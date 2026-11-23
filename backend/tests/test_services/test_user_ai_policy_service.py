from __future__ import annotations

from types import SimpleNamespace

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.core.orm_base import Base
from app.models.user import User
from app.models.user_ai_policy import UserAIPolicyDefault, UserAIPolicyOverride
from app.schemas.user_ai_policy import (
    AdminUserAIPolicyResetRequest,
    AdminUserAIPolicyUnlimitedRequest,
    AdminUserAIPolicyUpdateRequest,
    UserAIPolicyOverrides,
    UserAIPolicyValues,
)
from app.services import user_ai_policy_service as service


@pytest_asyncio.fixture
async def sessions(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'policy.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()


async def _seed_user(factory, user_id: int = 41):
    async with factory() as db:
        db.add(User(id=user_id, openid=f"user-{user_id}"))
        await db.commit()


@pytest.mark.asyncio
async def test_effective_policy_merges_defaults_and_per_user_overrides(
    sessions, monkeypatch
):
    monkeypatch.setattr(service.settings, "AI_DAILY_TOKEN_LIMIT", 1000)
    monkeypatch.setattr(service.settings, "AI_MONTHLY_TOKEN_LIMIT", 5000)
    monkeypatch.setattr(service.settings, "AI_USER_RPM_LIMIT", 12)
    await _seed_user(sessions)
    async with sessions() as db:
        db.add(
            UserAIPolicyDefault(
                id=1,
                regeneration_cooldown_seconds=60,
                regeneration_question_24h_limit=3,
                regeneration_account_24h_limit=20,
                daily_token_limit=1000,
                monthly_token_limit=5000,
                rpm_limit=12,
                version=1,
            )
        )
        db.add(
            UserAIPolicyOverride(
                user_id=41,
                daily_token_limit=-1,
                rpm_limit=99,
                version=1,
            )
        )
        await db.commit()
        policy = await service.get_effective_user_ai_policy(db, 41)
        detail = await service.get_user_policy(db, 41)

    assert policy.daily_token_limit == -1
    assert policy.monthly_token_limit == 5000
    assert policy.rpm_limit == 99
    assert policy.regeneration_question_24h_limit == 3
    assert detail.sources.daily_token_limit == "user"
    assert detail.sources.monthly_token_limit == "default"
    assert detail.overrides["daily_token_limit"] == -1
    assert detail.overrides["monthly_token_limit"] is None


@pytest.mark.asyncio
async def test_unlimited_and_reset_preserve_optimistic_versioning(sessions, monkeypatch):
    await _seed_user(sessions)
    operator = SimpleNamespace(id=7)
    audits = []

    async def write_audit(*args, **kwargs):
        audits.append((args, kwargs))

    monkeypatch.setattr(service, "_write_policy_audit", write_audit)
    async with sessions() as db:
        unlimited = await service.set_user_policy_unlimited(
            db,
            41,
            AdminUserAIPolicyUnlimitedRequest(version=0, reason="维护者专项测试"),
            operator,
        )
        await db.commit()
    assert unlimited.unlimited is True
    assert unlimited.version == 1
    assert unlimited.updated_by == 7
    assert set(unlimited.overrides.values()) == {-1}

    async with sessions() as db:
        reset = await service.reset_user_policy(
            db,
            41,
            AdminUserAIPolicyResetRequest(version=1, reason="恢复统一策略"),
            operator,
        )
        await db.commit()
    assert reset.unlimited is False
    assert reset.version == 0
    assert set(reset.overrides.values()) == {None}
    assert [call[0][2] for call in audits] == [
        "app_user.ai_policy.unlimited",
        "app_user.ai_policy.reset",
    ]
    assert audits[0][1]["detail"]["scope"] == "ordinary_user"
    assert audits[1][1]["detail"]["scope"] == "ordinary_user"


@pytest.mark.asyncio
async def test_update_default_requires_matching_version(sessions, monkeypatch):
    operator = SimpleNamespace(id=7)

    async def write_audit(*args, **kwargs):
        return None

    monkeypatch.setattr(service, "_write_policy_audit", write_audit)
    values = UserAIPolicyValues(
        regeneration_cooldown_seconds=90,
        regeneration_question_24h_limit=4,
        regeneration_account_24h_limit=30,
        daily_token_limit=60000,
        monthly_token_limit=600000,
        rpm_limit=15,
    )
    async with sessions() as db:
        result = await service.update_default_policy(
            db,
            service.AdminUserAIPolicyDefaultUpdateRequest(
                version=0, values=values, reason="初始化动态策略"
            ),
            operator,
        )
        await db.commit()
    assert result.version == 1
    assert result.updated_by == 7
    assert result.values == values

    async with sessions() as db:
        with pytest.raises(service.UserAIPolicyConflictError):
            await service.update_default_policy(
                db,
                service.AdminUserAIPolicyDefaultUpdateRequest(
                    version=0, values=values, reason="过期写入"
                ),
                operator,
            )


def test_runtime_default_normalizes_non_positive_legacy_limits(monkeypatch):
    monkeypatch.setattr(service.settings, "AI_DAILY_TOKEN_LIMIT", 0)
    monkeypatch.setattr(service.settings, "AI_MONTHLY_TOKEN_LIMIT", -1)
    monkeypatch.setattr(service.settings, "AI_USER_RPM_LIMIT", 0)
    values = service.runtime_default_values()
    assert values.daily_token_limit == -1
    assert values.monthly_token_limit == -1
    assert values.rpm_limit == -1


def test_policy_schema_rejects_values_beyond_runtime_safe_bounds():
    with pytest.raises(ValidationError):
        UserAIPolicyValues(
            regeneration_cooldown_seconds=86_401,
            regeneration_question_24h_limit=3,
            regeneration_account_24h_limit=20,
            daily_token_limit=50_000,
            monthly_token_limit=500_000,
            rpm_limit=12,
        )


def test_user_policy_overrides_allow_inheritance_and_reject_zero():
    request = AdminUserAIPolicyUpdateRequest(
        version=0,
        values=UserAIPolicyOverrides(
            regeneration_cooldown_seconds=None,
            regeneration_question_24h_limit=-1,
            regeneration_account_24h_limit=20,
            daily_token_limit=None,
            monthly_token_limit=600_000,
            rpm_limit=None,
        ),
        reason="逐项继承与覆盖",
    )

    assert request.values.regeneration_cooldown_seconds is None
    assert request.values.regeneration_question_24h_limit == -1
    assert request.values.regeneration_account_24h_limit == 20

    with pytest.raises(ValidationError):
        UserAIPolicyOverrides(regeneration_account_24h_limit=0)


def test_policy_reason_is_stripped_and_whitespace_only_is_rejected():
    request = AdminUserAIPolicyResetRequest(
        version=0,
        reason="  恢复默认策略  ",
    )
    assert request.reason == "恢复默认策略"

    with pytest.raises(ValidationError):
        AdminUserAIPolicyResetRequest(version=0, reason="   ")
