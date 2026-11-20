"""Add user account-password credentials.

Revision ID: v25_user_password_auth
Revises: v24_multi_identity_auth
"""

import sqlalchemy as sa

from alembic import op

revision = "v25_user_password_auth"
down_revision = "v24_multi_identity_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_password_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "identity_id",
            sa.Integer(),
            sa.ForeignKey("user_auth_identities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("password_hash", sa.String(256), nullable=False),
        sa.Column(
            "password_changed_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "identity_id",
            name="uq_user_password_credentials_identity_id",
        ),
    )


def downgrade() -> None:
    op.drop_table("user_password_credentials")
