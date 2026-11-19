"""Database-backed invariants from the production schema review; no production data."""

from __future__ import annotations

import asyncio
import os
from datetime import date, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401
from app.core.error_codes import ApiError
from app.core.orm_base import Base
from app.core.time_utils import shanghai_date_utc_range, utcnow
from app.models.admin import QuestionVersion, Subject
from app.models.answer_behavior import AnswerBehavior
from app.models.export_task import ExportSnapshot, ExportTask
from app.models.knowledge_point import KnowledgePoint
from app.models.practice_record import PracticeRecord
from app.models.question import Question
from app.models.question_import import QuestionImport
from app.models.recommendation_log import RecommendationLog
from app.models.recommendation_metrics_daily import RecommendationMetricsDaily
from app.models.user import User
from app.services import (
    behavior_service,
    recommendation_metrics_service,
    vector_freshness,
)
from app.services.export import cleanup
from app.services.knowledge_point_service import sync_question_knowledge_points
from app.services.question_revision_service import ensure_question_revision


@pytest_asyncio.fixture(params=["sqlite", "postgresql"])
async def database(request, tmp_path):
    schema = f"consistency_{uuid4().hex}"
    admin = None
    if request.param == "postgresql":
        url = os.environ.get("TEST_DATABASE_URL")
        if not url:
            pytest.skip("TEST_DATABASE_URL is required for PostgreSQL validation")
        admin = create_async_engine(url)
        async with admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_async_engine(
            url, connect_args={"server_settings": {"search_path": schema}}
        )
    else:
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{tmp_path}/repair.db", connect_args={"timeout": 30}
        )

        @event.listens_for(engine.sync_engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add_all(
                [
                    User(id=1, openid="repair-test"),
                    Subject(id=1, code="ds", name="数据结构", path="ds", level=1),
                    Subject(id=2, code="co", name="组成原理", path="co", level=1),
                ]
            )
            await db.flush()
            question = Question(
                id=1, subject_id=1, content={"text": "排序"}, answer="A"
            )
            db.add(question)
            await db.flush()
            await sync_question_knowledge_points(db, question, ["排序"])
            revision = await ensure_question_revision(db, question)
            db.add(
                PracticeRecord(
                    id=1,
                    user_id=1,
                    question_id=1,
                    question_version_id=revision.id,
                    subject_id=1,
                    user_answer="A",
                    is_correct=True,
                )
            )
            await db.commit()
        yield sessions
    finally:
        await engine.dispose()
        if admin:
            async with admin.begin() as conn:
                await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            await admin.dispose()


@pytest.mark.asyncio
async def test_corrupt_revision_checksum_cannot_hide_content_drift(database):
    async with database() as db:
        question = await db.get(Question, 1)
        old = await db.get(QuestionVersion, question.current_version_id)
        old.answer = "B"  # simulate historical corruption without changing its checksum
        await db.flush()
        new = await ensure_question_revision(db, question)
        assert new.id != old.id and new.version == old.version + 1
        assert new.answer == "A" and old.answer == "B"
        assert (await ensure_question_revision(db, question)).id == new.id


@pytest.mark.asyncio
async def test_legacy_checksum_does_not_duplicate_an_identical_historical_version(database):
    async with database() as db:
        question = await db.get(Question, 1)
        old = await db.get(QuestionVersion, question.current_version_id)
        old.state_hash = "0" * 64
        await db.flush()
        assert (await ensure_question_revision(db, question)).id == old.id
        assert old.state_hash == "0" * 64


@pytest.mark.asyncio
async def test_cross_subject_links_rejected_but_final_subject_migration_is_valid(
    database,
):
    async with database() as db:
        question = await db.get(Question, 1)
        old_id = question.current_version_id
        async with db.begin_nested():
            question.subject_id = 2
            with pytest.raises(ApiError, match="知识点与科目不一致"):
                await ensure_question_revision(db, question)
            await sync_question_knowledge_points(db, question, ["排序"], replace=True)
            revision = await ensure_question_revision(db, question)
            assert revision.subject_id == 2
        assert (await db.get(QuestionVersion, old_id)).subject_id == 1


@pytest.mark.asyncio
async def test_behavior_concurrency_null_keys_and_identity_guard(database):
    async with database() as db:
        version = (await db.get(Question, 1)).current_version_id
    barrier = asyncio.Barrier(2)

    async def record_once():
        async with database() as db:
            await barrier.wait()
            result = await behavior_service.record_answer_behavior(db, 1, 1, version, 1)
            return result.id

    assert len(set(await asyncio.gather(record_once(), record_once()))) == 1
    async with database() as db:
        for _ in range(2):
            await behavior_service.record_answer_behavior(
                db, 1, 1, version, commit=False
            )
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(AnswerBehavior)) == 3
        with pytest.raises(ValueError, match="different answer identity"):
            await behavior_service.record_answer_behavior(
                db, 1, 2, version, 1, commit=False
            )
        assert (
            await db.scalar(
                select(AnswerBehavior).where(AnswerBehavior.practice_record_id == 1)
            )
        ).question_id == 1


@pytest.mark.asyncio
async def test_global_and_leaf_metrics_share_a_null_group_identity(database):
    day = date(2026, 11, 19)
    async with database() as db:
        db.add(Subject(id=3, code="exam", name="父科目", path="exam", level=1))
        await db.flush()
        leaf = await db.get(Subject, 1)
        leaf.parent_id, leaf.path, leaf.level = 3, "exam/ds", 2
        for variant in (None, "A", "B"):
            db.add(
                RecommendationLog(
                    user_id=1,
                    question_id=1,
                    subject_id=1,
                    scene="practice",
                    strategy="scored",
                    variant_key=variant,
                    shown_at=shanghai_date_utc_range(day)[0],
                )
            )
        await db.commit()
    barrier = asyncio.Barrier(3)

    async def aggregate(subject_id):
        async with database() as db:
            await barrier.wait()
            await recommendation_metrics_service.aggregate_recommendation_metrics_daily(
                db, day, subject_id
            )
            await db.commit()

    await asyncio.gather(aggregate(None), aggregate(1), aggregate(3))
    async with database() as db:
        rows = (await db.scalars(select(RecommendationMetricsDaily))).all()
        assert {row.variant_key for row in rows} == {None, "A", "B"} and len(rows) == 3
        assert all(row.exposure_count == 1 for row in rows)
        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                db.add(
                    RecommendationMetricsDaily(
                        date=day, subject_id=1, scene="practice", strategy="scored"
                    )
                )
                await db.flush()


@pytest.mark.asyncio
async def test_subject_restrict_and_import_target_detachment(database):
    async with database() as db:
        question = Question(id=2, subject_id=1, content={"text": "发布历史"}, answer="B")
        db.add(question)
        await db.flush()
        imported = QuestionImport(
            batch_id="repair",
            source_type="text",
            raw_data={"text": "source"},
            status="published",
            question_id=question.id,
        )
        db.add(imported)
        await db.commit()
        await db.delete(question)
        await db.commit()
        await db.refresh(imported)
        assert imported.question_id is None and imported.status == "published"
        assert imported.raw_data == {"text": "source"}
        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                await db.execute(text("DELETE FROM subjects WHERE id=1"))


@pytest.mark.asyncio
async def test_vector_candidates_and_cached_results_validate_current_hash(database):
    async with database() as db:
        identity = (await vector_freshness.load_embedding_identities(db, [1]))[1]
        good = (1, "ds", "single_choice", identity["hash"], 0.95)
        assert await vector_freshness.filter_fresh_candidates(db, [good], [1]) == [good]
        stale = (1, "ds", "single_choice", "old", 0.99)
        assert await vector_freshness.filter_fresh_candidates(db, [stale], [1]) == []
        item = {"question_id": 1, "subject": "ds", "question_type": "single_choice"}
        cached = vector_freshness.pack_vector_cache([item], [good])
        assert await vector_freshness.read_fresh_vector_cache(db, cached, [1]) == [item]
        kp = await db.scalar(
            select(KnowledgePoint).where(KnowledgePoint.subject_id == 1)
        )
        kp.name = "新的知识点名称"
        await db.flush()
        assert await vector_freshness.read_fresh_vector_cache(db, cached, [1]) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("snapshot_exists", [True, False])
@pytest.mark.parametrize("delete_succeeds", [True, False])
async def test_expired_export_metadata_converges_without_deleting_shared_snapshot(
    database, monkeypatch, snapshot_exists, delete_succeeds
):
    from unittest.mock import AsyncMock, Mock

    storage = Mock(delete=AsyncMock(return_value=delete_succeeds))
    monkeypatch.setattr(cleanup, "get_export_storage", lambda: storage)
    monkeypatch.setattr(cleanup, "_publish_expired_event", AsyncMock())
    async with database() as db:
        snapshot = ExportSnapshot(id=str(uuid4()), user_id=1, data={})
        db.add(snapshot)
        await db.flush()
        values = dict(
            user_id=1,
            range_type="all",
            title="repair",
            export_date="2026-11-19",
            file_name="repair.pdf",
        )
        stale = ExportTask(
            **values,
            status="expired",
            snapshot_id=snapshot.id if snapshot_exists else str(uuid4()),
            file_key="old-file",
            expires_at=utcnow() - timedelta(days=1),
        )
        live = ExportTask(**values, status="processing", snapshot_id=snapshot.id)
        db.add_all([stale, live])
        await db.commit()
        selected = (await db.scalars(select(ExportTask.id).where(
            cleanup.export_cleanup_condition(utcnow(), utcnow() - timedelta(days=7)),
        ))).all()
        assert selected == [stale.id]
        result = await cleanup.cleanup_expired(db)
        if not delete_succeeds:
            assert result["files_delete_failed"] == 1 and result["expired_metadata_repaired"] == 0
            await db.refresh(stale)
            await db.refresh(snapshot)
            await db.refresh(live)
            assert stale.file_key == "old-file" and stale.snapshot_id is not None
            storage.delete.return_value = True
            result = await cleanup.cleanup_expired(db)
        assert result["expired_metadata_repaired"] == 1 and result["tasks_expired"] == 0
        assert stale.snapshot_id is None and stale.file_key is None
        assert await db.get(ExportSnapshot, snapshot.id) is not None
        assert live.status == "processing"
        assert (await cleanup.cleanup_expired(db))["candidates"] == 0
