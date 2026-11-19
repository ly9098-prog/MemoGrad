"""Actual Public PDF resume entry and worker fencing, with memory-only storage."""

from __future__ import annotations

import hashlib
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from fastapi import HTTPException, UploadFile
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import Headers

from app.api.v1 import imports
from app.models.import_pipeline import ImportPipeline, ImportPipelineChunk
from app.services import import_pipeline_service, staging_storage, task_queue_worker
from app.services.db_fencing import initialize_fencing_fields
from app.services.task_queue_contract import EnqueueResult, Task
from tests.fixtures.pdf_helper import make_minimal_pdf


@pytest_asyncio.fixture
async def resume_case(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(ImportPipeline.__table__.create)
        await conn.run_sync(ImportPipelineChunk.__table__.create)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    from app.core import database

    monkeypatch.setattr(database, "async_session", sessions)
    monkeypatch.setattr(imports, "get_upload_validator", MagicMock())
    monkeypatch.setattr(
        staging_storage,
        "async_store_file",
        AsyncMock(return_value=SimpleNamespace(object_id="synthetic-staging")),
    )
    enqueue = AsyncMock(return_value=EnqueueResult())
    monkeypatch.setattr(task_queue_worker, "_enqueue_v2_with_local_fallback", enqueue)
    pdf = make_minimal_pdf(page_count=2)
    await _seed_pipeline(sessions, pdf)
    yield SimpleNamespace(sessions=sessions, enqueue=enqueue, pdf=pdf)
    await engine.dispose()


async def _seed_pipeline(sessions: async_sessionmaker, pdf: bytes) -> None:
    async with sessions() as db:
        db.add(
            ImportPipeline(
                pipeline_id="public-pdf",
                source_type="pdf",
                source_file="original.pdf",
                source_sha256=hashlib.sha256(pdf).hexdigest(),
                total_pages=2,
                chunk_size=1,
                status="failed",
                created_by="7",
                error_message="original-failure",
                finished_at=datetime(2026, 11, 18, 12),
                execution_status="processing",
                current_task_id="import:public-pdf",
                current_owner_token="old-owner",
                execution_generation=1,
            )
        )
        await db.flush()
        db.add_all(
            [
                ImportPipelineChunk(
                    pipeline_id="public-pdf",
                    chunk_index=index,
                    page_start=index + 1,
                    page_end=index + 1,
                    status="completed" if index == 0 else "failed",
                    batch_id="successful-batch" if index == 0 else None,
                    question_count=3 if index == 0 else 0,
                )
                for index in range(2)
            ]
        )
        await db.commit()


async def call_public(case, user_id: int = 7):
    file = UploadFile(
        BytesIO(case.pdf),
        filename="original.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )
    async with case.sessions() as db:
        return await imports.resume_pipeline(
            "public-pdf",
            file,
            subject="DS",
            enable_ai_repair=False,
            confidence_threshold=0.75,
            db=db,
            current_user=SimpleNamespace(id=user_id),
        )


async def read_row(case):
    async with case.sessions() as db:
        return await db.get(ImportPipeline, "public-pdf")


@pytest.mark.asyncio
async def test_public_resume_enters_real_v2_worker_and_revokes_original_owner(
    resume_case,
    monkeypatch,
):
    case = resume_case
    response = await call_public(case)
    assert response.model_dump() == {
        "pipeline_id": "public-pdf",
        "status": "running",
        "resumed_chunks": [1],
    }
    call = case.enqueue.await_args
    task_id, payload = call.kwargs["task_id"], call.args[1]
    assert task_id.startswith("resume:") and len(task_id) <= 64
    assert (await read_row(case)).current_task_id == task_id
    run = AsyncMock()
    monkeypatch.setattr(import_pipeline_service, "run_resume_background", run)
    monkeypatch.setattr(
        task_queue_worker,
        "_resolve_staging_path",
        AsyncMock(return_value="/synthetic/resume.pdf"),
    )
    monkeypatch.setattr(task_queue_worker, "async_cleanup_work_copy", AsyncMock())
    await task_queue_worker._process_task_v2(
        Task(
            task_id=task_id,
            task_type="resume_pipeline",
            payload=payload,
            owner_token="resume-owner",
            generation=2,
        )
    )
    assert run.await_args.kwargs["pipeline_id"] == "public-pdf"
    assert run.await_args.kwargs["options"]["enable_ai_repair"] is False
    assert run.await_args.kwargs["options"]["confidence_threshold"] == 0.75
    row = await read_row(case)
    assert (row.current_task_id, row.current_owner_token, row.execution_generation) == (
        task_id,
        "resume-owner",
        2,
    )
    assert row.execution_status == "completed"
    await _assert_original_revoked(case)


async def _assert_original_revoked(case: SimpleNamespace) -> None:
    async with case.sessions() as db:
        assert not await initialize_fencing_fields(
            db,
            ImportPipeline,
            "public-pdf",
            task_id="import:public-pdf",
            owner_token="stale-owner",
            generation=99,
        )
        completed = await db.get(ImportPipelineChunk, 1)
        assert (completed.status, completed.batch_id, completed.question_count) == (
            "completed",
            "successful-batch",
            3,
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["rejected", "exception"])
async def test_public_resume_queue_failure_restores_error_and_remains_retryable(
    resume_case,
    failure,
):
    case = resume_case
    if failure == "rejected":
        case.enqueue.return_value = EnqueueResult(accepted=False, reason="queue_full")
        expected = HTTPException
    else:
        case.enqueue.side_effect = RuntimeError("isolated enqueue failure")
        expected = RuntimeError
    with pytest.raises(expected) as error:
        await call_public(case)
    if failure == "rejected":
        assert error.value.status_code == 503
    rejected_task = case.enqueue.await_args.kwargs["task_id"]
    row = await read_row(case)
    assert (row.status, row.error_message, row.finished_at) == (
        "failed",
        "original-failure",
        datetime(2026, 11, 18, 12),
    )
    async with case.sessions() as db:
        assert not await initialize_fencing_fields(
            db,
            ImportPipeline,
            "public-pdf",
            task_id=rejected_task,
            owner_token="late-ambiguous-worker",
            generation=2,
        )
    case.enqueue.side_effect = None
    case.enqueue.return_value = EnqueueResult()
    await call_public(case)
    assert case.enqueue.await_args.kwargs["task_id"] != rejected_task


@pytest.mark.asyncio
async def test_public_resume_compensation_cannot_undo_a_started_worker(resume_case):
    case = resume_case

    async def started_then_unavailable(kind, payload, **kwargs):
        async with case.sessions() as db:
            assert await initialize_fencing_fields(
                db,
                ImportPipeline,
                "public-pdf",
                task_id=kwargs["task_id"],
                owner_token="started-worker",
                generation=1,
            )
            await db.execute(
                update(ImportPipeline)
                .where(ImportPipeline.pipeline_id == "public-pdf")
                .values(status="running")
            )
            await db.commit()
        raise RuntimeError("enqueue acknowledgement unavailable")

    case.enqueue.side_effect = started_then_unavailable
    with pytest.raises(RuntimeError):
        await call_public(case)
    row = await read_row(case)
    assert (row.status, row.execution_status, row.current_owner_token) == (
        "running",
        "processing",
        "started-worker",
    )


@pytest.mark.asyncio
async def test_public_resume_rejects_duplicate_and_foreign_creator(resume_case):
    case = resume_case
    with pytest.raises(HTTPException) as forbidden:
        await call_public(case, user_id=8)
    assert forbidden.value.status_code == 403
    case.enqueue.assert_not_awaited()
    await call_public(case)
    with pytest.raises(HTTPException) as duplicate:
        await call_public(case)
    assert duplicate.value.status_code == 409
    assert case.enqueue.await_count == 1


@pytest.mark.asyncio
async def test_public_resume_observed_fence_change_rejects_atomic_claim(
    resume_case,
    monkeypatch,
):
    case = resume_case

    async def stage_after_reclaim(*args, **kwargs):
        async with case.sessions() as db:
            await db.execute(
                update(ImportPipeline)
                .where(ImportPipeline.pipeline_id == "public-pdf")
                .values(current_owner_token="reclaimed-owner", execution_generation=2)
            )
            await db.commit()
        return SimpleNamespace(object_id="synthetic-staging")

    monkeypatch.setattr(staging_storage, "async_store_file", stage_after_reclaim)
    with pytest.raises(HTTPException) as conflict:
        await call_public(case)
    assert conflict.value.status_code == 409
    case.enqueue.assert_not_awaited()
    assert (await read_row(case)).current_owner_token == "reclaimed-owner"
