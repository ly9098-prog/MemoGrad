"""Account admission and paid-use settlement for the two statistics AI readers."""

from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ai_runtime_guard import AIResourceRejectedError
from app.models.user import User
from app.services.ai_learning_service import (
    cancel_token_reservation,
    estimate_chat_token_reservation,
    record_token_usage,
    reserve_token_budget,
    settle_token_reservation,
)


async def lock_active_user(db: AsyncSession, user_id: int) -> bool:
    return await db.scalar(
        select(User.id)
        .where(
            User.id == user_id,
            User.deleted_at.is_(None),
            User.is_banned.is_(False),
            User.lifecycle_status == "active",
        )
        .with_for_update()
    ) is not None


async def call_metered_stats_ai(
    db: AsyncSession,
    user_id: int,
    messages: list[dict],
    invoke: Callable[[int | None], Awaitable[dict | None]],
    *,
    max_tokens: int,
    session_type: str,
) -> dict | None:
    reservation = await reserve_token_budget(
        db, user_id, estimate_chat_token_reservation(messages, max_output_tokens=max_tokens)
    )
    if reservation is None:
        return None
    try:
        response = await invoke(reservation.rpm_limit)
    except AIResourceRejectedError:
        # Admission failures happen before provider transport, so release the
        # known zero-cost hold. Other exceptions may follow a dispatched call
        # and therefore retain it.
        await cancel_token_reservation(reservation)
        raise
    if response is None:
        await cancel_token_reservation(reservation)
        return None
    await record_token_usage(
        db, user_id, session_type, session_type,
        str(response.get("content") or ""), response,
    )
    await settle_token_reservation(reservation, int(response.get("tokens_used") or 0))
    return response


def unavailable_diagnosis(summary: str = "账号已注销，无法生成诊断。") -> dict:
    return {
        "weak_points": [], "strong_points": [], "learning_suggestions": [],
        "summary": summary, "generated": False,
    }


def empty_dashboard_payload(trend_days: int) -> dict:
    return {
        "overview": {
            "today_questions": 0, "today_accuracy": 0.0, "due_review_count": 0,
            "consecutive_days": 0, "total_questions": 0, "total_accuracy": 0.0,
        },
        "trends": {
            "days": trend_days, "total_questions": 0, "active_days": 0,
            "avg_accuracy": 0.0,
        },
        "subjects": {"strongest": None, "weakest": None, "items": []},
        "review_risk": {"high_forget_count": 0, "stuck_questions": 0, "top_topics": []},
    }
