"""Enforce answer/aggregate identities and align current question references.

Revision ID: v23_database_consistency
Revises: v22_merge_import_owner

No question content or immutable revision is rewritten. Missing import targets
are detached while their published status and source/parsed data are retained.
Ambiguous duplicate behavior/aggregate rows stop the migration for investigation.
"""

import sqlalchemy as sa

from alembic import op

revision = "v23_database_consistency"
down_revision = "v22_merge_import_owner"
branch_labels = None
depends_on = None

_NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def _prepare_connection() -> None:
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        connection.execute(sa.text("SET LOCAL lock_timeout='5s'"))
        connection.execute(sa.text("SET LOCAL statement_timeout='120s'"))
        return
    if connection.dialect.name != "sqlite":
        return
    if connection.exec_driver_sql("PRAGMA foreign_keys").scalar():
        raise RuntimeError(
            "SQLite table rebuild requires foreign_keys=OFF before the migration transaction; "
            "incoming references are verified with foreign_key_check afterwards"
        )
    driver = connection.connection.driver_connection
    if not driver.in_transaction:
        connection.exec_driver_sql("BEGIN")


def _check_sqlite_references() -> None:
    if op.get_bind().dialect.name == "sqlite":
        if op.get_bind().exec_driver_sql("PRAGMA foreign_key_check").first():
            raise RuntimeError("SQLite foreign_key_check failed; roll back the migration")


def _assert_unique_rows() -> None:
    checks = (
        ("answer_behaviors", "practice_record_id", "practice_record_id IS NOT NULL"),
        (
            "recommendation_metrics_daily",
            "date, subject_id, scene, strategy",
            "variant_key IS NULL",
        ),
    )
    for table, keys, condition in checks:
        duplicate = (
            op.get_bind()
            .execute(
                sa.text(
                    f"SELECT 1 FROM {table} WHERE {condition} GROUP BY {keys} "
                    "HAVING count(*) > 1 LIMIT 1"
                )
            )
            .first()
        )
        if duplicate:
            raise RuntimeError(
                f"Resolve duplicate identities in {table} before migrating"
            )


def _subject_fk(ondelete: str) -> None:
    keys = sa.inspect(op.get_bind()).get_foreign_keys("questions")
    matches = [key for key in keys if key["constrained_columns"] == ["subject_id"]]
    if len(matches) != 1 or matches[0]["referred_table"] != "subjects":
        raise RuntimeError(
            "Unexpected questions.subject_id foreign key; no replacement made"
        )
    name = matches[0]["name"] or "fk_questions_subject_id_subjects"
    with op.batch_alter_table("questions", naming_convention=_NAMING) as batch:
        batch.drop_constraint(name, type_="foreignkey")
        batch.create_foreign_key(
            "fk_questions_subject_id_subjects",
            "subjects",
            ["subject_id"],
            ["id"],
            ondelete=ondelete,
        )


def upgrade() -> None:
    _prepare_connection()
    _assert_unique_rows()
    # These two identities deliberately differ: multiple independent NULL
    # practice keys are legal; a NULL daily variant identifies one shared group.
    op.create_index(
        "uq_answer_behaviors_practice_record",
        "answer_behaviors",
        ["practice_record_id"],
        unique=True,
    )
    op.create_index(
        "uq_rmd_null_variant",
        "recommendation_metrics_daily",
        ["date", "subject_id", "scene", "strategy"],
        unique=True,
        postgresql_where=sa.text("variant_key IS NULL"),
        sqlite_where=sa.text("variant_key IS NULL"),
    )
    op.execute(
        sa.text(
            "UPDATE question_imports SET question_id = NULL "
            "WHERE question_id IS NOT NULL AND NOT EXISTS "
            "(SELECT 1 FROM questions WHERE questions.id = question_imports.question_id)"
        )
    )
    with op.batch_alter_table("question_imports") as batch:
        batch.alter_column(
            "question_id", existing_type=sa.BigInteger(), type_=sa.Integer()
        )
        batch.create_foreign_key(
            "fk_question_imports_question_id_questions",
            "questions",
            ["question_id"],
            ["id"],
            ondelete="SET NULL",
        )
    _subject_fk("RESTRICT")
    _check_sqlite_references()


def downgrade() -> None:
    _prepare_connection()
    # Detached nonexistent references cannot be reconstructed by downgrade.
    _subject_fk("SET NULL")
    with op.batch_alter_table("question_imports") as batch:
        batch.drop_constraint(
            "fk_question_imports_question_id_questions", type_="foreignkey"
        )
        batch.alter_column(
            "question_id", existing_type=sa.Integer(), type_=sa.BigInteger()
        )
    op.drop_index("uq_rmd_null_variant", table_name="recommendation_metrics_daily")
    op.drop_index("uq_answer_behaviors_practice_record", table_name="answer_behaviors")
    _check_sqlite_references()
