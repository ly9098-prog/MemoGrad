"""Bind asynchronous outbox tasks to the account whose erasure revokes them.

Revision ID: v21_task_outbox_owner
Revises: v20_batch_upload_idempotency
"""

import json

import sqlalchemy as sa

from alembic import op

revision = "v21_task_outbox_owner"
down_revision = "v20_batch_upload_idempotency"
branch_labels = None
depends_on = None


def _positive_id(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.removeprefix("user:")
        if not value.isascii() or not value.isdigit() or len(value) > 10:
            return None
        value = int(value)
    if isinstance(value, int) and 0 < value <= 2**31 - 1:
        return value
    return None


def _payload_owner(payload: dict) -> int | None:
    for key in ("owner_user_id", "user_id", "created_by"):
        owner = _positive_id(payload.get(key))
        if owner is not None:
            return owner
    return None


def upgrade() -> None:
    op.add_column(
        "task_outbox",
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            nullable=True,
            comment="App account whose deletion must revoke this task",
        ),
    )
    op.create_index(
        "ix_task_outbox_owner_user_id",
        "task_outbox",
        ["owner_user_id"],
        unique=False,
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, task_id, task_type, payload FROM task_outbox "
            "WHERE owner_user_id IS NULL"
        )
    ).mappings().all()
    for row in rows:
        payload = row["payload"]
        if isinstance(payload, (str, bytes, bytearray)):
            try:
                payload = json.loads(payload)
            except (ValueError, UnicodeError):
                continue
        if not isinstance(payload, dict):
            continue
        owner = _payload_owner(payload)
        if row["task_type"] == "answer_projection" and owner is None:
            record_id = _positive_id(payload.get("practice_record_id"))
            if record_id is not None:
                owner = _positive_id(
                    bind.execute(
                        sa.text(
                            "SELECT user_id FROM practice_records WHERE id = :record_id"
                        ),
                        {"record_id": record_id},
                    ).scalar()
                )
        if owner is None:
            continue
        bind.execute(
            sa.text(
                "UPDATE task_outbox SET owner_user_id = :owner_user_id "
                "WHERE id = :outbox_id"
            ),
            {"owner_user_id": owner, "outbox_id": row["id"]},
        )


def downgrade() -> None:
    op.drop_index("ix_task_outbox_owner_user_id", table_name="task_outbox")
    op.drop_column("task_outbox", "owner_user_id")
