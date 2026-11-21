from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth_otp_support import _ip, _raise_otp
from app.core.browser_origin import enforce_trusted_browser_origin
from app.core.config import settings
from app.core.database import get_db
from app.core.email_address import normalize_email
from app.core.security import get_current_user, read_user_nbf, set_user_nbf
from app.core.time_utils import utcnow
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.schemas.user import (
    IdentityEmailStartRequest,
    IdentityEmailVerifyRequest,
    OtpStartResponse,
    TokenResponse,
    WebTokenResponse,
    WechatBindConfirmRequest,
    WechatBindStartResponse,
    WechatBindStatusResponse,
    WechatLogin,
)
from app.services import (
    email_otp_service,
    identity_service,
    user_auth_service,
    user_service,
    wechat_bind_challenge_service,
    wechat_miniprogram_code_service,
)

router = APIRouter()

_BIND_STATUS_TTL_MESSAGE = "绑定码有效期 5 分钟，请重新生成"


def _raise_wechat_bind_error(exc: wechat_bind_challenge_service.WechatBindError):
    if isinstance(exc, wechat_bind_challenge_service.WechatBindRateLimitedError):
        status_code = 429
    elif isinstance(exc, wechat_bind_challenge_service.WechatBindNotFoundError):
        status_code = 404
    elif isinstance(exc, wechat_bind_challenge_service.WechatBindConflictError):
        status_code = 409
    else:
        status_code = 503
    raise HTTPException(status_code=status_code, detail=str(exc)) from exc


async def _expire_challenge(
    challenge_id: str,
    record: dict,
) -> None:
    try:
        await wechat_bind_challenge_service.consume_challenge(challenge_id)
    except wechat_bind_challenge_service.WechatBindError:
        return
    await wechat_bind_challenge_service.set_status_quietly(
        challenge_id,
        user_id=int(record.get("user_id") or 0),
        status="expired",
        poll_digest=str(record.get("poll_digest") or ""),
        message="Web 登录状态已变化，请重新生成绑定码",
    )


@router.post(
    "/users/me/identities/wechat/bind/start",
    response_model=WechatBindStartResponse,
)
async def start_wechat_bind(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        record, poll_token = await wechat_bind_challenge_service.start_challenge(
            current_user.id,
            nbf=await read_user_nbf(current_user.id),
        )
    except wechat_bind_challenge_service.WechatBindError as exc:
        _raise_wechat_bind_error(exc)

    qrcode_data_url = None
    qrcode_error = None
    try:
        qrcode_data_url = (
            await wechat_miniprogram_code_service.generate_bind_code(
                str(record["challenge_id"])
            )
        )
    except wechat_miniprogram_code_service.WechatMiniProgramCodeError as exc:
        qrcode_error = str(exc)

    return WechatBindStartResponse(
        challenge_id=str(record["challenge_id"]),
        poll_token=poll_token,
        expires_in=wechat_bind_challenge_service.CHALLENGE_TTL_SEC,
        miniprogram_path=wechat_miniprogram_code_service.bind_page_path(),
        miniprogram_scene=str(record["challenge_id"]),
        qrcode_data_url=qrcode_data_url,
        qrcode_error=qrcode_error,
    )


@router.get(
    "/users/me/identities/wechat/bind/status/{challenge_id}",
    response_model=WechatBindStatusResponse,
)
async def get_wechat_bind_status(
    challenge_id: str,
    request: Request,
    poll_token: str = Header(..., alias="X-Wechat-Bind-Token"),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        result = await wechat_bind_challenge_service.get_status(
            challenge_id,
            poll_token,
        )
    except wechat_bind_challenge_service.WechatBindError as exc:
        _raise_wechat_bind_error(exc)
    return WechatBindStatusResponse(
        status=result["status"],
        identity_id=result.get("identity_id"),
        message=result.get("message"),
    )


@router.post("/users/me/identities/wechat/bind/{challenge_id}/cancel")
async def cancel_wechat_bind(
    challenge_id: str,
    request: Request,
    poll_token: str = Header(..., alias="X-Wechat-Bind-Token"),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        await wechat_bind_challenge_service.cancel_challenge(
            challenge_id,
            poll_token,
        )
    except wechat_bind_challenge_service.WechatBindError as exc:
        _raise_wechat_bind_error(exc)
    return {"status": "cancelled"}


@router.post(
    "/auth/wechat/bind/confirm",
    response_model=WechatBindStatusResponse,
)
async def confirm_wechat_bind(
    data: WechatBindConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Confirm a Web-initiated bind from the Mini Program after ``wx.login``."""
    try:
        await wechat_bind_challenge_service.reserve_confirm_attempt(
            data.challenge_id,
            _ip(request),
        )
        record = await wechat_bind_challenge_service.get_challenge(
            data.challenge_id
        )
    except wechat_bind_challenge_service.WechatBindError as exc:
        _raise_wechat_bind_error(exc)
    if record is None:
        raise HTTPException(status_code=404, detail=_BIND_STATUS_TTL_MESSAGE)

    user_id = int(record.get("user_id") or 0)
    if user_id <= 0:
        raise HTTPException(status_code=404, detail=_BIND_STATUS_TTL_MESSAGE)
    if int(record.get("nbf") or 0) != int(await read_user_nbf(user_id) or 0):
        await _expire_challenge(data.challenge_id, record)
        raise HTTPException(status_code=401, detail="Web 登录状态已变化，请重新生成绑定码")

    try:
        subject = await user_service.resolve_wechat_subject(data.code)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    try:
        consumed = await wechat_bind_challenge_service.consume_challenge(
            data.challenge_id
        )
    except wechat_bind_challenge_service.WechatBindError as exc:
        _raise_wechat_bind_error(exc)

    if int(consumed.get("nbf") or 0) != int(await read_user_nbf(user_id) or 0):
        await wechat_bind_challenge_service.set_status_quietly(
            data.challenge_id,
            user_id=user_id,
            status="expired",
            poll_digest=str(consumed.get("poll_digest") or ""),
            message="Web 登录状态已变化，请重新生成绑定码",
        )
        raise HTTPException(status_code=401, detail="Web 登录状态已变化，请重新生成绑定码")

    user = await db.get(User, user_id)
    if user is None:
        await wechat_bind_challenge_service.set_status_quietly(
            data.challenge_id,
            user_id=user_id,
            status="expired",
            poll_digest=str(consumed.get("poll_digest") or ""),
            message="账号状态已变化，请重新登录",
        )
        raise HTTPException(status_code=401, detail="账号状态已变化，请重新登录")
    try:
        await identity_service.validate_identity_user(user)
    except identity_service.IdentityUnavailableError as exc:
        await wechat_bind_challenge_service.set_status_quietly(
            data.challenge_id,
            user_id=user_id,
            status="expired",
            poll_digest=str(consumed.get("poll_digest") or ""),
            message=str(exc),
        )
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    try:
        identity, owner = await identity_service.find_identity_user(
            db,
            provider="wechat",
            namespace=identity_service.wechat_namespace(),
            subject=subject,
        )
        if owner is not None and owner.id != user.id:
            raise identity_service.IdentityConflictError(
                "该微信已绑定到其他账号，请使用原账号登录"
            )
        current_wechat = await db.scalar(
            select(UserAuthIdentity.id).where(
                UserAuthIdentity.user_id == user.id,
                UserAuthIdentity.provider == "wechat",
                UserAuthIdentity.namespace == identity_service.wechat_namespace(),
            )
        )
        if identity is None:
            if current_wechat is not None:
                raise identity_service.IdentityConflictError(
                    "当前账号已绑定其他微信，请先解绑后再绑定"
                )
            identity = await identity_service.bind_identity(
                db,
                user=user,
                provider="wechat",
                namespace=identity_service.wechat_namespace(),
                subject=subject,
                commit=False,
            )
            await db.execute(
                update(RefreshToken)
                .where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
                .values(revoked_at=utcnow())
            )
            await db.flush()
            await set_user_nbf(user_id)
            await db.commit()
            await wechat_bind_challenge_service.set_status(
                data.challenge_id,
                user_id=user.id,
                status="completed",
                poll_digest=str(consumed.get("poll_digest") or ""),
                identity_id=identity.id,
                message="微信已绑定，请重新登录",
            )
        else:
            await wechat_bind_challenge_service.set_status(
                data.challenge_id,
                user_id=user.id,
                status="completed",
                poll_digest=str(consumed.get("poll_digest") or ""),
                identity_id=identity.id,
                message="该微信已属于当前账号",
            )
    except identity_service.IdentityConflictError as exc:
        await db.rollback()
        await wechat_bind_challenge_service.set_status_quietly(
            data.challenge_id,
            user_id=user_id,
            status="conflict",
            poll_digest=str(consumed.get("poll_digest") or ""),
            message=str(exc),
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except identity_service.IdentityUnavailableError as exc:
        await db.rollback()
        await wechat_bind_challenge_service.set_status_quietly(
            data.challenge_id,
            user_id=user_id,
            status="expired",
            poll_digest=str(consumed.get("poll_digest") or ""),
            message=str(exc),
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (HTTPException, SQLAlchemyError) as exc:
        await db.rollback()
        await wechat_bind_challenge_service.set_status_quietly(
            data.challenge_id,
            user_id=user_id,
            status="expired",
            poll_digest=str(consumed.get("poll_digest") or ""),
            message="微信绑定未完成，请重新生成绑定码",
        )
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=503, detail="微信绑定服务暂时不可用") from exc
    except wechat_bind_challenge_service.WechatBindError as exc:
        _raise_wechat_bind_error(exc)

    return WechatBindStatusResponse(
        status="completed",
        identity_id=identity.id,
        message="微信绑定已完成",
    )


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
