"""Consolidate the duplicate import request indexes without a uniqueness gap.

Revision ID: v21_import_request_index
Revises: v20_batch_upload_idempotency

Downgrade restores both historical indexes: v20 subsequently drops the
canonical index, so the legacy index must already protect request identities.
Only the two known, plain unique indexes are changed; unexpected definitions
require manual investigation. Index creation uses normal transactional DDL.
"""

import sqlalchemy as sa

from alembic import op

revision = "v21_import_request_index"
down_revision = "v20_batch_upload_idempotency"
branch_labels = None
depends_on = None

TABLE = "import_batch_jobs"
CANONICAL = "uq_import_batch_jobs_request_id"
LEGACY = "ix_import_batch_jobs_request_id"


def _sqlite_indexes(connection: sa.Connection) -> dict[str, bool]:
    # SQLAlchemy skips SQLite expression indexes during reflection. Inspect the
    # catalog directly so an unreflectable, same-name index cannot look absent.
    objects = connection.execute(
        sa.text(
            "SELECT name, type, tbl_name FROM sqlite_master "
            "WHERE name IN (:canonical, :legacy)"
        ),
        {"canonical": CANONICAL, "legacy": LEGACY},
    ).mappings()
    indexes = {}
    for item in objects:
        metadata = (
            connection.execute(
                sa.text("SELECT * FROM pragma_index_list(:table) WHERE name = :name"),
                {"table": TABLE, "name": item["name"]},
            )
            .mappings()
            .one_or_none()
        )
        keys = (
            connection.execute(
                sa.text('SELECT * FROM pragma_index_xinfo(:name) WHERE "key" = 1'),
                {"name": item["name"]},
            )
            .mappings()
            .all()
        )
        indexes[item["name"]] = bool(
            item["type"] == "index"
            and item["tbl_name"] == TABLE
            and metadata
            and metadata["unique"]
            and metadata["origin"] == "c"
            and not metadata["partial"]
            and len(keys) == 1
            and keys[0]["name"] == "request_id"
            and not keys[0]["desc"]
            and keys[0]["coll"] == "BINARY"
        )
    return indexes


def _postgresql_indexes(connection: sa.Connection, table_oid: int) -> dict[str, bool]:
    # Reflection alone omits validity, collation and operator-class details.
    rows = connection.execute(
        sa.text("""
            SELECT c.relname AS name,
                i.indrelid = :table_oid
                AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
                AND NOT i.indisprimary AND NOT i.indisexclusion
                AND NOT i.indisreplident AND NOT i.indisclustered
                AND NOT i.indnullsnotdistinct
                AND i.indnatts = 1 AND i.indnkeyatts = 1
                AND i.indexprs IS NULL AND i.indpred IS NULL
                AND a.attname = 'request_id'
                AND i.indcollation[0] = a.attcollation
                AND i.indoption[0] = 0 AND opc.opcdefault
                AND am.amname = 'btree'
                AND NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conindid = c.oid
                ) AS valid_shape
            FROM pg_class c
            LEFT JOIN pg_index i ON i.indexrelid = c.oid
            LEFT JOIN pg_attribute a
                ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
            LEFT JOIN pg_opclass opc ON opc.oid = i.indclass[0]
            LEFT JOIN pg_am am ON am.oid = c.relam
            WHERE c.relnamespace = (
                SELECT relnamespace FROM pg_class WHERE oid = :table_oid
            ) AND c.relname IN (:canonical, :legacy)
        """),
        {"table_oid": table_oid, "canonical": CANONICAL, "legacy": LEGACY},
    )
    return {name: bool(valid_shape) for name, valid_shape in rows}


def _validated_indexes() -> tuple[str | None, dict[str, bool]]:
    connection = op.get_bind()
    schema = None
    if connection.dialect.name == "sqlite":
        indexes = _sqlite_indexes(connection)
    elif connection.dialect.name == "postgresql":
        target = connection.execute(
            sa.text("""
                SELECT c.oid, n.nspname
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.oid = to_regclass(:table)
            """),
            {"table": TABLE},
        ).one_or_none()
        if target is None:
            raise RuntimeError(f"Cannot resolve {TABLE}; no indexes have been changed.")
        schema = target.nspname
        indexes = _postgresql_indexes(connection, target.oid)
    else:
        raise RuntimeError(
            "Import request index repair supports SQLite and PostgreSQL only."
        )
    for name, valid_shape in indexes.items():
        if not valid_shape:
            raise RuntimeError(
                f"Unexpected definition for {name}; expected a plain unique index on "
                f"{TABLE}(request_id) without replica identity or clustering roles. "
                "No indexes have been changed."
            )
    return schema, indexes


def upgrade() -> None:
    schema, indexes = _validated_indexes()
    # Creating first also rejects historical non-NULL duplicates without
    # deleting or rewriting jobs, even if both known indexes were missing.
    if CANONICAL not in indexes:
        op.create_index(CANONICAL, TABLE, ["request_id"], unique=True, schema=schema)
    if LEGACY in indexes:
        op.drop_index(LEGACY, table_name=TABLE, schema=schema)


def downgrade() -> None:
    schema, indexes = _validated_indexes()
    for name in (CANONICAL, LEGACY):
        if name not in indexes:
            op.create_index(name, TABLE, ["request_id"], unique=True, schema=schema)
