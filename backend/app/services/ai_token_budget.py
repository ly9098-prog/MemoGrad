"""Per-user AI token admission and billing shared by learning and vector services.

Uses the existing atomic cache ledger and AiChat usage records. The global
OCR/import token budget in app.features.token_budget is a separate policy.
"""

import logging
from dataclasses import dataclass

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.ai_runtime_guard import AIResourceRejectedError
from app.core.time_utils import shanghai_date_utc_range, shanghai_today
from app.models.ai_chat import AiChat
from app.services.user_ai_policy_service import (
    EffectiveUserAIPolicy,
    UserAIPolicyUnavailableError,
    get_effective_user_ai_policy,
    runtime_default_values,
)

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class TokenReservation:
    user_id: int
    reserved_tokens: int
    day_key: str
    month_key: str
    active: bool = True
    rpm_limit: int | None = None
    policy: EffectiveUserAIPolicy | None = None


def _token_period_keys(user_id: int) -> tuple[str, str]:
    today_date = shanghai_today()
    today = today_date.strftime("%Y-%m-%d")
    month = today_date.strftime("%Y-%m")
    env = str(settings.APP_ENV or "unknown").strip().lower()
    return (
        f"memograd:{env}:ai:budget:day:{today}:user:{user_id}",
        f"memograd:{env}:ai:budget:month:{month}:user:{user_id}",
    )


async def reserve_token_budget(
    db: AsyncSession, user_id: int, tokens_needed: int
) -> TokenReservation | None:
    """Atomically reserve estimated tokens before invoking a paid provider."""
    tokens = max(1, int(tokens_needed))
    if db is None:
        policy = EffectiveUserAIPolicy(**runtime_default_values().model_dump())
    else:
        try:
            policy = await get_effective_user_ai_policy(db, user_id)
        except UserAIPolicyUnavailableError as exc:
            raise AIResourceRejectedError(
                "ai_user_policy_unavailable", retry_after_sec=5
            ) from exc
    daily_limit = int(policy.daily_token_limit)
    monthly_limit = int(policy.monthly_token_limit)
    day_key, month_key = _token_period_keys(user_id)
    if daily_limit <= 0 and monthly_limit <= 0:
        return TokenReservation(
            user_id,
            0,
            day_key,
            month_key,
            rpm_limit=policy.rpm_limit,
            policy=policy,
        )

    today_date = shanghai_today()
    today = shanghai_date_utc_range(today_date)[0]
    first_of_month = shanghai_date_utc_range(today_date.replace(day=1))[0]
    used_today, used_monthly = await _load_token_usage(
        db,
        user_id,
        today=today,
        first_of_month=first_of_month,
    )
    try:
        reserved = await cache.reserve_token_budget_strict(
            day_key=day_key,
            month_key=month_key,
            used_daily=int(used_today or 0),
            used_monthly=int(used_monthly or 0),
            tokens=tokens,
            daily_limit=daily_limit,
            monthly_limit=monthly_limit,
            daily_ttl=3 * 24 * 60 * 60,
            monthly_ttl=40 * 24 * 60 * 60,
        )
    except CacheUnavailableError:
        return None
    if not reserved:
        return None
    return TokenReservation(
        user_id,
        tokens,
        day_key,
        month_key,
        rpm_limit=policy.rpm_limit,
        policy=policy,
    )


async def settle_token_reservation(
    reservation: TokenReservation | None,
    actual_tokens: int,
) -> None:
    """Keep the actual charge and refund only the unused part of a hold."""
    if reservation is None or not reservation.active:
        return
    reservation.active = False
    if reservation.reserved_tokens <= 0:
        return
    try:
        await cache.release_token_budget_strict(
            day_key=reservation.day_key,
            month_key=reservation.month_key,
            tokens=reservation.reserved_tokens,
            actual_tokens=actual_tokens,
        )
    except CacheUnavailableError:
        logger.warning(
            "AI token reservation settlement failed user_id=%s reserved=%s actual=%s",
            reservation.user_id,
            reservation.reserved_tokens,
            actual_tokens,
        )


async def cancel_token_reservation(
    reservation: TokenReservation | None,
) -> None:
    """Release the full reservation when the provider is not billed."""
    if reservation is None or not reservation.active:
        return
    reservation.active = False
    if reservation.reserved_tokens <= 0:
        return
    try:
        await cache.release_token_budget_strict(
            day_key=reservation.day_key,
            month_key=reservation.month_key,
            tokens=reservation.reserved_tokens,
        )
    except CacheUnavailableError:
        logger.warning(
            "AI token reservation cancel failed user_id=%s tokens=%s",
            reservation.user_id,
            reservation.reserved_tokens,
        )


async def _load_token_usage(
    db: AsyncSession,
    user_id: int,
    *,
    today,
    first_of_month,
) -> tuple[int, int]:
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    case((AiChat.created_at >= today, AiChat.tokens_used), else_=0)
                ),
                0,
            ),
            func.coalesce(func.sum(AiChat.tokens_used), 0),
        ).where(
            AiChat.user_id == user_id,
            AiChat.created_at >= first_of_month,
        )
    )
    used_today, used_monthly = result.one()
    return int(used_today or 0), int(used_monthly or 0)


async def record_token_usage(
    db: AsyncSession,
    user_id: int,
    session_type: str,
    user_message: str,
    ai_response: str,
    result: dict,
) -> None:
    """记录 AI 调用 token 用量到 AiChat。"""
    db.add(
        AiChat(
            user_id=user_id,
            session_type=session_type,
            user_message=user_message[:500],
            ai_response=ai_response[:2000],
            tokens_used=result.get("tokens_used", 0),
            model=result.get("model", "unknown"),
            duration_ms=result.get("duration_ms", 0),
        )
    )
    await db.commit()
