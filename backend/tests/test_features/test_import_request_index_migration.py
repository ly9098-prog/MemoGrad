"""Exercise the repair with SQLite and opt-in, transaction-scoped PG schemas."""

from __future__ import annotations

import asyncio
import importlib.util
import os
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.ext.asyncio import create_async_engine

MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "v21_import_request_index.py"
)
CANONICAL = "uq_import_batch_jobs_request_id"
LEGACY = "ix_import_batch_jobs_request_id"
INDEX_STATES = [(CANONICAL, LEGACY), (CANONICAL,), (LEGACY,), ()]


def test_model_registry_keeps_only_the_canonical_request_identity_index() -> None:
    import app.models  # noqa: F401
    from app.models.import_batch_job import ImportBatchJob

    request_indexes = [
        index
        for index in ImportBatchJob.__table__.indexes
        if "request_id" in index.columns
    ]
    assert [
        (index.name, index.unique, tuple(index.columns.keys()))
        for index in request_indexes
    ] == [(CANONICAL, True, ("request_id",))]


@pytest.fixture
def connection(tmp_path: Path) -> Iterator[sa.Connection]:
    engine = sa.create_engine(
        sa.URL.create("sqlite", database=str(tmp_path / "migration.db"))
    )
    with engine.connect() as connection:
        connection.execute(
            sa.text("""
            CREATE TABLE import_batch_jobs (
                id INTEGER PRIMARY KEY,
                request_id VARCHAR(64),
                submission_fingerprint VARCHAR(64),
                payload TEXT NOT NULL
            )
        """)
        )
        connection.execute(
            sa.text("""
            INSERT INTO import_batch_jobs VALUES
                (1, 'request-1', 'fingerprint-1', 'first job'),
                (2, NULL, NULL, 'legacy job'),
                (3, NULL, NULL, 'another legacy job')
        """)
        )
        connection.commit()
        yield connection
    engine.dispose()


def _migration(connection: sa.Connection) -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "import_request_index_migration", MIGRATION_PATH
    )
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.op = Operations(MigrationContext.configure(connection))
    return migration


def _create_indexes(connection: sa.Connection, names: tuple[str, ...]) -> None:
    for name in names:
        connection.execute(
            sa.text(f'CREATE UNIQUE INDEX "{name}" ON import_batch_jobs (request_id)')
        )
    connection.commit()


def _indexes(connection: sa.Connection) -> dict[str, tuple]:
    return {
        row["name"]: tuple(row.values())
        for row in connection.execute(
            sa.text("""
            SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index'
            ORDER BY name
        """)
        ).mappings()
    }


def _rows(connection: sa.Connection) -> list[tuple]:
    return [
        tuple(row)
        for row in connection.execute(
            sa.text("SELECT * FROM import_batch_jobs ORDER BY id")
        )
    ]


def _assert_duplicate_rejected(connection: sa.Connection) -> None:
    with connection.begin_nested():
        with pytest.raises(sa.exc.IntegrityError, match="UNIQUE constraint failed"):
            connection.execute(
                sa.text("""
                INSERT INTO import_batch_jobs (request_id, payload)
                VALUES ('request-1', 'must be rejected')
            """)
            )


@pytest.mark.parametrize(
    "existing", INDEX_STATES, ids=["both", "canonical", "legacy", "neither"]
)
def test_upgrade_downgrade_upgrade_preserves_jobs_and_uniqueness(
    connection: sa.Connection, existing: tuple[str, ...]
) -> None:
    _create_indexes(connection, existing)
    before = _rows(connection)
    migration = _migration(connection)

    for operation, expected in [
        (migration.upgrade, {CANONICAL}),
        (migration.downgrade, {CANONICAL, LEGACY}),
        (migration.upgrade, {CANONICAL}),
    ]:
        operation()
        assert set(_indexes(connection)) == expected
        assert _rows(connection) == before
        _assert_duplicate_rejected(connection)
    connection.execute(
        sa.text("""
        INSERT INTO import_batch_jobs (request_id, payload)
        VALUES (NULL, 'new null job'), (NULL, 'another new null job')
    """)
    )
    assert (
        connection.scalar(
            sa.text("SELECT COUNT(*) FROM import_batch_jobs WHERE request_id IS NULL")
        )
        == 4
    )
    assert _rows(connection)[:3] == before


@pytest.mark.parametrize(
    "existing", INDEX_STATES, ids=["both", "canonical", "legacy", "neither"]
)
def test_downgrade_restores_legacy_before_v20_drops_canonical(
    connection: sa.Connection, existing: tuple[str, ...]
) -> None:
    _create_indexes(connection, existing)
    before = _rows(connection)
    _migration(connection).downgrade()
    assert set(_indexes(connection)) == {CANONICAL, LEGACY}
    connection.execute(sa.text(f'DROP INDEX "{CANONICAL}"'))
    assert set(_indexes(connection)) == {LEGACY}
    _assert_duplicate_rejected(connection)
    assert _rows(connection) == before


def test_replacement_is_enforced_after_every_index_ddl(
    connection: sa.Connection,
) -> None:
    _create_indexes(connection, (LEGACY,))
    observed = []

    def check_after_ddl(conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith(("CREATE UNIQUE INDEX", "DROP INDEX")):
            observed.append(set(_indexes(conn)))
            _assert_duplicate_rejected(conn)

    sa.event.listen(connection, "after_cursor_execute", check_after_ddl)
    try:
        migration = _migration(connection)
        migration.upgrade()
        migration.downgrade()
        migration.upgrade()
    finally:
        sa.event.remove(connection, "after_cursor_execute", check_after_ddl)
    assert observed == [
        {CANONICAL, LEGACY},
        {CANONICAL},
        {CANONICAL, LEGACY},
        {CANONICAL},
    ]


@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
def test_existing_duplicate_requests_fail_without_rewriting_jobs(
    connection: sa.Connection, direction: str
) -> None:
    connection.execute(
        sa.text("""
        INSERT INTO import_batch_jobs (request_id, payload)
        VALUES ('request-1', 'historical duplicate')
    """)
    )
    connection.commit()
    before = _rows(connection)
    with pytest.raises(sa.exc.IntegrityError, match="UNIQUE constraint failed"):
        getattr(_migration(connection), direction)()
    assert _rows(connection) == before
    assert _indexes(connection) == {}


INVALID_INDEXES = [
    "CREATE INDEX {name} ON import_batch_jobs (request_id)",
    "CREATE UNIQUE INDEX {name} ON import_batch_jobs (payload)",
    "CREATE UNIQUE INDEX {name} ON import_batch_jobs (request_id, payload)",
    "CREATE UNIQUE INDEX {name} ON import_batch_jobs (request_id) WHERE id < 0",
    "CREATE UNIQUE INDEX {name} ON import_batch_jobs (lower(request_id))",
    "CREATE UNIQUE INDEX {name} ON import_batch_jobs (request_id COLLATE NOCASE)",
    "CREATE UNIQUE INDEX {name} ON import_batch_jobs (request_id DESC)",
    "CREATE UNIQUE INDEX {name} ON other_jobs (request_id)",
]


@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
@pytest.mark.parametrize(
    "invalid_name", [CANONICAL, LEGACY], ids=["canonical", "legacy"]
)
@pytest.mark.parametrize(
    "definition",
    INVALID_INDEXES,
    ids=[
        "nonunique",
        "wrong-column",
        "compound",
        "partial",
        "expression",
        "collation",
        "desc",
        "other-table",
    ],
)
def test_unexpected_named_indexes_are_rejected_before_any_ddl(
    connection: sa.Connection, direction: str, invalid_name: str, definition: str
) -> None:
    connection.execute(sa.text("CREATE TABLE other_jobs (request_id VARCHAR(64))"))
    _create_indexes(connection, (LEGACY if invalid_name == CANONICAL else CANONICAL,))
    connection.execute(sa.text(definition.format(name=invalid_name)))
    connection.commit()
    before_rows = _rows(connection)
    before_indexes = _indexes(connection)
    with pytest.raises(RuntimeError, match=f"Unexpected definition for {invalid_name}"):
        getattr(_migration(connection), direction)()
    assert _rows(connection) == before_rows
    assert _indexes(connection) == before_indexes


def test_unrelated_indexes_are_preserved(connection: sa.Connection) -> None:
    connection.execute(
        sa.text("CREATE INDEX ix_jobs_payload ON import_batch_jobs (payload)")
    )
    _create_indexes(connection, (CANONICAL, LEGACY))
    before = _indexes(connection)["ix_jobs_payload"]
    migration = _migration(connection)
    migration.upgrade()
    migration.downgrade()
    migration.upgrade()
    assert _indexes(connection)["ix_jobs_payload"] == before


@pytest.fixture
def pg_case() -> Callable[[Callable[[sa.Connection, str, str], None]], None]:
    # Require a dedicated test URL; never fall back to an app database setting.
    test_url = os.environ.get("IMPORT_REQUEST_INDEX_TEST_DATABASE_URL")
    if not test_url:
        pytest.skip("set IMPORT_REQUEST_INDEX_TEST_DATABASE_URL for isolated PG tests")
    assert sa.make_url(test_url).get_backend_name() == "postgresql"

    def run(case: Callable[[sa.Connection, str, str], None]) -> None:
        async def isolated_case() -> None:
            engine = create_async_engine(test_url)
            token = uuid.uuid4().hex
            target, shadow = f"index-target-{token}", f"index-shadow-{token}"
            try:
                async with engine.connect() as connection:
                    transaction = await connection.begin()
                    try:
                        for schema in (target, shadow):
                            await connection.execute(sa.schema.CreateSchema(schema))
                        await connection.execute(
                            sa.text(f"""
                            CREATE TABLE "{target}".import_batch_jobs (
                                id INTEGER PRIMARY KEY, request_id VARCHAR(64),
                                submission_fingerprint VARCHAR(64), payload TEXT NOT NULL
                            )
                        """)
                        )
                        await connection.execute(
                            sa.text(f"""
                            INSERT INTO "{target}".import_batch_jobs
                            VALUES (1, 'request-1', 'fingerprint-1', 'first job')
                        """)
                        )
                        await connection.execute(
                            sa.text(
                                f'CREATE TABLE "{shadow}".other_jobs (request_id VARCHAR(64))'
                            )
                        )
                        for name in (CANONICAL, LEGACY):
                            await connection.execute(
                                sa.text(
                                    f'CREATE UNIQUE INDEX "{name}" '
                                    f'ON "{shadow}".other_jobs (request_id)'
                                )
                            )
                        await connection.execute(
                            sa.text(f'SET LOCAL search_path TO "{shadow}", "{target}"')
                        )
                        await connection.run_sync(
                            lambda conn: case(conn, target, shadow)
                        )
                    finally:
                        # Rolls back all schema/table/index DDL as well as rows.
                        await transaction.rollback()
            finally:
                await engine.dispose()

        asyncio.run(isolated_case())

    return run


def _pg_indexes(connection: sa.Connection, schema: str) -> dict[str, tuple]:
    return {
        row[0]: tuple(row[1:])
        for row in connection.execute(
            sa.text("""
                SELECT c.relname, c.oid, pg_get_indexdef(c.oid),
                    i.indisreplident, i.indisclustered
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_index i ON i.indexrelid = c.oid
                WHERE n.nspname = :schema AND c.relname IN (:canonical, :legacy)
            """),
            {"schema": schema, "canonical": CANONICAL, "legacy": LEGACY},
        )
    }


@pytest.mark.parametrize(
    "existing", INDEX_STATES, ids=["both", "canonical", "legacy", "neither"]
)
def test_pg_schema_scoping_preserves_shadow_indexes_and_request_uniqueness(
    pg_case: Callable, existing: tuple[str, ...]
) -> None:
    def check(connection: sa.Connection, target: str, shadow: str) -> None:
        for name in existing:
            connection.execute(
                sa.text(
                    f'CREATE UNIQUE INDEX "{name}" ON "{target}".import_batch_jobs (request_id)'
                )
            )
        before_rows = _rows(connection)
        before_shadow = _pg_indexes(connection, shadow)
        migration = _migration(connection)
        for operation, expected in [
            (migration.upgrade, {CANONICAL}),
            (migration.downgrade, {CANONICAL, LEGACY}),
            (migration.upgrade, {CANONICAL}),
        ]:
            operation()
            assert set(_pg_indexes(connection, target)) == expected
            assert _pg_indexes(connection, shadow) == before_shadow
            assert _rows(connection) == before_rows
            with pytest.raises(sa.exc.IntegrityError, match="duplicate key"):
                with connection.begin_nested():
                    connection.execute(
                        sa.text("""
                        INSERT INTO import_batch_jobs (id, request_id, payload)
                        VALUES (2, 'request-1', 'must be rejected')
                    """)
                    )
        connection.execute(
            sa.text("""
            INSERT INTO import_batch_jobs (id, request_id, payload)
            VALUES (2, NULL, 'first null'), (3, NULL, 'second null')
        """)
        )
        assert len(_rows(connection)) == 3

    pg_case(check)


@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
@pytest.mark.parametrize(
    "special_name", [CANONICAL, LEGACY], ids=["canonical", "legacy"]
)
@pytest.mark.parametrize("role", ["replica_identity", "clustered"])
def test_pg_special_index_roles_are_rejected_without_metadata_changes(
    pg_case: Callable, direction: str, special_name: str, role: str
) -> None:
    def check(connection: sa.Connection, target: str, shadow: str) -> None:
        connection.execute(
            sa.text(
                "ALTER TABLE import_batch_jobs ALTER COLUMN request_id SET NOT NULL"
            )
        )
        for name in (CANONICAL, LEGACY):
            connection.execute(
                sa.text(
                    f'CREATE UNIQUE INDEX "{name}" ON "{target}".import_batch_jobs (request_id)'
                )
            )
        command = (
            "REPLICA IDENTITY USING INDEX"
            if role == "replica_identity"
            else "CLUSTER ON"
        )
        connection.execute(
            sa.text(f'ALTER TABLE import_batch_jobs {command} "{special_name}"')
        )
        before_indexes = _pg_indexes(connection, target)
        assert before_indexes[special_name][2 if role == "replica_identity" else 3]
        before_shadow, before_rows = _pg_indexes(connection, shadow), _rows(connection)
        with pytest.raises(
            RuntimeError, match=f"Unexpected definition for {special_name}"
        ):
            getattr(_migration(connection), direction)()
        assert _pg_indexes(connection, target) == before_indexes
        assert _pg_indexes(connection, shadow) == before_shadow
        assert _rows(connection) == before_rows

    pg_case(check)
