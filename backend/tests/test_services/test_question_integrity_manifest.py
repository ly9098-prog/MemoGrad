"""Reviewed manifest safety: dry-run, identity, history and repeat application."""

from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.models.admin import QuestionVersion
from app.models.question import Question
from app.services.question_integrity_audit import audit_question_integrity
from app.services.question_integrity_repair import repair_questions
from app.services.question_revision_service import (
    compute_question_state_hash,
    load_question_kp_link_ids,
)
from tests.test_services.test_database_consistency_repair import (
    database as database_fixture,
)

database = database_fixture


@pytest.mark.asyncio
async def test_batched_audit_ignores_empty_representation_but_detects_answer_and_scope_drift(
    database,
):
    async with database() as db:
        question = await db.get(Question, 1)
        question.image_url, question.raw_content = [], "  "
        await db.flush()
        assert (await audit_question_integrity(db, batch_size=1))[
            "affected_questions"
        ] == 0
        question.answer, question.subject_id = "B", 2
        await db.flush()
        result = await audit_question_integrity(db, batch_size=1)
        assert result["checked_questions"] == result["affected_questions"] == 1
        assert {"answer", "subject_id", "knowledge_point_subject"} <= set(
            result["findings"][0]["issues"]
        )
        assert result["findings"][0]["sync_uuid"] == question.sync_uuid
        assert "answer" not in result["findings"][0]


async def _entry(db):
    question = await db.get(Question, 1)
    links = await load_question_kp_link_ids(db, 1)
    revision = await db.get(QuestionVersion, question.current_version_id)
    target = SimpleNamespace(**vars(question))
    target.answer = "B"
    return {
        "sync_uuid": question.sync_uuid,
        "expected_hash": compute_question_state_hash(question, links),
        "target_hash": compute_question_state_hash(target, links),
        "expected_version": revision.version,
        "answer": "B",
        "reason": "explicitly reviewed synthetic answer",
    }


@pytest.mark.asyncio
async def test_dry_run_is_read_only_apply_is_idempotent_and_preserves_history(database):
    async with database() as db:
        entry = await _entry(db)
        question = await db.get(Question, 1)
        old_id = question.current_version_id
        plan = await repair_questions(db, [entry])
        assert plan["questions"][0]["status"] == "planned"
        assert question.answer == "A" and question.current_version_id == old_id
        assert not db.dirty
        result = await repair_questions(db, [entry], apply=True)
        assert result["questions"][0]["status"] == "applied"
        await db.commit()
        count = await db.scalar(select(func.count()).select_from(QuestionVersion))
        assert (await db.get(QuestionVersion, old_id)).answer == "A"
        assert question.answer == "B" and question.current_version_id != old_id
        repeated = await repair_questions(db, [entry], apply=True)
        assert repeated["questions"][0]["status"] == "already_applied"
        assert (
            await db.scalar(select(func.count()).select_from(QuestionVersion)) == count
        )


@pytest.mark.asyncio
async def test_all_fingerprints_and_targets_are_checked_before_first_write(database):
    async with database() as db:
        entry = await _entry(db)
        missing = {**entry, "sync_uuid": "ffffffff-ffff-4fff-bfff-ffffffffffff"}
        with pytest.raises(ValueError, match="sync_uuid not found"):
            await repair_questions(db, [entry, missing], apply=True)
        assert (await db.get(Question, 1)).answer == "A"
        assert not db.dirty
        with pytest.raises(ValueError, match="changed since review"):
            await repair_questions(
                db, [{**entry, "expected_hash": "0" * 64}], apply=True
            )
        with pytest.raises(ValueError, match="target fingerprint"):
            await repair_questions(db, [{**entry, "target_hash": "0" * 64}], apply=True)
        with pytest.raises(ValueError, match="numeric IDs"):
            await repair_questions(db, [{**entry, "question_id": 1}], apply=True)
