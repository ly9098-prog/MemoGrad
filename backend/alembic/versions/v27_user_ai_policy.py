"""Add ordinary-user AI quota defaults and per-user overrides.

Revision ID: v27_user_ai_policy
Revises: v26_user_client_boundary
"""

import os

import sqlalchemy as sa

from alembic import op

revision = "v27_user_ai_policy"
down_revision = "v26_user_client_boundary"
branch_labels = None
depends_on = None

_FIELDS = (
    "regeneration_cooldown_seconds",
    "regeneration_question_24h_limit",
    "regeneration_account_24h_limit",
    "daily_token_limit",
    "monthly_token_limit",
    "rpm_limit",
)
_FIELD_MAX = {
    "regeneration_cooldown_seconds": 86_400,
    "regeneration_question_24h_limit": 1_000,
    "regeneration_account_24h_limit": 1_000,
    "daily_token_limit": 2_147_483_647,
    "monthly_token_limit": 2_147_483_647,
    "rpm_limit": 100_000,
}
_FIELD_ENV = {
    "daily_token_limit": "AI_DAILY_TOKEN_LIMIT",
    "monthly_token_limit": "AI_MONTHLY_TOKEN_LIMIT",
    "rpm_limit": "AI_USER_RPM_LIMIT",
}


def _positive_or_unlimited(name: str) -> str:
    return f"{name} = -1 OR ({name} > 0 AND {name} <= {_FIELD_MAX[name]})"


def _nullable_positive_or_unlimited(name: str) -> str:
    return (
        f"{name} IS NULL OR {name} = -1 OR "
        f"({name} > 0 AND {name} <= {_FIELD_MAX[name]})"
    )


def _normalized_env(name: str, default: int) -> int:
    value = int(os.getenv(_FIELD_ENV[name], str(default)))
    return -1 if value <= 0 else min(value, _FIELD_MAX[name])


def upgrade() -> None:
    op.create_table(
        "user_ai_policy_defaults",
        sa.Column("id", sa.Integer(), primary_key=True),
        *[
            sa.Column(name, sa.Integer(), nullable=False)
            for name in _FIELDS
        ],
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "updated_by",
            sa.Integer(),
            sa.ForeignKey("admin_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        *[
            sa.CheckConstraint(
                _positive_or_unlimited(name),
                name=f"ck_user_ai_policy_defaults_{name}",
            )
            for name in _FIELDS
        ],
    )
    op.create_table(
        "user_ai_policy_overrides",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        *[
            sa.Column(name, sa.Integer(), nullable=True)
            for name in _FIELDS
        ],
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "updated_by",
            sa.Integer(),
            sa.ForeignKey("admin_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        *[
            sa.CheckConstraint(
                _nullable_positive_or_unlimited(name),
                name=f"ck_user_ai_policy_overrides_{name}",
            )
            for name in _FIELDS
        ],
    )
    defaults = sa.table(
        "user_ai_policy_defaults",
        sa.column("id", sa.Integer()),
        *(sa.column(name, sa.Integer()) for name in _FIELDS),
        sa.column("version", sa.Integer()),
    )
    op.bulk_insert(
        defaults,
        [
            {
                "id": 1,
                "regeneration_cooldown_seconds": 60,
                "regeneration_question_24h_limit": 3,
                "regeneration_account_24h_limit": 20,
                "daily_token_limit": _normalized_env(
                    "daily_token_limit", 50_000
                ),
                "monthly_token_limit": _normalized_env(
                    "monthly_token_limit", 500_000
                ),
                "rpm_limit": _normalized_env("rpm_limit", 12),
                "version": 1,
            }
        ],
    )


def downgrade() -> None:
    op.drop_table("user_ai_policy_overrides")
    op.drop_table("user_ai_policy_defaults")
