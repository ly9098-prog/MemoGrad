import asyncio
import json
import logging
import os
import time
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.import_sse_metrics as import_sse_metrics
from app.api.v1.admin_import_ocr_text import router as ocr_text_router
from app.core.admin_guards import (
    admin_rate_limit,
    finish_idempotency,
    require_idempotency,
)
from app.core.admin_redis import IdempotencyClaim, release_idempotent_request
from app.core.admin_security import AdminPrincipal, require_permissions
from app.core.config import settings
from app.core.database import get_db
from app.core.runtime_paths import API_ADMIN_V1_PREFIX
from app.features import question_publish_service as publish_svc
from app.features.import_mode import ImportMode
from app.schemas.admin_imports import (
    AdminImportActionResponse,
    AdminImportBatchCompleteRequest,
    AdminImportBatchCompleteResponse,
    AdminImportBatchDetail,
    AdminImportBatchListItem,
    AdminImportCompleteResponse,
    AdminImportDeleteResponse,
    AdminImportEnrichResponse,
    AdminImportQuestionItem,
    AdminImportQuestionUpdateRequest,
    AdminImportRejectRequest,
    AdminImportTaskStatusResponse,
    BatchAnswerApplyRequest,
    BatchAnswerApplyResponse,
    BatchAnswerImageApplyRequest,
    BatchAnswerPreviewRequest,
    BatchAnswerPreviewResponse,
    BatchImageJobStatusResponse,
    BatchImageReparseResponse,
    BatchImageUploadResponse,
    QuestionCsvImportResponse,
    TextImportRequest,
    TextImportResponse,
    TextImportResultItem,
    TextParseRequest,
    TextParseResponse,
)
from app.schemas.common import paginated_response
from app.schemas.import_review import PipelineStatusResponse, PipelineUploadResponse
from app.schemas.question_publish import PublishResponse
from app.services.admin_audit_service import write_admin_audit
from app.services.admin_import_service import (
    approve_import_batch,
    approve_import_question,
    approve_low_risk_questions,
    batch_complete_import_questions,
    complete_import_question,
    create_enrich_task,
    delete_import_batch,
    delete_import_question,
    get_enrich_status,
    get_import_batch_detail,
    list_import_batches,
    list_review_queue,
    list_subject_options,
    reject_import_batch,
    reject_import_question,
    update_import_question,
)
from app.services.import_enqueue_outcome import ImportEnqueueUncertainError
from app.services.import_pipeline_service import (
    get_pipeline_status as svc_get_pipeline_status,
)
from app.services.import_upload_service import (
    start_import_pipeline as svc_start_import_pipeline,
)
from app.services.question_csv_import_service import (
    MAX_QUESTIONS_CSV_BYTES,
    QuestionCsvValidationError,
    import_questions_csv,
)
from app.services.streaming_upload_handler import stream_to_temp, validate_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix=f"{API_ADMIN_V1_PREFIX}/imports", tags=["admin-imports"])
router.include_router(ocr_text_router)

_SSE_MAX_CONNECTIONS_PER_USER = 5
_SSE_MAX_GLOBAL_CONNECTIONS = 50
_PIPELINE_SSE_MAX_SECONDS = 300
_PIPELINE_SSE_POLL_SECONDS = 2.5
_PIPELINE_STOPPED = {
    "completed",
    "completed_with_warnings",
    "success",
    "finished",
    "failed",
    "error",
    "cancelled",
    "paused",
    "interrupted",
}
_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _stream_connections() -> dict[int, int]:
    from app.features import batch_image_import_service as batch_svc

    if not hasattr(batch_svc, "_active_sse_connections"):
        batch_svc._active_sse_connections = {}
    return batch_svc._active_sse_connections


def _stream_limit_response(connections: dict[int, int], admin_id: int) -> JSONResponse | None:
    total = sum(connections.values())
    if total >= _SSE_MAX_GLOBAL_CONNECTIONS:
        import_sse_metrics.counters["global_rejected"] += 1
        logger.warning("SSE global connection limit reached: %d active", total)
        return JSONResponse(
            status_code=503,
            content={"detail": "Server at SSE capacity", "code": "SSE_GLOBAL_LIMIT"},
        )
    if connections.get(admin_id, 0) >= _SSE_MAX_CONNECTIONS_PER_USER:
        import_sse_metrics.counters["per_user_rejected"] += 1
        logger.warning("SSE per-user connection limit reached for user %s", admin_id)
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many SSE connections", "code": "SSE_LIMIT"},
        )
    return None


def _change_stream_count(connections: dict[int, int], admin_id: int, delta: int) -> None:
    connections[admin_id] = max(0, connections.get(admin_id, 0) + delta)
    import_sse_metrics.counters["active"] = sum(connections.values())


def _question_csv_error_response(
    *, status_code: int, message: str, code: str
) -> JSONResponse:
    """Return administrator-safe CSV diagnostics without global sanitization.

    The application-level HTTPException handler intentionally replaces arbitrary
    backend details with a generic message. CSV import validation errors are a
    special case: they contain only file row/field diagnostics and are useful to
    the administrator. Keep both ``detail`` and the standard ``error.message``
    envelope so old/new admin clients and reverse proxies can surface the same
    concrete reason.
    """

    safe_message = (message or "CSV 导入失败").strip()[:4000]
    return JSONResponse(
        status_code=status_code,
        content={
            "detail": safe_message,
            "error": {
                "code": code,
                "message": safe_message,
                "retryable": False,
            },
        },
    )


def _raise_import_error(exc: ValueError) -> None:
    if str(exc) in {"导入批次不存在", "导入题目不存在", "AI任务不存在"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
    )


@router.post("/upload", response_model=PipelineUploadResponse)
async def upload_import_file(
    file: UploadFile,
    subject: str | None = None,
    subject_id: int | None = None,
    import_mode: ImportMode = ImportMode.AUTO,
    enable_ai_repair: bool = True,
    confidence_threshold: float = 0.6,
    image_fast_mode: bool = Query(
        True,
        description="图片快速解析：OCR 后只保留题目级 AI repair，避免逐 OCR 块重复调用模型",
    ),
    page_start: int | None = None,
    page_end: int | None = None,
    current_admin=Depends(require_permissions("import:write")),
):
    suffix = os.path.splitext(file.filename or "")[1] or ".bin"
    tmp = await stream_to_temp(file, suffix=suffix)
    try:
        result = await svc_start_import_pipeline(
            file_path=tmp.path,
            filename=file.filename or "",
            content_type=file.content_type,
            subject=subject,
            subject_id=subject_id,
            import_mode=import_mode.value
            if isinstance(import_mode, ImportMode)
            else import_mode,
            enable_ai_repair=enable_ai_repair,
            confidence_threshold=confidence_threshold,
            image_fast_mode=image_fast_mode,
            page_start=page_start,
            page_end=page_end,
            created_by=f"admin:{current_admin.id}",
        )
    except ImportEnqueueUncertainError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    finally:
        # Workers consume the durable staging object, not this request's file.
        tmp.close()
    return result


@router.post("/questions-csv", response_model=QuestionCsvImportResponse)
async def import_questions_csv_file(
    file: UploadFile = File(...),
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """Directly import an exported questions CSV into the target question bank."""
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="仅支持 .csv 文件",
        )

    try:
        tmp = await stream_to_temp(
            file,
            max_size=MAX_QUESTIONS_CSV_BYTES,
            suffix=".csv",
        )
    except ValueError as exc:
        # This endpoint opts into returning user-safe import validation details.
        # The global HTTPException handler intentionally strips ``detail``.
        return _question_csv_error_response(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            message=str(exc),
            code="QUESTION_CSV_TOO_LARGE",
        )

    try:
        result = await import_questions_csv(
            db,
            tmp.path,
            admin_id=current_admin.id,
        )
        await db.commit()
        return QuestionCsvImportResponse(
            total_rows=result.total_rows,
            inserted_count=result.inserted_count,
            skipped_count=result.skipped_count,
            first_question_id=result.first_question_id,
            last_question_id=result.last_question_id,
        )
    except QuestionCsvValidationError as exc:
        await db.rollback()
        # CSV validation messages contain only row/field diagnostics and are
        # safe to show to the administrator. Return directly so the global
        # sanitized HTTPException handler does not replace them with a generic
        # "请求参数有误" message.
        return _question_csv_error_response(
            status_code=status.HTTP_400_BAD_REQUEST,
            message=str(exc),
            code="QUESTION_CSV_VALIDATION_ERROR",
        )
    except Exception:
        await db.rollback()
        logger.exception("questions CSV import failed")
        raise
    finally:
        tmp.close()


@router.post("/segment-image/upload")
async def upload_segment_image(
    file: UploadFile,
    _=Depends(require_permissions("import:write")),
):
    """ "上传segment编辑器中的替换图片，压缩后保存到存储后端并返回URL。"""
    from app.services.storage_backend import compress_image, get_storage

    ctype = (file.content_type or "").lower()
    if ctype and not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="仅支持图片文件")
    MAX_SIZE = 10 * 1024 * 1024
    filename = file.filename or "segment.png"
    suffix = os.path.splitext(filename)[1] or ".png"
    try:
        tmp = await stream_to_temp(file, max_size=MAX_SIZE, suffix=suffix)
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    try:
        if tmp.size == 0:
            raise HTTPException(status_code=400, detail="图片内容为空")
        with open(tmp.path, "rb") as fh:
            data = fh.read(MAX_SIZE + 1)
        storage = get_storage()
        compressed = compress_image(data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="图片格式无效或尺寸过大") from exc
    finally:
        tmp.close()
    if compressed.startswith(b"\x89PNG\r\n\x1a\n"):
        extension = ".png"
    elif compressed.startswith(b"RIFF") and compressed[8:12] == b"WEBP":
        extension = ".webp"
    else:
        extension = ".jpg"
    storage_key = f"segments/{uuid.uuid4().hex}{extension}"
    url = await storage.upload(storage_key, compressed)
    return {"url": url, "filename": storage_key.rsplit("/", 1)[-1]}


@router.get("/pipelines/{pipeline_id}", response_model=PipelineStatusResponse)
async def get_admin_pipeline_status(
    pipeline_id: str,
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await svc_get_pipeline_status(pipeline_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/pipelines/{pipeline_id}/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def stream_admin_pipeline_status(
    pipeline_id: str,
    request: Request,
    current_admin: AdminPrincipal = Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    from app.core.database import async_session

    admin_id = current_admin.id
    connections = _stream_connections()
    rejection = _stream_limit_response(connections, admin_id)
    if rejection is not None:
        return rejection
    try:
        initial = await svc_get_pipeline_status(pipeline_id, db)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        await db.close()

    async def events():
        if _stream_limit_response(connections, admin_id) is not None:
            yield 'event: error\ndata: {"message":"SSE connection limit reached"}\n\n'
            return

        _change_stream_count(connections, admin_id, 1)
        deadline = time.monotonic() + _PIPELINE_SSE_MAX_SECONDS
        snapshot = initial
        previous = None
        try:
            while time.monotonic() < deadline:
                if await request.is_disconnected():
                    import_sse_metrics.counters["disconnected"] += 1
                    return
                if snapshot != previous:
                    yield f"event: status\ndata: {snapshot.model_dump_json()}\n\n"
                    if snapshot.status in _PIPELINE_STOPPED:
                        yield f'event: done\ndata: {json.dumps({"status": snapshot.status})}\n\n'
                        return
                    previous = snapshot
                else:
                    yield ": heartbeat\n\n"
                await asyncio.sleep(_PIPELINE_SSE_POLL_SECONDS)
                async with async_session() as status_db:
                    snapshot = await svc_get_pipeline_status(pipeline_id, status_db)
            import_sse_metrics.counters["max_duration_closed"] += 1
            yield 'event: timeout\ndata: {"message":"SSE connection expired"}\n\n'
        except Exception:
            logger.exception("Pipeline SSE status lookup failed: pipeline_id=%s", pipeline_id)
            yield 'event: error\ndata: {"message":"Status lookup failed"}\n\n'
        finally:
            _change_stream_count(connections, admin_id, -1)

    return StreamingResponse(events(), media_type="text/event-stream", headers=_SSE_HEADERS)


_RESUMABLE_STATUSES = {"failed", "paused", "interrupted"}


@router.post("/pipelines/{pipeline_id}/resume")
async def admin_resume_pipeline(
    pipeline_id: str,
    file: UploadFile,
    enable_ai_repair: bool | None = None,
    enable_ocr_correction: bool | None = None,
    confidence_threshold: float | None = Query(None, ge=0, le=1),
    image_fast_mode: bool | None = None,
    subject: str | None = None,
    subject_id: int | None = Query(None, ge=1),
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """Re-upload the original file and resume with its original execution settings."""
    from app.services.import_recovery_service import ImportRecoveryError, resume_import

    try:
        return await resume_import(db, pipeline_id, file, {
            "enable_ai_repair": enable_ai_repair,
            "enable_ocr_correction": enable_ocr_correction,
            "confidence_threshold": confidence_threshold,
            "image_fast_mode": image_fast_mode,
            "subject": subject, "subject_id": subject_id,
        })
    except ImportEnqueueUncertainError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ImportRecoveryError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code}) from exc


@router.get("/review-queue")
async def get_import_review_queue(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = "pending",
    batch_id: str | None = None,
    subject: str | None = None,
    subject_id: int | None = None,
    source_type: str | None = None,
    keyword: str | None = None,
    risk_level: str | None = Query(None, pattern="^(high|medium|low)$"),
    answer_status: str | None = Query(
        None,
        pattern="^(missing|imported|ai_filled|manual_filled|manual_verified|abnormal)$",
    ),
    question_type: str | None = None,
    sort: str | None = Query(
        None, pattern="^(source_order|created_desc|risk_desc|answer_priority)$"
    ),
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    items, total = await list_review_queue(
        db,
        page,
        page_size,
        status,
        batch_id,
        subject,
        source_type,
        keyword,
        risk_level=risk_level,
        subject_id=subject_id,
        answer_status=answer_status,
        question_type=question_type,
        sort=sort,
    )
    return paginated_response(items, total, page, page_size)


@router.get("/subject-options")
async def get_subject_options(
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    """返回科目列表供下拉框使用。"""
    return await list_subject_options(db)


@router.get("/questions/{import_id}", response_model=AdminImportQuestionItem)
async def get_import_question_item(
    import_id: int,
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    """Get full detail for a single import question, including large fields."""
    from app.services.admin_import_service import get_import_question_detail

    try:
        return await get_import_question_detail(db, import_id)
    except ValueError as exc:
        _raise_import_error(exc)


@router.put("/questions/{import_id}")
async def update_import_question_item(
    import_id: int,
    data: AdminImportQuestionUpdateRequest,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await update_import_question(db, import_id, data)
        await db.commit()
        return item
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)


@router.post(
    "/questions/{import_id}/complete", response_model=AdminImportCompleteResponse
)
async def complete_import_question_item(
    import_id: int,
    request: Request,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await complete_import_question(db, import_id, current_admin, request)
        await db.commit()
        return result
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)
    except PermissionError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.post(
    "/questions/batch-complete", response_model=AdminImportBatchCompleteResponse
)
async def batch_complete_import_questions_item(
    data: AdminImportBatchCompleteRequest,
    request: Request,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await batch_complete_import_questions(
            db,
            data.import_ids,
            data.fields,
            data.strategy,
            current_admin,
            request,
        )
        return result
    except ValueError as exc:
        _raise_import_error(exc)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.post("/questions/{import_id}/approve", response_model=AdminImportActionResponse)
async def approve_import_question_item(
    import_id: int,
    request: Request,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await approve_import_question(db, import_id, current_admin.id)
        await write_admin_audit(
            db,
            current_admin,
            "import.approve",
            "import",
            import_id,
            severity="important",
            detail={
                "batch_id": item.batch_id,
                "question_id": item.question_id,
                "status": item.status,
            },
            request=request,
        )
        await db.commit()
        return AdminImportActionResponse(
            id=item.id, status=item.status, affected_count=1
        )
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)


@router.post("/questions/{import_id}/reject", response_model=AdminImportActionResponse)
async def reject_import_question_item(
    import_id: int,
    data: AdminImportRejectRequest | None = None,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await reject_import_question(
            db, import_id, current_admin.id, data.reason if data else None
        )
        await db.commit()
        return AdminImportActionResponse(
            id=item.id, status=item.status, affected_count=1
        )
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)


@router.post("/{batch_id}/approve", response_model=AdminImportActionResponse)
async def approve_import_batch_items(
    batch_id: str,
    request: Request,
    current_admin: AdminPrincipal = Depends(require_permissions("import:write")),
    _: None = Depends(admin_rate_limit),
    idem: IdempotencyClaim = Depends(require_idempotency),
    db: AsyncSession = Depends(get_db),
):
    if idem.response is not None:
        return AdminImportActionResponse(**idem.response)
    try:
        count = await approve_import_batch(db, batch_id, current_admin.id)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        await release_idempotent_request(idem)
        _raise_import_error(exc)
    except Exception:
        await db.rollback()
        await release_idempotent_request(idem)
        raise
    # A committed operation must keep its pending claim if result storage fails.
    response = AdminImportActionResponse(
        batch_id=batch_id, status="approved", affected_count=count
    )
    await finish_idempotency(idem, response.model_dump(mode="json"))
    return response


@router.post("/{batch_id}/approve-low-risk")
async def approve_low_risk_batch_items(
    batch_id: str,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await approve_low_risk_questions(db, batch_id, current_admin.id)
        await db.commit()
        return result
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)


@router.post("/{batch_id}/reject", response_model=AdminImportActionResponse)
async def reject_import_batch_items(
    batch_id: str,
    request: Request,
    data: AdminImportRejectRequest | None = None,
    current_admin: AdminPrincipal = Depends(require_permissions("import:write")),
    _: None = Depends(admin_rate_limit),
    idem: IdempotencyClaim = Depends(require_idempotency),
    db: AsyncSession = Depends(get_db),
):
    if idem.response is not None:
        return AdminImportActionResponse(**idem.response)
    try:
        count = await reject_import_batch(
            db, batch_id, current_admin.id, data.reason if data else None
        )
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        await release_idempotent_request(idem)
        _raise_import_error(exc)
    except Exception:
        await db.rollback()
        await release_idempotent_request(idem)
        raise
    # A committed operation must keep its pending claim if result storage fails.
    response = AdminImportActionResponse(
        batch_id=batch_id, status="rejected", affected_count=count
    )
    await finish_idempotency(idem, response.model_dump(mode="json"))
    return response


@router.post("/{batch_id}/publish", response_model=PublishResponse)
async def publish_import_batch_items(
    batch_id: str,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await publish_svc.publish_questions(db, batch_id=batch_id)
    except ValueError as exc:
        _raise_import_error(exc)


@router.delete("/questions/{import_id}", response_model=AdminImportDeleteResponse)
async def delete_import_question_item(
    import_id: int,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        count = await delete_import_question(db, import_id)
        await db.commit()
        return AdminImportDeleteResponse(id=import_id, deleted_count=count)
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)


@router.delete("/{batch_id}", response_model=AdminImportDeleteResponse)
async def delete_import_batch_items(
    batch_id: str,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        count = await delete_import_batch(db, batch_id)
        await db.commit()
        return AdminImportDeleteResponse(batch_id=batch_id, deleted_count=count)
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)


@router.get("")
async def list_imports(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    source_type: str | None = None,
    keyword: str | None = None,
    batch_id: str | None = None,
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    batches, total = await list_import_batches(
        db, page, page_size, status, source_type, keyword, batch_id=batch_id,
    )
    return paginated_response(
        [AdminImportBatchListItem.model_validate(item) for item in batches],
        total,
        page,
        page_size,
    )


@router.get("/pipelines")
async def list_pipelines(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    source_type: str | None = None,
    sort_by: str = "started_at",
    keyword: str | None = None,
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    """List import pipelines before the dynamic ``/{batch_id}`` route."""
    return await _list_pipelines_impl(
        page=page,
        page_size=page_size,
        status=status,
        source_type=source_type,
        sort_by=sort_by,
        keyword=keyword,
        db=db,
    )


@router.get("/{batch_id}", response_model=AdminImportBatchDetail)
async def get_import_detail(
    batch_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_import_batch_detail(db, batch_id, page, page_size, status)
    except ValueError as exc:
        _raise_import_error(exc)


@router.post("/{batch_id}/enrich", response_model=AdminImportEnrichResponse)
async def create_import_enrich_task(
    batch_id: str,
    request: Request,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        task = await create_enrich_task(db, batch_id, current_admin, request)
        await db.commit()
        return task
    except ValueError as exc:
        await db.rollback()
        _raise_import_error(exc)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.post("/text-parse", response_model=TextParseResponse)
async def parse_text_questions(
    data: TextParseRequest,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """解析用户粘贴的文本，返回结构化题目预览。"""
    from app.features.text_question_parser import parse_text_questions_async

    result = await parse_text_questions_async(
        data.text,
        data.subject,
        db=db,
        subject_id=data.subject_id,
        admin_quota_admin_id=current_admin.id,
    )
    return TextParseResponse(**result)


@router.post("/text-import", response_model=TextImportResponse)
async def import_text_questions(
    data: TextImportRequest,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """将解析后的文本题目写入 question_imports 暂存区。"""
    import uuid
    from datetime import datetime

    from app.features.question_import_writer import _create_question_import
    from app.features.question_pipeline import process_question_pipeline

    batch_id = (
        f"BATCH_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
    )
    items: list[TextImportResultItem] = []
    succeeded = 0
    failed = 0
    duplicates_filtered = 0

    for i, q in enumerate(data.questions):
        try:
            q_input = {
                "subject": q.subject or data.subject,
                "subject_id": q.subject_id or data.subject_id,
                # 文本导入写入的是审核暂存区，允许科目留空；最终发布前
                # 仍由审核流程保证 Question.subject_id 满足数据库约束。
                "allow_subjectless": True,
                "skip_ocr_quality_gate": True,
                "stem": q.stem,
                "options": q.options,
                "answer": q.answer or "",
                "analysis": q.analysis or "",
                "question_type": q.question_type or "",
                "knowledge_points": q.knowledge_points,
                "difficulty": q.difficulty,
            }

            result = process_question_pipeline(
                q_input,
                source_type="text",
                source={"file": "text_import", "page": 0},
            )

            if not result["is_valid"]:
                items.append(
                    TextImportResultItem(
                        block_index=i,
                        status="fail",
                        error=f"校验失败: {', '.join(result['errors'])}",
                    )
                )
                failed += 1
                continue

            async with db.begin_nested():
                qi = await _create_question_import(
                    db,
                    batch_id=batch_id,
                    source_type="text",
                    source_file="text_import",
                    raw_data=q.model_dump(),
                    result=result,
                    skip_existing=True,
                )
            if qi is None:
                items.append(
                    TextImportResultItem(
                        block_index=i,
                        status="duplicate",
                        error="题库中已存在相同题目",
                    )
                )
                duplicates_filtered += 1
                continue
            items.append(
                TextImportResultItem(
                    block_index=i,
                    import_id=qi.id,
                    status="ok",
                )
            )
            succeeded += 1
        except Exception as exc:
            items.append(
                TextImportResultItem(
                    block_index=i,
                    status="fail",
                    error=str(exc),
                )
            )
            failed += 1

    await db.commit()
    return TextImportResponse(
        batch_id=batch_id,
        items=items,
        total=len(data.questions),
        succeeded=succeeded,
        failed=failed,
        duplicates_filtered=duplicates_filtered,
    )


# ---------------------------------------------------------------------------
# 快速补充答案（Phase 1 — 答案串补录）
# ---------------------------------------------------------------------------

_MAX_RAW_TEXT_LENGTH = 50_000


@router.post("/{batch_id}/answers/preview", response_model=BatchAnswerPreviewResponse)
async def batch_answer_preview(
    batch_id: str,
    data: BatchAnswerPreviewRequest,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """解析答案串，生成预览（不写入数据库）。"""
    from app.services.batch_answer_service import BusinessError, generate_preview

    if len(data.raw_text) > _MAX_RAW_TEXT_LENGTH:
        raise HTTPException(
            status_code=422,
            detail={"error_code": "TEXT_TOO_LONG", "detail": "答案文本过长"},
        )

    try:
        return await generate_preview(
            db,
            batch_id,
            data.raw_text,
            admin_id=current_admin.id,
        )
    except BusinessError as exc:
        logger.warning(
            "batch_answer_preview failed: batch_id=%s error_code=%s message=%s",
            batch_id,
            exc.code,
            exc.message,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": exc.code, "detail": exc.message},
        )
    except ValueError as exc:
        logger.warning(
            "batch_answer_preview invalid input: batch_id=%s error=%s",
            batch_id,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "INVALID_INPUT", "detail": str(exc)},
        )


@router.post("/{batch_id}/answers/apply", response_model=BatchAnswerApplyResponse)
async def batch_answer_apply(
    batch_id: str,
    data: BatchAnswerApplyRequest,
    request: Request,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """确认预览结果，写入答案到数据库。"""
    from app.services.batch_answer_service import BusinessError, apply_preview

    try:
        result = await apply_preview(
            db, batch_id, data.preview_token, current_admin, request=request
        )
        return result
    except HTTPException:
        raise
    except BusinessError as exc:
        logger.warning(
            "batch_answer_apply failed: batch_id=%s error_code=%s message=%s",
            batch_id,
            exc.code,
            exc.message,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": exc.code, "detail": exc.message},
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "INVALID_INPUT", "detail": str(exc)},
        )
    except Exception as exc:
        logger.exception("Batch answer apply failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error_code": "INTERNAL_ERROR", "detail": "写入失败，请稍后重试"},
        )


# ---------------------------------------------------------------------------
# 快速补充答案 — 图片导入（Phase 2）
# ---------------------------------------------------------------------------

_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_IMAGE_MAX_FILES = 50
_IMAGE_MAX_TOTAL_BYTES = 50 * 1024 * 1024


def _get_image_max_bytes() -> int:
    """Return image max bytes from settings (Pydantic default is 5 MB)."""
    from app.core.config import settings

    return settings.IMAGE_IMPORT_MAX_BYTES


def _validate_answer_image(
    filename: str, content: bytes, content_type: str | None
) -> str | None:
    """校验单张答案/解析图片，返回错误原因（None 表示通过）。"""
    max_bytes = _get_image_max_bytes()
    if not filename:
        return "文件名为空"
    if not filename.lower().endswith(_IMAGE_EXTENSIONS):
        return "仅支持 .jpg / .jpeg / .png / .webp"
    if content_type and content_type not in _IMAGE_CONTENT_TYPES:
        return f"Content-Type 不支持: {content_type}"
    if not content:
        return "图片内容为空"
    if len(content) > max_bytes:
        return f"图片过大（最大 {max_bytes // (1024 * 1024)}MB）"
    return None


@router.post("/{batch_id}/answers/image/preview")
async def batch_answer_image_preview(
    batch_id: str,
    files: list[UploadFile] = File(..., description="答案/解析图片（多张）"),
    mode: str = Form(
        "answer_only", description="导入模式：answer_only | answer_analysis"
    ),
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """上传答案/解析图片，OCR 提取并生成预览。

    - 支持 jpg/png/webp，单次最多 50 张
    - mode=answer_only 仅提取答案
    - mode=answer_analysis 同时提取答案和解析
    - 不写入数据库，返回预览结果
    """
    from app.services.batch_answer_image_service import (
        BusinessError,
        generate_image_preview,
    )

    if not files:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "NO_FILES", "detail": "未上传任何图片"},
        )
    if len(files) > _IMAGE_MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "TOO_MANY_FILES",
                "detail": f"单次最多上传 {_IMAGE_MAX_FILES} 张图片",
            },
        )

    if mode not in ("answer_only", "answer_analysis"):
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": "INVALID_MODE",
                "detail": "mode 必须是 answer_only 或 answer_analysis",
            },
        )

    # 读取并校验图片
    images_data: list[dict] = []
    rejected: list[str] = []
    total_bytes = 0
    for f in files:
        filename = f.filename or f"image_{len(images_data)}"
        suffix = os.path.splitext(filename)[1] or ".png"
        try:
            tmp = await stream_to_temp(
                f,
                max_size=_get_image_max_bytes(),
                suffix=suffix,
            )
        except ValueError as exc:
            rejected.append(f"{filename}: {exc}")
            continue
        except Exception:
            rejected.append(f"{filename}: 读取失败")
            continue

        try:
            total_bytes += tmp.size
            if total_bytes > _IMAGE_MAX_TOTAL_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"上传图片总量超过 {_IMAGE_MAX_TOTAL_BYTES // (1024 * 1024)}MB 限制",
                )
            with open(tmp.path, "rb") as fh:
                content = fh.read(_get_image_max_bytes() + 1)
        finally:
            tmp.close()

        err = _validate_answer_image(filename, content, f.content_type)
        if err:
            rejected.append(f"{filename}: {err}")
            continue

        images_data.append({"filename": filename, "bytes": content})

    if not images_data:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "ALL_FILES_REJECTED",
                "detail": f"所有图片均未通过校验: {'; '.join(rejected)}",
            },
        )

    try:
        result = await generate_image_preview(
            db,
            batch_id,
            images_data,
            mode=mode,
            admin_id=current_admin.id,
        )
        if rejected:
            result.setdefault("warnings", []).append(
                f"{len(rejected)} 张图片未通过校验: {'; '.join(rejected)}"
            )
        return result
    except BusinessError as exc:
        logger.warning(
            "batch_answer_image_preview failed: batch_id=%s error_code=%s message=%s",
            batch_id,
            exc.code,
            exc.message,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": exc.code, "detail": exc.message},
        )
    except ValueError as exc:
        logger.warning(
            "batch_answer_image_preview invalid input: batch_id=%s error=%s",
            batch_id,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "INVALID_INPUT", "detail": str(exc)},
        )


@router.post("/{batch_id}/answers/image/apply")
async def batch_answer_image_apply(
    batch_id: str,
    data: BatchAnswerImageApplyRequest,
    request: Request,
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """确认图片预览结果，写入答案/解析到数据库。"""
    from app.services.batch_answer_image_service import (
        BusinessError,
        apply_image_preview,
    )

    try:
        result = await apply_image_preview(
            db,
            batch_id,
            data.preview_token,
            current_admin,
            request=request,
        )
        return result
    except HTTPException:
        raise
    except BusinessError as exc:
        logger.warning(
            "batch_answer_image_apply failed: batch_id=%s error_code=%s message=%s",
            batch_id,
            exc.code,
            exc.message,
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": exc.code, "detail": exc.message},
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error_code": "INVALID_INPUT", "detail": str(exc)},
        )
    except Exception as exc:
        logger.exception("Batch answer image apply failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error_code": "INTERNAL_ERROR", "detail": "写入失败，请稍后重试"},
        )


@router.get("/{batch_id}/status", response_model=AdminImportTaskStatusResponse)
async def get_import_enrich_status(
    batch_id: str,
    _=Depends(require_permissions("import:read")),
):
    try:
        return await get_enrich_status(batch_id)
    except ValueError as exc:
        _raise_import_error(exc)


# ---------------------------------------------------------------------------
# 批量图片导题（多图片 → 复用现有单图 OCR/AI/审核流水线）
# ---------------------------------------------------------------------------

_BATCH_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")
_BATCH_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/batch-image/upload", response_model=BatchImageUploadResponse)
async def batch_image_upload(
    files: list[UploadFile],
    subject: str | None = None,
    subject_id: int | None = None,
    concurrency: int | None = None,
    enable_ai_repair: bool = True,
    confidence_threshold: float = Query(0.6, ge=0, le=1, allow_inf_nan=False),
    batch_fast_mode: bool = Query(
        True,
        description="批量图片快速模式：OCR 后跳过逐块纠错/代码重建/Roman 独立调用，仅保留题目级 AI repair",
    ),
    ocr_mode: str = Query("local", alias="ocr_mode"),
    # Idempotency / trace identifiers
    batch_id: str | None = Query(None, description="前端生成的 batch 标识"),
    image_id: str | None = Query(
        None,
        description="前端生成的 image 标识（单图）。对多图，传 image_ids[] 或自动生成派生 ID",
    ),
    image_ids: list[str] = Query(
        [],
        alias="image_ids",
        description="各图片 image_import_id（可选，长度与 files 一致）",
    ),
    request_id: str | None = Query(
        None, description="前端生成的 request 标识（幂等键）"
    ),
    current_admin=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """批量上传图片，逐张走现有 OCR → AI 解析 → 待审核流水线（队列模式）。

    - 并发 2~4（默认取 settings.BATCH_IMAGE_DEFAULT_CONCURRENCY），其余排队；
    - 单张失败只记录、不终止整批；
    - 返回 job_id，通过 GET /imports/batch-image/{job_id} 查询进度。
    - 支持 idempotency：request_id 重复时返回已有 job_id。
    - image_id: 向后兼容的单图模式。多图时传 image_ids[]。
    """
    from app.features import batch_image_import_service as batch_svc
    from app.services.batch_image_idempotency import (
        BatchSubmissionConflictError,
        validate_submission_ids,
    )

    if not files:
        raise HTTPException(status_code=400, detail="未上传任何图片")
    if len(files) > settings.BATCH_IMAGE_MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"单次最多上传 {settings.BATCH_IMAGE_MAX_FILES} 张图片",
        )

    try:
        validate_submission_ids(
            request_id=request_id, batch_id=batch_id, image_id=image_id, image_ids=image_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # P0-3: only validate dependencies matching the requested ocr_mode
    from app.features.ocr_mode import resolve_ocr_mode, validate_ocr_mode_dependencies

    try:
        resolved_mode = resolve_ocr_mode(ocr_mode)
        validate_ocr_mode_dependencies(resolved_mode)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # P0-4: resolve per-image IDs
    if image_ids and len(image_ids) != len(files):
        raise HTTPException(
            status_code=422,
            detail=f"image_ids 长度 ({len(image_ids)}) 与 files 长度 ({len(files)}) 不一致",
        )
    use_image_ids = bool(image_ids)
    # Warn about deprecated single-image_id with multiple files
    if image_id and len(files) > 1 and not use_image_ids:
        logger.warning(
            "Deprecated: single image_id=%s used for %d files. "
            "Each file will get a derived ID (image_id:seq). "
            "Use image_ids[] for per-file IDs.",
            image_id,
            len(files),
        )

    temporaries = []
    try:
        sources: list[batch_svc.BatchImageSource] = []
        sources_with_sha: list[tuple[batch_svc.BatchImageSource, str, str]] = []
        rejected_files: list[str] = []
        seq = 0
        for idx, upload in enumerate(files):
            filename = upload.filename or f"image_{seq + 1}"

            # Lightweight extension/content-type check before streaming
            if not filename.lower().endswith(_BATCH_IMAGE_EXTENSIONS):
                rejected_files.append(f"{filename}: 仅支持 .jpg / .jpeg / .png / .webp")
                continue
            if (
                upload.content_type
                and upload.content_type not in _BATCH_IMAGE_CONTENT_TYPES
            ):
                rejected_files.append(
                    f"{filename}: Content-Type 不支持: {upload.content_type}"
                )
                continue

            # Stream to temp file
            suffix = os.path.splitext(filename)[1] or ".png"
            try:
                tmp = await stream_to_temp(
                    upload, max_size=settings.IMAGE_IMPORT_MAX_BYTES or 0, suffix=suffix
                )
                temporaries.append(tmp)
            except ValueError as exc:
                rejected_files.append(f"{filename}: {exc}")
                continue
            if tmp.size == 0:
                tmp.close()
                rejected_files.append(f"{filename}: 图片内容为空")
                continue

            validation_error = await asyncio.to_thread(validate_image, tmp.path)
            if validation_error:
                tmp.close()
                rejected_files.append(f"{filename}: {validation_error}")
                continue

            # Compute source_sha256 for content-level dedup
            from app.services.import_pipeline_admission import _hash_file

            source_sha256_hex = await asyncio.to_thread(_hash_file, tmp.path)

            seq += 1

            # Resolve per-image image_import_id
            if use_image_ids:
                per_image_id = image_ids[idx]
            elif image_id and len(files) == 1:
                per_image_id = image_id
            elif image_id:
                per_image_id = f"{image_id}:{seq}"
            else:
                per_image_id = f"auto_{seq}"

            source_obj = batch_svc.BatchImageSource(
                seq=seq,
                source_file=filename,
                temp_path=tmp.path,
            )
            sources.append(source_obj)
            sources_with_sha.append((source_obj, source_sha256_hex, per_image_id))

        # Stage all source files to persistent storage for cross-process access
        from app.services.staging_storage import async_store_file

        try:
            validate_submission_ids(
                request_id=request_id, batch_id=batch_id, image_id=image_id,
                image_ids=[entry[2] for entry in sources_with_sha],
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        staging_object_ids: list[str] = []
        for src in sources:
            try:
                staging_obj = await async_store_file(
                    src.temp_path,
                    original_name=src.source_file,
                    mime="image/png",
                )
                staging_object_ids.append(staging_obj.object_id)
            except Exception as exc:
                logger.warning("Failed to stage batch image %s", src.source_file, exc_info=True)
                raise HTTPException(
                    status_code=503, detail="图片暂存失败，请稍后重新上传"
                ) from exc

        if not sources:
            raise HTTPException(
                status_code=400,
                detail="没有可处理的图片"
                + (f"（{rejected_files[0]}）" if rejected_files else ""),
            )

        concurrency = batch_svc.clamp_concurrency(concurrency)
        job_id = batch_svc.new_job_id()
        options = {
            "enable_ai_repair": enable_ai_repair,
            "confidence_threshold": confidence_threshold,
            "batch_fast_mode": batch_fast_mode,
            "ocr_mode": resolved_mode,
        }

        # P0-4: pass per-file image_import_id + source_sha256
        per_file_image_ids = [sid[2] for sid in sources_with_sha]
        per_file_sha256 = [sid[1] for sid in sources_with_sha]
        try:
            job = await batch_svc.create_batch_job(
                db,
                job_id=job_id,
                sources=sources,
                subject=subject,
                subject_id=subject_id,
                concurrency=concurrency,
                created_by=f"admin:{current_admin.id}",
                batch_import_id=batch_id,
                image_import_id=image_id,
                request_id=request_id,
                per_file_image_ids=per_file_image_ids,
                per_file_sha256=per_file_sha256,
                options=options,
                rejected_files=rejected_files,
            )
        except BatchSubmissionConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

        # Idempotency: duplicate submission returns existing job_id
        is_duplicate = job.status == "duplicate"
        if is_duplicate:
            from app.models.import_batch_job import ImportBatchJob

            existing_job = await db.get(ImportBatchJob, job.job_id, populate_existing=True)
            logger.info(
                "Duplicate batch image upload, returning existing job_id=%s", job.job_id
            )
            if (existing_job.status != "queued" or existing_job.current_owner_token
                    or not existing_job.submission_fingerprint):
                return BatchImageUploadResponse(
                    job_id=job.job_id,
                    status=existing_job.status,
                    total=existing_job.total,
                    rejected=len(rejected_files),
                    rejected_files=rejected_files,
                    concurrency=existing_job.concurrency,
                    duplicate=True,
                )
            # A producer may have lost its enqueue reply or exited after DB
            # commit. Replaying this same task_id repairs the handoff; Redis's
            # idempotency guard prevents a second execution if it was accepted.
            job_id = existing_job.job_id

        # Enqueue via durable queue — replaces BackgroundTasks (P0-3)
        from app.services.import_recovery_context import save_recovery_context
        from app.services.task_queue_worker import enqueue_batch_image_job

        await save_recovery_context(job_id, {
            "subject": subject,
            "subject_id": subject_id,
            "options": options,
            "created_by": f"admin:{current_admin.id}",
        })

        from functools import partial

        from sqlalchemy.exc import OperationalError

        from app.services.batch_image_admission import dispatch_batch_admission

        try:
            result = await dispatch_batch_admission(db, job_id, partial(
                enqueue_batch_image_job,
                job_id=job_id,
                staging_object_ids=staging_object_ids,
                subject=subject,
                subject_id=subject_id,
                options=options,
                concurrency=concurrency,
                source_files=[src.source_file for src in sources],
            ))
        except ImportEnqueueUncertainError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except OperationalError as exc:
            await db.rollback()
            raise HTTPException(status_code=503, detail="任务准入暂不可用，请查询状态后重试") from exc
        if result is not None and not result:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"任务队列已满，请稍后重试: {result.reason}",
            )

        from app.models.import_batch_job import ImportBatchJob

        admitted = await db.get(ImportBatchJob, job_id, populate_existing=True)

        return BatchImageUploadResponse(
            job_id=job_id,
            status=admitted.status,
            total=admitted.total,
            rejected=len(rejected_files),
            rejected_files=rejected_files,
            concurrency=admitted.concurrency,
            duplicate=is_duplicate,
        )
    finally:
        # Staging is content-addressed and may be shared by other jobs. Only
        # these request-owned temporary files are safe to remove immediately.
        for temporary in temporaries:
            temporary.close()


@router.get("/batch-image/{job_id}", response_model=BatchImageJobStatusResponse)
async def get_batch_image_job(
    job_id: str,
    _=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    """查询批量导题任务进度（总数/已完成/处理中/等待中 + 每张明细）。"""
    from app.features import batch_image_import_service as batch_svc

    try:
        return await batch_svc.get_batch_job_status(db, job_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get(
    "/batch-image/{job_id}/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def stream_batch_image_job(
    job_id: str,
    request: Request,
    last_event_id_query: int = Query(0, alias="lastEventId"),
    last_event_id_header: str | None = Header(None, alias="Last-Event-ID"),
    admin_user=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
):
    """SSE 流：增量推送 trace events，job 终态时发送 done event 后关闭。

    lastEventId query 参数与 Last-Event-ID header 均可指定增量游标。
    Last-Event-ID header 仅在 query 未传值时生效（EventSource 自动重连行为）。

    安全约束：
    - 单用户最多 _SSE_MAX_CONNECTIONS_PER_USER 个并发连接
    - 单连接最长 _SSE_MAX_DURATION_SEC 秒后自动关闭
    - 客户端断开时自动清理
    """
    from app.core.database import async_session
    from app.features import batch_image_import_service as batch_svc

    # ── Connection limits ──
    _SSE_MAX_DURATION_SEC = 7200  # 2 hours max
    _SSE_MAX_IDLE_SEC = 300  # 5 min without business event

    active_conns = _stream_connections()
    current_user_id = (
        admin_user.get("id")
        if isinstance(admin_user, dict)
        else getattr(admin_user, "id", 0)
    )

    rejection = _stream_limit_response(active_conns, current_user_id)
    if rejection is not None:
        return rejection
    await db.close()

    def _resolve_last_event_id() -> int:
        if last_event_id_query:
            return last_event_id_query
        if last_event_id_header is not None:
            try:
                return int(last_event_id_header)
            except (ValueError, TypeError):
                pass
        return 0

    async def event_generator():
        if _stream_limit_response(active_conns, current_user_id) is not None:
            yield 'event: error\ndata: {"message":"SSE connection limit reached"}\n\n'
            return

        last_event_id = _resolve_last_event_id()
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)

        # Track active connection
        _change_stream_count(active_conns, current_user_id, 1)
        start_time = time.time()
        last_business_event_time = start_time  # for idle timeout

        async def on_event(event_type: str, data: dict):
            """Put event into bounded queue — drop oldest trace if full.
            Only drops 'trace' events; 'done' and error events are never
            dropped (they close the stream).
            """
            nonlocal last_business_event_time
            if event_type != "heartbeat":
                last_business_event_time = time.time()
            if queue.full():
                if event_type == "trace":
                    return  # drop oldest trace — acceptable for progress
                # For non-trace events, make room by discarding oldest
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await queue.put((event_type, data))

        async def on_done():
            await queue.put(("done", {}))

        async def poll_db():
            nonlocal last_event_id
            async with async_session() as db:
                events = await batch_svc.poll_trace_events(
                    db, job_id, since_id=last_event_id
                )
                for ev in events:
                    ev_id = ev.get("id")
                    if ev_id is not None:
                        last_event_id = max(last_event_id, int(ev_id))

                payloads = [{"type": "trace", "data": ev} for ev in events]
                summary = await batch_svc.poll_job_summary(db, job_id)
                if summary and summary.get("status") in {
                    "completed",
                    "completed_with_warnings",
                    "failed",
                }:
                    payloads.append({"type": "done", "data": summary})
                return payloads

        # Try Redis Pub/Sub subscription with DB polling fallback
        from app.core.background_tasks import create_background_task

        sub_task = create_background_task(
            _run_sse_subscribe(job_id, on_event, on_done, poll_db),
            name=f"sse-sub-{job_id}",
        )
        try:
            while True:
                elapsed = time.time() - start_time
                if elapsed > _SSE_MAX_DURATION_SEC:
                    import_sse_metrics.counters["max_duration_closed"] += 1
                    yield f"event: timeout\ndata: {json.dumps({'message': 'connection max duration reached'})}\n\n"
                    return

                # Idle timeout — no business events within threshold
                idle_sec = time.time() - last_business_event_time
                if idle_sec > _SSE_MAX_IDLE_SEC:
                    import_sse_metrics.counters["max_idle_closed"] += 1
                    yield f"event: idle_timeout\ndata: {json.dumps({'message': 'connection idle timeout'})}\n\n"
                    return

                # Check client disconnect (FastAPI CancelledError handler is also present)
                if await request.is_disconnected():
                    import_sse_metrics.counters["disconnected"] += 1
                    return

                try:
                    event_type, data = await asyncio.wait_for(queue.get(), timeout=2.0)
                    if event_type == "done":
                        yield f"event: done\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                        return
                    yield f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                except TimeoutError:
                    # Heartbeat — no events in 2s (no DB access)
                    yield ": heartbeat\n\n"
                except Exception:
                    logger.exception("batch image SSE stream error: job_id=%s", job_id)
                    yield 'event: error\ndata: {"message":"Status stream failed"}\n\n'
                    return
        finally:
            _change_stream_count(active_conns, current_user_id, -1)
            if not sub_task.done():
                sub_task.cancel()
                try:
                    await sub_task
                except (asyncio.CancelledError, Exception):
                    logger.debug("SSE subscriber task cleanup for job %s", job_id)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


async def _run_sse_subscribe(
    job_id: str,
    on_event,
    on_done,
    poll_fn,
):
    """Run Pub/Sub subscription with DB polling fallback in background."""
    try:
        from app.services.sse_pubsub import subscribe_job

        await subscribe_job(
            job_id=job_id,
            on_event=on_event,
            on_done=on_done,
            poll_fn=poll_fn,
            poll_interval=2.0,
            timeout=3600,
        )
    except Exception:
        logger.warning("SSE subscribe failed for job %s, using direct poll", job_id)


@router.post(
    "/batch-image/items/{item_id}/retry",
)
async def retry_batch_image_item(
    item_id: int,
    file: UploadFile,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Re-upload one failed original image, retaining successful items in the job."""
    from app.services.batch_image_recovery_service import (
        retry_batch_image_item as retry_item,
    )
    from app.services.import_recovery_service import ImportRecoveryError

    try:
        return await retry_item(db, item_id, file)
    except ImportEnqueueUncertainError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ImportRecoveryError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code}) from exc


@router.post(
    "/batch-image/items/{item_id}/reparse", response_model=BatchImageReparseResponse
)
async def reparse_batch_image_item(
    item_id: int,
    subject: str | None = None,
    subject_id: int | None = None,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """基于缓存的 OCR 文本重新解析单张图片（不重复 OCR）。"""
    from app.features import batch_image_import_service as batch_svc

    try:
        return await batch_svc.reparse_item_from_cache(
            db, item_id, subject=subject, subject_id=subject_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


# ---------------------------------------------------------------------------
# P4-7: artifact / checkpoint / cache cleanup
# ---------------------------------------------------------------------------


@router.post("/pipelines/{pipeline_id}/cleanup")
async def admin_cleanup_pipeline_artifacts(
    pipeline_id: str,
    force: bool = False,
    _=Depends(require_permissions("import:write")),
):
    """清理指定 pipeline 的 artifact 文件。

    force=True 时跳过运行中检查，直接删除。
    """
    from app.features.pipeline_artifacts import cleanup_artifacts

    removed = cleanup_artifacts(pipeline_id, force=force)
    return {
        "pipeline_id": pipeline_id,
        "artifacts_removed": removed,
        "force": force,
    }


@router.post("/cleanup/expired")
async def admin_cleanup_expired_artifacts(
    completed_ttl: int = 86400,
    failed_ttl: int = 604800,
    _=Depends(require_permissions("import:write")),
):
    """清理所有过期 artifact。

    completed_ttl: completed pipeline artifact 保留秒数（默认 24h）
    failed_ttl: failed pipeline artifact 保留秒数（默认 7d）
    """
    from app.features.pipeline_artifacts import cleanup_expired

    results = cleanup_expired(
        completed_ttl=completed_ttl,
        failed_ttl=failed_ttl,
    )
    return {
        "cleaned": results,
        "total_pipelines": len(results),
        "completed_ttl": completed_ttl,
        "failed_ttl": failed_ttl,
    }


# ---------------------------------------------------------------------------
# P7-1: Pipelines list (API-level aggregation, no DB migration)
# ---------------------------------------------------------------------------


async def _list_pipelines_impl(
    db: AsyncSession,
    page: int,
    page_size: int,
    status: str | None = None,
    source_type: str | None = None,
    sort_by: str = "started_at",
    keyword: str | None = None,
) -> dict:
    from app.services.admin_import_history_service import list_import_runs

    return await list_import_runs(db, page, page_size, status, source_type, sort_by, keyword)


# ---------------------------------------------------------------------------
# P7-3: Maintenance — unified cleanup (artifacts + OCR cache, dry-run support)
# ---------------------------------------------------------------------------


@router.post("/maintenance/cleanup")
async def admin_maintenance_cleanup(
    request: dict,
    _=Depends(require_permissions("import:write")),
):
    """执行清理任务。

    请求:
        {
            "target": "all" | "artifacts" | "ocr_cache" | "db_rows",
            "dry_run": true
        }

    - artifacts: 清理过期 pipeline artifact 文件
    - ocr_cache: 清理过期 OCR 缓存条目
    - db_rows: 当前版本暂不实现（返回 not_implemented）

    dry_run=true 时只扫描不删除。
    真实删除（dry_run=false）需要先执行 dry-run 并确认。
    """
    from app.features.pipeline_artifacts import cleanup_expired as _cleanup_artifacts
    from app.services.ocr_cache_service import (
        cleanup_expired_entries as _cleanup_ocr_cache,
    )

    target = (request or {}).get("target", "all")
    dry_run = (request or {}).get("dry_run", True)

    results: dict[str, dict] = {}

    if target in ("all", "artifacts"):
        try:
            art_result = _cleanup_artifacts(dry_run=dry_run)
            results["artifacts"] = {
                "scanned_count": art_result.get("scanned_count", 0),
                "deleted_count": art_result.get("deleted_count", 0),
                "freed_bytes": art_result.get("freed_bytes", 0),
                "skipped_running_count": art_result.get("skipped_running_count", 0),
            }
        except Exception as exc:
            results["artifacts"] = {"error": str(exc)}

    if target in ("all", "ocr_cache"):
        try:
            cache_result = _cleanup_ocr_cache(dry_run=dry_run)
            results["ocr_cache"] = {
                "scanned_count": cache_result.get("scanned_count", 0),
                "deleted_count": cache_result.get("deleted_count", 0),
                "freed_bytes": cache_result.get("freed_bytes", 0),
                "skipped_count": cache_result.get("skipped_count", 0),
            }
        except Exception as exc:
            results["ocr_cache"] = {"error": str(exc)}

    if target in ("all", "db_rows"):
        # P7 第一版不实现 DB rows 物理删除
        results["db_rows"] = {
            "status": "not_implemented",
            "note": "DB row cleanup 需要先 dry-run 再 confirm=true，当前版本暂不实现",
        }

    return {
        "dry_run": dry_run,
        "target": target,
        "targets": results,
    }


# ---------------------------------------------------------------------------
# P7-4: Failure case export
# ---------------------------------------------------------------------------


@router.post("/questions/{import_id}/export-case")
async def admin_export_failure_case(
    import_id: int,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """导出单道失败题为 acceptance case 模板。

    expected_template 所有字段为空，必须人工填写。
    不导出完整 PDF/图片，raw_data 截断至 2000 字符。
    """
    from sqlalchemy import select

    from app.features.ocr_case_exporter import export_failure_case
    from app.models.question_import import QuestionImport

    row = (
        await db.execute(select(QuestionImport).where(QuestionImport.id == import_id))
    ).scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=404, detail="导入题目不存在")

    # Convert ORM to dict (safe fields only)
    q_import = {
        "id": row.id,
        "source_file": row.source_file,
        "source_page": None,
        "subject_id": row.subject_id,
        "subject": row.subject_ref.code if row.subject_ref else None,
        "question_type": row.question_type,
        "raw_data": row.raw_data or {},
        "stem": None,
        "options": None,
        "answer": None,
        "analysis": None,
        "risk_flags": row.risk_flags or [],
        "failure_types": [],
    }
    # Extract parsed content fields if available
    pc = row.parsed_content or {}
    if isinstance(pc, dict):
        q_import["stem"] = pc.get("stem")
        q_import["options"] = pc.get("options")
        q_import["answer"] = pc.get("answer")
        q_import["analysis"] = pc.get("analysis")

    case = export_failure_case(q_import)
    return case


@router.post("/batches/{batch_id}/export-failure-cases")
async def admin_export_batch_failure_cases(
    batch_id: str,
    failure_type: str | None = None,
    _=Depends(require_permissions("import:write")),
    db: AsyncSession = Depends(get_db),
):
    """批量导出批次内失败题为 acceptance case 模板。

    failure_type 可选：仅导出指定失败类型的题目。
    """
    from sqlalchemy import select

    from app.features.ocr_case_exporter import export_failure_cases_batch
    from app.models.question_import import QuestionImport

    rows = (
        (
            await db.execute(
                select(QuestionImport)
                .where(QuestionImport.batch_id == batch_id)
                .order_by(QuestionImport.id)
            )
        )
        .scalars()
        .all()
    )

    if not rows:
        raise HTTPException(status_code=404, detail="批次不存在或没有题目")

    items = []
    for row in rows:
        pc = row.parsed_content if isinstance(row.parsed_content, dict) else {}
        items.append(
            {
                "id": row.id,
                "source_file": row.source_file,
                "source_page": None,
                "subject_id": row.subject_id,
                "subject": row.subject_ref.code if row.subject_ref else None,
                "question_type": row.question_type,
                "raw_data": row.raw_data or {},
                "stem": pc.get("stem"),
                "options": pc.get("options"),
                "answer": pc.get("answer"),
                "analysis": pc.get("analysis"),
                "risk_flags": row.risk_flags or [],
                "failure_types": [],
            }
        )

    cases = export_failure_cases_batch(items, failure_type_filter=failure_type)
    return {
        "batch_id": batch_id,
        "total": len(items),
        "exported": len(cases),
        "cases": cases,
    }


def _cleanup_temp_sources(sources: list) -> None:
    """Delete temporary source files left on disk after duplicate-request cleanup.

    Safely ignores:
    - Sources without a temp_path attribute
    - Files that have already been deleted
    """
    for src in sources:
        temp_path = getattr(src, "temp_path", None)
        if not temp_path:
            continue
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        except OSError:
            logger.warning("Failed to remove temp source: %s", temp_path)
