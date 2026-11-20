import asyncio
import hashlib
import io
import struct
import uuid

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.log_context import get_trace_headers
from app.core.security import issue_user_token
from app.models.admin import AdminUser, Permission, Role, RolePermission
from app.models.app_user_admin_binding import AppUserAdminBinding
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.schemas.user import UserResponse
from app.services import identity_service
from app.services.storage_backend import (
    LEGACY_USER_AVATAR_PREFIX,
    get_legacy_user_avatar_storage,
    get_user_avatar_storage,
)

WX_URL = "https://api.weixin.qq.com/sns/jscode2session"
LOCAL_APP_ENVS = {"development", "local", "test"}
AVATAR_SIZE = 512
AVATAR_JPEG_QUALITY = 88
MAX_AVATAR_DIMENSION = 4096
MAX_AVATAR_PIXELS = 4096 * 4096


def _dev_openid(code: str) -> str:
    """开发环境：从 code 生成确定性 openid，绕过微信 jscode2session"""
    return "dev_" + hashlib.md5(code.encode()).hexdigest()[:16]


async def _resolve_wechat_openid(code: str) -> str:
    code = code.strip()
    if not code:
        raise ValueError("微信登录凭证不能为空")

    has_app_id = bool(
        settings.WECHAT_APP_ID and settings.WECHAT_APP_ID != "your-app-id-here"
    )
    has_app_secret = bool(
        settings.WECHAT_APP_SECRET
        and settings.WECHAT_APP_SECRET != "your-app-secret-here"
    )

    if has_app_id and has_app_secret:
        # 生产环境：调用微信 jscode2session
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    WX_URL,
                    headers=get_trace_headers(),
                    params={
                        "appid": settings.WECHAT_APP_ID,
                        "secret": settings.WECHAT_APP_SECRET,
                        "js_code": code,
                        "grant_type": "authorization_code",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ValueError("微信登录服务暂时不可用") from exc

        if "openid" not in data:
            raise ValueError("微信登录凭证无效")
        return str(data["openid"])
    if settings.APP_ENV.lower() in LOCAL_APP_ENVS:
        # 开发环境：从 code 派生 openid
        return _dev_openid(code)
    # 生产环境禁止回退到可预测的开发身份。
    raise ValueError("微信登录服务未配置")


async def resolve_wechat_subject(code: str) -> str:
    return await _resolve_wechat_openid(code)


async def resolve_wechat_identity(
    db: AsyncSession, code: str, *, allow_register: bool = True
) -> tuple[User, UserAuthIdentity]:
    openid = await _resolve_wechat_openid(code)
    namespace = identity_service.wechat_namespace()
    identity, user = await identity_service.find_identity_user(
        db, provider="wechat", namespace=namespace, subject=openid
    )
    if identity and user:
        try:
            await identity_service.validate_identity_user(user)
        except identity_service.IdentityUnavailableError as exc:
            raise ValueError(str(exc)) from exc
        return user, identity

    # Lazy repair covers local databases created before v24 and migration rows
    # whose namespace was necessarily recorded as ``legacy-v1``.
    legacy_user = await db.scalar(select(User).where(User.openid == openid))
    if legacy_user is not None:
        try:
            await identity_service.validate_identity_user(legacy_user)
        except identity_service.IdentityUnavailableError as exc:
            raise ValueError(str(exc)) from exc
        legacy_identity = await db.scalar(
            select(UserAuthIdentity).where(
                UserAuthIdentity.provider == "wechat",
                UserAuthIdentity.subject == openid,
                UserAuthIdentity.user_id == legacy_user.id,
            )
        )
        if legacy_identity is None:
            legacy_identity = UserAuthIdentity(
                user_id=legacy_user.id,
                provider="wechat",
                namespace=namespace,
                subject=openid,
                verified_at=legacy_user.created_at,
            )
            db.add(legacy_identity)
        else:
            legacy_identity.namespace = namespace
        await db.commit()
        return legacy_user, legacy_identity

    if not allow_register:
        raise ValueError("该微信尚未绑定任何账号")

    try:
        return await identity_service.authenticate_identity(
            db,
            provider="wechat",
            namespace=namespace,
            subject=openid,
            allow_register=True,
        )
    except identity_service.IdentityUnavailableError as exc:
        raise ValueError(str(exc)) from exc


async def wechat_login(db: AsyncSession, code: str) -> tuple[str, int, User]:
    """Resolve a WeChat identity, then issue a user access token."""
    user, _identity = await resolve_wechat_identity(db, code)
    token, expires_at = await issue_user_token(user.id)
    return token, expires_at, user


async def get_user_response(db: AsyncSession, user: User) -> UserResponse:
    """Build app user payload with miniprogram permission metadata.

    AppUser login identities are managed independently. A miniprogram user receives
    admin-like metadata only through an explicit app_user_admin_bindings row.
    """
    identities = await identity_service.list_user_identities(db, user.id)
    email_identity = next(
        (
            identity
            for identity in identities
            if identity.provider == "email" and identity.namespace == "user"
        ),
        None,
    )
    identity_payload = [
        {
            "id": identity.id,
            "provider": identity.provider,
            "namespace": identity.namespace,
            "masked_subject": (
                f"{identity.subject[:2]}***@{identity.subject.split('@', 1)[1]}"
                if identity.provider == "email" and "@" in identity.subject
                else identity.subject
                if identity.provider == "password"
                else f"{identity.provider}:***"
            ),
            "verified": identity.verified_at is not None,
        }
        for identity in identities
    ]

    if settings.APP_ENV.lower() in {
        "development",
        "local",
        "test",
    } and str(user.openid or "").startswith("dev_"):
        return UserResponse(
            id=user.id,
            nickname=user.nickname,
            avatar_url=user.avatar_url,
            profile_completed=bool(user.nickname and user.nickname.strip()),
            email=email_identity.subject if email_identity else None,
            email_verified=bool(email_identity and email_identity.verified_at),
            identities=identity_payload,
            is_admin=True,
            role="super_admin",
            role_name="super_admin",
            permissions=["*"],
        )

    role_name = "user"
    permissions: list[str] = []

    admin_result = await db.execute(
        select(AdminUser, Role)
        .join(AppUserAdminBinding, AppUserAdminBinding.admin_user_id == AdminUser.id)
        .join(Role, Role.id == AdminUser.role_id)
        .where(AppUserAdminBinding.user_id == user.id)
        .where(AdminUser.is_active.is_(True))
        .order_by(AppUserAdminBinding.id.desc())
    )
    admin_row = admin_result.first()
    if admin_row:
        _, role = admin_row
        role_name = role.name
        permission_result = await db.execute(
            select(Permission.name)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == role.id)
            .order_by(Permission.name.asc())
        )
        permissions = list(permission_result.scalars().all())

    is_admin = role_name in {"admin", "super_admin"} or "import:write" in permissions
    return UserResponse(
        id=user.id,
        nickname=user.nickname,
        avatar_url=user.avatar_url,
        profile_completed=bool(user.nickname and user.nickname.strip()),
        email=email_identity.subject if email_identity else None,
        email_verified=bool(email_identity and email_identity.verified_at),
        identities=identity_payload,
        is_admin=is_admin,
        role=role_name,
        role_name=role_name,
        permissions=permissions,
    )


async def update_user(
    db: AsyncSession, user_id: int, nickname: str | None
) -> User | None:
    user = await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not user or user.deleted_at is not None:
        return None
    if nickname is not None:
        user.nickname = " ".join(nickname.strip().split())
    await db.commit()
    await db.refresh(user)
    return user


def _normalize_avatar_bytes(data: bytes) -> bytes:
    """Decode and normalize a user supplied avatar into a bounded JPEG."""
    try:
        return _decode_avatar(data)
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        SyntaxError,
        EOFError,
        struct.error,
        ZeroDivisionError,
    ) as exc:
        raise ValueError("头像文件不是有效图片") from exc


def _decode_avatar(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as source:
        width, height = source.size
        if (
            width <= 0
            or height <= 0
            or width > MAX_AVATAR_DIMENSION
            or height > MAX_AVATAR_DIMENSION
            or width * height > MAX_AVATAR_PIXELS
        ):
            raise ValueError("头像图片尺寸超出限制")
        source.load()
        image = ImageOps.exif_transpose(source)
        # chooseAvatar normally returns a square crop.  ImageOps.fit also
        # gives us a stable square result for camera/gallery edge cases.
        image = ImageOps.fit(
            image.convert("RGB"),
            (AVATAR_SIZE, AVATAR_SIZE),
            method=Image.Resampling.LANCZOS,
        )
        output = io.BytesIO()
        image.save(
            output,
            format="JPEG",
            quality=AVATAR_JPEG_QUALITY,
            optimize=True,
        )
        return output.getvalue()


async def replace_user_avatar(db: AsyncSession, user: User, data: bytes) -> User:
    """Persist a normalized avatar and replace the user's previous avatar."""
    normalized = await asyncio.to_thread(_normalize_avatar_bytes, data)
    storage = get_user_avatar_storage()
    key = f"{user.id}/{uuid.uuid4().hex}.jpg"
    try:
        new_url = await storage.upload(key, normalized)
    except Exception as exc:
        raise RuntimeError("avatar storage upload failed") from exc
    try:
        current = await db.scalar(
            select(User)
            .where(User.id == user.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if current is None or current.deleted_at is not None:
            raise RuntimeError("account is unavailable")
        previous_url = current.avatar_url
        current.avatar_url = new_url
        await db.commit()
        await db.refresh(current)
    except Exception:
        await db.rollback()
        try:
            await storage.delete(new_url)
        except Exception:
            pass
        raise

    # The new avatar is already durable at this point.  Deletion is best-effort
    # so a transient storage error never rolls the user's profile back.
    if previous_url and previous_url != new_url:
        await delete_user_avatar_file(previous_url, storage=storage)

    return current


async def delete_user_avatar_file(avatar_url: str | None, *, storage=None) -> None:
    """Best-effort removal of a persisted profile avatar.

    Avatars created before the dedicated namespace fix live below
    ``/static/formulas/avatars``.  Detect those URLs and use a legacy-scoped
    backend so replacing an old avatar also removes the old object instead of
    leaving it orphaned.
    """
    if not avatar_url:
        return
    normalized_url = str(avatar_url).replace("\\", "/")
    legacy_marker = f"/{LEGACY_USER_AVATAR_PREFIX.strip('/')}/"
    if legacy_marker in normalized_url or normalized_url.startswith(
        LEGACY_USER_AVATAR_PREFIX + "/"
    ):
        backend = get_legacy_user_avatar_storage()
    else:
        backend = storage or get_user_avatar_storage()
    try:
        await backend.delete(avatar_url)
    except Exception:
        # Profile/account updates must not fail only because old media cleanup
        # encountered a transient storage error.
        pass
