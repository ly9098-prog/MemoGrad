from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.admin_auth import _enforce_trusted_browser_origin
from app.core.admin_security import (
    get_current_admin,
    set_refresh_cookie,
    verify_admin_password,
)
from app.core.database import get_db
from app.core.email_address import normalize_email
from app.core.runtime_paths import API_ADMIN_V1_PREFIX
from app.core.time_utils import utcnow
from app.models.admin import AdminUser
from app.schemas.admin_auth import (
    AdminEmailActivationRequest,
    AdminEmailStartRequest,
    AdminEmailVerifyRequest,
    AdminPasswordRecoveryRequest,
    AdminRecoveryVerifyResponse,
    AdminTokenResponse,
)
from app.schemas.user import IdentityEmailVerifyRequest, OtpStartResponse
from app.services import admin_email_auth_service, email_otp_service
from app.services.admin_audit_service import write_admin_audit
from app.services.admin_auth_service import build_admin_login_response

router = APIRouter(prefix=f"{API_ADMIN_V1_PREFIX}/auth", tags=["admin-auth"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _raise_otp(exc: email_otp_service.OtpError) -> None:
    if isinstance(exc, email_otp_service.OtpRateLimitError):
        raise HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, email_otp_service.OtpUnavailableError):
        raise HTTPException(status_code=503, detail=str(exc))
    raise HTTPException(status_code=400, detail=str(exc))


async def _issue_admin_start(
    *, email: str, purpose: str, request: Request, user_id: int | None, metadata=None
) -> OtpStartResponse:
    try:
        issued = await email_otp_service.issue_otp(
            domain="admin",
            email=email,
            purpose=purpose,
            client_ip=_ip(request),
            user_id=user_id,
            metadata=metadata,
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    return OtpStartResponse(
        challenge_id=issued.challenge_id,
        expires_in=issued.expires_in,
        resend_after=issued.resend_after,
    )


@router.post("/email/login/start", response_model=OtpStartResponse)
async def start_admin_email_login(
    data: AdminEmailStartRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _enforce_trusted_browser_origin(request)
    try:
        email = normalize_email(data.email)
        admin = await admin_email_auth_service.find_active_admin_by_email(db, email)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await _issue_admin_start(
        email=email,
        purpose="login",
        request=request,
        user_id=admin.id if admin else None,
    )


@router.post("/email/login/verify", response_model=AdminTokenResponse)
async def verify_admin_email_login(
    data: AdminEmailVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    _enforce_trusted_browser_origin(request)
    try:
        challenge = await email_otp_service.consume_otp(
            challenge_id=data.challenge_id,
            code=data.code,
            domain="admin",
            purpose="login",
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    admin = await db.get(AdminUser, int(challenge.get("user_id") or 0))
    if (
        admin is None
        or not admin.is_active
        or admin.email_normalized != normalize_email(str(challenge["email"]))
        or admin.email_verified_at is None
    ):
        raise HTTPException(status_code=401, detail="登录信息无效")
    token, refresh_token, user, role, permissions = await build_admin_login_response(
        db, admin
    )
    admin.last_login_at = utcnow()
    admin.last_login_ip = _ip(request)
    await write_admin_audit(
        db,
        None,
        "system.email_login",
        "admin_user",
        admin.id,
        severity="low",
        request=request,
    )
    await db.commit()
    set_refresh_cookie(response, refresh_token, request=request)
    return AdminTokenResponse(
        access_token=token, user=user, role=role, permissions=permissions
    )


@router.post("/email/activate/start", response_model=OtpStartResponse)
async def start_admin_email_activation(
    data: AdminEmailActivationRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin),
):
    _enforce_trusted_browser_origin(request)
    try:
        if not verify_admin_password(
            data.current_password, current_admin.user.password_hash
        ):
            raise ValueError("当前密码错误")
        normalized = await admin_email_auth_service.validate_admin_email_available(
            db, admin_user=current_admin.user, email=data.email
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return await _issue_admin_start(
        email=normalized,
        purpose="activate",
        request=request,
        user_id=current_admin.id,
        metadata={"operation": "activate_email"},
    )


@router.post("/email/activate/verify", response_model=AdminTokenResponse)
async def verify_admin_email_activation(
    data: IdentityEmailVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin),
):
    _enforce_trusted_browser_origin(request)
    try:
        challenge = await email_otp_service.consume_otp(
            challenge_id=data.challenge_id,
            code=data.code,
            domain="admin",
            purpose="activate",
        )
        if int(challenge.get("user_id") or 0) != current_admin.id:
            raise email_otp_service.OtpError("验证码不属于当前管理员")
        admin = await admin_email_auth_service.activate_admin_email(
            db, admin_user=current_admin.user, email=str(challenge["email"])
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    token, refresh_token, user, role, permissions = await build_admin_login_response(
        db, admin
    )
    await write_admin_audit(
        db,
        current_admin,
        "admin_user.verify_email",
        "admin_user",
        admin.id,
        severity="critical",
        request=request,
    )
    await db.commit()
    set_refresh_cookie(response, refresh_token, request=request)
    return AdminTokenResponse(
        access_token=token, user=user, role=role, permissions=permissions
    )


@router.post("/email/recover/start", response_model=OtpStartResponse)
async def start_admin_email_recovery(
    data: AdminEmailStartRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _enforce_trusted_browser_origin(request)
    try:
        email = normalize_email(data.email)
        admin = await admin_email_auth_service.find_active_admin_by_email(db, email)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await _issue_admin_start(
        email=email,
        purpose="recover",
        request=request,
        user_id=admin.id if admin else None,
        metadata={"operation": "recover_password"},
    )


@router.post("/email/recover/verify", response_model=AdminRecoveryVerifyResponse)
async def verify_admin_email_recovery(
    data: AdminEmailVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _enforce_trusted_browser_origin(request)
    try:
        challenge = await email_otp_service.consume_otp(
            challenge_id=data.challenge_id,
            code=data.code,
            domain="admin",
            purpose="recover",
        )
        if challenge.get("metadata", {}).get("operation") != "recover_password":
            raise email_otp_service.OtpError("验证码用途不匹配")
        user_id = int(challenge.get("user_id") or 0)
        admin = await db.get(AdminUser, user_id)
        if (
            admin is None
            or not admin.is_active
            or admin.email_verified_at is None
            or admin.email_normalized
            != normalize_email(str(challenge.get("email") or ""))
        ):
            raise email_otp_service.OtpError("密码恢复信息无效")
        reset_token = await admin_email_auth_service.issue_admin_recovery_token(admin)
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    return AdminRecoveryVerifyResponse(reset_token=reset_token)


@router.post("/recover-password")
async def recover_admin_password(
    data: AdminPasswordRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _enforce_trusted_browser_origin(request)
    try:
        admin = await admin_email_auth_service.reset_admin_password_with_token(
            db,
            reset_token=data.reset_token,
            new_password=data.new_password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await write_admin_audit(
        db,
        None,
        "admin_user.recover_password",
        "admin_user",
        admin.id,
        severity="critical",
        detail={"username": admin.username},
        request=request,
    )
    await db.commit()
    return {"status": "ok", "reauthentication_required": True}
