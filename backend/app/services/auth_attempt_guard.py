from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from app.core.cache import cache
from app.core.config import settings


class AuthAttemptBusyError(ValueError):
    """A decision is contended or has lost its lease or expected state."""


@dataclass
class AuthAttempt:
    locks: list[tuple[str, str]]
    expected: dict[str, Any] = field(default_factory=dict)

    async def read(self, key: str) -> Any:
        value = await cache.get_strict(key)
        self.expected[key] = value
        return value

    async def commit(self, **changes) -> None:
        if not await cache.commit_guarded_strict(
            locks=self.locks, expected=self.expected, **changes
        ):
            raise AuthAttemptBusyError("验证状态已变化，请重新验证")

    async def record_failure(
        self,
        *,
        challenge_key: str,
        failure_key: str,
        ip_lock_key: str,
        max_attempts: int,
        challenge_ttl: int,
        enforce_ip_lock: bool = True,
        ip_lock_max_failures: int | None = None,
        ip_lock_sec: int | None = None,
    ) -> bool:
        attempt_key = f"{challenge_key}:attempts"
        attempts = int(await self.read(attempt_key) or 0) + 1
        failures = (
            int(await self.read(failure_key) or 0) + 1
            if enforce_ip_lock
            else 0
        )
        max_failures = (
            ip_lock_max_failures
            if ip_lock_max_failures is not None
            else settings.OTP_IP_LOCK_MAX_FAILURES
        )
        lock_ttl = ip_lock_sec if ip_lock_sec is not None else settings.OTP_IP_LOCK_SEC
        locked = failures >= max_failures
        await self.commit(
            increments=[
                (attempt_key, challenge_ttl),
                *(
                    [(failure_key, lock_ttl)]
                    if enforce_ip_lock
                    else []
                ),
            ],
            values=[(ip_lock_key, "1", lock_ttl)] if locked else [],
            deletes=[challenge_key, attempt_key] if attempts >= max_attempts else [],
        )
        return locked


@asynccontextmanager
async def serialize_ip_attempts(lock_key: str) -> AsyncIterator[AuthAttempt]:
    """Keep lock checks, answer checks and counters in one IP-scoped decision.

    The guarded section only accesses Redis; never hold it over SMTP or image
    rendering. A contending request is rejected instead of queuing guesses.
    """
    owner = uuid4().hex
    if not await cache.acquire_lock_strict(lock_key, owner, ttl=10):
        raise AuthAttemptBusyError("验证请求过于频繁，请稍后重试")
    try:
        yield AuthAttempt(locks=[(lock_key, owner)])
    finally:
        await cache.release_lock(lock_key, owner)
