"""Outbox account ownership survives JSON storage and reversible migration."""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def migration(connection):
    path = Path(__file__).parents[2] / "alembic/versions/v21_task_outbox_owner.py"
    spec = importlib.util.spec_from_file_location("outbox_owner_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if connection is not None:
        module.op = Operations(MigrationContext.configure(connection))
    return module


def test_json_text_backfill_preserves_rows_and_downgrade_preserves_payloads():
    engine = sa.create_engine("sqlite:///:memory:")
    payloads = [
        ({"user_id": 11}, "import", 11),
        ({"owner_user_id": "12", "user_id": 11}, "import", 12),
        ({"created_by": "13"}, "import", 13),
        ({"created_by": "user:14"}, "import", 14),
        ({"created_by": "admin:11"}, "import", None),
        ({"user_id": True}, "import", None),
        ({"user_id": 1.5}, "import", None),
        ({"user_id": -1}, "import", None),
        ({"user_id": 2**63}, "import", None),
        ({"practice_record_id": 4}, "answer_projection", 15),
        ({"practice_record_id": 5}, "answer_projection", None),
        ({"practice_record_id": 4}, "import", None),
        ([], "import", None),
        (None, "import", None),
    ]
    try:
        with engine.begin() as connection:
            connection.execute(sa.text(
                "CREATE TABLE task_outbox (id INTEGER PRIMARY KEY, task_id TEXT, "
                "task_type TEXT, payload JSON NOT NULL)"
            ))
            connection.execute(sa.text(
                "CREATE TABLE practice_records (id INTEGER PRIMARY KEY, user_id INTEGER)"
            ))
            connection.execute(sa.text("INSERT INTO practice_records VALUES (4, 15)"))
            for index, (payload, task_type, _owner) in enumerate(payloads, 1):
                connection.execute(sa.text(
                    "INSERT INTO task_outbox VALUES (:id, :task_id, :task_type, :payload)"
                ), {
                    "id": index, "task_id": f"task-{index}",
                    "task_type": task_type, "payload": json.dumps(payload),
                })
            before = connection.execute(sa.text("SELECT * FROM task_outbox ORDER BY id")).all()
            module = migration(connection)
            module.upgrade()
            owners = connection.execute(sa.text(
                "SELECT owner_user_id FROM task_outbox ORDER BY id"
            )).scalars().all()
            assert owners == [owner for _payload, _task_type, owner in payloads]
            assert "ix_task_outbox_owner_user_id" in {
                item["name"] for item in sa.inspect(connection).get_indexes("task_outbox")
            }
            module.downgrade()
            assert connection.execute(sa.text(
                "SELECT * FROM task_outbox ORDER BY id"
            )).all() == before
            assert "owner_user_id" not in {
                item["name"] for item in sa.inspect(connection).get_columns("task_outbox")
            }
    finally:
        engine.dispose()


@pytest.mark.parametrize("payload", [
    {"user_id": 21}, {"created_by": "user:21"}, {"owner_user_id": "21"},
])
def test_native_json_mapping_uses_same_principal_rules(payload):
    assert migration(None)._payload_owner(payload) == 21
