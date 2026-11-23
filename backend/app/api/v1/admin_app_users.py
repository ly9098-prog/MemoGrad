from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_security import require_permissions, require_roles
from app.core.database import get_db
from app.core.runtime_paths import API_ADMIN_V1_PREFIX
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.schemas.admin_app_users import (
    AdminAppUserBanRequest,
    AdminAppUserBindAdminRequest,
    AdminAppUserBindAdminResponse,
    AdminAppUserDetail,
    AdminAppUserIdentitySummary,
    AdminAppUserListItem,
    AdminAppUserUpdateRequest,
)
from app.schemas.common import PaginatedResponse, paginated_response
from app.schemas.user_ai_policy import (
    AdminUserAIPolicyBatchRequest,
    AdminUserAIPolicyDefaultResponse,
    AdminUserAIPolicyDefaultUpdateRequest,
    AdminUserAIPolicyDetailResponse,
    AdminUserAIPolicyResetRequest,
    AdminUserAIPolicyUnlimitedRequest,
    AdminUserAIPolicyUpdateRequest,
    UserAIPolicyValues,
)
from app.services.admin_app_user_service import (
    ban_app_user,
    bind_app_user_admin,
    get_app_user_detail,
    get_user_type,
    list_app_users,
    load_user_identities,
    load_user_identities_by_user,
    mask_identity_subject,
    unban_app_user,
    unbind_app_user_admin,
    update_app_user,
)
from app.services.user_ai_policy_service import (
    UserAIPolicyConflictError,
    batch_update_user_policies,
    get_default_policy,
    get_user_policy,
    reset_user_policy,
    runtime_default_values,
    set_user_policy_unlimited,
    update_default_policy,
    update_user_policy,
)

router = APIRouter(prefix=f"{API_ADMIN_V1_PREFIX}/app-users", tags=["admin-app-users"])


def _build_app_user_item(
    user: User, identities: list[UserAuthIdentity]
) -> AdminAppUserListItem:
    item = AdminAppUserListItem.model_validate(user)
    item.identities = [
        AdminAppUserIdentitySummary(
            provider=identity.provider,
            masked_subject=mask_identity_subject(identity),
            verified=identity.verified_at is not None,
            created_at=identity.created_at,
        )
        for identity in identities
    ]
    item.user_type = get_user_type(identities)
    return item


@router.get("", response_model=PaginatedResponse[AdminAppUserListItem])
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    keyword: str | None = None,
    user_type: str | None = Query(default=None, pattern="^(web|miniprogram|both)$"),
    is_banned: bool | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    _=Depends(require_permissions("app-user:read")),
    db: AsyncSession = Depends(get_db),
):
    users, total = await list_app_users(
        db, page, page_size, keyword, user_type, is_banned, created_from, created_to
    )
    identities_by_user = await load_user_identities_by_user(
        db, [user.id for user in users]
    )
    items = []
    for user in users:
        identities = identities_by_user.get(user.id, [])
        items.append(_build_app_user_item(user, identities))
    return paginated_response(items, total, page, page_size)


@router.get("/ai-policy", response_model=AdminUserAIPolicyDefaultResponse)
async def read_user_ai_policy_defaults(
    _=Depends(require_permissions("ai_setting:read")),
    __=Depends(require_roles("super_admin")),
    db: AsyncSession = Depends(get_db),
):
    return await get_default_policy(db)


@router.patch("/ai-policy", response_model=AdminUserAIPolicyDefaultResponse)
async def patch_user_ai_policy_defaults(
    data: AdminUserAIPolicyDefaultUpdateRequest,
    request: Request,
    current_admin=Depends(require_roles("super_admin")),
    _=Depends(require_permissions("ai_setting:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await update_default_policy(db, data, current_admin, request)
        await db.commit()
        return result
    except UserAIPolicyConflictError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get("/ai-policy/preset", response_model=UserAIPolicyValues)
async def read_user_ai_policy_preset(
    _=Depends(require_permissions("ai_setting:read")),
    __=Depends(require_roles("super_admin")),
):
    return runtime_default_values()


@router.patch("/ai-policy/batch", response_model=list[AdminUserAIPolicyDetailResponse])
async def patch_user_ai_policy_batch(
    data: AdminUserAIPolicyBatchRequest,
    request: Request,
    current_admin=Depends(require_roles("super_admin")),
    _=Depends(require_permissions("app-user:read", "ai_setting:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await batch_update_user_policies(db, data, current_admin, request)
        await db.commit()
        return result
    except UserAIPolicyConflictError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/{user_id}", response_model=AdminAppUserDetail)
async def get_user(
    user_id: int,
    _=Depends(require_permissions("app-user:read")),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_app_user_detail(db, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/{user_id}/ai-policy", response_model=AdminUserAIPolicyDetailResponse)
async def read_user_ai_policy(
    user_id: int,
    _=Depends(require_permissions("app-user:read")),
    __=Depends(require_permissions("ai_setting:read")),
    ___=Depends(require_roles("super_admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await get_user_policy(db, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.patch("/{user_id}/ai-policy", response_model=AdminUserAIPolicyDetailResponse)
async def patch_user_ai_policy(
    user_id: int,
    data: AdminUserAIPolicyUpdateRequest,
    request: Request,
    current_admin=Depends(require_roles("super_admin")),
    _=Depends(require_permissions("app-user:read")),
    __=Depends(require_permissions("ai_setting:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await update_user_policy(db, user_id, data, current_admin, request)
        await db.commit()
        return result
    except UserAIPolicyConflictError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.patch(
    "/{user_id}/ai-policy/unlimited",
    response_model=AdminUserAIPolicyDetailResponse,
)
async def patch_user_ai_policy_unlimited(
    user_id: int,
    data: AdminUserAIPolicyUnlimitedRequest,
    request: Request,
    current_admin=Depends(require_roles("super_admin")),
    _=Depends(require_permissions("app-user:read")),
    __=Depends(require_permissions("ai_setting:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await set_user_policy_unlimited(
            db, user_id, data, current_admin, request
        )
        await db.commit()
        return result
    except UserAIPolicyConflictError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.delete("/{user_id}/ai-policy", response_model=AdminUserAIPolicyDetailResponse)
async def delete_user_ai_policy(
    user_id: int,
    data: AdminUserAIPolicyResetRequest,
    request: Request,
    current_admin=Depends(require_roles("super_admin")),
    _=Depends(require_permissions("app-user:read")),
    __=Depends(require_permissions("ai_setting:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await reset_user_policy(db, user_id, data, current_admin, request)
        await db.commit()
        return result
    except UserAIPolicyConflictError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.patch("/{user_id}", response_model=AdminAppUserListItem)
async def patch_user(
    user_id: int,
    data: AdminAppUserUpdateRequest,
    request: Request,
    current_admin=Depends(require_permissions("app-user:write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await update_app_user(db, user_id, data, current_admin, request)
        await db.commit()
        await db.refresh(user)
        return _build_app_user_item(user, await load_user_identities(db, user.id))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/{user_id}/admin-binding", response_model=AdminAppUserBindAdminResponse)
async def bind_admin(
    user_id: int,
    data: AdminAppUserBindAdminRequest,
    request: Request,
    current_admin=Depends(require_roles("super_admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        binding = await bind_app_user_admin(
            db, user_id, data.admin_user_id, current_admin, request
        )
        await db.commit()
        await db.refresh(binding)
        return binding
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except PermissionError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.delete("/{user_id}/admin-binding")
async def unbind_admin(
    user_id: int,
    request: Request,
    current_admin=Depends(require_roles("super_admin")),
    db: AsyncSession = Depends(get_db),
):
    try:
        await unbind_app_user_admin(db, user_id, current_admin, request)
        await db.commit()
        return {"status": "ok"}
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except PermissionError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))


@router.post("/{user_id}/ban", response_model=AdminAppUserListItem)
async def ban_user(
    user_id: int,
    data: AdminAppUserBanRequest,
    request: Request,
    current_admin=Depends(require_permissions("app-user:ban")),
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await ban_app_user(db, user_id, data, current_admin, request)
        await db.commit()
        await db.refresh(user)
        return _build_app_user_item(user, await load_user_identities(db, user.id))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post("/{user_id}/unban", response_model=AdminAppUserListItem)
async def unban_user(
    user_id: int,
    request: Request,
    current_admin=Depends(require_permissions("app-user:ban")),
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await unban_app_user(db, user_id, current_admin, request)
        await db.commit()
        await db.refresh(user)
        return _build_app_user_item(user, await load_user_identities(db, user.id))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
