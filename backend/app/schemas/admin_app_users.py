from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field

from app.schemas.base import BaseModel


class AdminAppUserIdentitySummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: str
    masked_subject: str
    verified: bool
    created_at: datetime | None = None


class AdminAppUserListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    openid: str | None = None
    nickname: str | None = None
    avatar_url: str | None = None
    is_banned: bool
    banned_reason: str | None = None
    banned_at: datetime | None = None
    banned_by: int | None = None
    created_at: datetime
    registration_source: Literal["web", "miniprogram"] | None = None
    last_active_client: Literal["web", "miniprogram"] | None = None
    last_active_at: datetime | None = None
    user_type: Literal["web", "miniprogram", "both", "unknown"] = "unknown"
    identities: list[AdminAppUserIdentitySummary] = Field(default_factory=list)
    updated_at: datetime
    lifecycle_status: str = "active"


class AdminAppUserDetail(AdminAppUserListItem):
    practice_count: int
    wrong_count: int
    recent_active_at: datetime | None = None
    login_identities: list[AdminAppUserIdentitySummary] = Field(default_factory=list)


class AdminAppUserUpdateRequest(BaseModel):
    nickname: str | None = Field(default=None, max_length=64)


class AdminAppUserBindAdminRequest(BaseModel):
    admin_user_id: int


class AdminAppUserBindAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    admin_user_id: int
    created_by: int | None = None
    created_at: datetime


class AdminAppUserBanRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=256)
