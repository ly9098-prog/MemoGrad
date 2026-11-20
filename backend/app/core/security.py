import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.database import get_db
from app.core.deployment_profile import DeploymentProfile, detect_deployment_profile
from app.core.time_utils import unix_timestamp, utcnow
from app.models.admin import AdminUser, Permission, RolePermission
from app.models.app_user_admin_binding import AppUserAdminBinding

security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

_USER_TOKEN_TYPE = "user_access"
_USER_STEP_UP_TOKEN_TYPE = "user_step_up"


def _user_jwt_secret() -> str:
    """Return a user-token signing key isolated from the admin token domain.

    USER_JWT_SECRET can provide a fully independent root secret.  When it is
    unset, derive a scoped key from APP_SECRET so user/admin JWTs still never
    share the exact HMAC key.
    """
    configured = (getattr(settings, "USER_JWT_SECRET", "") or "").strip()
    if configured:
        return configured
    return hmac.new(
        settings.APP_SECRET.encode("utf-8"),
        b"memograd:user-jwt:v1",
        hashlib.sha256,
    ).hexdigest()


def create_token(user_id: int, *, issued_at: int | None = None) -> tuple[str, int]:
    current = int(datetime.now(UTC).timestamp())
    now = datetime.fromtimestamp(max(current, issued_at or current), tz=UTC)
    expire_dt = now + timedelta(days=settings.JWT_EXPIRE_DAYS)
    payload = {
        "sub": str(user_id),
        "type": _USER_TOKEN_TYPE,
        "iss": settings.JWT_ISSUER,
        "aud": settings.USER_JWT_AUDIENCE,
        "jti": uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(expire_dt.timestamp()),
    }
    return (
        jwt.encode(payload, _user_jwt_secret(), algorithm="HS256"),
        int(expire_dt.timestamp()),
    )


def decode_token_payload(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            _user_jwt_secret(),
            algorithms=["HS256"],
            audience=settings.USER_JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
            options={"require": ["sub", "type", "iss", "aud", "jti", "iat", "exp"]},
            leeway=2,
        )
        if payload.get("type") != _USER_TOKEN_TYPE:
            raise jwt.InvalidTokenError("wrong token type")
        int(payload["sub"])
        int(payload["iat"])
        return payload
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


def decode_token(token: str) -> int:
    """Decode a user access token and return its user id.

    Kept as a compatibility wrapper for existing callers; all validation is
    performed by :func:`decode_token_payload`.
    """
    return int(decode_token_payload(token)["sub"])


def create_user_step_up_token(
    user_id: int, *, identity_id: int, expires_in_sec: int = 300,
    issued_at: int | None = None,
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "identity_id": identity_id,
        "type": _USER_STEP_UP_TOKEN_TYPE,
        "iss": settings.JWT_ISSUER,
        "aud": settings.USER_JWT_AUDIENCE,
        "jti": uuid4().hex,
        "iat": max(int(now.timestamp()), issued_at or 0),
        "exp": int((now + timedelta(seconds=expires_in_sec)).timestamp()),
    }
    return jwt.encode(payload, _user_jwt_secret(), algorithm="HS256")


def decode_user_step_up_token(token: str, *, user_id: int) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            _user_jwt_secret(),
            algorithms=["HS256"],
            audience=settings.USER_JWT_AUDIENCE,
            issuer=settings.JWT_ISSUER,
            options={"require": ["sub", "identity_id", "type", "iss", "aud", "jti", "iat", "exp"]},
            leeway=2,
        )
        if (
            payload.get("type") != _USER_STEP_UP_TOKEN_TYPE
            or int(payload["sub"]) != user_id
        ):
            raise jwt.InvalidTokenError("wrong step-up token")
        return payload
    except (jwt.PyJWTError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="安全验证已失效，请重新验证",
        ) from exc


async def read_user_nbf(user_id: int) -> int | None:
    """Return the account-wide invalidation marker, failing closed if unavailable."""
    try:
        value = await cache.get_strict(f"user:jwt:nbf:{user_id}")
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc
    return int(value) if value else None


_UNSET_NBF = object()


async def issue_user_token(
    user_id: int,
    *,
    expected_nbf: int | None | object = _UNSET_NBF,
) -> tuple[str, int]:
    """Issue a token that is newer than any account-wide invalidation marker.

    Security-sensitive callers that already authorized a rotation can pin the
    marker they observed. A concurrent logout then causes issuance to fail
    instead of being silently converted into a post-logout credential.
    """
    try:
        user_nbf = await cache.get_strict(f"user:jwt:nbf:{user_id}")
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc
    minimum_iat = int(user_nbf) if user_nbf else None
    if (
        expected_nbf is not _UNSET_NBF
        and minimum_iat is not None
        and minimum_iat != expected_nbf
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="会话已失效，请重新登录",
        )
    return create_token(user_id, issued_at=minimum_iat)


async def set_user_nbf(user_id: int, timestamp: int | None = None) -> None:
    """Invalidate user access tokens issued before *timestamp*.

    Production requires Redis, so this invalidation is shared by all web
    workers. The local cache fallback remains useful for development.
    """
    candidate = timestamp or (int(unix_timestamp(utcnow())) + 1)
    try:
        await cache.advance_integer_marker_strict(
            f"user:jwt:nbf:{user_id}",
            candidate,
            ttl=max(settings.JWT_EXPIRE_DAYS, 1) * 24 * 60 * 60,
        )
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
):
    user, _ = await authenticate_user_token(credentials.credentials, db)
    return user


async def get_optional_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_security),
    db: AsyncSession = Depends(get_db),
):
    """Resolve the caller when credentials are present, otherwise return None.

    An invalid or expired credential is never downgraded to anonymity: public
    reads must not silently serve a different identity than the one supplied.
    """
    if credentials is None:
        if request.headers.get("Authorization") is not None:
            raise HTTPException(status_code=401, detail="Invalid authorization header")
        return None
    user, _ = await authenticate_user_token(credentials.credentials, db)
    return user


async def authenticate_user_token(
    token: str,
    db: AsyncSession,
):
    """Validate a bearer token and return ``(user, payload)``.

    This shared path is also used by WebSockets so account bans, deletion,
    logout invalidation and JWT type/audience checks cannot be bypassed.
    """
    from app.models.user import User

    payload = decode_token_payload(token)
    user_id = int(payload["sub"])
    token_iat = int(payload["iat"])

    try:
        user_nbf = await cache.get_strict(f"user:jwt:nbf:{user_id}")
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc
    if user_nbf and token_iat < int(user_nbf):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    lifecycle = getattr(user, "lifecycle_status", "active") or "active"
    if user.deleted_at is not None or lifecycle != "active":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号已注销",
        )
    if user.is_banned:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已封禁",
        )

    # Bind user identity to log context for trace correlation
    try:
        from app.core.log_context import bind_log_context

        bind_log_context(user_id=str(user.id))
    except Exception:
        pass

    return user, payload


def _is_local_dev_user(user) -> bool:
    if settings.APP_ENV.lower() not in {
        "development",
        "dev",
        "local",
        "test",
        "testing",
    }:
        return False
    try:
        if detect_deployment_profile() != DeploymentProfile.LOCAL_IMPORT:
            return False
    except Exception:
        # Invalid deployment configuration must never grant a permission bypass.
        return False
    return str(getattr(user, "openid", "")).startswith("dev_")


def require_app_permission(permission_name: str):
    async def dependency(
        current_user=Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if _is_local_dev_user(current_user):
            return current_user

        result = await db.execute(
            select(Permission.name)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .join(AdminUser, AdminUser.role_id == RolePermission.role_id)
            .join(
                AppUserAdminBinding, AppUserAdminBinding.admin_user_id == AdminUser.id
            )
            .where(AppUserAdminBinding.user_id == current_user.id)
            .where(AdminUser.is_active.is_(True))
            .where(Permission.name == permission_name)
        )
        if result.scalar_one_or_none() != permission_name:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied",
            )
        return current_user

    return dependency
