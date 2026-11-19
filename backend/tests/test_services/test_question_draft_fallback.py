"""The real draft generator must log fallback without publishing any question."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import app.models  # noqa: F401
from app.features import question_draft_generator, question_pipeline
from app.features.question_draft_generator import generate_drafts
from app.models.ai_chat import AiChat
from app.models.ai_generation_log import AiGenerationLog
from app.services.ai_learning_service import TokenReservation


@pytest.mark.asyncio
async def test_generation_fallback_only_adds_failure_audit_and_commits(monkeypatch):
    db = SimpleNamespace(add=Mock(), commit=AsyncMock())
    fallback_value = {"questions": []}
    call = AsyncMock(return_value=(
        {"fallback_value": fallback_value, "model": "fallback", "error": "unavailable"},
        None, None,
    ))
    monkeypatch.setattr(question_pipeline, "_call_or_fallback", call)
    reservation = TokenReservation(17, 1, "day-key", "month-key")
    monkeypatch.setattr(
        question_draft_generator,
        "reserve_token_budget",
        AsyncMock(return_value=reservation),
    )

    result = await generate_drafts(
        db, 17, subject_code="data_structure", knowledge_points=["stack"], count=2,
    )

    assert result["generated"] == 0
    assert result["from_fallback"] is True
    assert result["batch_id"].startswith("AIGEN_")
    call.assert_awaited_once()
    assert call.call_args.args[2] is db
    db.add.assert_called_once()
    log = db.add.call_args.args[0]
    assert isinstance(log, AiGenerationLog)
    assert (log.user_id, log.action, log.success) == (17, "generate", 0)
    assert log.parsed_result == fallback_value
    assert log.error_message == "unavailable"
    db.commit.assert_awaited_once_with()
    assert reservation.active is True


@pytest.mark.asyncio
async def test_generation_invalid_subject_does_not_call_ai_or_write(monkeypatch):
    db = SimpleNamespace(add=Mock(), commit=AsyncMock())
    call = AsyncMock()
    monkeypatch.setattr(question_pipeline, "_call_or_fallback", call)

    with pytest.raises(ValueError, match="canonical subject code"):
        await generate_drafts(
            db, 17, subject_code="unsupported-subject", knowledge_points=["stack"],
        )

    call.assert_not_awaited()
    db.add.assert_not_called()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_generation_quota_rejection_happens_before_provider(monkeypatch):
    db = SimpleNamespace(execute=AsyncMock(), add=Mock(), commit=AsyncMock())
    call = AsyncMock()
    quota = AsyncMock(return_value=None)
    monkeypatch.setattr(question_pipeline, "_call_or_fallback", call)
    monkeypatch.setattr(question_draft_generator, "reserve_token_budget", quota)

    with pytest.raises(ValueError, match="额度已用尽"):
        await generate_drafts(
            db,
            17,
            subject_code="data_structure",
            knowledge_points=["stack"],
            count=2,
        )

    quota.assert_awaited_once()
    assert quota.await_args.args[0] is db
    assert quota.await_args.args[1] == 17
    assert quota.await_args.args[2] > 0
    call.assert_not_awaited()
    db.add.assert_not_called()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_generation_success_records_ai_chat_usage(monkeypatch):
    db = SimpleNamespace(execute=AsyncMock(), add=Mock(), commit=AsyncMock())
    call = AsyncMock(
        return_value=(
            {"model": "synthetic", "tokens_used": 23, "duration_ms": 7},
            '{"questions": []}',
            {},
        )
    )
    monkeypatch.setattr(question_pipeline, "_call_or_fallback", call)
    monkeypatch.setattr(
        question_draft_generator,
        "reserve_token_budget",
        AsyncMock(
            return_value=TokenReservation(
                17, 1, "day-key", "month-key"
            )
        ),
    )
    settle = AsyncMock()
    monkeypatch.setattr(question_draft_generator, "settle_token_reservation", settle)

    result = await generate_drafts(
        db,
        17,
        subject_code="data_structure",
        knowledge_points=["stack"],
        count=2,
    )

    assert result["generated"] == 0
    assert result["tokens_used"] == 23
    call.assert_awaited_once()
    usage_rows = [
        call.args[0]
        for call in db.add.call_args_list
        if isinstance(call.args[0], AiChat)
    ]
    assert len(usage_rows) == 1
    assert usage_rows[0].user_id == 17
    assert usage_rows[0].session_type == "ai_import_generate"
    assert usage_rows[0].tokens_used == 23
    db.commit.assert_awaited_once_with()
    settle.assert_awaited_once()
    assert settle.await_args.args[1] == 23
