"""Database ownership of concurrent submissions, independent of Redis availability."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.features import batch_image_import_service as batch
from app.models.import_batch_job import (
    BatchJobTraceEvent,
    ImportBatchJob,
    ImportBatchJobItem,
)


@pytest_asyncio.fixture
async def submissions(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'submissions.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    from app.services import health_check_service, sse_pubsub

    monkeypatch.setattr(sse_pubsub, "publish_event", AsyncMock())
    monkeypatch.setattr(
        health_check_service,
        "check_ai_model_config",
        AsyncMock(return_value=SimpleNamespace(severity="ok")),
    )
    try:
        yield sessions
    finally:
        await engine.dispose()


async def create(sessions, name, **overrides):
    values = dict(
        job_id=name,
        sources=[batch.BatchImageSource(1, "page.png", "/synthetic/page.png")],
        subject=None,
        concurrency=1,
        created_by="admin:12",
        request_id="synthetic-concurrent-key",
        per_file_sha256=["a" * 64],
    )
    values.update(overrides)
    async with sessions() as db:
        return await batch.create_batch_job(db, **values)


@pytest.mark.asyncio
async def test_concurrent_submissions_share_one_database_owner(
    submissions, monkeypatch
):
    original = batch._find_job_by_request_id
    both_read = asyncio.Event()
    readers = 0

    async def synchronized_read(db, request_id):
        nonlocal readers
        existing = await original(db, request_id)
        if existing is None:
            readers += 1
            if readers == 2:
                both_read.set()
            await asyncio.wait_for(both_read.wait(), timeout=5)
        return existing

    monkeypatch.setattr(batch, "_find_job_by_request_id", synchronized_read)
    results = await asyncio.gather(
        create(submissions, "job-a"), create(submissions, "job-b")
    )
    assert len({job.job_id for job in results}) == 1
    assert sorted(job.status for job in results) == ["duplicate", "queued"]
    async with submissions() as db:
        for model in (ImportBatchJob, ImportBatchJobItem, BatchJobTraceEvent):
            assert await db.scalar(select(func.count()).select_from(model)) == 1


@pytest.mark.asyncio
async def test_unkeyed_requests_remain_independent(submissions):
    await asyncio.gather(
        create(submissions, "unkeyed-a", request_id=None),
        create(submissions, "unkeyed-b", request_id=None),
    )
    async with submissions() as db:
        assert await db.scalar(select(func.count()).select_from(ImportBatchJob)) == 2
