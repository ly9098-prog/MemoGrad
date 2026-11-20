from datetime import datetime

from pydantic import ConfigDict, Field, field_validator

from app.schemas.base import BaseModel


class AdminRoleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    display_name: str
    is_system: bool


class AdminUserListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str | None = None
    email: str | None = None
    email_verified: bool = False
    must_change_password: bool = False
    is_active: bool
    role_id: int
    last_login_at: datetime | None = None
    last_login_ip: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("must_change_password", mode="before")
    @classmethod
    def default_first_login_flag(cls, value):
        return False if value is None else value


class AdminUserDetail(AdminUserListItem):
    role: AdminRoleSummary


class AdminUserCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=12, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=128)
    role_id: int
    is_active: bool = True


class AdminUserPatchRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=64)
    email: str | None = Field(default=None, max_length=128)
    is_active: bool | None = None
    role_id: int | None = None


class AdminUserResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=12, max_length=128)
