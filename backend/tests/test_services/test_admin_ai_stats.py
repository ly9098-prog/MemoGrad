"""AI statistics over isolated SQLite logs; no configured models or remote calls."""

from datetime import date, datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.orm_base import Base
from app.models.ai_chat import AiChat
from app.models.ai_generation_log import AiGenerationLog
from app.services import admin_ai_settings_service as service

NOW = datetime(2026, 11, 17, 3)


@pytest_asyncio.fixture
async def db(monkeypatch):
    monkeypatch.setattr(service, "shanghai_today", lambda: date(2026, 11, 17))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(
                lambda sync: Base.metadata.create_all(
                    sync, tables=[AiGenerationLog.__table__, AiChat.__table__]
                )
            )
        async with AsyncSession(engine) as session:
            yield session
    finally:
        await engine.dispose()


def generation(model, created_at=NOW, *, success=1):
    return AiGenerationLog(
        user_id=1, action="test", model=model, created_at=created_at,
        tokens_used=100, duration_ms=100, success=success,
    )


def chat(model, created_at=NOW):
    return AiChat(
        user_id=1, session_type="test", user_message="synthetic", ai_response="synthetic",
        model=model, created_at=created_at, tokens_used=100, duration_ms=100,
    )


@pytest.mark.asyncio
async def test_primary_model_combines_both_log_sources_without_changing_totals(db):
    db.add_all([
        generation("deepseek-v4-flash"), generation("glm-4.6", success=0),
        chat("glm-4.6"), chat("glm-4.6"),
    ])
    await db.flush()
    result = await service.get_ai_stats(db, 7)
    assert result.model_name == "glm-4.6"
    assert result.today_calls == result.monthly_calls == 4
    assert result.total_tokens == 400
    assert result.success_rate == 75.0
    assert result.avg_latency_ms == 100.0
    assert result.daily_trends[-1].calls == 4
    assert "estimated_cost" not in result.model_dump()


@pytest.mark.asyncio
async def test_primary_model_uses_the_requested_summary_window(db):
    db.add_all([
        *(generation("deepseek-v4-flash", datetime(2026, 11, 2)) for _ in range(4)),
        generation("glm-4.6"), chat("glm-4.6"),
    ])
    await db.flush()
    monthly = await service.get_ai_stats(db, 30)
    recent = await service.get_ai_stats(db, 7, summary_days=7)
    assert monthly.model_name == "deepseek-v4-flash"
    assert recent.model_name == "glm-4.6"
    assert monthly.monthly_calls == recent.monthly_calls == 6
    assert monthly.total_tokens == 600
    assert recent.total_tokens == 200


@pytest.mark.asyncio
async def test_ties_are_stable_by_model_name_and_trim_whitespace(db):
    db.add_all([generation(" glm-4.6 "), chat("deepseek-v4-flash")])
    await db.flush()
    result = await service.get_ai_stats(db)
    assert result.model_name == "deepseek-v4-flash"


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["openai-compatible", " OpenAI-compatible ", "", "  "])
async def test_placeholder_model_names_remain_unknown(db, name):
    db.add(generation(name))
    await db.flush()
    result = await service.get_ai_stats(db)
    assert result.model_name is None
    assert result.monthly_calls == 1


@pytest.mark.asyncio
async def test_no_calls_does_not_invent_a_model(db):
    result = await service.get_ai_stats(db)
    assert result.model_name is None
    assert result.monthly_calls == result.total_tokens == 0


@pytest.mark.asyncio
async def test_unrecorded_majority_does_not_fall_back_to_a_less_used_model(db):
    db.add_all([generation("openai-compatible"), chat("openai-compatible"), chat("glm-4.6")])
    await db.flush()
    assert (await service.get_ai_stats(db)).model_name is None


@pytest.mark.asyncio
async def test_model_aggregation_respects_shanghai_month_and_tomorrow_boundaries(db):
    db.add_all([
        generation("glm-4.6", datetime(2026, 10, 31, 16)),
        chat("glm-4.6"),
        *(generation("qwen3.5-plus", datetime(2026, 10, 31, 15, 59)) for _ in range(3)),
        *(chat("qwen3.5-plus", datetime(2026, 11, 17, 16)) for _ in range(3)),
    ])
    await db.flush()
    result = await service.get_ai_stats(db, 30)
    assert result.model_name == "glm-4.6"
    assert result.total_tokens == 200
