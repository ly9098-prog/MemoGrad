import logging
from datetime import datetime, timedelta

from sqlalchemy import or_, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import normalize_to_naive_utc, utcnow
from app.models.user import User

USER_CLIENTS = ("web", "miniprogram")
ACTIVITY_WRITE_COOLDOWN_SECONDS = 5 * 60
logger = logging.getLogger("postgraduate-ai.user-auth")


def _active_client(client: str) -> str | None:
    return client if client in USER_CLIENTS else None


async def record_user_activity(
    db: AsyncSession,
    user: User,
    client: str,
    *,
    now: datetime | None = None,
) -> None:
    """Record a successful authenticated client without blocking login flows.

    Activity metadata is operational evidence, not authorization input.  A
    five-minute window avoids a write per business request, and the conditional
    update ensures a delayed login cannot replace a newer activity timestamp.
    """
    active_client = _active_client(client)
    if active_client is None:
        return

    observed_at = normalize_to_naive_utc(now or utcnow())
    threshold = observed_at - timedelta(seconds=ACTIVITY_WRITE_COOLDOWN_SECONDS)
    try:
        result = await db.execute(
            update(User)
            .where(
                User.id == user.id,
                User.lifecycle_status == "active",
                User.deleted_at.is_(None),
                User.is_banned.is_(False),
                or_(
                    User.last_active_at.is_(None),
                    User.last_active_at <= observed_at,
                ),
                or_(
                    User.last_active_client.is_(None),
                    User.last_active_client != active_client,
                    User.last_active_at < threshold,
                ),
            )
            .values(last_active_client=active_client, last_active_at=observed_at)
        )
        if not result.rowcount:
            return
        user.last_active_client = active_client
        user.last_active_at = observed_at
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            logger.warning(
                "User activity rollback failed: user_id=%s client=%s",
                user.id,
                active_client,
                exc_info=True,
            )
        logger.warning(
            "User activity write failed: user_id=%s client=%s",
            user.id,
            active_client,
            exc_info=True,
        )
