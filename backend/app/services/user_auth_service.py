from fastapi import HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.security import create_user_step_up_token, issue_user_token, read_user_nbf
from app.core.user_web_auth import set_user_refresh_cookie
from app.models.user import User
from app.models.user_auth import UserConsentAcceptance
from app.schemas.user import TokenResponse, WebTokenResponse
from app.services import email_otp_service, token_service, user_service


async def authorize_email_change(
    *,
    user_id: int,
    email: str,
    old_email: str,
    step_up_token: str | None,
    challenge_id: str | None,
) -> None:
    if step_up_token:
        await consume_step_up_token(step_up_token, user_id)
        return
    if not challenge_id:
        raise email_otp_service.OtpError("请先完成安全验证")
    previous = await email_otp_service.get_active_challenge(challenge_id)
    if (
        previous.get("user_id") != user_id
        or previous.get("domain") != "user"
        or previous.get("purpose") != "bind"
        or previous.get("email") != email
        or previous.get("metadata", {}).get("operation") != "change_email"
        or previous.get("metadata", {}).get("old_email") != old_email
    ):
        raise email_otp_service.OtpError("请重新完成安全验证")


def validate_registration_consent(
    *,
    accepted_terms: bool,
    agreement_version: str | None,
    privacy_version: str | None,
) -> dict[str, str]:
    if not accepted_terms:
        raise ValueError("请先阅读并同意用户协议和隐私政策")
    if agreement_version != settings.USER_AGREEMENT_VERSION:
        raise ValueError("用户协议版本已更新，请重新阅读并同意")
    if privacy_version != settings.PRIVACY_POLICY_VERSION:
        raise ValueError("隐私政策版本已更新，请重新阅读并同意")
    return {
        "user_agreement": settings.USER_AGREEMENT_VERSION,
        "privacy_policy": settings.PRIVACY_POLICY_VERSION,
    }


async def record_consents(
    db: AsyncSession, user_id: int, versions: dict[str, str]
) -> None:
    existing = await db.execute(
        select(
            UserConsentAcceptance.document_type, UserConsentAcceptance.document_version
        ).where(UserConsentAcceptance.user_id == user_id)
    )
    granted = set(existing.all())
    for document_type, document_version in versions.items():
        if (document_type, document_version) in granted:
            continue
        try:
            async with db.begin_nested():
                db.add(
                    UserConsentAcceptance(
                        user_id=user_id,
                        document_type=document_type,
                        document_version=document_version,
                    )
                )
                await db.flush()
        except IntegrityError:
            if (
                await db.scalar(
                    select(UserConsentAcceptance.id).where(
                        UserConsentAcceptance.user_id == user_id,
                        UserConsentAcceptance.document_type == document_type,
                        UserConsentAcceptance.document_version == document_version,
                    )
                )
                is None
            ):
                raise
    await db.commit()


async def issue_miniprogram_session(db: AsyncSession, user: User) -> TokenResponse:
    access_token, expires_at = await issue_user_token(user.id)
    refresh_token = await token_service.create_refresh_token(db, user.id)
    return TokenResponse(
        access_token=access_token,
        expires_at=expires_at,
        refresh_token=refresh_token,
        user=await user_service.get_user_response(db, user),
    )


async def issue_web_session(
    db: AsyncSession,
    user: User,
    response: Response,
    request: Request | None = None,
) -> WebTokenResponse:
    access_token, expires_at = await issue_user_token(user.id)
    refresh_token = await token_service.create_refresh_token(db, user.id)
    set_user_refresh_cookie(response, refresh_token, request)
    return WebTokenResponse(
        access_token=access_token,
        expires_at=expires_at,
        user=await user_service.get_user_response(db, user),
    )


async def issue_session(
    db: AsyncSession,
    user: User,
    *,
    client: str,
    response: Response,
    request: Request | None = None,
) -> TokenResponse | WebTokenResponse:
    if client == "web":
        return await issue_web_session(db, user, response, request)
    return await issue_miniprogram_session(db, user)


async def issue_step_up_token(user_id: int, identity_id: int) -> str:
    return create_user_step_up_token(
        user_id,
        identity_id=identity_id,
        expires_in_sec=300,
        issued_at=await read_user_nbf(user_id),
    )


async def consume_step_up_token(token: str, user_id: int) -> int:
    from app.core.security import decode_user_step_up_token

    payload = decode_user_step_up_token(token, user_id=user_id)
    nbf = await read_user_nbf(user_id)
    if nbf is not None and int(payload["iat"]) < nbf:
        raise HTTPException(status_code=401, detail="安全验证已失效，请重新验证")
    try:
        jti = str(payload["jti"])
        acquired = await cache.acquire_lock_strict(
            f"user:step_up:used:{jti}", "1", ttl=600
        )
    except (KeyError, CacheUnavailableError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="安全验证服务暂时不可用",
        ) from exc
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="安全验证已使用，请重新验证",
        )
    return int(payload["identity_id"])


async def invalidate_user_sessions(db: AsyncSession, user_id: int) -> None:
    from app.core.security import set_user_nbf

    await token_service.revoke_all_user_tokens(db, user_id)
    await set_user_nbf(user_id)
