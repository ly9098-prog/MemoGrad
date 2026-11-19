"""Forward/backward data preservation and preflight checks for v23."""

import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.ext.asyncio import create_async_engine

MIGRATION = (
    Path(__file__).resolve().parents[2] / "alembic/versions/v23_database_consistency.py"
)


def _migration(connection):
    spec = importlib.util.spec_from_file_location(
        "database_consistency_migration", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.op = Operations(MigrationContext.configure(connection))
    return module


def _seed(connection):
    for sql in (
        "CREATE TABLE subjects (id INTEGER PRIMARY KEY)",
        "CREATE TABLE questions (id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL "
        "REFERENCES subjects(id) ON DELETE SET NULL, content TEXT NOT NULL)",
        "CREATE TABLE question_imports (id INTEGER PRIMARY KEY, question_id BIGINT, "
        "status TEXT NOT NULL, raw_data TEXT NOT NULL)",
        "CREATE TABLE question_knowledge_points (id INTEGER PRIMARY KEY, question_id INTEGER "
        "REFERENCES questions(id) ON DELETE CASCADE, payload TEXT)",
        "CREATE TABLE answer_behaviors (id INTEGER PRIMARY KEY, practice_record_id INTEGER)",
        "CREATE TABLE recommendation_metrics_daily (id INTEGER PRIMARY KEY, date DATE NOT NULL, "
        "subject_id INTEGER NOT NULL, scene TEXT NOT NULL, strategy TEXT NOT NULL, variant_key TEXT, "
        "UNIQUE(date,subject_id,scene,strategy,variant_key))",
        "INSERT INTO subjects VALUES (1)",
        "INSERT INTO questions VALUES (1,1,'preserved')",
        "INSERT INTO question_imports VALUES (1,1,'published','valid source'), "
        "(2,2147483648,'published','orphan source')",
        "INSERT INTO question_knowledge_points VALUES (1,1,'preserved link')",
        "INSERT INTO answer_behaviors VALUES (1,42),(2,NULL),(3,NULL)",
        "INSERT INTO recommendation_metrics_daily VALUES "
        "(1,'2026-11-19',1,'practice','scored',NULL), (2,'2026-11-19',1,'practice','scored','A')",
    ):
        connection.execute(sa.text(sql))


def _assert_rows(connection):
    assert connection.execute(sa.text("SELECT * FROM questions")).all() == [
        (1, 1, "preserved")
    ]
    assert connection.execute(
        sa.text("SELECT * FROM question_knowledge_points")
    ).all() == [(1, 1, "preserved link")]
    assert connection.execute(
        sa.text("SELECT * FROM question_imports ORDER BY id")
    ).all() == [
        (1, 1, "published", "valid source"),
        (2, None, "published", "orphan source"),
    ]
    assert connection.scalar(sa.text("SELECT count(*) FROM answer_behaviors")) == 3


def _roundtrip(connection):
    migration = _migration(connection)
    for operation, ondelete in (
        (migration.upgrade, "RESTRICT"),
        (migration.downgrade, "SET NULL"),
        (migration.upgrade, "RESTRICT"),
    ):
        operation()
        _assert_rows(connection)
        foreign_key = sa.inspect(connection).get_foreign_keys("questions")[0]
        assert foreign_key["options"]["ondelete"] == ondelete
    for statement in (
        "INSERT INTO answer_behaviors VALUES (4,42)",
        "INSERT INTO recommendation_metrics_daily VALUES (3,'2026-11-19',1,'practice','scored',NULL)",
        "INSERT INTO question_imports VALUES (3,999,'published','reject dangling')",
    ):
        if connection.dialect.name == "sqlite":
            # This connection performed batch rebuilds with enforcement off.
            if "question_imports" in statement:
                continue
        with pytest.raises(sa.exc.IntegrityError):
            with connection.begin_nested():
                connection.execute(sa.text(statement))


@pytest.mark.asyncio
@pytest.mark.parametrize("dialect", ["sqlite", "postgresql"])
@pytest.mark.parametrize(
    "scenario", ["roundtrip", "duplicate_behavior", "duplicate_null_variant"]
)
async def test_migration_preserves_sources_and_rejects_ambiguous_duplicates(
    tmp_path, dialect, scenario
):
    schema = f"migration_{uuid4().hex}"
    admin = None
    if dialect == "postgresql":
        url = os.environ.get("TEST_DATABASE_URL")
        if not url:
            pytest.skip("TEST_DATABASE_URL is required for PostgreSQL migration checks")
        admin = create_async_engine(url)
        async with admin.begin() as connection:
            await connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
        engine = create_async_engine(
            url, connect_args={"server_settings": {"search_path": schema}}
        )
    else:
        engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/migration.db")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(_seed)
            if scenario == "roundtrip":
                await connection.run_sync(_roundtrip)
            else:
                sql = (
                    "INSERT INTO answer_behaviors VALUES (4,42)"
                    if scenario == "duplicate_behavior"
                    else "INSERT INTO recommendation_metrics_daily VALUES (3,'2026-11-19',1,'practice','scored',NULL)"
                )
                await connection.execute(sa.text(sql))
                with pytest.raises(RuntimeError, match="duplicate identities"):
                    await connection.run_sync(lambda conn: _migration(conn).upgrade())
                assert (
                    await connection.scalar(
                        sa.text("SELECT question_id FROM question_imports WHERE id=2")
                    )
                    == 2147483648
                )
                assert not await connection.run_sync(
                    lambda conn: sa.inspect(conn).get_indexes("answer_behaviors")
                )
    finally:
        await engine.dispose()
        if admin:
            async with admin.begin() as connection:
                await connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
            await admin.dispose()


def test_sqlite_enforcement_on_fails_before_any_mutation(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path}/enforced.db")
    with engine.connect() as connection:
        _seed(connection)
        connection.commit()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        with pytest.raises(RuntimeError, match="requires foreign_keys=OFF"):
            _migration(connection).upgrade()
        assert (
            connection.scalar(
                sa.text("SELECT question_id FROM question_imports WHERE id=2")
            )
            == 2147483648
        )
    engine.dispose()
