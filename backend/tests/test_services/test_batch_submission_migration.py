"""The idempotency migration preserves historical jobs and rejects ambiguity."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def migration(connection):
    path = (
        Path(__file__).parents[2] / "alembic/versions/v20_batch_upload_idempotency.py"
    )
    spec = importlib.util.spec_from_file_location("batch_migration_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.op = Operations(MigrationContext.configure(connection))
    return module


def old_table(connection):
    metadata = sa.MetaData()
    table = sa.Table(
        "import_batch_jobs",
        metadata,
        sa.Column("job_id", sa.String(64), primary_key=True),
        sa.Column("request_id", sa.String(64), nullable=True),
    )
    metadata.create_all(connection)
    return table


def test_migration_enforces_key_uniqueness_and_preserves_unkeyed_jobs(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    try:
        with engine.begin() as connection:
            table = old_table(connection)
            connection.execute(
                table.insert(),
                [
                    {"job_id": "old-keyed", "request_id": "old-key"},
                    {"job_id": "old-unkeyed", "request_id": None},
                ],
            )
            module = migration(connection)
            module.upgrade()
            assert (
                connection.scalar(sa.text("SELECT COUNT(*) FROM import_batch_jobs"))
                == 2
            )
            connection.execute(
                table.insert(), {"job_id": "new-unkeyed", "request_id": None}
            )
            with connection.begin_nested():
                with pytest.raises(sa.exc.IntegrityError):
                    connection.execute(
                        table.insert(), {"job_id": "dup", "request_id": "old-key"}
                    )
            module.downgrade()
            assert "submission_fingerprint" not in {
                column["name"]
                for column in sa.inspect(connection).get_columns("import_batch_jobs")
            }
    finally:
        engine.dispose()


def test_historical_duplicates_stop_before_any_schema_or_data_change(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'duplicates.db'}")
    try:
        with engine.begin() as connection:
            table = old_table(connection)
            connection.execute(
                table.insert(),
                [
                    {"job_id": "old-a", "request_id": "same-key"},
                    {"job_id": "old-b", "request_id": "same-key"},
                ],
            )
            with pytest.raises(RuntimeError, match="Reconcile historical"):
                migration(connection).upgrade()
            assert (
                connection.scalar(sa.text("SELECT COUNT(*) FROM import_batch_jobs"))
                == 2
            )
            assert "submission_fingerprint" not in {
                column["name"]
                for column in sa.inspect(connection).get_columns("import_batch_jobs")
            }
    finally:
        engine.dispose()
