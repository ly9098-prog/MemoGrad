"""Shared authentication for the small ordinary-user read surface.

Admin and ordinary-user tokens remain separate identity domains.  This module
does not create an Admin account, grant an Admin role, or broaden an ordinary
user's API scope: it validates both token kinds independently and only permits
ordinary users on an explicit method/path whitelist.
"""

import re
from typing import Literal

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_security import (
    AdminPrincipal,
    _get_permission_names,
    resolve_admin_token,
)
from app.core.database import get_db
from app.core.runtime_paths import API_ADMIN_V1_PREFIX
from app.core.security import authenticate_user_token
from app.models.user import User

admin_or_user_security = HTTPBearer(auto_error=False)

_PREFIX = re.escape(API_ADMIN_V1_PREFIX)
_USER_READ_ENDPOINTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(rf"^{_PREFIX}/questions$"), "question:read"),
    (re.compile(rf"^{_PREFIX}/questions/subject-options$"), "question:read"),
    (re.compile(rf"^{_PREFIX}/questions/[1-9][0-9]*$"), "question:read"),
    (re.compile(rf"^{_PREFIX}/knowledge/subjects$"), "knowledge:read"),
    (re.compile(rf"^{_PREFIX}/knowledge/graph$"), "knowledge:read"),
)


def _user_read_permission(path: str, method: str) -> str | None:
    if method.upper() != "GET":
        return None
    for pattern, permission in _USER_READ_ENDPOINTS:
        if pattern.fullmatch(path):
            return permission
    return None


class ReadAccessPrincipal:
    def __init__(
        self,
        *,
        identity_kind: Literal["admin", "user"],
        admin: AdminPrincipal | None = None,
        user: User | None = None,
    ) -> None:
        self.identity_kind = identity_kind
        self.admin = admin
        self.user = user

    @property
    def is_admin(self) -> bool:
        return self.identity_kind == "admin"

    @property
    def subject_id(self) -> int:
        principal = self.admin.user if self.admin is not None else self.user
        if principal is None:
            raise RuntimeError("read principal missing identity")
        return int(principal.id)

    @property
    def display_name(self) -> str:
        if self.admin is not None:
            return (
                self.admin.user.display_name
                or self.admin.user.username
                or f"管理员 #{self.admin.user.id}"
            )
        if self.user is not None:
            nickname = (self.user.nickname or "").strip()
            return nickname or f"用户 #{self.user.id}"
        return "用户"


def require_admin_or_public_reader(permission_name: str):
    """Allow an Admin with RBAC permission or a user on a whitelisted GET path."""

    async def dependency(
        request: Request,
        credentials: HTTPAuthorizationCredentials | None = Depends(
            admin_or_user_security
        ),
        db: AsyncSession = Depends(get_db),
    ) -> ReadAccessPrincipal:
        if credentials is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authenticated",
            )

        try:
            admin = await resolve_admin_token(
                credentials.credentials,
                db,
                allow_restricted=False,
            )
        except HTTPException as admin_error:
            if admin_error.status_code != status.HTTP_401_UNAUTHORIZED:
                raise
        else:
            granted = await _get_permission_names(db, admin.role_id)
            if permission_name not in granted:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission denied",
                )
            return ReadAccessPrincipal(identity_kind="admin", admin=admin)

        try:
            user, _payload = await authenticate_user_token(
                credentials.credentials,
                db,
            )
        except HTTPException as user_error:
            if user_error.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                raise
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired token",
            ) from user_error

        allowed_permission = _user_read_permission(
            request.url.path,
            request.method,
        )
        if allowed_permission is None or allowed_permission != permission_name:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permission denied",
            )
        return ReadAccessPrincipal(identity_kind="user", user=user)

    return dependency


question_read_access = require_admin_or_public_reader("question:read")
knowledge_read_access = require_admin_or_public_reader("knowledge:read")
