from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth_otp_support import _ip, _raise_otp
from app.core.database import get_db
from app.core.email_address import normalize_email
from app.core.security import get_current_user
from app.core.user_web_auth import delete_user_refresh_cookie
from app.models.user import User
from app.schemas.user import (
    ChangeEmailStartRequest,
    IdentityEmailVerifyRequest,
    IdentityUnlinkRequest,
    OtpStartResponse,
    WechatLogin,
)
from app.services import (
    email_otp_service,
    identity_service,
    user_auth_service,
    user_service,
)

router = APIRouter()


@router.post(
    "/users/me/identities/email/step-up/start", response_model=OtpStartResponse
)
async def start_email_step_up(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    identities = await identity_service.list_user_identities(db, current_user.id)
    email_identity = next(
        (
            item
            for item in identities
            if item.provider == "email" and item.namespace == "user"
        ),
        None,
    )
    if email_identity is None:
        raise HTTPException(status_code=409, detail="当前账号未绑定邮箱")
    try:
        issued = await email_otp_service.issue_otp(
            domain="user",
            email=email_identity.subject,
            purpose="step_up",
            client_ip=_ip(request),
            user_id=current_user.id,
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    return OtpStartResponse(
        challenge_id=issued.challenge_id,
        expires_in=issued.expires_in,
        resend_after=issued.resend_after,
    )


@router.post("/users/me/identities/email/step-up/verify")
async def verify_email_step_up(
    data: IdentityEmailVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        challenge = await email_otp_service.consume_otp(
            challenge_id=data.challenge_id,
            code=data.code,
            domain="user",
            purpose="step_up",
            client_ip=_ip(request),
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    if int(challenge.get("user_id") or 0) != current_user.id:
        raise HTTPException(status_code=401, detail="验证码不属于当前账号")
    identity = await identity_service.find_identity(
        db, provider="email", namespace="user", subject=str(challenge["email"])
    )
    if identity is None or identity.user_id != current_user.id:
        raise HTTPException(status_code=401, detail="邮箱状态已变化，请重新验证")
    return {
        "step_up_token": await user_auth_service.issue_step_up_token(
            current_user.id, identity.id
        )
    }


@router.post("/users/me/identities/email/change/start", response_model=OtpStartResponse)
async def start_email_change(
    data: ChangeEmailStartRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
        raise HTTPException(status_code=409, detail="该邮箱已绑定到其他账号")
    identities = await identity_service.list_user_identities(db, current_user.id)
    current_email = next(
        (item for item in identities if item.provider == "email"), None
    )
    if current_email is None:
        raise HTTPException(status_code=409, detail="当前账号未绑定邮箱")
    try:
        await user_auth_service.authorize_email_change(
            user_id=current_user.id,
            email=email,
            old_email=current_email.subject,
            step_up_token=data.step_up_token,
            challenge_id=data.challenge_id,
        )
        issued = await email_otp_service.issue_otp(
            domain="user",
            email=email,
            purpose="bind",
            client_ip=_ip(request),
            user_id=current_user.id,
            metadata={"operation": "change_email", "old_email": current_email.subject},
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    return OtpStartResponse(
        challenge_id=issued.challenge_id,
        expires_in=issued.expires_in,
        resend_after=issued.resend_after,
    )


@router.post("/users/me/identities/email/change/verify")
async def verify_email_change(
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
            client_ip=_ip(request),
        )
        if challenge.get("metadata", {}).get("operation") != "change_email":
            raise email_otp_service.OtpError("验证码用途不匹配")
        if int(challenge.get("user_id") or 0) != current_user.id:
            raise email_otp_service.OtpError("验证码不属于当前账号")
        await identity_service.replace_email_identity(
            db,
            user_id=current_user.id,
            old_email=challenge.get("metadata", {}).get("old_email"),
            new_email=str(challenge["email"]),
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    except identity_service.IdentityConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except identity_service.IdentityUnavailableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await user_auth_service.invalidate_user_sessions(db, current_user.id)
    delete_user_refresh_cookie(response)
    return {"status": "ok", "reauthentication_required": True}


@router.post("/users/me/identities/wechat/step-up/verify")
async def verify_wechat_step_up(
    data: WechatLogin,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        subject = await user_service.resolve_wechat_subject(data.code)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    identity, owner = await identity_service.find_identity_user(
        db,
        provider="wechat",
        namespace=identity_service.wechat_namespace(),
        subject=subject,
    )
    if owner is None or owner.id != current_user.id:
        raise HTTPException(status_code=401, detail="微信验证未通过")
    return {
        "step_up_token": await user_auth_service.issue_step_up_token(
            current_user.id, identity.id
        )
    }


@router.delete("/users/me/identities/{identity_id}")
async def unlink_identity(
    identity_id: int,
    data: IdentityUnlinkRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    retained_identity_id = await user_auth_service.consume_step_up_token(
        data.step_up_token, current_user.id
    )
    try:
        await identity_service.unbind_identity(
            db,
            user_id=current_user.id,
            identity_id=identity_id,
            retained_identity_id=retained_identity_id,
        )
    except identity_service.IdentityConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except identity_service.IdentityUnavailableError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await user_auth_service.invalidate_user_sessions(db, current_user.id)
    delete_user_refresh_cookie(response)
    return {"status": "ok", "reauthentication_required": True}
