"""Atomic monthly accounting for Admin-triggered AI parse calls."""

import math

from sqlalchemy import select, update

from app.core.database import async_session
from app.core.log_context import get_log_context
from app.core.time_utils import shanghai_now
from app.models.admin import AdminAIUsageMonthly, AdminUser, Role
from app.services.admin_ai_settings_service import (
    current_year_month,
    get_or_create_ai_settings,
)


class AdminAIUsageRejectedError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retry_after_sec: int | None = None,
    ) -> None:
        self.code = code
        self.retry_after_sec = retry_after_sec
        super().__init__(message)


def parse_admin_id_from_created_by(value: str | None) -> int | None:
    """Return the numeric admin ID from the explicit ``admin:<id>`` owner form."""
    raw = str(value or "").strip()
    if not raw.startswith("admin:"):
        return None
    try:
        admin_id = int(raw.removeprefix("admin:"))
    except ValueError:
        return None
    return admin_id if admin_id > 0 else None


def seconds_until_next_month() -> int:
    """Return a stable Shanghai-calendar retry delay for a month-scoped quota."""
    now = shanghai_now()
    if now.month == 12:
        boundary = now.replace(
            year=now.year + 1,
            month=1,
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
    else:
        boundary = now.replace(
            month=now.month + 1,
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        )
    return max(1, math.ceil((boundary - now).total_seconds()))


async def reserve_admin_ai_parse_call(
    *,
    scope: str,
    admin_id: int | None = None,
) -> str:
    resolved_admin_id = admin_id or _context_admin_id()
    if resolved_admin_id is None:
        raise AdminAIUsageRejectedError(
            "ai_admin_auth_unavailable", "无法确认 AI 解析操作管理员"
        )
    async with async_session() as db:
        settings = await get_or_create_ai_settings(db)
        if not settings.ai_parse_enabled:
            await _write_rejection_audit(
                db,
                admin_id=resolved_admin_id,
                scope=scope,
                action="ai_parse.blocked",
                resource_type="ai_setting",
                resource_id=settings.id,
                year_month=current_year_month(),
                error_message="AI 解析已全局关闭",
            )
            await db.commit()
            raise AdminAIUsageRejectedError(
                "ai_parse_disabled", "后台 AI 解析已全局关闭"
            )
        year_month = current_year_month()
        await _ensure_monthly_row(db, year_month, settings.monthly_call_limit)
        is_super_admin = await _is_super_admin(db, resolved_admin_id)
        condition = AdminAIUsageMonthly.year_month == year_month
        if settings.monthly_call_limit > 0 and not is_super_admin:
            condition = condition & (
                AdminAIUsageMonthly.call_count < settings.monthly_call_limit
            )
        result = await db.execute(
            update(AdminAIUsageMonthly)
            .where(condition)
            .values(call_count=AdminAIUsageMonthly.call_count + 1)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            await _write_rejection_audit(
                db,
                admin_id=resolved_admin_id,
                scope=scope,
                action="ai_quota.exhausted",
                resource_type="ai_usage",
                resource_id=year_month,
                year_month=year_month,
                error_message="AI 解析月度额度已用尽",
            )
            await db.commit()
            raise AdminAIUsageRejectedError(
                "ai_admin_quota_exhausted",
                "AI 解析月度额度已用尽",
                retry_after_sec=seconds_until_next_month(),
            )
        await db.commit()
        return year_month


async def release_admin_ai_parse_call_for(
    *,
    scope: str,
    admin_id: int | None = None,
    year_month: str | None = None,
) -> None:
    """Release one attempt for an explicit admin/scope after pre-dispatch failure."""
    resolved_admin_id = admin_id or _context_admin_id()
    if resolved_admin_id is None or not year_month:
        return
    async with async_session() as db:
        target_month = year_month
        await db.execute(
            update(AdminAIUsageMonthly)
            .where(
                AdminAIUsageMonthly.year_month == target_month,
                AdminAIUsageMonthly.call_count > 0,
            )
            .values(call_count=AdminAIUsageMonthly.call_count - 1)
            .execution_options(synchronize_session=False)
        )
        await db.commit()


def _context_admin_id() -> int | None:
    raw = get_log_context().get("admin_id")
    if raw in (None, "", "-"):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


async def _write_rejection_audit(
    db,
    *,
    admin_id: int,
    scope: str,
    action: str,
    resource_type: str,
    resource_id: str | int | None,
    year_month: str,
    error_message: str,
) -> None:
    from app.core.admin_security import AdminPrincipal
    from app.services.admin_audit_service import write_admin_audit

    admin = await db.get(AdminUser, admin_id)
    principal = AdminPrincipal(admin, {}) if admin is not None else None
    await write_admin_audit(
        db,
        principal,
        action,
        resource_type,
        resource_id,
        severity="important",
        detail={
            "reason": "rejected_before_transport",
            "scope": scope,
            "year_month": year_month,
            "admin_id": admin_id,
        },
        status="failed",
        error_message=error_message,
    )


async def _is_super_admin(db, admin_id: int) -> bool:
    role = await db.scalar(
        select(Role.name)
        .join(AdminUser, AdminUser.role_id == Role.id)
        .where(AdminUser.id == admin_id)
    )
    return role == "super_admin"


async def _ensure_monthly_row(db, year_month: str, limit: int) -> None:
    dialect = db.bind.dialect.name if db.bind else "postgresql"
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        from sqlalchemy.dialects.postgresql import insert
    statement = (
        insert(AdminAIUsageMonthly)
        .values(
            year_month=year_month,
            call_count=0,
            limit_snapshot=limit,
        )
        .on_conflict_do_nothing(index_elements=["year_month"])
    )
    await db.execute(statement)
