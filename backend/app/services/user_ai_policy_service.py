"""Resolve and administer ordinary-user AI quota policy."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time_utils import utcnow
from app.models.user import User
from app.models.user_ai_policy import (
    POLICY_FIELD_MAX,
    POLICY_FIELDS,
    UserAIPolicyDefault,
    UserAIPolicyOverride,
)
from app.schemas.user_ai_policy import (
    AdminUserAIPolicyBatchRequest,
    AdminUserAIPolicyDefaultResponse,
    AdminUserAIPolicyDefaultUpdateRequest,
    AdminUserAIPolicyDetailResponse,
    AdminUserAIPolicyResetRequest,
    AdminUserAIPolicyUnlimitedRequest,
    AdminUserAIPolicyUpdateRequest,
    UserAIPolicyEffectiveValues,
    UserAIPolicySources,
    UserAIPolicyValues,
)

if TYPE_CHECKING:
    from app.core.admin_security import AdminPrincipal

DEFAULT_POLICY_ID = 1


async def batch_update_user_policies(
    db: AsyncSession,
    data: AdminUserAIPolicyBatchRequest,
    current_admin: AdminPrincipal,
    request: Request | None = None,
) -> list[AdminUserAIPolicyDetailResponse]:
    """Apply in stable lock order; the caller owns the all-or-nothing transaction."""
    results = []
    for target in sorted(data.targets, key=lambda item: item.user_id):
        common = {"version": target.version, "reason": data.reason}
        try:
            if data.action == "reset":
                result = await reset_user_policy(
                    db, target.user_id, AdminUserAIPolicyResetRequest(**common),
                    current_admin, request,
                )
            elif data.action == "unlimited":
                result = await set_user_policy_unlimited(
                    db, target.user_id, AdminUserAIPolicyUnlimitedRequest(**common),
                    current_admin, request,
                )
            else:
                result = await update_user_policy(
                    db, target.user_id,
                    AdminUserAIPolicyUpdateRequest(**common, values=data.values),
                    current_admin, request,
                )
        except UserAIPolicyConflictError as exc:
            raise UserAIPolicyConflictError(
                f"用户 #{target.user_id} 的额度已更新，本批次未保存，请重新读取"
            ) from exc
        results.append(result)
    return results


class UserAIPolicyConflictError(ValueError):
    pass


class UserAIPolicyUnavailableError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class EffectiveUserAIPolicy:
    regeneration_cooldown_seconds: int
    regeneration_question_24h_limit: int
    regeneration_account_24h_limit: int
    daily_token_limit: int
    monthly_token_limit: int
    rpm_limit: int

    @property
    def unlimited(self) -> bool:
        return all(getattr(self, name) == -1 for name in POLICY_FIELDS)


def runtime_default_values() -> UserAIPolicyValues:
    def normalized(name: str, raw: int) -> int:
        value = int(raw)
        if value <= 0:
            return -1
        return min(value, POLICY_FIELD_MAX[name])

    return UserAIPolicyValues(
        regeneration_cooldown_seconds=60,
        regeneration_question_24h_limit=3,
        regeneration_account_24h_limit=20,
        daily_token_limit=normalized(
            "daily_token_limit", int(settings.AI_DAILY_TOKEN_LIMIT)
        ),
        monthly_token_limit=normalized(
            "monthly_token_limit", int(settings.AI_MONTHLY_TOKEN_LIMIT)
        ),
        rpm_limit=normalized("rpm_limit", int(settings.AI_USER_RPM_LIMIT)),
    )


def _values_from_row(row: UserAIPolicyDefault | UserAIPolicyOverride) -> dict[str, int | None]:
    return {name: getattr(row, name) for name in POLICY_FIELDS}


def _resolve_values(
    defaults: UserAIPolicyValues, override: UserAIPolicyOverride | None
) -> tuple[UserAIPolicyEffectiveValues, UserAIPolicySources]:
    values = defaults.model_dump()
    sources: dict[str, str] = {name: "default" for name in POLICY_FIELDS}
    if override:
        for name in POLICY_FIELDS:
            candidate = getattr(override, name)
            if candidate is not None:
                values[name] = candidate
                sources[name] = "user"
    return UserAIPolicyEffectiveValues(**values), UserAIPolicySources(**sources)


async def _load_runtime_rows(
    db: AsyncSession, user_id: int
) -> tuple[UserAIPolicyDefault | None, UserAIPolicyOverride | None]:
    default = await db.get(UserAIPolicyDefault, DEFAULT_POLICY_ID)
    override = await db.get(UserAIPolicyOverride, user_id)
    return default, override


async def get_effective_user_ai_policy(
    db: AsyncSession, user_id: int
) -> EffectiveUserAIPolicy:
    try:
        default, override = await _load_runtime_rows(db, user_id)
    except Exception as exc:
        raise UserAIPolicyUnavailableError("AI 额度策略暂不可用") from exc
    defaults = (
        UserAIPolicyValues(**_values_from_row(default))
        if default
        else runtime_default_values()
    )
    effective, _ = _resolve_values(defaults, override)
    return EffectiveUserAIPolicy(**effective.model_dump())


async def get_default_policy(
    db: AsyncSession,
) -> AdminUserAIPolicyDefaultResponse:
    row = await db.get(UserAIPolicyDefault, DEFAULT_POLICY_ID)
    if row is None:
        return AdminUserAIPolicyDefaultResponse(
            version=0, values=runtime_default_values()
        )
    return AdminUserAIPolicyDefaultResponse(
        version=row.version,
        values=UserAIPolicyValues(**_values_from_row(row)),
        updated_by=row.updated_by,
        updated_at=row.updated_at,
    )


async def update_default_policy(
    db: AsyncSession,
    data: AdminUserAIPolicyDefaultUpdateRequest,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> AdminUserAIPolicyDefaultResponse:
    row = await db.get(UserAIPolicyDefault, DEFAULT_POLICY_ID)
    before = runtime_default_values().model_dump() if row is None else _values_from_row(row)
    current_version = row.version if row else 0
    if data.version != current_version:
        raise UserAIPolicyConflictError("默认额度已被其他管理员更新，请刷新后重试")
    if row is None:
        if not await _insert_default_policy(
            db, data.values.model_dump(), updated_by=operator.id
        ):
            raise UserAIPolicyConflictError(
                "默认额度已被其他管理员更新，请刷新后重试"
            )
        row = await db.get(UserAIPolicyDefault, DEFAULT_POLICY_ID)
    else:
        result = await db.execute(
            update(UserAIPolicyDefault)
            .where(
                UserAIPolicyDefault.id == DEFAULT_POLICY_ID,
                UserAIPolicyDefault.version == data.version,
            )
            .values(**data.values.model_dump(), version=data.version + 1, updated_by=operator.id, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise UserAIPolicyConflictError("默认额度已被其他管理员更新，请刷新后重试")
        await db.refresh(row)
    if row.version == data.version:
        row.version = data.version + 1
        row.updated_by = operator.id
        row.updated_at = utcnow()
    await _write_policy_audit(
        db,
        operator,
        "ai_setting.user_policy_defaults.update",
        "user_ai_policy_defaults",
        str(DEFAULT_POLICY_ID),
        severity="important",
        detail={
            "before": before,
            "after": data.values.model_dump(),
            "version": row.version,
            "reason": data.reason,
            "scope": "ordinary_users",
        },
        request=request,
    )
    await db.flush()
    return await get_default_policy(db)


async def get_user_policy(
    db: AsyncSession, user_id: int
) -> AdminUserAIPolicyDetailResponse:
    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise ValueError("用户不存在")
    default, override = await _load_runtime_rows(db, user_id)
    defaults = (
        UserAIPolicyValues(**_values_from_row(default))
        if default
        else runtime_default_values()
    )
    effective, sources = _resolve_values(defaults, override)
    return AdminUserAIPolicyDetailResponse(
        user_id=user_id,
        version=override.version if override else 0,
        defaults=defaults,
        overrides=_values_from_row(override) if override else {name: None for name in POLICY_FIELDS},
        effective=effective,
        sources=sources,
        unlimited=effective_fields_unlimited(effective),
        updated_by=override.updated_by if override else None,
        updated_at=override.updated_at if override else None,
    )


def effective_fields_unlimited(values: UserAIPolicyValues) -> bool:
    return all(getattr(values, name) == -1 for name in POLICY_FIELDS)


async def update_user_policy(
    db: AsyncSession,
    user_id: int,
    data: AdminUserAIPolicyUpdateRequest,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> AdminUserAIPolicyDetailResponse:
    return await _replace_user_policy(
        db,
        user_id,
        data.version,
        data.values.model_dump(),
        data.reason,
        operator,
        request,
        action="app_user.ai_policy.update",
    )


async def set_user_policy_unlimited(
    db: AsyncSession,
    user_id: int,
    data: AdminUserAIPolicyUnlimitedRequest,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> AdminUserAIPolicyDetailResponse:
    return await _replace_user_policy(
        db,
        user_id,
        data.version,
        {name: -1 for name in POLICY_FIELDS},
        data.reason,
        operator,
        request,
        action="app_user.ai_policy.unlimited",
        severity="critical",
    )


async def _replace_user_policy(
    db: AsyncSession,
    user_id: int,
    version: int,
    values: dict[str, int | None],
    reason: str,
    operator: AdminPrincipal,
    request: Request | None,
    *,
    action: str,
    severity: str = "important",
) -> AdminUserAIPolicyDetailResponse:
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None or user.deleted_at is not None:
        raise ValueError("用户不存在")
    row = await db.get(UserAIPolicyOverride, user_id)
    current_version = row.version if row else 0
    if version != current_version:
        raise UserAIPolicyConflictError("用户额度已被其他管理员更新，请刷新后重试")
    before = _values_from_row(row) if row else {name: None for name in POLICY_FIELDS}
    if row is None:
        if not await _insert_user_policy(
            db, user_id, values, updated_by=operator.id
        ):
            raise UserAIPolicyConflictError(
                "用户额度已被其他管理员更新，请刷新后重试"
            )
        row = await db.get(UserAIPolicyOverride, user_id)
    else:
        result = await db.execute(
            update(UserAIPolicyOverride)
            .where(
                UserAIPolicyOverride.user_id == user_id,
                UserAIPolicyOverride.version == version,
            )
            .values(**values, version=version + 1, updated_by=operator.id, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise UserAIPolicyConflictError("用户额度已被其他管理员更新，请刷新后重试")
        await db.refresh(row)
    if row.version == version:
        row.version = version + 1
        row.updated_by = operator.id
        row.updated_at = utcnow()
    await _write_policy_audit(
        db,
        operator,
        action,
        "app_user",
        str(user_id),
        severity=severity,
        detail={
            "before": before,
            "after": values,
            "version": row.version,
            "reason": reason,
            "scope": "ordinary_user",
        },
        request=request,
    )
    await db.flush()
    return await get_user_policy(db, user_id)


async def _insert_default_policy(
    db: AsyncSession, values: dict[str, int], *, updated_by: int
) -> bool:
    insert = _dialect_insert(db)
    result = await db.execute(
        insert(UserAIPolicyDefault)
        .values(
            id=DEFAULT_POLICY_ID,
            version=1,
            updated_by=updated_by,
            updated_at=utcnow(),
            **values,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    return result.rowcount == 1


async def _insert_user_policy(
    db: AsyncSession,
    user_id: int,
    values: dict[str, int | None],
    *,
    updated_by: int,
) -> bool:
    insert = _dialect_insert(db)
    result = await db.execute(
        insert(UserAIPolicyOverride)
        .values(
            user_id=user_id,
            version=1,
            updated_by=updated_by,
            updated_at=utcnow(),
            **values,
        )
        .on_conflict_do_nothing(index_elements=["user_id"])
    )
    return result.rowcount == 1


def _dialect_insert(db: AsyncSession):
    if db.bind is not None and db.bind.dialect.name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    return insert


async def _write_policy_audit(*args, **kwargs) -> None:
    from app.services.admin_audit_service import write_admin_audit

    await write_admin_audit(*args, **kwargs)


async def reset_user_policy(
    db: AsyncSession,
    user_id: int,
    data: AdminUserAIPolicyResetRequest,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> AdminUserAIPolicyDetailResponse:
    # Retain the row's revision when clearing overrides: deleting it would let
    # an old version become valid again after the next insert (ABA).
    return await _replace_user_policy(
        db,
        user_id,
        data.version,
        {name: None for name in POLICY_FIELDS},
        data.reason,
        operator,
        request,
        action="app_user.ai_policy.reset",
        severity="important",
    )
