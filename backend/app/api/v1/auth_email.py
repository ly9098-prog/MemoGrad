from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth_otp_support import _ip, _raise_otp, _raise_slider_captcha
from app.core.browser_origin import enforce_trusted_browser_origin
from app.core.config import settings
from app.core.database import get_db
from app.core.email_address import normalize_email
from app.core.runtime_paths import API_V1_PREFIX
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.schemas.captcha import (
    SliderCaptchaStartResponse,
    SliderCaptchaVerifyRequest,
    SliderCaptchaVerifyResponse,
)
from app.schemas.user import (
    EmailOtpStartRequest,
    EmailOtpVerifyRequest,
    OtpStartResponse,
    TokenResponse,
    WebTokenResponse,
)
from app.services import (
    email_otp_service,
    identity_service,
    slider_captcha_service,
    user_auth_service,
)

router = APIRouter(prefix=API_V1_PREFIX)


from app.api.v1 import auth_identity_bind, auth_identity_security


async def _email_identity_user(
    db: AsyncSession, email: str
) -> tuple[UserAuthIdentity | None, User | None]:
    try:
        return await identity_service.find_identity_user(
            db, provider="email", namespace="user", subject=email
        )
    except identity_service.IdentityUnavailableError:
        return None, None


@router.post(
    "/auth/captcha/slider/start", response_model=SliderCaptchaStartResponse
)
async def start_login_slider_captcha(request: Request):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        challenge = await slider_captcha_service.issue_challenge(
            domain="user",
            client_ip=_ip(request),
        )
    except slider_captcha_service.SliderCaptchaError as exc:
        _raise_slider_captcha(exc)
    return SliderCaptchaStartResponse(
        captcha_id=challenge.captcha_id,
        background_image=challenge.background_image,
        puzzle_image=challenge.puzzle_image,
        width=challenge.width,
        height=challenge.height,
        piece_size=challenge.piece_size,
        piece_y=challenge.piece_y,
        expires_in=challenge.expires_in,
    )


@router.post(
    "/auth/captcha/slider/verify", response_model=SliderCaptchaVerifyResponse
)
async def verify_login_slider_captcha(
    data: SliderCaptchaVerifyRequest,
    request: Request,
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        ticket = await slider_captcha_service.verify_challenge(
            captcha_id=data.captcha_id,
            offset=data.offset,
            trajectory=[
                {"x": point.x, "y": point.y, "t": point.t}
                for point in data.trajectory
            ],
            domain="user",
            client_ip=_ip(request),
        )
    except slider_captcha_service.SliderCaptchaError as exc:
        _raise_slider_captcha(exc)
    return SliderCaptchaVerifyResponse(
        ticket=ticket.ticket,
        expires_in=ticket.expires_in,
    )


@router.post("/auth/email/start", response_model=OtpStartResponse)
async def start_email_login(
    data: EmailOtpStartRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        email = normalize_email(data.email)
        consent = user_auth_service.validate_registration_consent(
            accepted_terms=data.accepted_terms,
            agreement_version=data.agreement_version,
            privacy_version=data.privacy_version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _identity, existing_user = await _email_identity_user(db, email)
    try:
        await slider_captcha_service.consume_ticket(
            ticket=data.captcha_ticket,
            domain="user",
            client_ip=_ip(request),
        )
        issued = await email_otp_service.issue_otp(
            domain="user",
            email=email,
            purpose="login",
            client_ip=_ip(request),
            user_id=existing_user.id if existing_user else None,
            metadata={"consent": consent},
        )
    except slider_captcha_service.SliderCaptchaError as exc:
        _raise_slider_captcha(exc)
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    return OtpStartResponse(
        challenge_id=issued.challenge_id,
        expires_in=issued.expires_in,
        resend_after=issued.resend_after,
    )


@router.post("/auth/email/verify", response_model=TokenResponse | WebTokenResponse)
async def verify_email_login(
    data: EmailOtpVerifyRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        challenge = await email_otp_service.consume_otp(
            challenge_id=data.challenge_id,
            code=data.code,
            domain="user",
            purpose="login",
            client_ip=_ip(request),
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    email = str(challenge["email"])
    user_id = challenge.get("user_id")
    if user_id:
        try:
            identity, user = await identity_service.find_identity_user(
                db, provider="email", namespace="user", subject=email
            )
        except identity_service.IdentityUnavailableError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        if identity is None or user is None or user.id != int(user_id):
            raise HTTPException(status_code=401, detail="账号不存在")
        try:
            await identity_service.validate_identity_user(user)
        except identity_service.IdentityUnavailableError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
    else:
        try:
            user, _identity = await identity_service.authenticate_identity(
                db,
                provider="email",
                namespace="user",
                subject=email,
                allow_register=True,
            )
        except identity_service.IdentityUnavailableError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except identity_service.IdentityConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    consent = challenge.get("metadata", {}).get("consent", {})
    if isinstance(consent, dict) and consent:
        await user_auth_service.record_consents(db, user.id, consent)
    return await user_auth_service.issue_session(
        db, user, client=data.client, response=response, request=request
    )


router.include_router(auth_identity_bind.router)
router.include_router(auth_identity_security.router)
