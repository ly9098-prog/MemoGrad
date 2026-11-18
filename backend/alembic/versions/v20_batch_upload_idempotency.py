"""Enforce concurrent batch-upload request ownership without rewriting history.

Revision ID: v20_batch_upload_idempotency
Revises: v19_pomodoro_subject_allocations
"""

import sqlalchemy as sa

from alembic import op

revision = "v20_batch_upload_idempotency"
down_revision = "v19_pomodoro_subject_allocations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    duplicates = connection.execute(
        sa.text(
            "SELECT 1 FROM import_batch_jobs WHERE request_id IS NOT NULL "
            "GROUP BY request_id HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicates:
        raise RuntimeError(
            "Duplicate import_batch_jobs.request_id values exist. "
            "Reconcile historical request identities before retrying this migration; "
            "no jobs have been deleted or rewritten."
        )
    op.add_column(
        "import_batch_jobs",
        sa.Column("submission_fingerprint", sa.String(64), nullable=True),
    )
    op.create_index(
        "uq_import_batch_jobs_request_id",
        "import_batch_jobs",
        ["request_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_import_batch_jobs_request_id", table_name="import_batch_jobs")
    op.drop_column("import_batch_jobs", "submission_fingerprint")
