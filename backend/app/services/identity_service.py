from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.time_utils import utcnow
from app.models.user import User
from app.models.user_auth import UserAuthIdentity, UserIdentityTombstone
from app.services.identity_tombstone_service import (
    identity_subject_digest,
    is_tombstoned,
)


class IdentityConflictError(ValueError):
    pass


class IdentityUnavailableError(ValueError):
    pass


def wechat_namespace() -> str:
    return (settings.WECHAT_APP_ID or "default").strip()


def user_is_usable(user: User | None) -> bool:
    if user is None:
        return False
    lifecycle = getattr(user, "lifecycle_status", "active") or "active"
    return user.deleted_at is None and lifecycle == "active" and not user.is_banned


async def validate_identity_user(user: User) -> User:
    lifecycle = getattr(user, "lifecycle_status", "active") or "active"
    if lifecycle == "anonymized":
        raise IdentityUnavailableError("账号已注销")
    if user.deleted_at is not None or lifecycle in {"erasing", "erased"}:
        raise IdentityUnavailableError("账号已注销")
    if user.is_banned:
        raise IdentityUnavailableError("账号已封禁")
    return user


async def _lock_user(
    db: AsyncSession, user_id: int, *, require_active: bool = True
) -> User:
    """Serialize identity mutations on one owner, including on SQLite."""
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(lifecycle_status=User.lifecycle_status)
    )
    user = await db.scalar(
        select(User).where(User.id == user_id).execution_options(populate_existing=True)
    )
    if user is None:
        raise IdentityUnavailableError("账号不存在")
    return await validate_identity_user(user) if require_active else user


async def find_identity(
    db: AsyncSession,
    *,
    provider: str,
    namespace: str,
    subject: str,
) -> UserAuthIdentity | None:
    result = await db.execute(
        select(UserAuthIdentity).where(
            UserAuthIdentity.provider == provider,
            UserAuthIdentity.namespace == namespace,
            UserAuthIdentity.subject == subject,
        )
    )
    return result.scalar_one_or_none()


async def find_identity_user(
    db: AsyncSession,
    *,
    provider: str,
    namespace: str,
    subject: str,
) -> tuple[UserAuthIdentity | None, User | None]:
    identity = await find_identity(
        db, provider=provider, namespace=namespace, subject=subject
    )
    if identity is None:
        if await is_tombstoned(db, provider, namespace, subject):
            raise IdentityUnavailableError("该身份关联的账号已注销")
        return None, None
    user = await db.get(User, identity.user_id)
    return identity, user


async def authenticate_identity(
    db: AsyncSession,
    *,
    provider: str,
    namespace: str,
    subject: str,
    allow_register: bool,
    display_name: str | None = None,
) -> tuple[User, UserAuthIdentity]:
    identity, user = await find_identity_user(
        db, provider=provider, namespace=namespace, subject=subject
    )
    if identity and user:
        await validate_identity_user(user)
        identity.last_authenticated_at = utcnow()
        await db.commit()
        return user, identity
    if not allow_register:
        raise IdentityUnavailableError("身份尚未绑定账号")

    user = User(nickname=display_name, lifecycle_status="active")
    db.add(user)
    try:
        await db.flush()
        identity = UserAuthIdentity(
            user_id=user.id,
            provider=provider,
            namespace=namespace,
            subject=subject,
            verified_at=utcnow(),
            last_authenticated_at=utcnow(),
        )
        db.add(identity)
        await db.flush()
        await db.commit()
        return user, identity
    except IntegrityError:
        await db.rollback()
        identity, user = await find_identity_user(
            db, provider=provider, namespace=namespace, subject=subject
        )
        if identity is None or user is None:
            raise IdentityConflictError("身份注册冲突，请重试")
        await validate_identity_user(user)
        return user, identity


async def bind_identity(
    db: AsyncSession,
    *,
    user: User,
    provider: str,
    namespace: str,
    subject: str,
) -> UserAuthIdentity:
    await _lock_user(db, user.id)
    existing, owner = await find_identity_user(
        db, provider=provider, namespace=namespace, subject=subject
    )
    if existing and owner:
        if owner.id == user.id:
            existing.last_authenticated_at = utcnow()
            await db.commit()
            return existing
        raise IdentityConflictError("该身份已绑定到其他账号，请使用原账号登录")
    same_provider = await db.scalar(
        select(UserAuthIdentity.id).where(
            UserAuthIdentity.user_id == user.id,
            UserAuthIdentity.provider == provider,
            UserAuthIdentity.namespace == namespace,
        )
    )
    if same_provider is not None:
        raise IdentityConflictError("当前账号已绑定此登录方式，请使用更换流程")
    identity = UserAuthIdentity(
        user_id=user.id,
        provider=provider,
        namespace=namespace,
        subject=subject,
        verified_at=utcnow(),
        last_authenticated_at=utcnow(),
    )
    db.add(identity)
    try:
        await db.flush()
        await db.commit()
        return identity
    except IntegrityError as exc:
        await db.rollback()
        raise IdentityConflictError("该身份已绑定到其他账号，请使用原账号登录") from exc


async def list_user_identities(
    db: AsyncSession, user_id: int
) -> list[UserAuthIdentity]:
    result = await db.execute(
        select(UserAuthIdentity)
        .where(UserAuthIdentity.user_id == user_id)
        .order_by(UserAuthIdentity.created_at.asc(), UserAuthIdentity.id.asc())
    )
    return list(result.scalars().all())


async def unbind_identity(
    db: AsyncSession,
    *,
    user_id: int,
    identity_id: int,
    retained_identity_id: int | None = None,
) -> None:
    await _lock_user(db, user_id)
    count = await db.scalar(
        select(func.count())
        .select_from(UserAuthIdentity)
        .where(UserAuthIdentity.user_id == user_id)
    )
    if int(count or 0) <= 1:
        raise IdentityConflictError("至少需要保留一种登录方式")
    if retained_identity_id is not None:
        retained = await db.scalar(
            select(UserAuthIdentity).where(
                UserAuthIdentity.id == retained_identity_id,
                UserAuthIdentity.user_id == user_id,
                UserAuthIdentity.verified_at.isnot(None),
            )
        )
        if retained is None or retained.id == identity_id:
            raise IdentityConflictError("请先验证准备保留的登录方式")
    identity = await db.scalar(
        select(UserAuthIdentity)
        .where(
            UserAuthIdentity.id == identity_id,
            UserAuthIdentity.user_id == user_id,
        )
        .with_for_update()
    )
    if identity is None:
        raise IdentityUnavailableError("登录身份不存在")
    if identity.provider == "wechat":
        user = await db.get(User, user_id)
        user.openid = None
    await db.delete(identity)
    await db.commit()


async def replace_email_identity(
    db: AsyncSession, *, user_id: int, old_email: str | None, new_email: str
) -> UserAuthIdentity:
    await _lock_user(db, user_id)
    existing, _owner = await find_identity_user(
        db, provider="email", namespace="user", subject=new_email
    )
    if existing:
        raise IdentityConflictError("该邮箱已绑定到其他账号")
    identity = await db.scalar(
        select(UserAuthIdentity)
        .where(
            UserAuthIdentity.user_id == user_id,
            UserAuthIdentity.provider == "email",
            UserAuthIdentity.namespace == "user",
        )
        .with_for_update()
    )
    if identity is None:
        raise IdentityUnavailableError("当前账号未绑定邮箱")
    if old_email and identity.subject != old_email:
        raise IdentityConflictError("邮箱状态已变化，请重新验证")
    identity.subject = new_email
    identity.verified_at = utcnow()
    identity.updated_at = utcnow()
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise IdentityConflictError("该邮箱已绑定到其他账号") from exc
    return identity


async def tombstone_user_identities(db: AsyncSession, user_id: int) -> None:
    await _lock_user(db, user_id, require_active=False)
    identities = await list_user_identities(db, user_id)
    for identity in identities:
        existing = await db.scalar(
            select(UserIdentityTombstone).where(
                UserIdentityTombstone.provider == identity.provider,
                UserIdentityTombstone.namespace == identity.namespace,
                UserIdentityTombstone.subject_digest
                == identity_subject_digest(
                    identity.provider, identity.namespace, identity.subject
                ),
            )
        )
        if existing is None:
            db.add(
                UserIdentityTombstone(
                    provider=identity.provider,
                    namespace=identity.namespace,
                    subject_digest=identity_subject_digest(
                        identity.provider, identity.namespace, identity.subject
                    ),
                )
            )
        await db.delete(identity)
    await db.flush()
