"""Explicit, fingerprint-checked repairs of current questions by sync UUID.

The manifest contains reviewed decisions, never numeric cross-environment IDs.
Historical revisions and their associations are only read, never rewritten.
"""

from types import SimpleNamespace
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import QuestionVersion, Subject
from app.models.knowledge_point import KnowledgePoint
from app.models.question import Question
from app.models.question_knowledge_point import QuestionKnowledgePoint
from app.services.question_revision_service import (
    compute_question_state_hash,
    ensure_question_revision,
    load_question_kp_link_ids,
    revision_matches_projection,
    validate_question_kp_subjects,
)

_FIELDS = {
    "sync_uuid",
    "expected_hash",
    "target_hash",
    "expected_version",
    "answer",
    "subject_code",
    "knowledge_points",
    "reason",
}


def validate_manifest(entries: list[dict]) -> None:
    if not isinstance(entries, list) or not 1 <= len(entries) <= 100:
        raise ValueError("manifest must contain 1..100 reviewed question repairs")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) - _FIELDS:
            raise ValueError(
                "manifest contains unknown fields; numeric IDs are not accepted"
            )
        identity = str(UUID(entry["sync_uuid"]))
        if identity in seen:
            raise ValueError("duplicate sync_uuid in repair manifest")
        seen.add(identity)
        for key in ("expected_hash", "target_hash"):
            if len(entry.get(key, "")) != 64:
                raise ValueError(f"manifest requires a SHA256 {key}")
        if not entry.get("reason") or not isinstance(
            entry.get("expected_version"), int
        ):
            raise ValueError("review reason and expected_version are required")


async def _target_links(
    db: AsyncSession,
    question: Question,
    entry: dict,
    subject_id: int,
) -> list[tuple]:
    current = await load_question_kp_link_ids(db, question.id)
    if "knowledge_points" not in entry:
        return current
    specs = entry["knowledge_points"]
    if not isinstance(specs, list) or not specs:
        raise ValueError(
            "explicit knowledge_points must contain reviewed existing nodes"
        )
    target = []
    for position, spec in enumerate(specs):
        if not isinstance(spec, dict) or set(spec) != {"name", "description"}:
            raise ValueError(
                "knowledge point identity requires exact name and syllabus description"
            )
        ids = (
            await db.scalars(
                select(KnowledgePoint.id).where(
                    KnowledgePoint.subject_id == subject_id,
                    KnowledgePoint.name == spec["name"],
                    KnowledgePoint.description == spec["description"],
                )
            )
        ).all()
        if len(ids) != 1:
            raise ValueError("knowledge point identity is absent or ambiguous")
        target.append(
            (ids[0], position, "main" if position == 0 else "secondary", 1.0, "admin")
        )
    return target


async def _plan_one(db: AsyncSession, entry: dict, *, lock: bool) -> dict:
    query = select(Question).where(Question.sync_uuid == entry["sync_uuid"])
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    question = await db.scalar(query)
    if question is None:
        raise ValueError(f"question sync_uuid not found: {entry['sync_uuid']}")
    links = await load_question_kp_link_ids(db, question.id)
    actual_hash = compute_question_state_hash(question, links)
    latest = await db.scalar(
        select(QuestionVersion)
        .where(
            QuestionVersion.question_id == question.id,
        )
        .order_by(QuestionVersion.version.desc())
        .limit(1)
    )
    if (
        actual_hash == entry["target_hash"]
        and latest
        and await revision_matches_projection(
            db,
            question,
            latest,
            links,
        )
        and question.current_version_id == latest.id
    ):
        return {"entry": entry, "question": question, "status": "already_applied"}
    if actual_hash != entry["expected_hash"] or (
        int(latest.version if latest else 0) != entry["expected_version"]
    ):
        raise ValueError(f"question changed since review: {entry['sync_uuid']}")
    subject_id, target_links = await _reviewed_target(db, question, entry)
    return {
        "entry": entry,
        "question": question,
        "status": "planned",
        "subject_id": subject_id,
        "links": target_links,
    }


async def _reviewed_target(db: AsyncSession, question: Question, entry: dict) -> tuple:
    subject_id = question.subject_id
    if "subject_code" in entry:
        subject_id = await db.scalar(
            select(Subject.id).where(
                Subject.code == entry["subject_code"],
                Subject.is_active.is_(True),
            )
        )
        if subject_id is None:
            raise ValueError("target subject is absent or inactive")
    target_links = await _target_links(db, question, entry, subject_id)
    # Plain values avoid sharing SQLAlchemy instrumentation with the live row.
    target = SimpleNamespace(
        **{
            key: value
            for key, value in vars(question).items()
            if not key.startswith("_")
        }
    )
    target.subject_id = subject_id
    if "answer" in entry:
        if not isinstance(entry["answer"], str) or not entry["answer"].strip():
            raise ValueError("reviewed answer must be nonempty text")
        target.answer = entry["answer"]
    await validate_question_kp_subjects(db, target, target_links)
    if compute_question_state_hash(target, target_links) != entry["target_hash"]:
        raise ValueError("target fingerprint does not match the reviewed decision")
    return subject_id, target_links


async def repair_questions(
    db: AsyncSession, entries: list[dict], *, apply: bool = False
) -> dict:
    """Plan all entries before writing; the caller owns commit/rollback."""
    validate_manifest(entries)
    plans = [
        await _plan_one(db, entry, lock=apply)
        for entry in sorted(entries, key=lambda entry: entry["sync_uuid"])
    ]
    results = []
    for plan in plans:
        if apply and plan["status"] == "planned":
            await _apply_one(db, plan)
        results.append(
            {
                "sync_uuid": plan["entry"]["sync_uuid"],
                "status": "applied"
                if apply and plan["status"] == "planned"
                else plan["status"],
                "reason": plan["entry"]["reason"],
            }
        )
    return {"apply": apply, "questions": results}


async def _apply_one(db: AsyncSession, plan: dict) -> None:
    entry, question = plan["entry"], plan["question"]
    question.subject_id = plan["subject_id"]
    if "answer" in entry:
        question.answer = entry["answer"]
    if "knowledge_points" in entry:
        current = (
            await db.scalars(
                select(QuestionKnowledgePoint).where(
                    QuestionKnowledgePoint.question_id == question.id,
                )
            )
        ).all()
        for link in current:
            await db.delete(link)
        await db.flush()
        db.add_all(
            [
                QuestionKnowledgePoint(
                    question_id=question.id,
                    knowledge_point_id=kid,
                    position=position,
                    role=role,
                    weight=weight,
                    source=source,
                )
                for kid, position, role, weight, source in plan["links"]
            ]
        )
    question.sync_version = (question.sync_version or 0) + 1
    await ensure_question_revision(
        db, question, change_source="integrity_repair", edit_reason=entry["reason"]
    )
