from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.query_limits import require_bounded_csv
from app.core.database import get_db
from app.core.runtime_paths import API_V1_PREFIX
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.common import paginated_response
from app.schemas.question import (
    QuestionCreate,
    QuestionPublicResponse,
    QuestionResponse,
)
from app.services import question_service as svc
from app.services.knowledge_point_service import load_question_kps
from app.utils.question_content import (
    reconcile_student_stem_fields,
    strip_student_segment_metadata,
)

router = APIRouter(prefix=f"{API_V1_PREFIX}/questions")


def _sanitize_content(content: dict | None) -> dict | None:
    """Strip admin-only fields from question content before returning to students."""
    if not isinstance(content, dict):
        return content
    sanitized = reconcile_student_stem_fields(content)
    sanitized.pop("source_snapshot_url", None)
    sanitized.pop("source_snapshot_full_page", None)
    sanitized.pop("visual_regions", None)
    sanitized.pop("visual_region_ids", None)
    return strip_student_segment_metadata(sanitized)


def _public_question(question, kps=None) -> QuestionPublicResponse:
    payload = QuestionPublicResponse.model_validate(question)
    if kps is not None:
        payload = payload.model_copy(update={"knowledge_points": kps})
    subject = question.subject_ref
    return payload.model_copy(
        update={
            "subject_code": subject.code if subject else "",
            "subject_name": subject.name if subject else "",
            "content": _sanitize_content(payload.content),
        }
    )


@router.post("", response_model=QuestionResponse)
async def create_question(
    data: QuestionCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Reject direct app writes; question publication belongs to admin review.

    The endpoint remains registered for protocol compatibility, but an app JWT
    must not create a published question outside the import/review/audit flow.
    """
    raise HTTPException(
        status_code=403,
        detail="题目写入必须通过管理端审核流程",
    )


@router.get("")
async def list_questions(
    subject_id: int | None = Query(None),
    question_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    items, total = await svc.list_questions(
        db, subject_id, question_type, page, page_size
    )
    kp_map = await load_question_kps(db, [q.id for q in items])
    return paginated_response(
        items=[_public_question(q, kp_map.get(q.id, [])) for q in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/random", response_model=QuestionPublicResponse | None)
async def random_question(
    subject_id: int | None = Query(None),
    question_type: str | None = Query(None),
    exclude_ids: str | None = Query(None, max_length=4096),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    require_bounded_csv(exclude_ids, field="exclude_ids", max_items=200, max_length=4096)
    exclude = []
    if exclude_ids:
        exclude = [int(x.strip()) for x in exclude_ids.split(",") if x.strip()]
    q = await svc.get_random(db, subject_id, question_type, exclude)
    if not q:
        raise HTTPException(status_code=404, detail="没有符合条件的题目")
    kp_map = await load_question_kps(db, [q.id])
    return _public_question(q, kp_map.get(q.id, []))


@router.get("/{question_id}/similar")
async def get_similar_questions(
    question_id: int,
    count: int = Query(5, ge=1, le=20),
    exclude_answered: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """获取相似题目推荐。向量优先 + 规则兜底，统一由 ai_learning_service 处理。"""
    from app.services import ai_learning_service

    result = await ai_learning_service.recommend_similar_questions(
        db=db,
        user_id=current_user.id,
        question_id=question_id,
        count=count,
    )
    return result


@router.get("/{question_id}/detail")
async def get_question_detail(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import select

    from app.models.admin import QuestionVersion
    from app.models.practice_record import PracticeRecord

    record = (
        await db.execute(
            select(PracticeRecord.question_version_id)
            .where(
                PracticeRecord.user_id == current_user.id,
                PracticeRecord.question_id == question_id,
            )
            .order_by(PracticeRecord.answered_at.desc(), PracticeRecord.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=403,
            detail="请先完成答题后再查看答案",
        )

    from app.services.ai_teacher_408_service import (
        AIExamInProgressError,
        assert_ai_answer_access_allowed,
    )

    try:
        await assert_ai_answer_access_allowed(
            db,
            user_id=current_user.id,
            question_id=question_id,
        )
    except AIExamInProgressError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "exam_in_progress_answer_blocked",
                "message": str(exc),
            },
        ) from exc

    q = await svc.get_by_id(db, question_id)
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在")

    revision = await db.get(QuestionVersion, int(record))
    if (
        revision is None
        or int(revision.question_id) != int(q.id)
        or revision.is_active is not True
        or int(revision.subject_id or 0) != int(q.subject_id)
        or str(revision.question_type or "") != str(q.question_type or "")
    ):
        raise HTTPException(status_code=404, detail="题目版本不可用")

    latest = (
        await db.execute(
            select(QuestionVersion)
            .where(QuestionVersion.question_id == q.id)
            .order_by(QuestionVersion.version.desc(), QuestionVersion.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if latest is None or int(latest.id) != int(revision.id):
        raise HTTPException(
            status_code=409,
            detail="题目已更新，请重新作答后查看解析",
        )

    kp_map = await load_question_kps(db, [q.id])
    return {
        "id": q.id,
        "subject_id": q.subject_id,
        "subject_code": q.subject_ref.code if q.subject_ref else None,
        "subject_name": q.subject_ref.name if q.subject_ref else None,
        "question_type": q.question_type,
        "content": _sanitize_content(q.content),
        "options": q.options,
        "answer": q.answer,
        "analysis": q.analysis,
        "knowledge_points": kp_map.get(q.id, []),
    }


@router.get("/{question_id}", response_model=QuestionPublicResponse)
async def get_question(
    question_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = await svc.get_by_id(db, question_id)
    if not q:
        raise HTTPException(status_code=404, detail="题目不存在")
    kp_map = await load_question_kps(db, [q.id])
    return _public_question(q, kp_map.get(q.id, []))
