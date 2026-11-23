"""Database-backed AI quota policy for ordinary users."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.orm_base import Base

POLICY_FIELDS = (
    "regeneration_cooldown_seconds",
    "regeneration_question_24h_limit",
    "regeneration_account_24h_limit",
    "daily_token_limit",
    "monthly_token_limit",
    "rpm_limit",
)

POLICY_FIELD_MAX = {
    "regeneration_cooldown_seconds": 86_400,
    "regeneration_question_24h_limit": 1_000,
    "regeneration_account_24h_limit": 1_000,
    "daily_token_limit": 2_147_483_647,
    "monthly_token_limit": 2_147_483_647,
    "rpm_limit": 100_000,
}


class UserAIPolicyDefault(Base):
    __tablename__ = "user_ai_policy_defaults"
    __table_args__ = tuple(
        CheckConstraint(
            f"{field} = -1 OR ({field} > 0 AND {field} <= {POLICY_FIELD_MAX[field]})",
            name=f"ck_user_ai_policy_defaults_{field}",
        )
        for field in POLICY_FIELDS
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    regeneration_cooldown_seconds: Mapped[int] = mapped_column(
        Integer, nullable=False
    )
    regeneration_question_24h_limit: Mapped[int] = mapped_column(
        Integer, nullable=False
    )
    regeneration_account_24h_limit: Mapped[int] = mapped_column(
        Integer, nullable=False
    )
    daily_token_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    monthly_token_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    rpm_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class UserAIPolicyOverride(Base):
    __tablename__ = "user_ai_policy_overrides"
    __table_args__ = tuple(
        CheckConstraint(
            f"{field} IS NULL OR {field} = -1 OR "
            f"({field} > 0 AND {field} <= {POLICY_FIELD_MAX[field]})",
            name=f"ck_user_ai_policy_overrides_{field}",
        )
        for field in POLICY_FIELDS
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    regeneration_cooldown_seconds: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    regeneration_question_24h_limit: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    regeneration_account_24h_limit: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    daily_token_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_token_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("admin_users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
