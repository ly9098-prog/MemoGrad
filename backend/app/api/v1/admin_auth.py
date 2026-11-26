import hashlib
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_security import (
    REFRESH_COOKIE_KEY,
    AdminPrincipal,
    PasswordPolicyError,
    blacklist_admin_token,
    consume_admin_refresh_token,
    decode_admin_refresh_token,
    delete_refresh_cookie,
    get_current_admin,
    get_current_admin_any_scope,
    get_current_admin_optional,
    set_refresh_cookie,
)
from app.core.browser_origin import enforce_trusted_browser_origin
from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.database import get_db
from app.core.runtime_paths import API_ADMIN_V1_PREFIX
from app.core.time_utils import utcnow
from app.models.admin import AdminUser
from app.schemas.admin_auth import (
    AdminChangePasswordRequest,
    AdminLoginRequest,
    AdminMeResponse,
    AdminProfileUpdateRequest,
    AdminTokenResponse,
)
from app.services.admin_audit_service import write_admin_audit
from app.services.admin_auth_service import (
    authenticate_admin,
    build_admin_login_response,
    change_admin_password,
    get_admin_me_response,
    update_admin_profile,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix=f"{API_ADMIN_V1_PREFIX}/auth", tags=["admin-auth"])


def _enforce_trusted_browser_origin(request: Request) -> None:
    """Block cross-site browser requests to cookie-bearing auth endpoints."""
    enforce_trusted_browser_origin(request, settings.ADMIN_WEB_BASE_URL)


def _username_digest(username: str) -> str:
    """Stable digest for account-scoped cache keys.

    Usernames are case-sensitive for authentication, so the digest must be
    too.  HMAC keeps key names fixed-length and prevents arbitrary usernames
    from becoming arbitrary Redis keys.
    """
    return hmac.new(
        settings.APP_SECRET.encode("utf-8"),
        f"admin-login-account\0{username.strip()}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _login_rate_key(request: Request, username: str) -> str:
    client_ip = request.client.host if request.client else "unknown"
    identity = f"{client_ip}|{username.strip()}"
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return f"admin:login:fail:{digest}"


def _account_fail_key(username: str) -> str:
    """Account-level failure counter used for attack monitoring.

    This counter deliberately does not lock the account: a hard global lock
    lets any unauthenticated caller deny service to a known administrator
    (OWASP Authentication Cheat Sheet discourages lockout for this reason).
    Throttling is enforced per (client IP, username) below, with nginx/IP-level
    limits in front.
    """
    return f"admin:login:account_fail:{_username_digest(username)}"


async def _report_login_failure_burst(
    db: AsyncSession, request: Request, username: str
) -> None:
    """Emit one alert per window when an account sees cross-IP failures."""
    digest = _username_digest(username)
    try:
        first = await cache.acquire_lock_strict(
            f"admin:login:alert:{digest}",
            "1",
            ttl=settings.ADMIN_LOGIN_WINDOW_SEC,
        )
    except CacheUnavailableError:
        logger.warning("Admin login failure burst could not be recorded")
        return
    if not first:
        return
    logger.warning(
        "Admin login failure threshold reached across sources",
        extra={"admin_username": username.strip()},
    )
    if not hasattr(db, "execute"):
        return
    try:
        admin_id = await db.scalar(
            select(AdminUser.id).where(
                AdminUser.username == username.strip(),
                AdminUser.is_active.is_(True),
            )
        )
        if admin_id is None:
            return
        await write_admin_audit(
            db,
            None,
            "system.login_failure_burst",
            "admin_user",
            admin_id,
            severity="high",
            detail={"username": username.strip()},
            request=request,
            status="failure",
        )
        await db.commit()
    except Exception:
        logger.exception("Failed to persist admin login failure burst audit")
        try:
            await db.rollback()
        except Exception:
            pass


async def _read_fail_count(rate_key: str) -> int:
    try:
        return int(await cache.get_strict(rate_key) or 0)
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc


async def _increment_fail_count(rate_key: str) -> int:
    try:
        return await cache.increment_strict(
            rate_key, ttl=settings.ADMIN_LOGIN_WINDOW_SEC
        )
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc


async def _clear_fail_count(rate_key: str) -> None:
    try:
        await cache.delete_strict(rate_key)
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        ) from exc


@router.post("/login", response_model=AdminTokenResponse)
async def login(
    data: AdminLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    _enforce_trusted_browser_origin(request)
    rate_key = _login_rate_key(request, data.username)
    account_fail_key = _account_fail_key(data.username)

    # Per-IP + per-username throttle. Account-wide lockout is intentionally
    # absent: it would let any caller deny service to a known administrator.
    if await _read_fail_count(rate_key) >= settings.ADMIN_LOGIN_MAX_FAILURES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请稍后重试",
            headers={"Retry-After": str(settings.ADMIN_LOGIN_WINDOW_SEC)},
        )

    try:
        admin_user = await authenticate_admin(db, data)
    except ValueError:
        await _increment_fail_count(rate_key)
        account_fails = await _increment_fail_count(account_fail_key)
        if account_fails >= settings.ADMIN_LOGIN_MAX_FAILURES:
            await _report_login_failure_burst(db, request, data.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误"
        )

    await _clear_fail_count(rate_key)
    await _clear_fail_count(account_fail_key)

    token, refresh_token, user, role, permissions = await build_admin_login_response(
        db, admin_user
    )
    admin_user.last_login_at = utcnow()
    admin_user.last_login_ip = request.client.host if request.client else None
    await write_admin_audit(
        db,
        AdminPrincipal(admin_user, {}),
        "system.login",
        "admin_user",
        admin_user.id,
        severity="low",
        request=request,
    )
    await db.commit()
    set_refresh_cookie(response, refresh_token, request=request)
    return AdminTokenResponse(
        access_token=token, user=user, role=role, permissions=permissions
    )


@router.post("/refresh", response_model=AdminTokenResponse)
async def refresh(
    request: Request, response: Response, db: AsyncSession = Depends(get_db)
):
    _enforce_trusted_browser_origin(request)
    refresh_token = request.cookies.get(REFRESH_COOKIE_KEY)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
    payload = decode_admin_refresh_token(refresh_token)
    admin_user = await consume_admin_refresh_token(payload, db)
    (
        token,
        new_refresh_token,
        user,
        role,
        permissions,
    ) = await build_admin_login_response(db, admin_user)
    set_refresh_cookie(response, new_refresh_token, request=request)
    return AdminTokenResponse(
        access_token=token, user=user, role=role, permissions=permissions
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    current_admin: AdminPrincipal | None = Depends(get_current_admin_optional),
):
    """Revoke the session even when the access token is missing or expired.

    Logout must be idempotent: the refresh cookie is the long-lived credential
    (7 days), so failing to delete/blacklist it when the 2-hour access token is
    stale would silently restore the session on the next page load.
    """
    _enforce_trusted_browser_origin(request)

    if current_admin is not None:
        payload = current_admin.token_payload
        await blacklist_admin_token(payload["jti"], int(payload["exp"]))

    refresh_token = request.cookies.get(REFRESH_COOKIE_KEY)
    if refresh_token:
        try:
            refresh_payload = decode_admin_refresh_token(refresh_token)
            await blacklist_admin_token(
                refresh_payload["jti"], int(refresh_payload["exp"])
            )
        except HTTPException:
            pass

    delete_refresh_cookie(response, request=request)
    return {"status": "ok"}


@router.get("/me", response_model=AdminMeResponse)
async def me(
    current_admin=Depends(get_current_admin_any_scope),
    db: AsyncSession = Depends(get_db),
):
    return await get_admin_me_response(db, current_admin.user)


@router.patch("/me", response_model=AdminMeResponse)
async def update_profile(
    data: AdminProfileUpdateRequest,
    request: Request,
    current_admin=Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    _enforce_trusted_browser_origin(request)
    return await update_admin_profile(db, current_admin, data, request)


@router.post("/change-password")
async def update_password(
    data: AdminChangePasswordRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin_any_scope),
):
    _enforce_trusted_browser_origin(request)
    try:
        await change_admin_password(
            db,
            current_admin.user,
            data,
            operator=current_admin,
            request=request,
        )
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        )
    delete_refresh_cookie(response, request=request)
    return {"status": "ok"}
