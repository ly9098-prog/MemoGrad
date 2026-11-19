"""Validate vector and cache identities against the current question projection."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import Subject
from app.models.question import Question
from app.services import embedding_service
from app.services.knowledge_point_service import load_question_kps


async def load_embedding_identities(db: AsyncSession, question_ids: list[int]) -> dict:
    """Batch current content hashes; inactive or unapproved questions have no identity."""
    if not question_ids:
        return {}
    rows = await db.execute(
        select(Question, Subject.code)
        .join(Subject, Subject.id == Question.subject_id)
        .where(
            Question.id.in_(question_ids),
            Question.is_active.is_(True),
            Question.review_status == "approved",
        )
        .execution_options(populate_existing=True)
    )
    questions = rows.all()
    kp_map = await load_question_kps(db, [q.id for q, _ in questions])
    identities = {}
    for question, code in questions:
        content = embedding_service.build_question_embedding_text(
            question,
            subject_code=code,
            knowledge_points=kp_map.get(question.id, []),
        )
        identities[question.id] = {
            "hash": embedding_service.compute_content_hash(content),
            "subject_id": question.subject_id,
            "subject": code,
            "question_type": question.question_type,
        }
    return identities


async def filter_fresh_candidates(
    db: AsyncSession, candidates: list, subject_ids: list[int]
) -> list:
    """Rows have (question_id, subject code, question type, content hash, similarity)."""
    identities = await load_embedding_identities(db, [row[0] for row in candidates])
    return [
        row
        for row in candidates
        if (identity := identities.get(row[0])) is not None
        and identity["subject_id"] in subject_ids
        and (row[1], row[2], row[3])
        == (
            identity["subject"],
            identity["question_type"],
            identity["hash"],
        )
    ]


def pack_vector_cache(items: list[dict], candidates: list) -> dict:
    ids = {item["question_id"] for item in items}
    return {
        "items": items,
        "hashes": {str(row[0]): row[3] for row in candidates if row[0] in ids},
    }


async def read_fresh_vector_cache(
    db: AsyncSession, cached: object, subject_ids: list[int]
) -> list[dict] | None:
    if not isinstance(cached, dict) or not isinstance(cached.get("items"), list):
        return None
    items = cached["items"]
    hashes = cached.get("hashes", {})
    # Empty recalls are cheap to recompute and cannot prove newly eligible items absent.
    if not items:
        return None
    candidates = [
        (
            item["question_id"],
            item["subject"],
            item["question_type"],
            hashes.get(str(item["question_id"])),
            0,
        )
        for item in items
    ]
    fresh = await filter_fresh_candidates(db, candidates, subject_ids)
    return items if len(fresh) == len(items) else None
