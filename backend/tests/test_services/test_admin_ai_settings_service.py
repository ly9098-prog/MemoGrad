from __future__ import annotations

from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.core.orm_base import Base
from app.models.admin import AdminAISettings, AdminAIUsageMonthly
from app.schemas.admin_ai_settings import AdminAISettingsPatchRequest
from app.services import admin_ai_settings_service as service


@pytest_asyncio.fixture
async def sessions(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'settings.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_read_settings_is_side_effect_free_before_first_write(sessions):
    async with sessions() as db:
        response = await service.get_ai_settings(db)
        await db.rollback()
    assert response.monthly_call_limit == service.DEFAULT_MONTHLY_CALL_LIMIT
    assert response.current_usage.call_count == 0
    async with sessions() as db:
        settings_count = await db.scalar(
            select(func.count()).select_from(AdminAISettings)
        )
        usage_count = await db.scalar(
            select(func.count()).select_from(AdminAIUsageMonthly)
        )
    assert settings_count == 0
    assert usage_count == 0


@pytest.mark.asyncio
async def test_first_write_creates_settings_and_monthly_row(sessions, monkeypatch):
    async def write_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(service, "write_admin_audit", write_audit)
    operator = SimpleNamespace(id=7)
    async with sessions() as db:
        response = await service.update_ai_settings(
            db,
            AdminAISettingsPatchRequest(
                ai_parse_enabled=False, monthly_call_limit=250
            ),
            operator,
        )
        await db.commit()
    assert response.ai_parse_enabled is False
    assert response.monthly_call_limit == 250
    assert response.current_usage.year_month == service.current_year_month()


@pytest.mark.asyncio
async def test_first_write_upserts_are_idempotent(sessions):
    async with sessions() as db:
        first_settings = await service.get_or_create_ai_settings(db)
        second_settings = await service.get_or_create_ai_settings(db)
        first_usage = await service.get_or_create_monthly_usage(
            db, limit_snapshot=250
        )
        second_usage = await service.get_or_create_monthly_usage(
            db, limit_snapshot=999
        )
        await db.commit()

    assert first_settings.id == second_settings.id == 1
    assert first_usage.year_month == second_usage.year_month
    assert second_usage.limit_snapshot == 250
    async with sessions() as db:
        assert await db.scalar(
            select(func.count()).select_from(AdminAISettings)
        ) == 1
        assert await db.scalar(
            select(func.count()).select_from(AdminAIUsageMonthly)
        ) == 1
