import asyncio
import re
import unicodedata

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError
from pwdlib.hashers.bcrypt import BcryptHasher
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.email_address import normalize_email
from app.core.time_utils import utcnow
from app.models.user import User
from app.models.user_auth import UserAuthIdentity, UserConsentAcceptance
from app.models.user_password import UserPasswordCredential
from app.services import identity_service

password_context = PasswordHash((BcryptHasher(),))
_BCRYPT_MAX_BYTES = 72
_USERNAME_PATTERN = re.compile(r"^[\w.-]+$", re.UNICODE)


class PasswordAuthError(ValueError):
    pass


class PasswordRegistrationConflictError(PasswordAuthError):
    pass


def normalize_username(value: str) -> tuple[str, str]:
    """Return display and case-insensitive account forms for a username."""
    display = unicodedata.normalize("NFKC", str(value or "")).strip()
    if not 3 <= len(display) <= 32:
        raise ValueError("账号长度需为 3 至 32 个字符")
    if (
        not _USERNAME_PATTERN.fullmatch(display)
        or display[0] in "._-"
        or display[-1] in "._-"
    ):
        raise ValueError("账号仅支持中英文、数字、点、下划线和短横线，且不能以符号开头或结尾")
    return display, display.casefold()


def normalize_login_account(account: str) -> tuple[str, str]:
    candidate = str(account or "").strip()
    if "@" in candidate:
        return "email", normalize_email(candidate)
    return "password", normalize_username(candidate)[1]


def validate_user_password(password: str) -> None:
    if len(password) < 12:
        raise ValueError("密码长度至少需要 12 位")
    if len(password.encode("utf-8")) > _BCRYPT_MAX_BYTES:
        raise ValueError("密码内容过长，请控制在 72 个英文字符以内")
    if not any(ch.isupper() for ch in password):
        raise ValueError("密码需包含大写字母")
    if not any(ch.islower() for ch in password):
        raise ValueError("密码需包含小写字母")
    if not any(ch.isdigit() for ch in password):
        raise ValueError("密码需包含数字")


def hash_user_password(password: str) -> str:
    validate_user_password(password)
    return password_context.hash(password)


async def hash_user_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_user_password, password)


def verify_user_password(password: str, password_hash: str) -> bool:
    if len(password.encode("utf-8")) > _BCRYPT_MAX_BYTES:
        return False
    try:
        return password_context.verify(password, password_hash)
    except (UnknownHashError, ValueError):
        return False


async def verify_user_password_async(password: str, password_hash: str) -> bool:
    return await asyncio.to_thread(verify_user_password, password, password_hash)


async def simulate_password_verify(password: str) -> None:
    """Spend comparable work for unknown accounts to reduce enumeration timing."""
    del password
    await asyncio.to_thread(password_context.hash, "MemoGrad Dummy Password 9x")


async def assert_registration_available(
    db: AsyncSession,
    *,
    username: str,
    email: str,
) -> None:
    try:
        password_identity, _ = await identity_service.find_identity_user(
            db,
            provider="password",
            namespace="user",
            subject=username,
        )
        email_identity, _ = await identity_service.find_identity_user(
            db,
            provider="email",
            namespace="user",
            subject=email,
        )
    except identity_service.IdentityUnavailableError as exc:
        raise PasswordRegistrationConflictError(str(exc)) from exc
    if password_identity is not None:
        raise PasswordRegistrationConflictError("该账号名称已被使用")
    if email_identity is not None:
        raise PasswordRegistrationConflictError("该邮箱已注册，请直接登录")


async def find_password_credential(
    db: AsyncSession,
    *,
    provider: str,
    subject: str,
) -> tuple[UserAuthIdentity, User, UserPasswordCredential] | None:
    try:
        _account_identity, user = await identity_service.find_identity_user(
            db,
            provider=provider,
            namespace="user",
            subject=subject,
        )
    except identity_service.IdentityUnavailableError as exc:
        raise PasswordAuthError(str(exc)) from exc
    if user is None:
        return None
    row = (
        await db.execute(
            select(UserAuthIdentity, UserPasswordCredential)
            .join(
                UserPasswordCredential,
                UserPasswordCredential.identity_id == UserAuthIdentity.id,
            )
            .where(
                UserAuthIdentity.user_id == user.id,
                UserAuthIdentity.provider == "password",
                UserAuthIdentity.namespace == "user",
            )
        )
    ).one_or_none()
    if row is None:
        return None
    return row[0], user, row[1]


async def authenticate_password_account(
    db: AsyncSession,
    *,
    account: str,
    password: str,
) -> User:
    provider, subject = normalize_login_account(account)

    record = await find_password_credential(
        db,
        provider=provider,
        subject=subject,
    )
    return await authenticate_password_record(
        db,
        record=record,
        password=password,
    )


async def authenticate_password_record(
    db: AsyncSession,
    *,
    record: tuple[UserAuthIdentity, User, UserPasswordCredential] | None,
    password: str,
) -> User:
    if record is None:
        await simulate_password_verify(password)
        raise PasswordAuthError("账号或密码错误")

    identity, user, credential = record
    password_ok = await verify_user_password_async(password, credential.password_hash)
    if not password_ok:
        raise PasswordAuthError("账号或密码错误")
    try:
        await identity_service.validate_identity_user(user)
    except identity_service.IdentityUnavailableError as exc:
        raise PasswordAuthError(str(exc)) from exc
    identity.last_authenticated_at = utcnow()
    await db.commit()
    return user


async def list_password_login_aliases(
    db: AsyncSession,
    *,
    user_id: int,
) -> list[tuple[str, str]]:
    rows = await db.execute(
        select(UserAuthIdentity.provider, UserAuthIdentity.subject).where(
            UserAuthIdentity.user_id == user_id,
            UserAuthIdentity.namespace == "user",
            UserAuthIdentity.provider.in_(("password", "email")),
        )
    )
    return [(str(provider), str(subject)) for provider, subject in rows]


async def create_password_account(
    db: AsyncSession,
    *,
    username: str,
    display_name: str,
    email: str,
    password_hash: str,
    consent_versions: dict[str, str],
    registration_source: str | None = None,
) -> tuple[User, UserAuthIdentity]:
    user = User(
        nickname=display_name,
        lifecycle_status="active",
        registration_source=registration_source,
    )
    db.add(user)
    try:
        await db.flush()
        password_identity = UserAuthIdentity(
            user_id=user.id,
            provider="password",
            namespace="user",
            subject=username,
            verified_at=utcnow(),
            last_authenticated_at=utcnow(),
        )
        email_identity = UserAuthIdentity(
            user_id=user.id,
            provider="email",
            namespace="user",
            subject=email,
            verified_at=utcnow(),
            last_authenticated_at=utcnow(),
        )
        db.add_all([password_identity, email_identity])
        await db.flush()
        db.add(
            UserPasswordCredential(
                identity_id=password_identity.id,
                password_hash=password_hash,
                password_changed_at=utcnow(),
            )
        )
        for document_type, document_version in consent_versions.items():
            db.add(
                UserConsentAcceptance(
                    user_id=user.id,
                    document_type=document_type,
                    document_version=document_version,
                    accepted_at=utcnow(),
                )
            )
        await db.commit()
        await db.refresh(user)
        return user, password_identity
    except IntegrityError as exc:
        await db.rollback()
        raise PasswordRegistrationConflictError(
            "账号或邮箱已被使用，请更换后重试"
        ) from exc
