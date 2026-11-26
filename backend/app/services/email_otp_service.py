import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.services.auth_attempt_guard import (
    AuthAttempt,
    AuthAttemptBusyError,
    serialize_ip_attempts,
)
from app.services.email_delivery import build_otp_email, send_auth_email

DOMAINS = {"user", "admin"}
PURPOSES = {"login", "register", "bind", "step_up", "activate", "recover"}


class OtpError(ValueError):
    pass


class OtpRateLimitError(OtpError):
    pass


class OtpIpLockedError(OtpRateLimitError):
    pass


class OtpUnavailableError(OtpError):
    pass


@dataclass(frozen=True)
class IssuedOtp:
    challenge_id: str
    expires_in: int
    resend_after: int


def _digest(*parts: str) -> str:
    payload = "\0".join(parts).encode("utf-8")
    return hmac.new(
        settings.APP_SECRET.encode("utf-8"), payload, hashlib.sha256
    ).hexdigest()


def _email_digest(domain: str, purpose: str, email: str) -> str:
    return _digest("email-address", domain, purpose, email)


def _challenge_key(challenge_id: str) -> str:
    return f"auth:otp:challenge:{challenge_id}"


def _resend_key(domain: str, purpose: str, email: str) -> str:
    return f"auth:otp:resend:{domain}:{purpose}:{_email_digest(domain, purpose, email)}"


def _active_key(domain: str, purpose: str, email: str) -> str:
    return f"auth:otp:active:{domain}:{purpose}:{_email_digest(domain, purpose, email)}"


def _ip_failure_key(domain: str, purpose: str, client_ip: str) -> str:
    digest = _digest("otp-ip", domain, purpose, client_ip)
    return f"auth:otp:ip-fail:{domain}:{purpose}:{digest}"


def _ip_lock_key(domain: str, purpose: str, client_ip: str) -> str:
    digest = _digest("otp-ip-lock", domain, purpose, client_ip)
    return f"auth:otp:ip-lock:{domain}:{purpose}:{digest}"


def _budget_keys(
    domain: str, purpose: str, email: str, client_ip: str
) -> tuple[str, ...]:
    day = datetime.now(UTC).strftime("%Y%m%d")
    digest = _email_digest(domain, purpose, email)
    email_key = f"auth:otp:email:{domain}:{purpose}:{digest}"
    ip_digest = hashlib.sha256(client_ip.encode("utf-8")).hexdigest()
    return (
        f"auth:otp:ip:{domain}:{purpose}:{ip_digest}",
        f"auth:otp:total:{domain}:{day}",
        email_key,
        f"auth:otp:ip-day:{domain}:{day}:{ip_digest}",
    )


def _unknown_recipient_key(domain: str) -> str:
    day = datetime.now(UTC).strftime("%Y%m%d")
    return f"auth:otp:unknown:{domain}:{day}"


async def _enforce_budgets(
    domain: str,
    purpose: str,
    email: str,
    client_ip: str,
    *,
    known_recipient: bool,
) -> None:
    ip_key, total_key, email_key, ip_day_key = _budget_keys(
        domain, purpose, email, client_ip
    )
    daily_limit = (
        settings.OTP_ADMIN_DOMAIN_DAILY_LIMIT
        if domain == "admin"
        else settings.OTP_USER_DOMAIN_DAILY_LIMIT
    )
    ip_daily_limit = (
        settings.OTP_ADMIN_IP_DAILY_LIMIT
        if domain == "admin"
        else settings.OTP_USER_IP_DAILY_LIMIT
    )
    limits = [
        (ip_key, settings.OTP_IP_HOURLY_LIMIT, 3600),
        (email_key, settings.OTP_EMAIL_HOURLY_LIMIT, 3600),
        (total_key, daily_limit, 86400),
        (ip_day_key, ip_daily_limit, 86400),
    ]
    if not known_recipient:
        unknown_daily_limit = (
            settings.OTP_ADMIN_UNKNOWN_EMAIL_DAILY_LIMIT
            if domain == "admin"
            else settings.OTP_USER_UNKNOWN_EMAIL_DAILY_LIMIT
        )
        limits.append(
            (_unknown_recipient_key(domain), unknown_daily_limit, 86400)
        )
    try:
        reserved = await cache.reserve_rate_limits_strict(limits)
    except CacheUnavailableError as exc:
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc
    if not reserved:
        raise OtpRateLimitError("验证码请求过于频繁，请稍后重试")


async def _assert_ip_unlocked(domain: str, purpose: str, client_ip: str) -> None:
    if await cache.get_strict(_ip_lock_key(domain, purpose, client_ip)):
        raise OtpIpLockedError("验证码尝试次数过多，请稍后再试")


async def _publish_challenge(
    challenge_id: str,
    challenge: dict[str, Any],
    subject: str,
    text: str,
    html: str,
) -> None:
    domain, purpose, email = (challenge[key] for key in ("domain", "purpose", "email"))
    active_key = _active_key(domain, purpose, email)
    old_challenge_id: str | None = None
    try:
        old_challenge_id = await cache.get_strict(active_key)
        await cache.set_strict(
            _challenge_key(challenge_id), challenge, ttl=settings.OTP_EXPIRE_SEC
        )
    except CacheUnavailableError as exc:
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc

    try:
        await send_auth_email(to_email=email, subject=subject, text=text, html=html)
    except Exception as exc:
        try:
            await cache.delete_strict(_challenge_key(challenge_id))
            await cache.delete_strict(_resend_key(domain, purpose, email))
        except CacheUnavailableError:
            pass
        if isinstance(exc, OtpError):
            raise
        raise OtpUnavailableError(str(exc) or "邮件发送失败，请稍后重试") from exc
    try:
        await cache.set_strict(active_key, challenge_id, ttl=settings.OTP_EXPIRE_SEC)
        if old_challenge_id and old_challenge_id != challenge_id:
            old_key = _challenge_key(str(old_challenge_id))
            await cache.delete_strict(old_key)
            await cache.delete_strict(f"{old_key}:attempts")
    except CacheUnavailableError as exc:
        try:
            await cache.delete_strict(_challenge_key(challenge_id))
        except CacheUnavailableError:
            pass
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc


async def issue_otp(
    *,
    domain: str,
    email: str,
    purpose: str,
    client_ip: str,
    enforce_ip_lock: bool = True,
    user_id: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> IssuedOtp:
    if domain not in DOMAINS or purpose not in PURPOSES:
        raise OtpError("验证码用途无效")
    if enforce_ip_lock:
        try:
            await _assert_ip_unlocked(domain, purpose, client_ip)
        except CacheUnavailableError as exc:
            raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc
    resend_key = _resend_key(domain, purpose, email)
    owner = uuid4().hex
    try:
        acquired = await cache.acquire_lock_strict(
            resend_key,
            owner,
            ttl=settings.OTP_RESEND_SEC,
        )
    except CacheUnavailableError as exc:
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc
    if not acquired:
        raise OtpRateLimitError("请稍后再获取验证码")
    try:
        await _enforce_budgets(
            domain,
            purpose,
            email,
            client_ip,
            known_recipient=user_id is not None,
        )
    except OtpError:
        await cache.release_lock(resend_key, owner)
        raise
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge_id = uuid4().hex
    challenge = {
        "domain": domain,
        "purpose": purpose,
        "email": email,
        "user_id": user_id,
        "code_digest": _digest("otp-code", challenge_id, email, domain, purpose, code),
        "metadata": metadata or {},
    }
    subject, text, html = build_otp_email(domain, purpose, code)
    await _publish_challenge(challenge_id, challenge, subject, text, html)
    return IssuedOtp(
        challenge_id=challenge_id,
        expires_in=settings.OTP_EXPIRE_SEC,
        resend_after=settings.OTP_RESEND_SEC,
    )


async def _verify_code(
    challenge_id: str,
    challenge: dict[str, Any],
    code: str,
    domain: str,
    purpose: str,
    client_ip: str,
    attempt: AuthAttempt,
    enforce_ip_lock: bool,
) -> None:
    expected = str(challenge.get("code_digest") or "")
    actual = _digest(
        "otp-code", challenge_id, str(challenge["email"]), domain, purpose, code
    )
    if not hmac.compare_digest(expected, actual):
        if await attempt.record_failure(
            challenge_key=_challenge_key(challenge_id),
            failure_key=_ip_failure_key(domain, purpose, client_ip),
            ip_lock_key=_ip_lock_key(domain, purpose, client_ip),
            max_attempts=settings.OTP_MAX_ATTEMPTS,
            challenge_ttl=settings.OTP_EXPIRE_SEC,
            enforce_ip_lock=enforce_ip_lock,
        ):
            raise OtpIpLockedError("验证码尝试次数过多，请稍后再试")
        raise OtpError("验证码错误或已失效")


async def consume_otp(
    *,
    challenge_id: str,
    code: str,
    domain: str,
    purpose: str,
    client_ip: str,
    enforce_ip_lock: bool = True,
    client: str | None = None,
) -> dict[str, Any]:
    try:
        async with serialize_ip_attempts(
            f"{_ip_lock_key(domain, purpose, client_ip)}:attempt"
        ) as attempt:
            return await _consume_otp(
                challenge_id=challenge_id,
                code=code,
                domain=domain,
                purpose=purpose,
                client_ip=client_ip,
                attempt=attempt,
                enforce_ip_lock=enforce_ip_lock,
                client=client,
            )
    except AuthAttemptBusyError as exc:
        raise OtpRateLimitError(str(exc)) from exc
    except CacheUnavailableError as exc:
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc


async def _consume_otp(
    *,
    challenge_id: str,
    code: str,
    domain: str,
    purpose: str,
    client_ip: str,
    attempt: AuthAttempt,
    enforce_ip_lock: bool,
    client: str | None,
) -> dict[str, Any]:
    key = _challenge_key(challenge_id)
    lock_key = f"{key}:lock"
    owner = uuid4().hex
    try:
        acquired = await cache.acquire_lock_strict(lock_key, owner, ttl=10)
    except CacheUnavailableError as exc:
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc
    if not acquired:
        raise OtpRateLimitError("验证请求过于频繁，请稍后重试")
    attempt.locks.append((lock_key, owner))
    try:
        if (
            enforce_ip_lock
            and await attempt.read(_ip_lock_key(domain, purpose, client_ip))
        ):
            raise OtpIpLockedError("验证码尝试次数过多，请稍后再试")
        challenge = await attempt.read(key)
        if not isinstance(challenge, dict):
            raise OtpError("验证码无效或已过期")
        active_key = _active_key(domain, purpose, str(challenge["email"]))
        active_challenge_id = await attempt.read(active_key)
        if active_challenge_id != challenge_id:
            raise OtpError("验证码无效或已过期")
        if challenge.get("domain") != domain or challenge.get("purpose") != purpose:
            raise OtpError("验证码用途不匹配")
        if (
            client is not None
            and challenge.get("metadata", {}).get("client") != client
        ):
            raise OtpError("验证码客户端不匹配")
        await _verify_code(
            challenge_id,
            challenge,
            code,
            domain,
            purpose,
            client_ip,
            attempt,
            enforce_ip_lock,
        )
        deletes = [key, f"{key}:attempts", active_key]
        # The IP failure counter is shared across challenges for this
        # domain/purpose.  Deleting it on any successful verification would let
        # an attacker reset the IP lock with their own mailbox between guesses.
        await attempt.commit(deletes=deletes)
        return challenge
    except CacheUnavailableError as exc:
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc
    finally:
        await cache.release_lock(lock_key, owner)


async def get_active_challenge(challenge_id: str) -> dict[str, Any]:
    """Read resend context; this never verifies a code or grants authentication."""
    try:
        challenge = await cache.get_strict(_challenge_key(challenge_id))
        if not isinstance(challenge, dict):
            raise OtpError("验证码已失效，请重新完成安全验证")
        active = await cache.get_strict(
            _active_key(challenge["domain"], challenge["purpose"], challenge["email"])
        )
        if active != challenge_id:
            raise OtpError("验证码已失效，请重新完成安全验证")
        return challenge
    except CacheUnavailableError as exc:
        raise OtpUnavailableError("验证码服务暂时不可用，请稍后重试") from exc
