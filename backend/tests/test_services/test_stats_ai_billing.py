"""Statistics AI must charge real usage and reject cancelled identities."""

from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register all model metadata
from app.core.cache import CacheClient
from app.core.database import Base
from app.core.time_utils import utcnow
from app.models.ai_chat import AiChat
from app.models.user import User
from app.services import ai_token_budget, stats_ai_billing, stats_service


@pytest_asyncio.fixture
async def billing_db(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    cache = CacheClient()
    cache._enabled = False
    monkeypatch.setattr(ai_token_budget, "cache", cache)
    monkeypatch.setattr(ai_token_budget.settings, "AI_DAILY_TOKEN_LIMIT", 1000)
    monkeypatch.setattr(ai_token_budget.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000)
    try:
        async with sessions() as db:
            db.add(User(id=17, openid="stats-billing-test"))
            await db.commit()
            yield db, cache
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_stats_success_records_charge_and_retains_it_in_the_ledger(billing_db):
    db, cache = billing_db
    provider = AsyncMock(
        return_value={"content": "{}", "tokens_used": 25, "model": "test"}
    )
    result = await stats_ai_billing.call_metered_stats_ai(
        db,
        17,
        [{"role": "user", "content": "diagnose"}],
        lambda _rate_limit: provider(),
        max_tokens=50,
        session_type="stats_ai_diagnosis",
    )
    assert result["tokens_used"] == 25
    assert await db.scalar(select(func.sum(AiChat.tokens_used))) == 25
    day_key, _month_key = ai_token_budget._token_period_keys(17)
    assert cache._local_get(day_key) == 25


@pytest.mark.asyncio
async def test_stats_exhausted_budget_never_invokes_provider(billing_db):
    db, _cache = billing_db
    db.add(AiChat(
        user_id=17, session_type="test", user_message="", ai_response="",
        tokens_used=1000, model="test", duration_ms=0,
    ))
    await db.commit()
    provider = AsyncMock()
    assert await stats_ai_billing.call_metered_stats_ai(
        db,
        17,
        [{"role": "user", "content": "diagnose"}],
        lambda _rate_limit: provider(),
        max_tokens=50,
        session_type="stats_ai_diagnosis",
    ) is None
    provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_stats_provider_failure_keeps_hold_and_does_not_write_chat(billing_db):
    db, cache = billing_db
    provider = AsyncMock(side_effect=RuntimeError("response lost"))
    with pytest.raises(RuntimeError, match="response lost"):
        await stats_ai_billing.call_metered_stats_ai(
            db,
            17,
            [{"role": "user", "content": "diagnose"}],
            lambda _rate_limit: provider(),
            max_tokens=50,
            session_type="stats_ai_diagnosis",
        )
    assert await db.scalar(select(func.count(AiChat.id))) == 0
    day_key, _month_key = ai_token_budget._token_period_keys(17)
    assert cache._local_get(day_key) >= 50


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["deleted", "banned"])
async def test_stats_public_readers_reject_inactive_account_before_provider(
    billing_db, monkeypatch, state
):
    db, _cache = billing_db
    user = await db.get(User, 17)
    if state == "deleted":
        user.deleted_at = utcnow()
    else:
        user.is_banned = True
    await db.commit()
    diagnosis = AsyncMock()
    dashboard = AsyncMock()
    monkeypatch.setattr(stats_service, "_call_ai_diagnosis_provider", diagnosis)
    monkeypatch.setattr(stats_service, "_call_dashboard_ai", dashboard)
    assert (await stats_service.get_ai_diagnosis(db, 17))["generated"] is False
    result = await stats_service.get_dashboard_llm_analysis(db, 17)
    assert isinstance(result, dict)
    diagnosis.assert_not_awaited()
    dashboard.assert_not_awaited()
    assert await db.scalar(select(func.count(AiChat.id))) == 0
