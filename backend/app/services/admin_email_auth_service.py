import hashlib
import hmac
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_security import (
    hash_admin_password,
    set_admin_user_nbf,
    validate_admin_password_strength,
)
from app.core.cache import CacheUnavailableError, cache
from app.core.email_address import normalize_email
from app.core.time_utils import utcnow
from app.models.admin import AdminUser


async def find_active_admin_by_email(db: AsyncSession, email: str) -> AdminUser | None:
    normalized = normalize_email(email)
    if len(normalized) > 128:
        raise ValueError("管理员邮箱不能超过 128 个字符")
    return await db.scalar(
        select(AdminUser).where(
            AdminUser.email_normalized == normalized,
            AdminUser.email_verified_at.isnot(None),
            AdminUser.is_active.is_(True),
        )
    )


async def validate_admin_email_available(
    db: AsyncSession, *, admin_user: AdminUser, email: str
) -> str:
    normalized = normalize_email(email)
    if len(normalized) > 128:
        raise ValueError("管理员邮箱不能超过 128 个字符")
    existing = await db.scalar(
        select(AdminUser.id).where(
            AdminUser.email_normalized == normalized,
            AdminUser.id != admin_user.id,
        )
    )
    if existing is not None:
        raise ValueError("该邮箱已被其他管理员使用")
    return normalized


async def activate_admin_email(
    db: AsyncSession, *, admin_user: AdminUser, email: str
) -> AdminUser:
    normalized = await validate_admin_email_available(
        db, admin_user=admin_user, email=email
    )
    admin_user.email = email.strip()
    admin_user.email_normalized = normalized
    admin_user.email_verified_at = utcnow()
    await set_admin_user_nbf(admin_user.id)
    await db.commit()
    await db.refresh(admin_user)
    return admin_user


def _reset_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _credential_fingerprint(admin: AdminUser) -> str:
    return _reset_digest(
        "\0".join(
            (
                admin.password_hash,
                admin.email_normalized or "",
                str(admin.email_verified_at or ""),
            )
        )
    )


async def issue_admin_recovery_token(admin: AdminUser) -> str:
    token = secrets.token_urlsafe(32)
    try:
        await cache.set_strict(
            f"auth:admin:recovery:{_reset_digest(token)}",
            {
                "user_id": admin.id,
                "credential_fingerprint": _credential_fingerprint(admin),
            },
            ttl=300,
        )
    except CacheUnavailableError as exc:
        raise ValueError("密码恢复服务暂时不可用") from exc
    return token


async def reset_admin_password_with_token(
    db: AsyncSession, *, reset_token: str, new_password: str
) -> AdminUser:
    validate_admin_password_strength(new_password)
    key = f"auth:admin:recovery:{_reset_digest(reset_token)}"
    try:
        state = await cache.get_strict(key)
        if not isinstance(state, dict):
            raise ValueError("密码恢复凭证无效或已过期")
        deleted = await cache.delete_strict(key)
    except CacheUnavailableError as exc:
        raise ValueError("密码恢复服务暂时不可用") from exc
    if deleted != 1:
        raise ValueError("密码恢复凭证无效或已过期")
    admin_user = await db.get(AdminUser, int(state["user_id"]))
    if (
        admin_user is None
        or not admin_user.is_active
        or not hmac.compare_digest(
            str(state.get("credential_fingerprint", "")),
            _credential_fingerprint(admin_user),
        )
    ):
        raise ValueError("管理员账号不可用")
    admin_user.password_hash = hash_admin_password(new_password)
    admin_user.must_change_password = False
    await set_admin_user_nbf(admin_user.id, int(utcnow().timestamp()) + 1)
    await db.commit()
    return admin_user


def recovery_expiry_seconds() -> int:
    return int(timedelta(minutes=5).total_seconds())
