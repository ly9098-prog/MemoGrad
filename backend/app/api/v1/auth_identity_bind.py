from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth_otp_support import _ip, _raise_otp
from app.core.database import get_db
from app.core.email_address import normalize_email
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.user import (
    IdentityEmailStartRequest,
    IdentityEmailVerifyRequest,
    OtpStartResponse,
    TokenResponse,
    WebTokenResponse,
    WechatLogin,
)
from app.services import (
    email_otp_service,
    identity_service,
    user_auth_service,
    user_service,
)

router = APIRouter()


@router.post("/users/me/identities/email/bind/start", response_model=OtpStartResponse)
async def start_email_bind(
    data: IdentityEmailStartRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not data.email:
        raise HTTPException(status_code=422, detail="请输入要绑定的邮箱")
    try:
        email = normalize_email(data.email)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        existing, _owner = await identity_service.find_identity_user(
            db, provider="email", namespace="user", subject=email
        )
    except identity_service.IdentityUnavailableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if existing is not None:
        detail = (
            "该邮箱已绑定到当前账号"
            if existing.user_id == current_user.id
            else "该邮箱已绑定到其他账号"
        )
        raise HTTPException(status_code=409, detail=detail)
    try:
        issued = await email_otp_service.issue_otp(
            domain="user",
            email=email,
            purpose="bind",
            client_ip=_ip(request),
            user_id=current_user.id,
            metadata={"operation": "bind"},
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    return OtpStartResponse(
        challenge_id=issued.challenge_id,
        expires_in=issued.expires_in,
        resend_after=issued.resend_after,
    )


@router.post(
    "/users/me/identities/email/bind/verify",
    response_model=TokenResponse | WebTokenResponse,
)
async def verify_email_bind(
    data: IdentityEmailVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        challenge = await email_otp_service.consume_otp(
            challenge_id=data.challenge_id,
            code=data.code,
            domain="user",
            purpose="bind",
        )
        if int(challenge.get("user_id") or 0) != current_user.id:
            raise email_otp_service.OtpError("验证码不属于当前账号")
        if challenge.get("metadata", {}).get("operation") != "bind":
            raise email_otp_service.OtpError("验证码用途不匹配")
        await identity_service.bind_identity(
            db,
            user=current_user,
            provider="email",
            namespace="user",
            subject=str(challenge["email"]),
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    except identity_service.IdentityConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except identity_service.IdentityUnavailableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await user_auth_service.invalidate_user_sessions(db, current_user.id)
    await db.refresh(current_user)
    return await user_auth_service.issue_session(
        db, current_user, client=data.client, response=response, request=request
    )


@router.post("/users/me/identities/wechat/bind")
async def bind_wechat_identity(
    data: WechatLogin,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        subject = await user_service.resolve_wechat_subject(data.code)
        identity, owner = await identity_service.find_identity_user(
            db,
            provider="wechat",
            namespace=identity_service.wechat_namespace(),
            subject=subject,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    if owner is not None and owner.id != current_user.id:
        raise HTTPException(
            status_code=409, detail="该微信已绑定到其他账号，请使用原账号登录"
        )
    if identity is None:
        try:
            identity = await identity_service.bind_identity(
                db,
                user=current_user,
                provider="wechat",
                namespace=identity_service.wechat_namespace(),
                subject=subject,
            )
        except identity_service.IdentityConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    await user_auth_service.invalidate_user_sessions(db, current_user.id)
    await db.refresh(current_user)
    return await user_auth_service.issue_session(
        db, current_user, client=data.client, response=response, request=request
    )
