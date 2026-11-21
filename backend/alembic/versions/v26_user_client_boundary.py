"""Track ordinary-user registration source and authenticated client activity.

Revision ID: v26_user_client_boundary
Revises: v25_user_password_auth
"""

import sqlalchemy as sa

from alembic import op

revision = "v26_user_client_boundary"
down_revision = "v25_user_password_auth"
branch_labels = None
depends_on = None

_OLD_PERMISSION_DESCRIPTIONS = {
    "app-user:read": "查看小程序用户",
    "app-user:write": "编辑小程序用户",
    "app-user:ban": "封禁或解封小程序用户",
}
_NEW_PERMISSION_DESCRIPTIONS = {
    "app-user:read": "查看普通用户",
    "app-user:write": "编辑普通用户",
    "app-user:ban": "封禁或解封普通用户",
}


def _update_permission_descriptions(descriptions: dict[str, str]) -> None:
    for name, description in descriptions.items():
        op.execute(
            sa.text(
                "UPDATE permissions SET description = :description WHERE name = :name"
            ).bindparams(name=name, description=description)
        )


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("registration_source", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("last_active_client", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("last_active_at", sa.DateTime(), nullable=True),
    )
    with op.batch_alter_table("users") as batch_op:
        batch_op.create_check_constraint(
            "ck_users_registration_source",
            "registration_source IS NULL OR registration_source IN ('web', 'miniprogram')",
        )
        batch_op.create_check_constraint(
            "ck_users_last_active_client",
            "last_active_client IS NULL OR last_active_client IN ('web', 'miniprogram')",
        )
        batch_op.create_check_constraint(
            "ck_users_last_active_pair",
            "(last_active_client IS NULL AND last_active_at IS NULL) "
            "OR (last_active_client IS NOT NULL AND last_active_at IS NOT NULL)",
        )
    _update_permission_descriptions(_NEW_PERMISSION_DESCRIPTIONS)


def downgrade() -> None:
    _update_permission_descriptions(_OLD_PERMISSION_DESCRIPTIONS)
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint("ck_users_last_active_pair", type_="check")
        batch_op.drop_constraint("ck_users_last_active_client", type_="check")
        batch_op.drop_constraint("ck_users_registration_source", type_="check")
    op.drop_column("users", "last_active_at")
    op.drop_column("users", "last_active_client")
    op.drop_column("users", "registration_source")
