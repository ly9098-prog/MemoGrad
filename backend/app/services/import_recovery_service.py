"""Validate original files and resubmit failed imports through the durable queue."""

from __future__ import annotations

import asyncio
import os
import uuid
from typing import Any

from fastapi import UploadFile
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.features import pipeline_orchestrator as orchestrator
from app.models.import_pipeline import ImportPipeline
from app.services import import_pipeline_service as runtime
from app.services.import_recovery_context import load_recovery_context
from app.services.import_upload_request import UploadRequest
from app.services.import_upload_service import _validate_upload
from app.services.staging_storage import StagingObject, async_store_file
from app.services.streaming_upload_handler import stream_to_temp, validate_image

RESUMABLE_STATUSES = {"failed", "paused", "interrupted"}


class ImportRecoveryError(ValueError):
    def __init__(
        self, message: str, status_code: int = 422, code: str | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code or {
            400: "IMPORT_RECOVERY_INVALID_FILE",
            404: "IMPORT_RECOVERY_NOT_FOUND",
            409: "IMPORT_RECOVERY_CONFLICT",
            503: "IMPORT_RECOVERY_QUEUE_UNAVAILABLE",
        }.get(status_code, "IMPORT_RECOVERY_ERROR")


async def stage_recovery_file(
    file: UploadFile,
    source_type: str,
    expected_sha256: str | None,
) -> StagingObject:
    suffix = os.path.splitext(file.filename or "")[1].lower()
    allowed = {
        "image": runtime._IMAGE_EXTENSIONS,
        "pdf": (".pdf",),
        "txt": (".txt",),
        "excel": (".xlsx", ".xls"),
    }
    if suffix not in allowed.get(source_type, ()):
        raise ImportRecoveryError("请重新上传与原任务类型一致的原始文件", 400)
    try:
        tmp = await stream_to_temp(file, suffix=suffix)
        with tmp:
            request = UploadRequest(tmp.path, file.filename or "", file.content_type)
            _validate_upload(request)
            digest = await asyncio.to_thread(runtime._sha256_of_file, tmp.path)
            if expected_sha256 and digest != expected_sha256:
                raise ImportRecoveryError(
                    "文件与原始导入文件不一致，请上传原文件",
                    400,
                    "IMPORT_SOURCE_MISMATCH",
                )
            if source_type == "image":
                if (
                    file.content_type
                    and file.content_type not in runtime._IMAGE_CONTENT_TYPES
                ):
                    raise ImportRecoveryError("图片 Content-Type 不支持", 400)
                error = await asyncio.to_thread(validate_image, tmp.path)
                if error:
                    raise ImportRecoveryError(error, 400)
            return await async_store_file(
                tmp.path,
                original_name=file.filename or "",
                mime=file.content_type or "",
            )
    except ImportRecoveryError:
        raise
    except ValueError as exc:
        raise ImportRecoveryError(str(exc), 400) from exc


async def _load_resume_inputs(
    db: AsyncSession,
    pipeline_id: str,
    overrides: dict[str, Any],
) -> tuple[ImportPipeline, dict, dict, dict]:
    row = await db.get(ImportPipeline, pipeline_id)
    snapshot = await runtime._get_image_pipeline_status(pipeline_id)
    if snapshot is None:
        snapshot = await orchestrator._get_pipeline_store(pipeline_id)
    if row is None:
        raise ImportRecoveryError("流水线不存在", 404)
    state = (snapshot or {}).get("status", row.status)
    if row.status not in RESUMABLE_STATUSES:
        raise ImportRecoveryError(f"流水线当前状态为 {state}，不可恢复", 409)
    checkpoint = await orchestrator._get_stage_checkpoint(pipeline_id) or {}
    context = await load_recovery_context(pipeline_id, row.source_type)
    if (
        not context
        and not checkpoint
        and not all(
            overrides.get(name) is not None
            for name in ("enable_ai_repair", "confidence_threshold", "image_fast_mode")
        )
    ):
        raise ImportRecoveryError(
            "原任务设置已过期，请在重传时提供原始导入设置",
            409,
            "IMPORT_RECOVERY_CONTEXT_EXPIRED",
        )
    inputs = {**checkpoint, **context, "source_type": row.source_type}
    inputs["source_file"] = context.get("source_file") or row.source_file
    inputs["created_by"] = context.get("created_by") or row.created_by
    inputs["options"] = {
        **(context.get("options") or {}),
        **(checkpoint.get("options") or {}),
    }
    for key, value in overrides.items():
        if value is not None:
            if key in {"subject", "subject_id"}:
                inputs[key] = value
            else:
                inputs["options"][key] = value
    return row, snapshot or {}, checkpoint, inputs


async def _claim_resume(
    db: AsyncSession, row: ImportPipeline, retry_token: str
) -> None:
    result = await db.execute(
        update(ImportPipeline)
        .where(
            ImportPipeline.pipeline_id == row.pipeline_id,
            ImportPipeline.status.in_(RESUMABLE_STATUSES),
            ImportPipeline.current_task_id == row.current_task_id,
            ImportPipeline.current_owner_token == row.current_owner_token,
            ImportPipeline.execution_generation == row.execution_generation,
        )
        .values(
            status="queued",
            error_message=None,
            finished_at=None,
            current_task_id=f"admin_resume:{retry_token}",
            current_owner_token=f"pending:{retry_token}",
            execution_generation=0,
            execution_status="queued",
        )
        .execution_options(synchronize_session=False)
    )
    if not result.rowcount:
        await db.rollback()
        raise ImportRecoveryError("任务正在处理或已提交恢复，请刷新状态", 409)
    await db.commit()


async def _write_resume_status(
    pipeline_id: str, source_type: str, snapshot: dict
) -> None:
    if source_type == "image":
        await runtime._set_image_pipeline_status(pipeline_id, **snapshot)
    else:
        await orchestrator._set_pipeline_store(pipeline_id, snapshot)


async def _enqueue_resume(
    pipeline_id: str,
    staging: StagingObject,
    inputs: dict,
    retry_token: str,
) -> Any:
    from app.services.task_queue_worker import enqueue_admin_resume

    return await enqueue_admin_resume(
        pipeline_id=pipeline_id,
        staging_object_id=staging.object_id,
        source_type=inputs["source_type"],
        source_file=inputs.get("source_file") or "",
        subject=inputs.get("subject"),
        subject_id=inputs.get("subject_id"),
        options=inputs["options"],
        created_by=inputs.get("created_by"),
        retry_token=retry_token,
    )


async def _restore_failed_resume(
    db: AsyncSession,
    row: ImportPipeline,
    previous: dict,
    retry_token: str,
) -> None:
    result = await db.execute(
        update(ImportPipeline)
        .where(
            ImportPipeline.pipeline_id == row.pipeline_id,
            ImportPipeline.status == "queued",
            ImportPipeline.current_task_id == f"admin_resume:{retry_token}",
            ImportPipeline.execution_status == "queued",
        )
        .values(
            status=row.status,
            error_message=row.error_message,
            finished_at=row.finished_at,
            execution_status="failed",
            current_task_id=f"rejected:{retry_token}",
        )
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    if result.rowcount:
        await _write_resume_status(
            row.pipeline_id, row.source_type, {**previous, "status": row.status}
        )


async def resume_import(
    db: AsyncSession,
    pipeline_id: str,
    file: UploadFile,
    overrides: dict[str, Any],
) -> dict[str, Any]:
    row, previous, checkpoint, inputs = await _load_resume_inputs(
        db, pipeline_id, overrides
    )
    staging = await stage_recovery_file(file, row.source_type, row.source_sha256)
    retry_token = uuid.uuid4().hex
    await _claim_resume(db, row, retry_token)
    snapshot = {
        **previous,
        "pipeline_id": pipeline_id,
        "status": "processing",
        "source_type": row.source_type,
        "source_file": inputs["source_file"],
        "errors": [],
        "finished_at": None,
    }
    try:
        await _write_resume_status(pipeline_id, row.source_type, snapshot)
        result = await _enqueue_resume(pipeline_id, staging, inputs, retry_token)
        if not result:
            raise ImportRecoveryError(
                runtime._queue_rejection_message(result.reason), 503
            )
    except Exception:
        await _restore_failed_resume(db, row, previous, retry_token)
        raise
    artifacts = []
    if row.source_type in {"pdf", "txt"}:
        from app.features.pipeline_artifacts import list_artifacts

        artifacts = list_artifacts(pipeline_id)
    return {
        "pipeline_id": pipeline_id,
        "status": "processing",
        "resumed_chunks": [],
        "failed_stage": checkpoint.get("failed_stage"),
        "completed_stages": len(checkpoint.get("completed_stages") or []),
        "artifact_stages": artifacts,
        "true_resume": bool(artifacts),
    }
