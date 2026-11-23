"""Admin API contracts for ordinary-user AI quotas."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from app.models.user_ai_policy import POLICY_FIELD_MAX, POLICY_FIELDS
from app.schemas.base import BaseModel

PolicyReason = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=2, max_length=256),
]


class UserAIPolicyValues(BaseModel):
    regeneration_cooldown_seconds: int = Field(
        ge=-1, le=POLICY_FIELD_MAX["regeneration_cooldown_seconds"]
    )
    regeneration_question_24h_limit: int = Field(
        ge=-1, le=POLICY_FIELD_MAX["regeneration_question_24h_limit"]
    )
    regeneration_account_24h_limit: int = Field(
        ge=-1, le=POLICY_FIELD_MAX["regeneration_account_24h_limit"]
    )
    daily_token_limit: int = Field(
        ge=-1, le=POLICY_FIELD_MAX["daily_token_limit"]
    )
    monthly_token_limit: int = Field(
        ge=-1, le=POLICY_FIELD_MAX["monthly_token_limit"]
    )
    rpm_limit: int = Field(ge=-1, le=POLICY_FIELD_MAX["rpm_limit"])

    @model_validator(mode="after")
    def reject_zero(self):
        for name in POLICY_FIELDS:
            if getattr(self, name) == 0:
                raise ValueError(f"{name} 必须大于 0，或使用 -1 表示不限")
        return self


class UserAIPolicyOverrides(BaseModel):
    regeneration_cooldown_seconds: int | None = Field(
        default=None, ge=-1, le=POLICY_FIELD_MAX["regeneration_cooldown_seconds"]
    )
    regeneration_question_24h_limit: int | None = Field(
        default=None, ge=-1, le=POLICY_FIELD_MAX["regeneration_question_24h_limit"]
    )
    regeneration_account_24h_limit: int | None = Field(
        default=None, ge=-1, le=POLICY_FIELD_MAX["regeneration_account_24h_limit"]
    )
    daily_token_limit: int | None = Field(
        default=None, ge=-1, le=POLICY_FIELD_MAX["daily_token_limit"]
    )
    monthly_token_limit: int | None = Field(
        default=None, ge=-1, le=POLICY_FIELD_MAX["monthly_token_limit"]
    )
    rpm_limit: int | None = Field(
        default=None, ge=-1, le=POLICY_FIELD_MAX["rpm_limit"]
    )

    @model_validator(mode="after")
    def reject_zero(self):
        for name in POLICY_FIELDS:
            if getattr(self, name) == 0:
                raise ValueError(f"{name} 必须大于 0，使用 -1 表示不限，或使用 null 继承默认")
        return self


class UserAIPolicyEffectiveValues(UserAIPolicyValues):
    pass


class UserAIPolicySources(BaseModel):
    regeneration_cooldown_seconds: Literal["default", "user"] = "default"
    regeneration_question_24h_limit: Literal["default", "user"] = "default"
    regeneration_account_24h_limit: Literal["default", "user"] = "default"
    daily_token_limit: Literal["default", "user"] = "default"
    monthly_token_limit: Literal["default", "user"] = "default"
    rpm_limit: Literal["default", "user"] = "default"


class AdminUserAIPolicyDefaultResponse(BaseModel):
    scope: Literal["default"] = "default"
    version: int
    values: UserAIPolicyValues
    updated_by: int | None = None
    updated_at: datetime | None = None


class AdminUserAIPolicyDefaultUpdateRequest(BaseModel):
    version: int = Field(ge=0)
    values: UserAIPolicyValues
    reason: PolicyReason


class AdminUserAIPolicyDetailResponse(BaseModel):
    scope: Literal["user"] = "user"
    user_id: int
    version: int
    defaults: UserAIPolicyValues
    overrides: dict[str, int | None]
    effective: UserAIPolicyEffectiveValues
    sources: UserAIPolicySources
    unlimited: bool
    updated_by: int | None = None
    updated_at: datetime | None = None


class AdminUserAIPolicyUpdateRequest(BaseModel):
    version: int = Field(ge=0)
    values: UserAIPolicyOverrides
    reason: PolicyReason


class AdminUserAIPolicyUnlimitedRequest(BaseModel):
    version: int = Field(ge=0)
    reason: PolicyReason


class AdminUserAIPolicyResetRequest(BaseModel):
    version: int = Field(ge=0)
    reason: PolicyReason
