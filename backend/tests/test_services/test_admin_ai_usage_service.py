from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.core.orm_base import Base
from app.models.admin import (
    AdminAISettings,
    AdminAIUsageMonthly,
    AdminUser,
    AuditLog,
    Role,
)
from app.services import admin_ai_usage_service as service


@pytest_asyncio.fixture
async def sessions(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'usage.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _seed(factory, *, limit: int = 1, enabled: bool = True):
    async with factory() as db:
        db.add_all(
            [
                Role(id=1, name="admin", display_name="管理员"),
                Role(id=2, name="super_admin", display_name="超级管理员"),
                AdminUser(
                    id=1,
                    username="operator",
                    password_hash="hash",
                    role_id=1,
                ),
                AdminUser(
                    id=2,
                    username="owner",
                    password_hash="hash",
                    role_id=2,
                ),
                AdminAISettings(
                    id=1,
                    ai_parse_enabled=enabled,
                    monthly_call_limit=limit,
                ),
            ]
        )
        await db.commit()


@pytest.mark.asyncio
async def test_monthly_call_limit_is_atomic_and_super_admin_still_meters(
    sessions, monkeypatch
):
    await _seed(sessions)
    monkeypatch.setattr(service, "async_session", sessions)

    await service.reserve_admin_ai_parse_call(
        scope="admin_import_ai", admin_id=1
    )
    with pytest.raises(service.AdminAIUsageRejectedError) as exc:
        await service.reserve_admin_ai_parse_call(
            scope="admin_import_ai", admin_id=1
        )
    assert exc.value.code == "ai_admin_quota_exhausted"

    await service.reserve_admin_ai_parse_call(
        scope="admin_import_ai", admin_id=2
    )
    await service.reserve_admin_ai_parse_call(
        scope="admin_import_ai", admin_id=2
    )
    async with sessions() as db:
        usage = await db.scalar(
            select(AdminAIUsageMonthly).where(
                AdminAIUsageMonthly.year_month == service.current_year_month()
            )
        )
    assert usage is not None
    assert usage.call_count == 3


@pytest.mark.asyncio
async def test_global_switch_blocks_even_super_admin(sessions, monkeypatch):
    await _seed(sessions, enabled=False)
    monkeypatch.setattr(service, "async_session", sessions)

    with pytest.raises(service.AdminAIUsageRejectedError) as exc:
        await service.reserve_admin_ai_parse_call(
            scope="admin_import_ai", admin_id=2
        )
    assert exc.value.code == "ai_parse_disabled"


@pytest.mark.asyncio
async def test_quota_rejection_is_audited_and_retries_next_month(
    sessions, monkeypatch
):
    await _seed(sessions)
    monkeypatch.setattr(service, "async_session", sessions)

    await service.reserve_admin_ai_parse_call(
        scope="admin_import_ai", admin_id=1
    )
    with pytest.raises(service.AdminAIUsageRejectedError) as exc:
        await service.reserve_admin_ai_parse_call(
            scope="admin_import_ai", admin_id=1
        )

    assert exc.value.retry_after_sec is not None
    assert exc.value.retry_after_sec > 0
    async with sessions() as db:
        audit = await db.scalar(
            select(AuditLog).where(AuditLog.action == "ai_quota.exhausted")
        )
    assert audit is not None
    assert audit.status == "failed"
    assert audit.operator_id == 1
    assert audit.detail["scope"] == "admin_import_ai"
    assert audit.detail["reason"] == "rejected_before_transport"


def test_parse_admin_owner_and_month_boundary_helpers(monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    assert service.parse_admin_id_from_created_by("admin:17") == 17
    assert service.parse_admin_id_from_created_by("17") is None
    assert service.parse_admin_id_from_created_by("admin:bad") is None

    monkeypatch.setattr(
        service,
        "shanghai_now",
        lambda: datetime(
            2026,
            11,
            30,
            23,
            59,
            30,
            tzinfo=ZoneInfo("Asia/Shanghai"),
        ),
    )
    assert service.seconds_until_next_month() == 30
