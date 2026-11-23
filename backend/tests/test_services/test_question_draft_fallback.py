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
async def test_ordinary_user_pipeline_uses_policy_rpm_without_admin_quota(monkeypatch):
    from app.ai import gateway

    runtime = SimpleNamespace(
        api_key="test-key",
        base_url="https://example.invalid/v1",
        model_name="test-model",
        provider="openai",
    )
    chat = AsyncMock(
        return_value={
            "content": "{}",
            "tokens_used": 1,
            "model": "test-model",
            "duration_ms": 1,
        }
    )

    async def resolve_runtime(*_args, **_kwargs):
        return runtime

    async def resolve_rpm(_db):
        return 17

    monkeypatch.setattr(gateway, "resolve_llm_runtime_config", resolve_runtime)
    monkeypatch.setattr(gateway, "resolve_user_rpm_limit", resolve_rpm)
    monkeypatch.setattr(question_pipeline, "llm", SimpleNamespace(chat=chat))

    await question_pipeline._call_or_fallback(
        [{"role": "user", "content": "test"}],
        {"fallback": True},
        object(),
    )

    chat.assert_awaited_once()
    assert chat.await_args.kwargs["rate_limit"] == 17
    assert "admin_quota_scope" not in chat.await_args.kwargs
    assert "admin_quota_admin_id" not in chat.await_args.kwargs


@pytest.mark.asyncio
async def test_admin_pipeline_keeps_monthly_quota_at_shared_call_boundary(monkeypatch):
    from app.ai import gateway

    runtime = SimpleNamespace(
        api_key="test-key",
        base_url="https://example.invalid/v1",
        model_name="test-model",
        provider="openai",
    )
    chat = AsyncMock(
        return_value={
            "content": "{}",
            "tokens_used": 1,
            "model": "test-model",
            "duration_ms": 1,
        }
    )

    async def resolve_runtime(*_args, **_kwargs):
        return runtime

    async def resolve_rpm(_db):
        return None

    monkeypatch.setattr(gateway, "resolve_llm_runtime_config", resolve_runtime)
    monkeypatch.setattr(gateway, "resolve_user_rpm_limit", resolve_rpm)
    monkeypatch.setattr(question_pipeline, "llm", SimpleNamespace(chat=chat))

    await question_pipeline._call_or_fallback(
        [{"role": "user", "content": "test"}],
        {"fallback": True},
        object(),
        admin_id=9,
    )

    chat.assert_awaited_once()
    assert chat.await_args.kwargs["admin_quota_scope"] == "admin_import_ai"
    assert chat.await_args.kwargs["admin_quota_admin_id"] == 9


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
async def test_generation_releases_hold_when_provider_was_not_dispatched(monkeypatch):
    db = SimpleNamespace(add=Mock(), commit=AsyncMock())
    call = AsyncMock(
        return_value=(
            {
                "fallback_value": {"questions": []},
                "model": "fallback",
                "error": "AI模型API Key未配置",
                "provider_dispatched": False,
            },
            None,
            None,
        )
    )
    monkeypatch.setattr(question_pipeline, "_call_or_fallback", call)
    reservation = TokenReservation(17, 1, "day-key", "month-key")
    monkeypatch.setattr(
        question_draft_generator,
        "reserve_token_budget",
        AsyncMock(return_value=reservation),
    )
    cancel = AsyncMock()
    monkeypatch.setattr(question_draft_generator, "cancel_token_reservation", cancel)

    result = await generate_drafts(
        db,
        17,
        subject_code="data_structure",
        knowledge_points=["stack"],
        count=2,
    )

    assert result["from_fallback"] is True
    cancel.assert_awaited_once_with(reservation)
    db.commit.assert_awaited_once_with()


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
