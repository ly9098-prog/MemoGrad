"""Atomic per-user token reservations must serialize concurrent admission."""

from __future__ import annotations

import asyncio
import os
import shutil
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register all model metadata
from app.core.cache import CacheClient
from app.core.database import Base
from app.models.ai_chat import AiChat
from app.models.user import User
from app.services import ai_learning_service as service


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
                service.settings,
                "AI_DAILY_TOKEN_LIMIT",
                limits[0],
            ), patch.object(
                service.settings,
                "AI_MONTHLY_TOKEN_LIMIT",
                limits[1],
            ), patch.object(service, "cache", client):
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
    with patch.object(service, "cache", client), patch.object(
        service.settings, "AI_DAILY_TOKEN_LIMIT", 1000
    ), patch.object(service.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
        service, "_load_token_usage", AsyncMock(return_value=(0, 0))
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
    with patch.object(service, "cache", client), patch.object(
        service.settings, "AI_DAILY_TOKEN_LIMIT", 1000
    ), patch.object(service.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
        service, "_load_token_usage", usage
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
    with patch.object(service, "cache", client), patch.object(
        service.settings, "AI_DAILY_TOKEN_LIMIT", 1000
    ), patch.object(service.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
        service, "_load_token_usage", AsyncMock(return_value=(0, 0))
    ), patch.object(service, "_call_ai", provider):
        reservation = await service.reserve_token_budget(None, 41, 600)
        assert reservation is not None
        assert await service._call_ai_reserved([], None, reservation) is None
        assert client._local_get(reservation.day_key) == (600 if provider_failed else 0)
        assert reservation.active is provider_failed


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
        "--maxclients", "16",
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
        with patch.object(service, "cache", client), patch.object(
            service.settings, "AI_DAILY_TOKEN_LIMIT", 1000
        ), patch.object(service.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000), patch.object(
            service, "_load_token_usage", AsyncMock(return_value=(0, 0))
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
    finally:
        await redis.aclose()
        if process.returncode is None:
            process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=2)
        except TimeoutError:
            process.kill()
            await process.wait()
