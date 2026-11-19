"""Add multi-provider user identities and verified admin email state.

Revision ID: v24_multi_identity_auth
Revises: v23_database_consistency

Existing users keep their numeric IDs and all learning records. Real legacy
WeChat openids become identity rows; lifecycle placeholders do not.
"""

import sqlalchemy as sa

from alembic import op
from app.core.config import settings
from app.core.email_address import normalize_email

revision = "v24_multi_identity_auth"
down_revision = "v23_database_consistency"
branch_labels = None
depends_on = None

_LIFECYCLE_PREFIXES = ("erasing:", "erased:", "anonymized:")


def _assert_admin_email_uniqueness() -> None:
    emails = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT email FROM admin_users WHERE email IS NOT NULL AND trim(email) <> ''"
            )
        )
        .scalars()
    )
    normalized = set()
    for email in emails:
        try:
            value = normalize_email(email)
        except ValueError:
            continue  # Invalid legacy profile data cannot become a login identity.
        if value in normalized:
            raise RuntimeError(
                "Resolve duplicate normalized admin emails before migrating"
            )
        normalized.add(value)


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.alter_column("openid", existing_type=sa.String(64), nullable=True)
        batch.add_column(
            sa.Column(
                "lifecycle_status",
                sa.String(16),
                nullable=False,
                server_default="active",
            )
        )
        batch.create_index("ix_users_lifecycle_status", ["lifecycle_status"])

    op.create_table(
        "user_auth_identities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("namespace", sa.String(96), nullable=False),
        sa.Column("subject", sa.String(256), nullable=False),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("last_authenticated_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "provider",
            "namespace",
            "subject",
            name="uq_user_auth_identities_provider_namespace_subject",
        ),
        sa.UniqueConstraint(
            "user_id",
            "provider",
            "namespace",
            name="uq_user_auth_identities_user_provider_namespace",
        ),
    )
    op.create_index(
        "ix_user_auth_identities_user_id", "user_auth_identities", ["user_id"]
    )
    op.create_index(
        "ix_user_auth_identities_provider", "user_auth_identities", ["provider"]
    )

    op.create_table(
        "user_identity_tombstones",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("namespace", sa.String(96), nullable=False),
        sa.Column("subject_digest", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "provider",
            "namespace",
            "subject_digest",
            name="uq_user_identity_tombstones_provider_namespace_subject",
        ),
    )

    op.create_table(
        "user_consent_acceptances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("document_type", sa.String(32), nullable=False),
        sa.Column("document_version", sa.String(32), nullable=False),
        sa.Column(
            "accepted_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "user_id",
            "document_type",
            "document_version",
            name="uq_user_consent_acceptances_user_document_version",
        ),
    )
    op.create_index(
        "ix_user_consent_acceptances_user_id", "user_consent_acceptances", ["user_id"]
    )

    op.execute(
        sa.text(
            "INSERT INTO user_auth_identities "
            "(user_id, provider, namespace, subject, verified_at) "
            "SELECT id, 'wechat', :namespace, openid, created_at FROM users "
            "WHERE openid IS NOT NULL "
            "AND openid NOT LIKE 'erasing:%' "
            "AND openid NOT LIKE 'erased:%' "
            "AND openid NOT LIKE 'anonymized:%' "
            "AND openid NOT LIKE 'dev_%'"
        ).bindparams(namespace=(settings.WECHAT_APP_ID or "default").strip())
    )
    op.execute(
        sa.text(
            "UPDATE users SET lifecycle_status = CASE "
            "WHEN openid LIKE 'erasing:%' THEN 'erasing' "
            "WHEN openid LIKE 'erased:%' THEN 'erased' "
            "WHEN openid LIKE 'anonymized:%' THEN 'anonymized' "
            "ELSE 'active' END"
        )
    )

    _assert_admin_email_uniqueness()
    with op.batch_alter_table("admin_users") as batch:
        batch.add_column(sa.Column("email_normalized", sa.String(128), nullable=True))
        batch.add_column(sa.Column("email_verified_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column(
                "must_change_password",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
    for row in (
        op.get_bind().execute(sa.text("SELECT id, email FROM admin_users")).all()
    ):
        try:
            normalized = normalize_email(row.email)
        except ValueError:
            continue
        op.get_bind().execute(
            sa.text("UPDATE admin_users SET email_normalized = :email WHERE id = :id"),
            {"email": normalized, "id": row.id},
        )
    op.create_index(
        "ix_admin_users_email_normalized",
        "admin_users",
        ["email_normalized"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_admin_users_email_normalized", table_name="admin_users")
    with op.batch_alter_table("admin_users") as batch:
        batch.drop_column("must_change_password")
        batch.drop_column("email_verified_at")
        batch.drop_column("email_normalized")

    op.drop_index(
        "ix_user_consent_acceptances_user_id",
        table_name="user_consent_acceptances",
    )
    op.drop_table("user_consent_acceptances")
    op.drop_table("user_identity_tombstones")
    op.drop_index("ix_user_auth_identities_provider", table_name="user_auth_identities")
    op.drop_index("ix_user_auth_identities_user_id", table_name="user_auth_identities")
    op.drop_table("user_auth_identities")

    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_lifecycle_status")
        batch.drop_column("lifecycle_status")
        # Downgrade cannot synthesize one openid for email/GitHub-only users.
        batch.alter_column("openid", existing_type=sa.String(64), nullable=True)
