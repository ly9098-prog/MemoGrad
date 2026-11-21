"""Short-lived, one-time WeChat binding challenges initiated by the Web app."""

import hashlib
import hmac
import secrets
from typing import Any

from app.core.cache import CacheUnavailableError, cache

CHALLENGE_TTL_SEC = 5 * 60
STATUS_TTL_SEC = 10 * 60
_RECORD_PREFIX = "user:wechat-bind:challenge:"
_STATUS_PREFIX = "user:wechat-bind:status:"
_USED_PREFIX = "user:wechat-bind:used:"


class WechatBindError(ValueError):
    pass


class WechatBindUnavailableError(WechatBindError):
    pass


class WechatBindNotFoundError(WechatBindError):
    pass


class WechatBindConflictError(WechatBindError):
    pass


class WechatBindRateLimitedError(WechatBindError):
    pass


def _record_key(challenge_id: str) -> str:
    return f"{_RECORD_PREFIX}{challenge_id}"


def _status_key(challenge_id: str) -> str:
    return f"{_STATUS_PREFIX}{challenge_id}"


def _poll_digest(poll_token: str) -> str:
    return hashlib.sha256(poll_token.encode("utf-8")).hexdigest()


async def start_challenge(
    user_id: int,
    *,
    nbf: int | None,
) -> tuple[dict[str, Any], str]:
    try:
        allowed = await cache.reserve_rate_limits_strict(
            [
                (f"user:wechat-bind:start:hour:{user_id}", 6, 3600),
                (f"user:wechat-bind:start:day:{user_id}", 20, 86400),
            ]
        )
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定服务暂时不可用") from exc
    if not allowed:
        raise WechatBindRateLimitedError("微信绑定请求过于频繁，请稍后再试")

    challenge_id = secrets.token_hex(12)
    poll_token = secrets.token_urlsafe(32)
    record = {
        "challenge_id": challenge_id,
        "user_id": user_id,
        "nbf": int(nbf or 0),
        "poll_digest": _poll_digest(poll_token),
    }
    try:
        await cache.set_strict(
            _record_key(challenge_id),
            record,
            ttl=CHALLENGE_TTL_SEC,
        )
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定服务暂时不可用") from exc
    return record, poll_token


async def reserve_confirm_attempt(challenge_id: str, client_ip: str) -> None:
    try:
        allowed = await cache.reserve_rate_limits_strict(
            [
                (f"user:wechat-bind:confirm:{challenge_id}", 10, 600),
                (f"user:wechat-bind:ip:{client_ip}", 30, 600),
            ]
        )
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定服务暂时不可用") from exc
    if not allowed:
        raise WechatBindRateLimitedError("微信绑定确认过于频繁，请稍后再试")


def verify_poll_token(record: dict[str, Any], poll_token: str) -> bool:
    expected = str(record.get("poll_digest") or "")
    supplied = _poll_digest(poll_token)
    return bool(expected) and hmac.compare_digest(expected, supplied)


async def get_challenge(challenge_id: str) -> dict[str, Any] | None:
    try:
        record = await cache.get_strict(_record_key(challenge_id))
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定服务暂时不可用") from exc
    return record if isinstance(record, dict) else None


async def _claim_challenge(challenge_id: str) -> bool:
    try:
        return await cache.acquire_lock_strict(
            f"{_USED_PREFIX}{challenge_id}",
            secrets.token_hex(8),
            ttl=STATUS_TTL_SEC,
        )
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定服务暂时不可用") from exc


async def consume_challenge(challenge_id: str) -> dict[str, Any]:
    if not await _claim_challenge(challenge_id):
        raise WechatBindNotFoundError("绑定码已使用或已失效")
    record = await get_challenge(challenge_id)
    if record is None:
        raise WechatBindNotFoundError("绑定码已失效，请重新生成")
    return record


async def set_status(
    challenge_id: str,
    *,
    user_id: int,
    status: str,
    poll_digest: str | None = None,
    identity_id: int | None = None,
    message: str | None = None,
) -> None:
    try:
        await cache.set_strict(
            _status_key(challenge_id),
            {
                "user_id": user_id,
                "status": status,
                "poll_digest": poll_digest,
                "identity_id": identity_id,
                "message": message,
            },
            ttl=STATUS_TTL_SEC,
        )
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定状态暂时不可用") from exc


async def set_status_quietly(
    challenge_id: str,
    *,
    user_id: int,
    status: str,
    poll_digest: str | None = None,
    identity_id: int | None = None,
    message: str | None = None,
) -> None:
    """Best-effort status write used on error paths that already fail closed."""
    try:
        await set_status(
            challenge_id,
            user_id=user_id,
            status=status,
            poll_digest=poll_digest,
            identity_id=identity_id,
            message=message,
        )
    except WechatBindUnavailableError:
        pass


async def get_status(
    challenge_id: str,
    poll_token: str,
) -> dict[str, Any]:
    try:
        status = await cache.get_strict(_status_key(challenge_id))
        if isinstance(status, dict):
            expected = str(status.get("poll_digest") or "")
            supplied = _poll_digest(poll_token)
            if not expected or not hmac.compare_digest(expected, supplied):
                raise WechatBindNotFoundError("绑定请求不存在或已失效")
            return {
                "status": str(status.get("status") or "expired"),
                "identity_id": status.get("identity_id"),
                "message": status.get("message"),
                "user_id": int(status.get("user_id") or 0),
            }
        record = await get_challenge(challenge_id)
    except WechatBindUnavailableError:
        raise
    if record is None:
        return {"status": "expired", "user_id": None}
    if not verify_poll_token(record, poll_token):
        raise WechatBindNotFoundError("绑定请求不存在或已失效")
    return {
        "status": "pending",
        "identity_id": None,
        "message": None,
        "user_id": int(record.get("user_id") or 0),
    }


async def cancel_challenge(challenge_id: str, poll_token: str) -> None:
    record = await get_challenge(challenge_id)
    if record is None:
        raise WechatBindNotFoundError("绑定请求不存在或已失效")
    if not verify_poll_token(record, poll_token):
        raise WechatBindNotFoundError("绑定请求不存在或已失效")
    if not await _claim_challenge(challenge_id):
        raise WechatBindConflictError("绑定确认已开始或已完成，无法取消，请等待绑定结果")
    await set_status(
        challenge_id,
        user_id=int(record.get("user_id") or 0),
        status="cancelled",
        poll_digest=str(record.get("poll_digest") or ""),
        message="绑定已取消",
    )
    try:
        await cache.delete_strict(_record_key(challenge_id))
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定服务暂时不可用") from exc


async def discard_challenge(challenge_id: str) -> None:
    try:
        await cache.delete_strict(_record_key(challenge_id))
    except CacheUnavailableError as exc:
        raise WechatBindUnavailableError("微信绑定服务暂时不可用") from exc
