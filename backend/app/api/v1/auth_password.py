import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth_otp_support import _ip, _raise_otp
from app.core.browser_origin import enforce_trusted_browser_origin
from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.database import get_db
from app.core.email_address import normalize_email
from app.core.runtime_paths import API_V1_PREFIX
from app.core.security import get_current_user
from app.core.user_web_auth import delete_user_refresh_cookie
from app.models.user import User
from app.schemas.user import (
    OtpStartResponse,
    PasswordChangedResponse,
    PasswordChangeRequest,
    PasswordLoginRequest,
    PasswordRegisterStartRequest,
    PasswordRegisterVerifyRequest,
    PasswordResetRequest,
    TokenResponse,
    WebTokenResponse,
)
from app.services import (
    email_otp_service,
    slider_captcha_service,
    user_auth_service,
    user_password_service,
)

router = APIRouter(prefix=API_V1_PREFIX)


def _password_rate_key(subject: str) -> str:
    digest = hmac.new(
        settings.APP_SECRET.encode("utf-8"),
        f"password-login\0{subject.casefold()}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"user:password-login:fail:{digest}"


def _password_ip_rate_key(client_ip: str) -> str:
    digest = hmac.new(
        settings.APP_SECRET.encode("utf-8"),
        f"password-login-ip\0{client_ip}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"user:password-login:ip:{digest}"


def _register_start_rate_key(client_ip: str) -> str:
    digest = hmac.new(
        settings.APP_SECRET.encode("utf-8"),
        f"password-register-start\0{client_ip}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"user:password-register-start:ip:{digest}"


def _password_change_ip_rate_key(client_ip: str) -> str:
    digest = hmac.new(
        settings.APP_SECRET.encode("utf-8"),
        f"password-change-ip\0{client_ip}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"user:password-change:ip:{digest}"


async def _reserve_password_limits(limits: list[tuple[str, int, int]]) -> None:
    try:
        allowed = await cache.reserve_rate_limits_strict(limits)
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="登录服务暂时不可用，请稍后重试",
        ) from exc
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请稍后再试",
            headers={"Retry-After": str(settings.USER_LOGIN_WINDOW_SEC)},
        )


async def _reserve_password_attempt(account_key: str, ip_key: str) -> None:
    account_limit = min(settings.USER_LOGIN_MAX_FAILURES, 5)
    await _reserve_password_limits(
        [
            (account_key, account_limit, settings.USER_LOGIN_WINDOW_SEC),
            (
                ip_key,
                settings.USER_LOGIN_MAX_FAILURES,
                settings.USER_LOGIN_WINDOW_SEC,
            ),
        ]
    )


async def _reserve_password_identity(identity_key: str) -> bool:
    account_limit = min(settings.USER_LOGIN_MAX_FAILURES, 5)
    try:
        return await cache.reserve_rate_limits_strict(
            [(identity_key, account_limit, settings.USER_LOGIN_WINDOW_SEC)]
        )
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="登录服务暂时不可用，请稍后重试",
        ) from exc


async def _clear_password_account_failures(keys: set[str]) -> None:
    try:
        for key in keys:
            await cache.delete_strict(key)
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="登录服务暂时不可用，请稍后重试",
        ) from exc


@router.post(
    "/auth/password/login",
    response_model=TokenResponse | WebTokenResponse,
)
async def password_login(
    data: PasswordLoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        provider, account_subject = user_password_service.normalize_login_account(
            data.account
        )
        account_key = _password_rate_key(f"account:{provider}:{account_subject}")
        normalization_error = None
    except ValueError as exc:
        account_subject = data.account.strip().casefold()
        account_key = _password_rate_key(f"invalid:{account_subject}")
        normalization_error = exc

    rate_keys = {account_key}
    await _reserve_password_attempt(
        account_key,
        _password_ip_rate_key(_ip(request)),
    )
    if normalization_error is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(normalization_error) or "账号或密码错误",
        ) from normalization_error

    try:
        record = await user_password_service.find_password_credential(
            db,
            provider=provider,
            subject=account_subject,
        )
        if record is not None:
            identity_key = _password_rate_key(f"identity:{record[0].id}")
            if identity_key != account_key:
                if not await _reserve_password_identity(identity_key):
                    await user_password_service.simulate_password_verify(
                        data.password
                    )
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="账号或密码错误",
                    )
                rate_keys.add(identity_key)
        user = await user_password_service.authenticate_password_record(
            db,
            record=record,
            password=data.password,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc) or "账号或密码错误",
        ) from exc
    rate_keys.update(
        _password_rate_key(f"account:{provider}:{subject}")
        for provider, subject in await user_password_service.list_password_login_aliases(
            db,
            user_id=user.id,
        )
    )
    await _clear_password_account_failures(rate_keys)
    return await user_auth_service.issue_session(
        db,
        user,
        client=data.client,
        response=response,
        request=request,
    )


@router.post(
    "/auth/password/register/start",
    response_model=OtpStartResponse,
)
async def start_password_registration(
    data: PasswordRegisterStartRequest,
    request: Request,
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        display_username, username = user_password_service.normalize_username(
            data.username
        )
        email = normalize_email(data.email)
        user_password_service.validate_user_password(data.password)
        consent = user_auth_service.validate_registration_consent(
            accepted_terms=data.accepted_terms,
            agreement_version=data.agreement_version,
            privacy_version=data.privacy_version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    client_ip = _ip(request)
    try:
        allowed = await cache.reserve_rate_limits_strict(
            [
                (
                    _register_start_rate_key(client_ip),
                    settings.PASSWORD_REGISTER_START_IP_HOURLY_LIMIT,
                    3600,
                )
            ]
        )
    except CacheUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="注册服务暂时不可用，请稍后重试",
        ) from exc
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="注册尝试过于频繁，请稍后再试",
        )

    try:
        await slider_captcha_service.consume_ticket(
            ticket=data.captcha_ticket,
            domain="user",
            purpose="register",
            email=email,
            client_ip=client_ip,
        )
    except slider_captcha_service.SliderCaptchaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Conflict detection is deferred to /register/verify so the start endpoint
    # cannot be used to enumerate existing usernames or emails.
    password_hash = await user_password_service.hash_user_password_async(data.password)
    try:
        issued = await email_otp_service.issue_otp(
            domain="user",
            email=email,
            purpose="register",
            client_ip=_ip(request),
            metadata={
                "operation": "password_register",
                "username": username,
                "username_display": display_username,
                "password_hash": password_hash,
                "consent": consent,
                "client": "web",
            },
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)
    return OtpStartResponse(
        challenge_id=issued.challenge_id,
        expires_in=issued.expires_in,
        resend_after=issued.resend_after,
    )


@router.post(
    "/auth/password/register/verify",
    response_model=TokenResponse | WebTokenResponse,
)
async def verify_password_registration(
    data: PasswordRegisterVerifyRequest,
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
            purpose="register",
            client_ip=_ip(request),
            client=data.client,
        )
    except email_otp_service.OtpError as exc:
        _raise_otp(exc)

    metadata = challenge.get("metadata", {})
    if (
        not isinstance(metadata, dict)
        or metadata.get("operation") != "password_register"
        or metadata.get("client") != data.client
    ):
        raise HTTPException(status_code=422, detail="注册验证信息无效")
    username = str(metadata.get("username") or "")
    display_username = str(metadata.get("username_display") or "")
    password_hash = str(metadata.get("password_hash") or "")
    consent = metadata.get("consent")
    if (
        not username
        or not display_username
        or not password_hash
        or not isinstance(consent, dict)
    ):
        raise HTTPException(status_code=422, detail="注册信息已失效，请重新提交")

    try:
        await user_password_service.assert_registration_available(
            db,
            username=username,
            email=str(challenge["email"]),
        )
    except user_password_service.PasswordRegistrationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    try:
        user, _identity = await user_password_service.create_password_account(
            db,
            username=username,
            display_name=display_username,
            email=str(challenge["email"]),
            password_hash=password_hash,
            consent_versions={str(key): str(value) for key, value in consent.items()},
            registration_source="web" if data.client == "web" else None,
        )
    except user_password_service.PasswordRegistrationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return await user_auth_service.issue_session(
        db,
        user,
        client=data.client,
        response=response,
        request=request,
    )


@router.post(
    "/auth/password/change", response_model=PasswordChangedResponse
)
async def change_password(
    data: PasswordChangeRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    await _reserve_password_limits(
        [
            (
                _password_rate_key(f"change:{current_user.id}"),
                min(settings.USER_LOGIN_MAX_FAILURES, 5),
                settings.USER_LOGIN_WINDOW_SEC,
            ),
            (
                _password_change_ip_rate_key(_ip(request)),
                settings.USER_LOGIN_MAX_FAILURES,
                settings.USER_LOGIN_WINDOW_SEC,
            ),
        ]
    )
    try:
        await user_password_service.change_user_password(
            db,
            user_id=current_user.id,
            current_password=data.current_password,
            new_password=data.new_password,
        )
    except user_password_service.PasswordAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await user_auth_service.invalidate_user_sessions(db, current_user.id)
    delete_user_refresh_cookie(response, request)
    return PasswordChangedResponse()


@router.post(
    "/auth/password/reset", response_model=PasswordChangedResponse
)
async def reset_password(
    data: PasswordResetRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rotate a forgotten password after an existing-mode step-up.

    The account must stay logged in via any working method (email OTP, GitHub,
    WeChat, or a known password); the step-up token proves control of an
    existing identity, so a stolen access token alone cannot reset it.
    """
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    await user_auth_service.consume_step_up_token(
        data.step_up_token, current_user.id
    )
    try:
        await user_password_service.reset_user_password(
            db,
            user_id=current_user.id,
            new_password=data.new_password,
        )
    except user_password_service.PasswordAuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await user_auth_service.invalidate_user_sessions(db, current_user.id)
    delete_user_refresh_cookie(response, request)
    return PasswordChangedResponse()
