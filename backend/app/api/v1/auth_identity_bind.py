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
)
from app.services import email_otp_service, identity_service, user_auth_service

router = APIRouter()


async def _authorize_email_bind(
    *,
    user_id: int,
    email: str,
    step_up_token: str | None,
    challenge_id: str | None,
) -> None:
    """Require proof of an existing login method before adding a new one.

    A stolen access token must not be enough to attach an attacker-controlled
    email (or GitHub account) and convert a temporary session into a permanent
    login.  The first request needs a step-up token; resends may reference the
    still-active challenge created by that authorised request.
    """
    if step_up_token:
        await user_auth_service.consume_step_up_token(step_up_token, user_id)
        return
    if not challenge_id:
        raise email_otp_service.OtpError("请先完成安全验证")
    previous = await email_otp_service.get_active_challenge(challenge_id)
    if (
        int(previous.get("user_id") or 0) != user_id
        or previous.get("domain") != "user"
        or previous.get("purpose") != "bind"
        or previous.get("email") != email
        or previous.get("metadata", {}).get("operation") != "bind"
    ):
        raise email_otp_service.OtpError("请重新完成安全验证")


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
        await _authorize_email_bind(
            user_id=current_user.id,
            email=email,
            step_up_token=data.step_up_token,
            challenge_id=data.challenge_id,
        )
        identities = await identity_service.list_user_identities(db, current_user.id)
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    if any(
        item.provider == "email" and item.namespace == "user"
        for item in identities
    ):
        raise HTTPException(
            status_code=409, detail="当前账号已绑定邮箱，请使用更换流程"
        )
    try:
        existing, _owner = await identity_service.find_identity_user(
            db, provider="email", namespace="user", subject=email
        )
    except identity_service.IdentityUnavailableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # Only the caller's own binding is reported (helpful, not an oracle).  An
    # address bound to another account proceeds through the OTP flow and is
    # rejected at verify with a generic conflict, so start cannot be used to
    # enumerate registered emails.
    if existing is not None and existing.user_id == current_user.id:
        raise HTTPException(status_code=409, detail="该邮箱已绑定到当前账号")
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
            client_ip=_ip(request),
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
