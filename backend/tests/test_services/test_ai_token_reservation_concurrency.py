"""Atomic per-user token reservations must serialize concurrent admission."""

from __future__ import annotations

import asyncio
import os
import shutil
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register all model metadata
from app.core.cache import CacheClient, CacheUnavailableError
from app.core.database import Base
from app.models.ai_chat import AiChat
from app.models.user import User
from app.services import ai_learning_service as service
from app.services import ai_token_budget as budget


@pytest.mark.parametrize("name", [
    "TokenReservation", "reserve_token_budget", "settle_token_reservation",
    "cancel_token_reservation", "record_token_usage",
])
def test_learning_keeps_existing_public_budget_exports(name):
    assert getattr(service, name) is getattr(budget, name)


@pytest.mark.asyncio
async def test_unavailable_atomic_ledger_rejects_admission(monkeypatch):
    monkeypatch.setattr(budget.settings, "AI_DAILY_TOKEN_LIMIT", 1000)
    monkeypatch.setattr(budget.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000)
    monkeypatch.setattr(budget, "_load_token_usage", AsyncMock(return_value=(0, 0)))
    reserve = AsyncMock(side_effect=CacheUnavailableError("ledger unavailable"))
    monkeypatch.setattr(budget.cache, "reserve_token_budget_strict", reserve)
    assert await service.reserve_token_budget(None, 41, 600) is None
    reserve.assert_awaited_once()


@pytest.mark.asyncio
async def test_policy_unavailable_rejects_admission(monkeypatch):
    from app.core.ai_runtime_guard import AIResourceRejectedError
    from app.services.user_ai_policy_service import UserAIPolicyUnavailableError

    async def unavailable_policy(_db, _user_id):
        raise UserAIPolicyUnavailableError("policy unavailable")

    monkeypatch.setattr(
        budget, "get_effective_user_ai_policy", unavailable_policy
    )
    with pytest.raises(AIResourceRejectedError) as exc:
        await service.reserve_token_budget(object(), 41, 600)
    assert exc.value.reason == "ai_user_policy_unavailable"


@pytest.mark.asyncio
async def test_unlimited_policy_bypasses_token_limits_but_keeps_reservation_contract(
    monkeypatch,
):
    policy = type(
        "Policy",
        (),
        {
            "daily_token_limit": -1,
            "monthly_token_limit": -1,
            "rpm_limit": -1,
        },
    )()

    async def effective_policy(_db, _user_id):
        return policy

    monkeypatch.setattr(budget, "get_effective_user_ai_policy", effective_policy)
    client = CacheClient()
    client._enabled = False
    monkeypatch.setattr(budget, "cache", client)
    monkeypatch.setattr(budget, "_load_token_usage", AsyncMock(return_value=(0, 0)))
    reservation = await service.reserve_token_budget(object(), 41, 600)
    assert reservation is not None
    assert reservation.reserved_tokens == 600
    assert client._local_get(reservation.day_key) == 600
    assert client._local_get(reservation.month_key) == 600
    assert reservation.rpm_limit == -1
    assert reservation.policy is policy


async def _assert_switch_preserves_pending_tokens(client, dimension, *, settle, user_id):
    policy = SimpleNamespace(daily_token_limit=5000, monthly_token_limit=5000, rpm_limit=12)
    setattr(policy, dimension, 1000)
    with (
        patch.object(budget, "cache", client),
        patch.object(budget, "get_effective_user_ai_policy", AsyncMock(return_value=policy)),
        patch.object(budget, "_load_token_usage", AsyncMock(return_value=(0, 0))),
    ):
        first = await budget.reserve_token_budget(object(), user_id, 600)
        assert first is not None
        setattr(policy, dimension, -1)
        second = await budget.reserve_token_budget(object(), user_id, 600)
        assert second is not None
        if settle:
            await budget.settle_token_reservation(second, 100)
        else:
            await budget.cancel_token_reservation(second)
        expected = 700 if settle else 600
        assert int(await client.get_strict(first.day_key)) == expected
        assert int(await client.get_strict(first.month_key)) == expected
        assert first.active is True
        setattr(policy, dimension, 1000)
        assert await budget.reserve_token_budget(object(), user_id, 1001 - expected) is None
        assert await budget.reserve_token_budget(object(), user_id, 1000 - expected) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("dimension", ["daily_token_limit", "monthly_token_limit"])
@pytest.mark.parametrize("settle", [False, True])
async def test_policy_switch_cannot_refund_another_pending_hold(dimension, settle):
    client = CacheClient()
    client._enabled = False
    await _assert_switch_preserves_pending_tokens(client, dimension, settle=settle, user_id=91)


@pytest.mark.asyncio
async def test_restoring_finite_token_policy_keeps_unlimited_pending_and_settled_usage():
    client = CacheClient()
    client._enabled = False
    policy = SimpleNamespace(daily_token_limit=-1, monthly_token_limit=-1, rpm_limit=-1)
    with (
        patch.object(budget, "cache", client),
        patch.object(budget, "get_effective_user_ai_policy", AsyncMock(return_value=policy)),
        patch.object(budget, "_load_token_usage", AsyncMock(return_value=(0, 0))),
    ):
        pending = await budget.reserve_token_budget(object(), 41, 600)
        assert pending is not None
        policy.daily_token_limit = policy.monthly_token_limit = 500
        assert await budget.reserve_token_budget(object(), 41, 1) is None
        await budget.settle_token_reservation(pending, 200)
        assert await budget.reserve_token_budget(object(), 41, 301) is None
        assert await budget.reserve_token_budget(object(), 41, 300) is not None


@pytest.mark.asyncio
async def test_local_token_capacity_never_silently_drops_a_hold(monkeypatch):
    client = CacheClient()
    client._enabled = False
    client._local_max_size = 2
    monkeypatch.setattr(budget, "cache", client)
    monkeypatch.setattr(budget, "_load_token_usage", AsyncMock(return_value=(0, 0)))
    first = await budget.reserve_token_budget(None, 41, 1)
    assert first is not None
    assert await budget.reserve_token_budget(None, 42, 1) is None
    second = await budget.reserve_token_budget(None, 41, 1)
    assert second is not None
    await budget.cancel_token_reservation(second)
    assert await client.get_strict(first.day_key) == 1
    assert await client.get_strict(first.month_key) == 1


@pytest.mark.asyncio
async def test_only_one_concurrent_request_can_reserve_last_tokens(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'token-reservation.db'}"
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add(User(id=41, openid="reservation-user"))
        await db.commit()

    client = CacheClient()
    client._enabled = False
    client._local.clear()
    limits = (1000, 5000)
    try:
        async with sessions() as first_db, sessions() as second_db:
            with patch.object(
                budget.settings,
                "AI_DAILY_TOKEN_LIMIT",
                limits[0],
            ), patch.object(
                budget.settings,
                "AI_MONTHLY_TOKEN_LIMIT",
                limits[1],
            ), patch.object(budget, "cache", client):
                reservations = await asyncio.gather(
                    service.reserve_token_budget(first_db, 41, 600),
                    service.reserve_token_budget(second_db, 41, 600),
                )

        assert sum(item is not None for item in reservations) == 1
        reservation = next(item for item in reservations if item is not None)
        await service.settle_token_reservation(reservation, 0)
        async with sessions() as db:
            chats = (await db.execute(select(func.count(AiChat.id)))).scalar_one()
        assert chats == 0
    finally:
        client._local.clear()
        await engine.dispose()


@pytest.mark.asyncio
async def test_settled_charge_blocks_a_request_with_stale_database_usage():
    """A SQL read started before settlement must not resurrect spent budget."""
    client = CacheClient()
    client._enabled = False
    with patch.object(budget, "cache", client), patch.object(
        budget.settings, "AI_DAILY_TOKEN_LIMIT", 1000
    ), patch.object(budget.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
        budget, "_load_token_usage", AsyncMock(return_value=(0, 0))
    ):
        first = await service.reserve_token_budget(None, 41, 600)
        assert first is not None
        await service.settle_token_reservation(first, 500)
        # The second query captured zero before the first caller committed.
        assert await service.reserve_token_budget(None, 41, 600) is None


@pytest.mark.asyncio
async def test_settlement_refunds_only_unused_tokens_without_double_counting_sql():
    client = CacheClient()
    client._enabled = False
    usage = AsyncMock(side_effect=[(0, 0), (500, 500)])
    with patch.object(budget, "cache", client), patch.object(
        budget.settings, "AI_DAILY_TOKEN_LIMIT", 1000
    ), patch.object(budget.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
        budget, "_load_token_usage", usage
    ):
        first = await service.reserve_token_budget(None, 41, 600)
        assert first is not None
        original_expiry = client._local[first.month_key][0]
        await service.settle_token_reservation(first, 500)
        assert client._local_get(first.day_key) == 500
        assert client._local[first.month_key][0] == original_expiry
        second = await service.reserve_token_budget(None, 41, 500)
        assert second is not None
        await service.cancel_token_reservation(second)
        assert client._local_get(first.day_key) == 500


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_failed", [False, True])
async def test_chat_refunds_only_a_known_unconfigured_provider(provider_failed):
    client = CacheClient()
    client._enabled = False
    provider = AsyncMock(return_value=None)
    if provider_failed:
        provider.side_effect = RuntimeError("response lost after request")
    with patch.object(budget, "cache", client), patch.object(
        budget.settings, "AI_DAILY_TOKEN_LIMIT", 1000
    ), patch.object(budget.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
        budget, "_load_token_usage", AsyncMock(return_value=(0, 0))
    ), patch.object(service, "_call_ai", provider):
        reservation = await service.reserve_token_budget(None, 41, 600)
        assert reservation is not None
        assert await service._call_ai_reserved([], None, reservation) is None
        assert client._local_get(reservation.day_key) == (600 if provider_failed else 0)
        assert reservation.active is provider_failed


@pytest.mark.asyncio
async def test_pretransport_guard_rejection_refunds_the_full_hold():
    from app.core.ai_runtime_guard import AIResourceRejectedError

    client = CacheClient()
    client._enabled = False

    async def rejected(*_args, **_kwargs):
        raise AIResourceRejectedError("ai_rate_limited", retry_after_sec=3)

    with patch.object(budget, "cache", client), patch.object(
        budget.settings, "AI_DAILY_TOKEN_LIMIT", 1000
    ), patch.object(budget.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
        budget, "_load_token_usage", AsyncMock(return_value=(0, 0))
    ), patch.object(service, "_call_ai", rejected):
        reservation = await service.reserve_token_budget(None, 41, 600)
        assert reservation is not None
        assert await service._call_ai_reserved([], None, reservation) is None

    assert client._local_get(reservation.day_key) == 0
    assert reservation.active is False


@pytest.mark.asyncio
async def test_redis_ledger_preserves_settled_charge_and_expiry(tmp_path):
    """Exercise the actual Lua scripts on a private, non-network Redis socket."""
    from redis.asyncio import Redis

    executable = os.environ.get("SEC_TEST_REDIS_SERVER") or shutil.which("redis-server")
    if not executable:
        pytest.skip("a local redis-server executable is required")
    socket_path = tmp_path / "quota.sock"
    process = await asyncio.create_subprocess_exec(
        executable,
        "--port", "0",
        "--unixsocket", str(socket_path),
        "--save", "",
        "--appendonly", "no",
        "--maxmemory", "16mb",
        "--maxclients", "64",
        "--dir", str(tmp_path),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    redis = Redis(unix_socket_path=str(socket_path))
    client = CacheClient()
    client._enabled = True
    client._client = redis
    try:
        for _attempt in range(100):
            if socket_path.exists():
                break
            await asyncio.sleep(0.01)
        assert await redis.ping()
        with patch.object(budget, "cache", client), patch.object(
            budget.settings, "AI_DAILY_TOKEN_LIMIT", 1000
        ), patch.object(budget.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
            budget, "_load_token_usage", AsyncMock(return_value=(0, 0))
        ):
            first = await service.reserve_token_budget(None, 41, 600)
            assert first is not None
            await service.settle_token_reservation(first, 500)
            assert int(await redis.get(first.day_key)) == 500
            assert await redis.ttl(first.month_key) > 39 * 24 * 3600
            assert await service.reserve_token_budget(None, 41, 600) is None
            second = await service.reserve_token_budget(None, 41, 500)
            assert second is not None
            await service.cancel_token_reservation(second)
            assert int(await redis.get(first.day_key)) == 500
        for index, (dimension, settle) in enumerate(
            (dimension, settle)
            for dimension in ("daily_token_limit", "monthly_token_limit")
            for settle in (False, True)
        ):
            await _assert_switch_preserves_pending_tokens(
                client, dimension, settle=settle, user_id=91 + index
            )
        from types import SimpleNamespace

        from app.services.ai.analysis_regeneration import admit_regeneration

        # Independent clients exercise the shared Redis Lua admission across processes.
        second_client = CacheClient()
        second_client._enabled = True
        second_client._client = redis
        wrong = SimpleNamespace(id=56, question_id=6, ai_analysis=None)
        results = await asyncio.gather(*[
            admit_regeneration(cache=client if index % 2 else second_client,
                               user_id=56, wrong_question=wrong)
            for index in range(24)
        ])
        assert sum(result is None for result in results) == 1
        assert all(result["error_code"] == "ai_regeneration_limited"
                   for result in results if result)
    finally:
        await redis.aclose()
        if process.returncode is None:
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=2)
        except TimeoutError:
            process.kill()
            await process.wait()
