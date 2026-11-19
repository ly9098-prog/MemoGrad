"""Real pgvector queries against synthetic current/stale vector identities."""

import asyncio
import os
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.core.orm_base import Base
from app.models.admin import Subject
from app.models.question import Question
from app.models.user import User
from app.services import ai_token_budget, embedding_service
from app.services import vector_retrieval_service as service
from app.services.vector_config_service import EmbeddingConfig, VectorSearchConfig
from app.services.vector_freshness import load_embedding_identities
from app.services.vector_integrity_repair import model_fingerprint, repair_vectors

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture
async def vector_database(monkeypatch):
    raw_url = os.environ.get("TEST_DATABASE_URL")
    if not raw_url:
        pytest.skip("TEST_DATABASE_URL is required")
    url = make_url(raw_url)
    name = f"vector_repair_{uuid4().hex[:16]}"
    admin = create_async_engine(
        url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    async with admin.connect() as conn:
        await conn.execute(text(f'CREATE DATABASE "{name}"'))
    engine = create_async_engine(url.set(database=name))
    config = EmbeddingConfig(
        model_config_id=7, dim=3, model="test", base_url="http://test.invalid"
    )
    search = VectorSearchConfig()
    search.enabled, search.mode, search.top_k, search.similarity_threshold = (
        True,
        "all",
        20,
        0.1,
    )
    monkeypatch.setattr(service._vs, "_cached", {"emb": config, "vec": search})
    monkeypatch.setattr(service._vs, "refresh_async", AsyncMock())
    monkeypatch.setattr(service, "is_vector_enabled", AsyncMock(return_value=True))
    monkeypatch.setattr(
        service, "_get_user_answer_version", AsyncMock(return_value="test")
    )
    for method in (
        "reserve_token_budget",
        "record_token_usage",
        "settle_token_reservation",
        "cancel_token_reservation",
    ):
        monkeypatch.setattr(
            ai_token_budget, method, AsyncMock(return_value="reservation")
        )
    provider = AsyncMock(return_value=[1.0, 0.0, 0.0])
    monkeypatch.setattr(embedding_service, "get_embedding", provider)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION vector"))
            await conn.run_sync(Base.metadata.create_all)
            await conn.execute(
                text(
                    "CREATE TABLE question_embeddings (id BIGSERIAL PRIMARY KEY, "
                    "question_id INTEGER, model_id INTEGER, subject_id INTEGER, question_type TEXT, "
                    "content_hash TEXT, content_text TEXT, embedding public.vector(3), embedding_dim INTEGER, "
                    "updated_at TIMESTAMP DEFAULT NOW(), embedded_at TIMESTAMP DEFAULT NOW(), "
                    "UNIQUE(question_id,model_id))"
                )
            )
        async with sessions() as db:
            db.add_all(
                [
                    User(id=1, openid="vector-test"),
                    Subject(id=1, code="ds", name="数据结构", path="ds", level=1),
                    Subject(id=2, code="co", name="组成原理", path="co", level=1),
                ]
            )
            await db.flush()
            for i in range(1, 10):
                db.add(
                    Question(
                        id=i,
                        subject_id=2 if i == 6 else 1,
                        content={"text": f"synthetic question {i}"},
                        answer="A",
                        question_type="multiple_choice" if i == 5 else "single_choice",
                        is_active=i != 7,
                        review_status="pending" if i == 8 else "approved",
                    )
                )
            await db.flush()
            identities = await load_embedding_identities(db, list(range(1, 10)))
            for i in range(1, 9):
                await db.execute(
                    text(
                        "INSERT INTO question_embeddings "
                        "(question_id,model_id,subject_id,question_type,content_hash,embedding,embedding_dim) "
                        "VALUES (:id,7,:subject,'single_choice',:hash,'[1,0,0]',3)"
                    ),
                    {
                        "id": i,
                        "subject": 2 if i == 4 else 1,
                        "hash": "old"
                        if i == 3
                        else identities.get(i, {}).get("hash", "inactive"),
                    },
                )
            await db.commit()
        yield sessions, provider, config
    finally:
        await engine.dispose()
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        await admin.dispose()


@pytest.mark.parametrize("method", ["similar", "text"])
@pytest.mark.parametrize("exclude,days", [(False, None), (True, None), (False, 30)])
async def test_all_recall_sql_branches_reject_stale_identity(
    vector_database, method, exclude, days
):
    sessions, _, _ = vector_database
    async with sessions() as db:
        if method == "similar":
            result = await service.search_similar_questions(
                db, 1, 1, count=10, exclude_answered=exclude, no_repeat_days=days
            )
            assert [item["question_id"] for item in result["recommendations"]] == [2]
        else:
            result = await service.vector_recall_by_text(
                db,
                1,
                "ds",
                "query",
                count=10,
                exclude_answered=exclude,
                no_repeat_days=days,
            )
            assert {item["question_id"] for item in result} == {1, 2}


async def test_existing_stale_source_is_not_reused_when_budget_denies_rebuild(
    vector_database, monkeypatch
):
    sessions, provider, _ = vector_database
    monkeypatch.setattr(
        ai_token_budget, "reserve_token_budget", AsyncMock(return_value=None)
    )
    async with sessions() as db:
        question = await db.get(Question, 3)
        assert await service._ensure_source_embedding(db, question, user_id=1) is None
        provider.assert_not_awaited()


async def test_source_changed_during_provider_call_uses_rule_fallback(vector_database):
    sessions, provider, _ = vector_database

    async def edit_source(*args, **kwargs):
        async with sessions() as editor:
            question = await editor.get(Question, 1)
            question.analysis = "changed while embedding provider was running"
            await editor.commit()
        return [1., 0., 0.]

    provider.side_effect = edit_source
    async with sessions() as db:
        await db.execute(text("UPDATE question_embeddings SET content_hash='old' WHERE question_id=1"))
        await db.commit()
        result = await service.search_similar_questions(db, 1, 1, exclude_answered=False)
        assert result["strategy"] == "fallback" and result["recommendations"] == []
        provider.assert_awaited_once()


async def test_source_completed_by_another_writer_cancels_unused_reservation(vector_database, monkeypatch):
    sessions, provider, _ = vector_database

    async def another_writer(_db, _user_id, _tokens):
        async with sessions() as writer:
            identity = (await load_embedding_identities(writer, [3]))[3]
            await writer.execute(text("UPDATE question_embeddings SET content_hash=:hash WHERE question_id=3"),
                                 {"hash": identity["hash"]})
            await writer.commit()
        return "reservation"

    monkeypatch.setattr(ai_token_budget, "reserve_token_budget", AsyncMock(side_effect=another_writer))
    async with sessions() as db:
        source = await db.get(Question, 3)
        assert await service._ensure_source_embedding(db, source, user_id=1) == [1., 0., 0.]
        provider.assert_not_awaited()
        ai_token_budget.cancel_token_reservation.assert_awaited_once_with("reservation")
        ai_token_budget.record_token_usage.assert_not_awaited()


async def test_atomic_first_vector_writes_and_reviewed_repair_are_repeatable(
    vector_database,
):
    sessions, provider, config = vector_database
    barrier = asyncio.Barrier(2)

    async def embed(*args, **kwargs):
        await barrier.wait()
        return [1.0, 0.0, 0.0]

    provider.side_effect = embed

    async def write():
        async with sessions() as db:
            result = await service.upsert_question_embedding(
                db, await db.get(Question, 9)
            )
            await db.commit()
            return result

    assert all(
        result["status"] in ("created", "updated")
        for result in await asyncio.gather(write(), write())
    )
    provider.side_effect = None
    async with sessions() as db:
        assert (
            await db.scalar(
                text("SELECT count(*) FROM question_embeddings WHERE question_id=9")
            )
            == 1
        )
        question = await db.get(Question, 3)
        identity = (await load_embedding_identities(db, [3]))[3]
        payload = {
            "model_fingerprint": model_fingerprint(config),
            "vectors": [
                {"sync_uuid": question.sync_uuid, "target_hash": identity["hash"]},
            ],
        }
        calls = provider.await_count
        plan = await repair_vectors(db, payload)
        assert (
            plan["vectors"][0]["status"] == "planned" and provider.await_count == calls
        )
        with pytest.raises(ValueError, match="model changed"):
            await repair_vectors(
                db, {**payload, "model_fingerprint": "old"}, apply=True
            )
        result = await repair_vectors(db, payload, apply=True)
        assert result["vectors"][0]["status"] == "applied" and result["failed"] == 0
        await db.commit()
        repeated = await repair_vectors(db, payload, apply=True)
        assert repeated["vectors"][0]["status"] == "already_applied"
        assert provider.await_count == calls + 1
        assert await db.scalar(select(Question.answer).where(Question.id == 3)) == "A"
