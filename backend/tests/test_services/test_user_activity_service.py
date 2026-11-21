import logging
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.time_utils import utcnow
from app.models.user import User
from app.services.user_activity_service import record_user_activity


def _user(last_active_client=None, last_active_at=None):
    return User(
        id=1,
        nickname="用户",
        is_banned=False,
        last_active_client=last_active_client,
        last_active_at=last_active_at,
    )


def _db_with_rowcount(rowcount=1):
    db = AsyncMock()
    db.execute.return_value = AsyncMock(rowcount=rowcount)
    return db


@pytest.mark.asyncio
async def test_records_new_activity():
    user = _user()
    db = _db_with_rowcount()
    now = datetime(2026, 11, 22, 10)

    await record_user_activity(db, user, "web", now=now)

    assert user.last_active_client == "web"
    assert user.last_active_at == now
    db.execute.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_throttles_same_client_activity():
    now = datetime(2026, 11, 22, 10)
    user = _user("web", now - timedelta(seconds=60))
    db = _db_with_rowcount(rowcount=0)

    await record_user_activity(db, user, "web", now=now)

    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_invalid_client_is_ignored():
    user = _user()
    db = AsyncMock()

    await record_user_activity(db, user, "admin", now=datetime(2026, 11, 22))

    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_database_failure_is_non_fatal_and_logged(caplog):
    user = _user()
    db = _db_with_rowcount()
    db.commit = AsyncMock(side_effect=RuntimeError("write unavailable"))

    with caplog.at_level(logging.WARNING, logger="postgraduate-ai.user-auth"):
        await record_user_activity(
            db, user, "miniprogram", now=datetime(2026, 11, 22)
        )

    db.rollback.assert_awaited_once()
    assert "User activity write failed: user_id=1 client=miniprogram" in caplog.text


@pytest.mark.asyncio
async def test_activity_write_persists_and_rejects_stale_timestamp(tmp_path):
    import app.models  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'activity.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as db:
        user = User(nickname="用户", lifecycle_status="active")
        db.add(user)
        await db.commit()
        await db.refresh(user)

        newer = datetime(2026, 11, 22, 10, 0)
        older = newer - timedelta(minutes=1)
        await record_user_activity(db, user, "web", now=newer)
        await record_user_activity(db, user, "miniprogram", now=older)

        stored = await db.scalar(select(User).where(User.id == user.id))
        assert stored.last_active_client == "web"
        assert stored.last_active_at == newer

    await engine.dispose()


@pytest.mark.asyncio
async def test_activity_write_skips_accounts_that_can_no_longer_authenticate(tmp_path):
    import app.models  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'activity-state.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as db:
        active = User(nickname="active", lifecycle_status="active")
        cancelled = User(
            nickname="cancelled",
            lifecycle_status="erasing",
            deleted_at=utcnow(),
        )
        erased = User(nickname="erased", lifecycle_status="erased")
        anonymized = User(nickname="anonymized", lifecycle_status="anonymized")
        banned = User(nickname="banned", lifecycle_status="active", is_banned=True)
        db.add_all([active, cancelled, erased, anonymized, banned])
        await db.commit()
        for user in (active, cancelled, erased, anonymized, banned):
            await db.refresh(user)

        observed_at = datetime(2026, 11, 22, 10, 0)
        for user in (active, cancelled, erased, anonymized, banned):
            await record_user_activity(db, user, "web", now=observed_at)

        stored = {
            user.nickname: (user.last_active_client, user.last_active_at)
            for user in (
                await db.get(User, active.id),
                await db.get(User, cancelled.id),
                await db.get(User, erased.id),
                await db.get(User, anonymized.id),
                await db.get(User, banned.id),
            )
        }

    assert stored["active"] == ("web", observed_at)
    assert stored["cancelled"] == (None, None)
    assert stored["erased"] == (None, None)
    assert stored["anonymized"] == (None, None)
    assert stored["banned"] == (None, None)

    await engine.dispose()
