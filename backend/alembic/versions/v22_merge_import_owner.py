"""Join the independent request-index and outbox-owner repairs.

Revision ID: v22_merge_import_owner
Revises: v21_import_request_index, v21_task_outbox_owner

Both parents retain their recorded history. A database at either parent must
apply the other repair before reaching the shared head.
"""

revision = "v22_merge_import_owner"
down_revision = ("v21_import_request_index", "v21_task_outbox_owner")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
