from datetime import datetime

from pydantic import ConfigDict, Field, field_validator

from app.schemas.base import BaseModel

# bcrypt only consumes the first 72 bytes and the hasher rejects longer input.
# Validate on bytes (not characters) at the schema boundary so oversized
# credentials are rejected identically for existing and unknown usernames.
BCRYPT_MAX_BYTES = 72


def _bcrypt_bytes(value: str) -> str:
    if len(value.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError(f"密码长度不能超过 {BCRYPT_MAX_BYTES} 字节")
    return value


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("password")
    @classmethod
    def limit_password_bytes(cls, value: str) -> str:
        return _bcrypt_bytes(value)


class AdminChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("old_password")
    @classmethod
    def limit_old_password_bytes(cls, value: str) -> str:
        return _bcrypt_bytes(value)

    @field_validator("new_password")
    @classmethod
    def limit_new_password_bytes(cls, value: str) -> str:
        return _bcrypt_bytes(value)


class AdminRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    display_name: str
    description: str | None = None
    is_system: bool


class AdminUserResponse(BaseModel):
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
    created_at: datetime | None = None

    @field_validator("must_change_password", mode="before")
    @classmethod
    def default_first_login_flag(cls, value):
        return False if value is None else value


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: AdminUserResponse
    role: AdminRoleResponse
    permissions: list[str] = []


class AdminMeResponse(BaseModel):
    user: AdminUserResponse
    role: AdminRoleResponse
    permissions: list[str]


class AdminProfileUpdateRequest(BaseModel):
    """Self-service fields only. Email changes require the verified OTP flow."""

    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(max_length=64)

    @field_validator("display_name", mode="before")
    @classmethod
    def normalize_display_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class AdminEmailStartRequest(BaseModel):
    email: str = Field(min_length=3, max_length=128)


class AdminEmailLoginStartRequest(AdminEmailStartRequest):
    captcha_ticket: str = Field(min_length=32, max_length=64)


class AdminEmailRecoveryStartRequest(AdminEmailStartRequest):
    captcha_ticket: str = Field(min_length=32, max_length=64)


class AdminEmailActivationRequest(AdminEmailStartRequest):
    current_password: str = Field(min_length=1, max_length=128)
    captcha_ticket: str = Field(min_length=32, max_length=64)

    @field_validator("current_password")
    @classmethod
    def limit_current_password_bytes(cls, value: str) -> str:
        return _bcrypt_bytes(value)


class AdminEmailVerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")


class AdminRecoveryVerifyResponse(BaseModel):
    reset_token: str
    expires_in: int = 300


class AdminPasswordRecoveryRequest(BaseModel):
    reset_token: str = Field(min_length=32, max_length=256)
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def limit_new_password_bytes(cls, value: str) -> str:
        return _bcrypt_bytes(value)
