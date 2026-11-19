"""Bounded, read-only audit of current projections, revisions and KP ownership."""

from collections import defaultdict
from types import SimpleNamespace

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import QuestionVersion
from app.models.knowledge_point import KnowledgePoint
from app.models.question import Question
from app.models.question_knowledge_point import QuestionKnowledgePoint
from app.services.question_revision_service import (
    _canonical_state_payload,
    compute_question_state_hash,
    load_revision_kp_links,
)


async def _batch_links(db: AsyncSession, question_ids: list[int]) -> tuple[dict, dict]:
    rows = await db.execute(
        select(QuestionKnowledgePoint, KnowledgePoint.subject_id)
        .outerjoin(
            KnowledgePoint,
            KnowledgePoint.id == QuestionKnowledgePoint.knowledge_point_id,
        )
        .where(QuestionKnowledgePoint.question_id.in_(question_ids))
        .order_by(
            QuestionKnowledgePoint.question_id,
            QuestionKnowledgePoint.position,
            QuestionKnowledgePoint.id,
        )
    )
    links, subjects = defaultdict(list), defaultdict(set)
    for link, subject_id in rows:
        links[link.question_id].append(
            (
                link.knowledge_point_id,
                link.position,
                link.role or "main",
                float(link.weight if link.weight is not None else 1),
                link.source or "imported",
            )
        )
        subjects[link.question_id].add(subject_id)
    return links, subjects


def _revision_differences(
    question: Question, revision: QuestionVersion, links: list, frozen: list
) -> list[str]:
    if revision.subject_id is None or not revision.question_type:
        return ["incomplete_current_revision"]
    payload = _canonical_state_payload(question, links)
    snapshot = SimpleNamespace(
        id=revision.question_id,
        **{
            key: getattr(revision, key)
            for key in payload
            if key not in ("question_id", "knowledge_points")
        },
    )
    version_links = [
        (item.knowledge_point_id, item.position, item.role, item.weight, item.source)
        for item in frozen
    ]
    historical = _canonical_state_payload(snapshot, version_links)
    issues = []
    for field, value in payload.items():
        other = historical[field]
        if field == "image_url":
            value, other = value or [], other or []
        elif field == "raw_content":
            value, other = (value or "").strip(), (other or "").strip()
        if value != other:
            issues.append(field)
    if compute_question_state_hash(snapshot, version_links) != revision.state_hash:
        issues.append("revision_checksum")
    return issues


async def audit_question_integrity(db: AsyncSession, batch_size: int = 200) -> dict:
    """Report stable identities and field names; never export question/answer content."""
    batch_size = max(1, min(batch_size, 1000))
    cursor, checked, findings, checksum_mismatches = 0, 0, [], 0
    while True:
        batch = (
            await db.execute(
                select(Question, QuestionVersion)
                .outerjoin(
                    QuestionVersion,
                    QuestionVersion.id == Question.current_version_id,
                )
                .where(Question.id > cursor)
                .order_by(Question.id)
                .limit(batch_size)
            )
        ).all()
        if not batch:
            break
        ids = [question.id for question, _ in batch]
        links, subjects = await _batch_links(db, ids)
        frozen = await load_revision_kp_links(
            db, [version.id for _, version in batch if version]
        )
        latest = dict(
            (
                await db.execute(
                    select(
                        QuestionVersion.question_id, func.max(QuestionVersion.version)
                    )
                    .where(
                        QuestionVersion.question_id.in_(ids),
                    )
                    .group_by(QuestionVersion.question_id)
                )
            ).all()
        )
        batch_findings, mismatches = _inspect_batch(batch, links, subjects, frozen, latest)
        findings.extend(batch_findings)
        checksum_mismatches += mismatches
        checked += len(batch)
        cursor = ids[-1]
    return {
        "checked_questions": checked,
        "affected_questions": len(findings),
        "stored_checksum_mismatches": checksum_mismatches,
        "findings": findings,
    }


def _inspect_batch(
    batch: list, links: dict, subjects: dict, frozen: dict, latest: dict
) -> tuple[list[dict], int]:
    findings, checksum_mismatches = [], 0
    for question, revision in batch:
        current_links = links.get(question.id, [])
        issues = []
        if any(
            subject != question.subject_id
            for subject in subjects.get(question.id, set())
        ):
            issues.append("knowledge_point_subject")
        if revision is None:
            issues.append("missing_current_revision")
        elif revision.question_id != question.id:
            issues.append("revision_question_identity")
        else:
            issues.extend(
                _revision_differences(
                    question, revision, current_links, frozen.get(revision.id, [])
                )
            )
            if revision.version != latest.get(question.id):
                issues.append("current_revision_behind_latest")
        # A stored digest is derived metadata, not the historical answer/identity.
        # Keep it visible without manufacturing duplicate versions to repair it.
        if "revision_checksum" in issues:
            checksum_mismatches += 1
            issues.remove("revision_checksum")
        if issues:
            findings.append(
                {
                    "sync_uuid": question.sync_uuid,
                    "issues": issues,
                    "expected_hash": compute_question_state_hash(
                        question, current_links
                    ),
                    "expected_version": latest.get(question.id, 0),
                }
            )
    return findings, checksum_mismatches
