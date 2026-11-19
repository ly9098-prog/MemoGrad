"""Search must keep text matches without sending invalid integers to PostgreSQL."""

from datetime import datetime

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy.dialects.postgresql.asyncpg import PGDialect_asyncpg
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

import app.models  # noqa: F401 -- register tables for the isolated test database
from app.core.database import Base
from app.models.question import Question
from app.schemas.admin_questions import AdminQuestionExportRequest
from app.services.admin_question_service import list_admin_questions


class _PostgresIntegerGuard:
    """Execute on SQLite while enforcing the actual asyncpg INTEGER bind range."""

    def __init__(self, session):
        self.session = session

    def get_bind(self):
        return self.session.get_bind()

    @staticmethod
    def _check(statement):
        compiled = statement.compile(dialect=PGDialect_asyncpg())
        sql = str(compiled)
        for position, name in enumerate(compiled.positiontup, 1):
            if f"${position}::INTEGER" in sql:
                value = compiled.params[name]
                assert -(2**31) <= value <= 2**31 - 1, (name, value)

    async def scalar(self, statement):
        self._check(statement)
        return await self.session.scalar(statement)

    async def execute(self, statement):
        self._check(statement)
        return await self.session.execute(statement)


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session
    finally:
        await engine.dispose()


def _question(question_id, stem, *, year=None):
    return Question(
        id=question_id,
        subject_id=1,
        question_type="single_choice",
        content={"stem": stem},
        answer="A",
        difficulty=2,
        year=year,
        created_at=datetime(2026, 11, 19),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "keyword",
    [
        "2147483648",
        "9999999999999999999999999999999",
        "#9999999999999999999999999999999",
        "9223372036854775808",
        "9" * 5000,
        "²",
        "①",
        "١" * 31,
        "９" * 31,
    ],
    ids=[
        "int32-overflow",
        "log-input",
        "hash-prefix",
        "int64-overflow",
        "python-int-limit",
        "superscript",
        "circled",
        "arabic",
        "fullwidth",
    ],
)
async def test_unsafe_numeric_keywords_still_match_text(db, keyword):
    db.add_all([_question(7, f"求 {keyword} 的值"), _question(8, "其他题目")])
    await db.commit()

    questions, total = await list_admin_questions(
        _PostgresIntegerGuard(db), page=1, page_size=20, keyword=keyword
    )

    assert total == 1
    assert [question.id for question in questions] == [7]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keyword", "question_id"),
    [
        ("7", 7),
        ("#7", 7),
        ("0007", 7),
        ("٠٠٧", 7),
        ("７", 7),
        ("0" * 5000 + "7", 7),
        ("０" * 10 + "７", 7),
        ("٠" * 10 + "٧", 7),
        ("0０٠" * 2000 + "７", 7),
        ("#" + "０" * 10 + "７", 7),
        ("2147483647", 2147483647),
    ],
    ids=[
        "plain",
        "hash",
        "leading-zero",
        "arabic",
        "fullwidth",
        "many-leading-zeros",
        "unicode-leading-zero-fullwidth",
        "unicode-leading-zero-arabic",
        "unicode-leading-zero-mixed",
        "unicode-leading-zero-hash",
        "int32-max",
    ],
)
async def test_valid_id_search_is_preserved(db, keyword, question_id):
    db.add(_question(question_id, "按编号查找"))
    await db.commit()

    questions, total = await list_admin_questions(
        _PostgresIntegerGuard(db), page=1, page_size=20, keyword=keyword
    )

    assert total == 1
    assert [question.id for question in questions] == [question_id]


@pytest.mark.asyncio
async def test_year_and_multiple_search_terms_are_preserved(db):
    long_number = "9999999999999999999999999999999"
    db.add_all(
        [
            _question(7, f"树节点编号 {long_number}", year=2026),
            _question(8, f"其他编号 {long_number}", year=2025),
        ]
    )
    await db.commit()

    for keyword in ("2026", "#2026", f"树 {long_number}"):
        questions, total = await list_admin_questions(
            _PostgresIntegerGuard(db), page=1, page_size=20, keyword=keyword
        )
        assert total == 1
        assert [question.id for question in questions] == [7]


@pytest.mark.asyncio
async def test_large_but_valid_page_has_a_bigint_offset(db):
    questions, total = await list_admin_questions(
        _PostgresIntegerGuard(db), page=2**31 - 1, page_size=100
    )
    assert questions == []
    assert total == 0


@pytest.mark.parametrize(
    "payload",
    [
        {"subject_id": 2**31},
        {"year": 2**31},
        {"year": -(2**31) - 1},
        {"knowledge_point_id": 2**31},
        {"ids": [1, 2**31]},
    ],
)
def test_export_rejects_integer_overflow(payload):
    with pytest.raises(ValidationError):
        AdminQuestionExportRequest.model_validate(payload)


def test_export_preserves_max_id_and_deduplication():
    request = AdminQuestionExportRequest(ids=[2**31 - 1, 7, 7])
    assert request.ids == [2**31 - 1, 7]
