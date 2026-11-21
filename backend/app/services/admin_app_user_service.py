from datetime import datetime

from fastapi import Request
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_security import AdminPrincipal
from app.core.time_utils import normalize_to_naive_utc, serialize_utc_datetime, utcnow
from app.models.admin import AdminUser, Role
from app.models.app_user_admin_binding import AppUserAdminBinding
from app.models.practice_record import PracticeRecord
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.models.wrong_question import WrongQuestion
from app.schemas.admin_app_users import (
    AdminAppUserBanRequest,
    AdminAppUserUpdateRequest,
)
from app.services.admin_audit_service import write_admin_audit

USER_TYPES = ("web", "miniprogram", "both")
WEB_IDENTITY_PROVIDERS = ("email", "github", "password")


async def _ensure_super_admin(db: AsyncSession, operator: AdminPrincipal) -> None:
    role_name = await db.scalar(
        select(Role.name)
        .join(AdminUser, AdminUser.role_id == Role.id)
        .where(AdminUser.id == operator.id)
    )
    if role_name != "super_admin":
        raise PermissionError("仅 super_admin 可管理普通用户管理员绑定")


async def list_app_users(
    db: AsyncSession,
    page: int,
    page_size: int,
    keyword: str | None = None,
    user_type: str | None = None,
    is_banned: bool | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
) -> tuple[list[User], int]:
    user_type = user_type if user_type in USER_TYPES else None
    conditions = []
    if keyword:
        pattern = f"%{keyword}%"
        identity_match = (
            select(UserAuthIdentity.id)
            .where(
                UserAuthIdentity.user_id == User.id,
                UserAuthIdentity.subject.ilike(pattern),
            )
            .exists()
        )
        conditions.append(
            or_(
                User.openid.ilike(pattern),
                User.nickname.ilike(pattern),
                identity_match,
            )
        )
    if is_banned is not None:
        conditions.append(User.is_banned.is_(is_banned))
    if user_type == "web":
        conditions.append(_has_identity_condition(WEB_IDENTITY_PROVIDERS))
        conditions.append(_without_wechat_condition())
    elif user_type == "miniprogram":
        conditions.append(_has_identity_condition(("wechat",)))
        conditions.append(_without_web_identity_condition())
    elif user_type == "both":
        conditions.append(_has_identity_condition(("wechat",)))
        conditions.append(_has_identity_condition(WEB_IDENTITY_PROVIDERS))
    if created_from:
        conditions.append(User.created_at >= normalize_to_naive_utc(created_from))
    if created_to:
        conditions.append(User.created_at <= normalize_to_naive_utc(created_to))

    query = select(User)
    count_query = select(func.count()).select_from(User)
    for condition in conditions:
        query = query.where(condition)
        count_query = count_query.where(condition)

    total = await db.scalar(count_query)
    result = await db.execute(
        query.order_by(User.created_at.desc(), User.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(result.scalars().all()), int(total or 0)


def get_user_type(identities: list[UserAuthIdentity]) -> str:
    if not identities:
        return "unknown"
    has_web = any(
        identity.provider in WEB_IDENTITY_PROVIDERS for identity in identities
    )
    has_miniprogram = any(identity.provider == "wechat" for identity in identities)
    if has_web and has_miniprogram:
        return "both"
    if has_web:
        return "web"
    if has_miniprogram:
        return "miniprogram"
    return "unknown"


def _has_identity_condition(providers: tuple[str, ...]) -> ColumnElement[bool]:
    return (
        select(UserAuthIdentity.id)
        .where(
            UserAuthIdentity.user_id == User.id,
            UserAuthIdentity.provider.in_(providers),
        )
        .exists()
    )


def _without_wechat_condition() -> ColumnElement[bool]:
    return ~_has_identity_condition(("wechat",))


def _without_web_identity_condition() -> ColumnElement[bool]:
    return ~_has_identity_condition(WEB_IDENTITY_PROVIDERS)


async def load_user_identities(db: AsyncSession, user_id: int) -> list[UserAuthIdentity]:
    return list(
        (
            await db.execute(
                select(UserAuthIdentity)
                .where(UserAuthIdentity.user_id == user_id)
                .order_by(UserAuthIdentity.created_at.asc())
            )
        ).scalars()
    )


async def load_user_identities_by_user(
    db: AsyncSession, user_ids: list[int]
) -> dict[int, list[UserAuthIdentity]]:
    if not user_ids:
        return {}
    result = await db.execute(
        select(UserAuthIdentity)
        .where(UserAuthIdentity.user_id.in_(user_ids))
        .order_by(UserAuthIdentity.created_at.asc(), UserAuthIdentity.id.asc())
    )
    grouped: dict[int, list[UserAuthIdentity]] = {user_id: [] for user_id in user_ids}
    for identity in result.scalars():
        grouped[identity.user_id].append(identity)
    return grouped


def mask_identity_subject(identity: UserAuthIdentity) -> str:
    if identity.provider == "email" and "@" in identity.subject:
        return f"{identity.subject[:2]}***@{identity.subject.split('@', 1)[1]}"
    if identity.provider == "password":
        return "password:***"
    return f"{identity.provider}:***"


async def get_app_user_detail(db: AsyncSession, user_id: int) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise ValueError("用户不存在")

    practice_count = await db.scalar(
        select(func.count())
        .select_from(PracticeRecord)
        .where(PracticeRecord.user_id == user_id)
    )
    wrong_count = await db.scalar(
        select(func.count())
        .select_from(WrongQuestion)
        .where(WrongQuestion.user_id == user_id)
    )
    recent_active_at = await db.scalar(
        select(func.max(PracticeRecord.answered_at)).where(
            PracticeRecord.user_id == user_id
        )
    )

    identities = await load_user_identities(db, user.id)
    identity_summaries = [
        {
            "provider": identity.provider,
            "masked_subject": mask_identity_subject(identity),
            "verified": identity.verified_at is not None,
            "created_at": identity.created_at,
        }
        for identity in identities
    ]
    return {
        "id": user.id,
        "openid": user.openid,
        "nickname": user.nickname,
        "avatar_url": user.avatar_url,
        "is_banned": user.is_banned,
        "banned_reason": user.banned_reason,
        "banned_at": user.banned_at,
        "banned_by": user.banned_by,
        "created_at": user.created_at,
        "registration_source": user.registration_source,
        "last_active_client": user.last_active_client,
        "last_active_at": user.last_active_at,
        "user_type": get_user_type(identities),
        "updated_at": user.updated_at,
        "lifecycle_status": user.lifecycle_status,
        "identities": identity_summaries,
        "login_identities": identity_summaries,
        "practice_count": int(practice_count or 0),
        "wrong_count": int(wrong_count or 0),
        "recent_active_at": recent_active_at,
    }


async def update_app_user(
    db: AsyncSession,
    user_id: int,
    data: AdminAppUserUpdateRequest,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise ValueError("用户不存在")

    before = {"nickname": user.nickname}
    update_data = data.model_dump(exclude_unset=True)
    if "nickname" in update_data:
        user.nickname = update_data["nickname"]
    after = {"nickname": user.nickname}

    await write_admin_audit(
        db,
        operator,
        "app_user.update",
        "app_user",
        user.id,
        detail={"before": before, "after": after},
        request=request,
    )
    return user


async def ban_app_user(
    db: AsyncSession,
    user_id: int,
    data: AdminAppUserBanRequest,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise ValueError("用户不存在")

    before = {
        "is_banned": user.is_banned,
        "banned_reason": user.banned_reason,
        "banned_at": serialize_utc_datetime(user.banned_at) if user.banned_at else None,
        "banned_by": user.banned_by,
    }
    user.is_banned = True
    user.banned_reason = data.reason
    user.banned_at = utcnow()
    user.banned_by = operator.id
    after = {
        "is_banned": user.is_banned,
        "banned_reason": user.banned_reason,
        "banned_at": serialize_utc_datetime(user.banned_at) if user.banned_at else None,
        "banned_by": user.banned_by,
    }

    await write_admin_audit(
        db,
        operator,
        "app_user.ban",
        "app_user",
        user.id,
        severity="critical",
        detail={"before": before, "after": after},
        request=request,
    )
    return user


async def unban_app_user(
    db: AsyncSession,
    user_id: int,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise ValueError("用户不存在")

    before = {
        "is_banned": user.is_banned,
        "banned_reason": user.banned_reason,
        "banned_at": serialize_utc_datetime(user.banned_at) if user.banned_at else None,
        "banned_by": user.banned_by,
    }
    user.is_banned = False
    user.banned_reason = None
    user.banned_at = None
    user.banned_by = None
    after = {
        "is_banned": user.is_banned,
        "banned_reason": user.banned_reason,
        "banned_at": None,
        "banned_by": None,
    }

    await write_admin_audit(
        db,
        operator,
        "app_user.unban",
        "app_user",
        user.id,
        severity="critical",
        detail={"before": before, "after": after},
        request=request,
    )
    return user


async def bind_app_user_admin(
    db: AsyncSession,
    user_id: int,
    admin_user_id: int,
    operator: AdminPrincipal,
    request: Request | None = None,
):
    await _ensure_super_admin(db, operator)

    user = await db.get(User, user_id)
    if not user:
        raise ValueError("用户不存在")
    admin_user = await db.get(AdminUser, admin_user_id)
    if not admin_user or not admin_user.is_active:
        raise ValueError("管理员不存在或已停用")

    existing_user_binding = await db.scalar(
        select(AppUserAdminBinding).where(AppUserAdminBinding.user_id == user_id)
    )
    if existing_user_binding:
        raise ValueError("该普通用户已绑定管理员账号")
    existing_admin_binding = await db.scalar(
        select(AppUserAdminBinding).where(
            AppUserAdminBinding.admin_user_id == admin_user_id
        )
    )
    if existing_admin_binding:
        raise ValueError("该管理员账号已绑定普通用户")

    binding = AppUserAdminBinding(
        user_id=user_id, admin_user_id=admin_user_id, created_by=operator.id
    )
    db.add(binding)
    await write_admin_audit(
        db,
        operator,
        "app_user.bind_admin",
        "app_user",
        user.id,
        severity="critical",
        detail={"admin_user_id": admin_user_id, "admin_username": admin_user.username},
        request=request,
    )
    return binding


async def unbind_app_user_admin(
    db: AsyncSession,
    user_id: int,
    operator: AdminPrincipal,
    request: Request | None = None,
) -> None:
    await _ensure_super_admin(db, operator)

    user = await db.get(User, user_id)
    if not user:
        raise ValueError("用户不存在")
    binding = await db.scalar(
        select(AppUserAdminBinding).where(AppUserAdminBinding.user_id == user_id)
    )
    if not binding:
        raise ValueError("该普通用户未绑定管理员账号")
    detail = {"admin_user_id": binding.admin_user_id}
    await db.delete(binding)
    await write_admin_audit(
        db,
        operator,
        "app_user.unbind_admin",
        "app_user",
        user.id,
        severity="critical",
        detail=detail,
        request=request,
    )
