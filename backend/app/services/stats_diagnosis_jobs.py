"""Return local insights immediately and enhance them in a bounded tracked task."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.background_tasks import create_background_task
from app.core.cache import CacheUnavailableError, cache
from app.core.database import async_session
from app.core.time_utils import shanghai_today
from app.services import stats_query_service, stats_service
from app.services.learning_time_projection import date_utc_range
from app.services.stats_ai_billing import lock_active_user
from app.services.stats_ai_projection import (
    build_knowledge_point_stats,
    build_local_ai_diagnosis,
)

logger = logging.getLogger(__name__)
JOB_TIMEOUT = 65
LEASE_TTL = 90
PUBLISH_TIMEOUT = 12
RESULT_KEY_PREFIX = "ai_diagnosis_job:v1"
LEASE_KEY_PREFIX = "ai_diagnosis_job_lease:v1"


async def _snapshot(db: AsyncSession, user_id: int) -> dict:
    since = date_utc_range(shanghai_today() - timedelta(days=60))[0]
    rows = await stats_query_service.load_ai_diagnosis_subject_rows(db, user_id, since)
    totals = await stats_query_service.load_practice_totals(db, user_id)
    return build_local_ai_diagnosis(
        knowledge_point_stats=build_knowledge_point_stats(rows),
        subject_count=len(rows),
        total_questions=int(totals[0] or 0),
    )


def _current_data(entry: dict) -> dict:
    if not isinstance(entry, dict) or not isinstance(entry.get("data"), dict):
        return {}
    data = entry["data"]
    if data.get("status") == "pending" and entry.get("pending_until", 0) <= time.time():
        return {**data, "status": "ready"}
    return data


def _entry_created_at(entry: dict) -> float:
    return float(entry.get("created_at", 0) or 0) if isinstance(entry, dict) else 0.0


async def get_diagnosis(
    db: AsyncSession, user_id: int, *, refresh: bool = False, poll_only: bool = False
) -> dict:
    key = f"{RESULT_KEY_PREFIX}:{user_id}"
    observed_at = 0.0
    try:
        entry = await cache.get_strict(key)
        observed_at = _entry_created_at(entry)
        current = _current_data(entry) if entry else {}
        if current and (poll_only or not refresh or current.get("status") == "pending"):
            return current
        local = {**await _snapshot(db, user_id), "status": "ready"}
        if poll_only:
            return local
        return await _start(
            user_id, key, local, refresh=refresh, observed_at=observed_at
        )
    except CacheUnavailableError:
        if poll_only:
            return {"status": "pending"}
        local = {
            **await _snapshot(db, user_id),
            "status": "ready",
        }
        return local


async def _start(
    user_id: int, key: str, local: dict, *, refresh: bool, observed_at: float
) -> dict:
    token = uuid.uuid4().hex
    lease = f"{LEASE_KEY_PREFIX}:{user_id}"
    pending = {**local, "status": "pending"}
    if not await cache.acquire_lock_strict(lease, token, ttl=LEASE_TTL):
        entry = await cache.get_strict(key)
        current = _current_data(entry) if entry else {}
        return current if current else pending
    try:
        entry = await cache.get_strict(key)
        current = _current_data(entry) if entry else {}
        current_is_newer = _entry_created_at(entry) > observed_at
        if current and (
            not refresh or current_is_newer or current.get("status") == "pending"
        ):
            await cache.release_lock(lease, token)
            return current
        created_at = time.time()
        published = await cache.commit_guarded_strict(
            locks=[(lease, token)],
            expected={},
            values=[
                (
                    key,
                    {
                        "data": pending,
                        "pending_until": created_at + JOB_TIMEOUT + PUBLISH_TIMEOUT + 3,
                        "created_at": created_at,
                    },
                    120,
                )
            ],
        )
        if not published:
            await cache.release_lock(lease, token)
            return local
        create_background_task(
            _run(user_id, key, lease, token, local), name="stats-diagnosis"
        )
    except BaseException:
        await cache.release_lock(lease, token)
        raise
    return pending


async def _run(user_id: int, key: str, lease: str, token: str, local: dict) -> None:
    result = local
    try:
        async with asyncio.timeout(JOB_TIMEOUT):
            async with async_session() as db:
                candidate = await stats_service.get_ai_diagnosis(db, user_id)
                await db.commit()
                result = {**candidate, "status": "ready"}
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning(
            "stats.diagnosis.failed user_id=%s error_type=%s",
            user_id,
            type(exc).__name__,
        )
    finally:
        await _publish_result(user_id, key, lease, token, result)


async def _publish_result(
    user_id: int, key: str, lease: str, token: str, result: dict
) -> None:
    """Retry publication with ownership and account checks held together."""
    try:
        async with asyncio.timeout(PUBLISH_TIMEOUT):
            while True:
                try:
                    async with async_session() as db:
                        active = await lock_active_user(db, user_id)
                        # Billing commits internally. Reacquire the account row
                        # here, and retain it until the guarded write finishes.
                        values = (
                            [
                                (
                                    key,
                                    {"data": result, "created_at": time.time()},
                                    600 if result.get("generated") else 30,
                                )
                            ]
                            if active
                            else []
                        )
                        await cache.commit_guarded_strict(
                            locks=[(lease, token)],
                            expected={},
                            values=values,
                            deletes=[lease] if active else [lease, key],
                        )
                    return
                except CacheUnavailableError:
                    await asyncio.sleep(0.3)
    except TimeoutError:
        # Leave the lease to expire: another request must not repurchase the
        # same analysis while publication is still within its recovery window.
        logger.error("stats.diagnosis.publish_failed user_id=%s", user_id)
    except Exception as exc:
        logger.warning(
            "stats.diagnosis.publish_failed user_id=%s error_type=%s",
            user_id,
            type(exc).__name__,
        )
