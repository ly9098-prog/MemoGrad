from pydantic import Field, field_validator

from app.schemas.base import BaseModel


class WechatLogin(BaseModel):
    code: str = Field(min_length=1, max_length=256)
    client: str = Field(default="miniprogram", pattern="^(web|miniprogram)$")
    accepted_terms: bool = False
    agreement_version: str | None = Field(default=None, max_length=32)
    privacy_version: str | None = Field(default=None, max_length=32)


class UserIdentityResponse(BaseModel):
    id: int
    provider: str
    namespace: str
    masked_subject: str
    verified: bool


class UserResponse(BaseModel):
    id: int
    nickname: str | None = None
    avatar_url: str | None = None
    profile_completed: bool = False
    email: str | None = None
    email_verified: bool = False
    identities: list[UserIdentityResponse] = Field(default_factory=list)
    is_admin: bool = False
    role: str = "user"
    role_name: str = "user"
    permissions: list[str] = Field(default_factory=list)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: int  # Unix timestamp
    refresh_token: str
    user: UserResponse


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=512)


class UserUpdate(BaseModel):
    nickname: str | None = Field(default=None, max_length=64)

    @field_validator("nickname")
    @classmethod
    def normalize_nickname(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("昵称不能为空")
        return normalized


class DeletionResponse(BaseModel):
    message: str
    deleted_at: int  # Unix timestamp


class EmailOtpStartRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    captcha_ticket: str = Field(min_length=32, max_length=64)
    client: str = Field(default="web", pattern="^web$")
    accepted_terms: bool = False
    agreement_version: str | None = Field(default=None, max_length=32)
    privacy_version: str | None = Field(default=None, max_length=32)


class EmailOtpVerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")
    client: str = Field(default="web", pattern="^web$")


class PasswordLoginRequest(BaseModel):
    account: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)
    client: str = Field(default="web", pattern="^web$")


class PasswordRegisterStartRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    captcha_ticket: str = Field(min_length=32, max_length=64)
    accepted_terms: bool = False
    agreement_version: str | None = Field(default=None, max_length=32)
    privacy_version: str | None = Field(default=None, max_length=32)


class PasswordRegisterVerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")
    client: str = Field(default="web", pattern="^web$")


class OtpStartResponse(BaseModel):
    challenge_id: str
    expires_in: int
    resend_after: int


class WebTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: int
    user: UserResponse


class IdentityEmailStartRequest(BaseModel):
    email: str | None = Field(default=None, max_length=254)


class IdentityEmailVerifyRequest(BaseModel):
    challenge_id: str = Field(min_length=32, max_length=64)
    code: str = Field(pattern=r"^\d{6}$")
    client: str = Field(default="web", pattern="^web$")


class ChangeEmailStartRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    step_up_token: str | None = Field(default=None, min_length=32, max_length=2048)
    challenge_id: str | None = Field(default=None, min_length=32, max_length=64)


class IdentityUnlinkRequest(BaseModel):
    step_up_token: str = Field(min_length=32, max_length=2048)


class GithubStartResponse(BaseModel):
    authorization_url: str
    state: str


class GithubLinkStartRequest(BaseModel):
    return_to: str = Field(default="/settings", max_length=512)


class GithubStartRequest(BaseModel):
    accepted_terms: bool = False
    agreement_version: str | None = Field(default=None, max_length=32)
    privacy_version: str | None = Field(default=None, max_length=32)
    return_to: str = Field(default="/", max_length=512)
