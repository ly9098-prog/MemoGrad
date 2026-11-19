"""Batch children must stop before terminal state and source cleanup."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.features import batch_image_import_service as batch
from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem


@pytest_asyncio.fixture
async def execution(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'execution.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(batch, "async_session", sessions)
    from app.services import sse_pubsub

    monkeypatch.setattr(sse_pubsub, "publish_event", AsyncMock())
    job_id = "synthetic-execution"
    sources = []
    async with sessions() as db:
        db.add(ImportBatchJob(job_id=job_id, total=2, concurrency=2, status="queued"))
        for seq in (1, 2):
            path = tmp_path / f"source-{seq}.png"
            path.write_bytes(b"synthetic owned work copy")
            sources.append(batch.BatchImageSource(seq, path.name, str(path)))
            db.add(ImportBatchJobItem(job_id=job_id, seq=seq, status="pending"))
        await db.commit()
    try:
        yield SimpleNamespace(job_id=job_id, sources=sources, sessions=sessions)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_durable_redelivery_resumes_interrupted_item_without_repeating_success(
    execution, monkeypatch
):
    interrupted = asyncio.Event()
    first_succeeded = asyncio.Event()
    calls = []

    async def first_process(_sem, *, item_id, src, **_kwargs):
        if src.seq == 2:
            await first_succeeded.wait()
        async with execution.sessions() as db:
            await db.execute(
                update(ImportBatchJobItem)
                .where(ImportBatchJobItem.id == item_id)
                .values(
                    status="succeeded" if src.seq == 1 else "processing",
                    review_batch_id="preserved-review" if src.seq == 1 else None,
                )
            )
            await db.commit()
        if src.seq == 1:
            first_succeeded.set()
        if src.seq == 2:
            interrupted.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(batch, "_process_source", first_process)
    parent = asyncio.create_task(
        batch.run_batch_job(
            job_id=execution.job_id,
            sources=execution.sources,
            subject=None,
            options={},
            concurrency=2,
        )
    )
    await asyncio.wait_for(interrupted.wait(), timeout=5)
    parent.cancel()
    with pytest.raises(asyncio.CancelledError):
        await parent
    async with execution.sessions() as db:
        await db.execute(
            update(ImportBatchJob)
            .where(ImportBatchJob.job_id == execution.job_id)
            .values(
                current_task_id="synthetic-task",
                current_owner_token="new-owner",
                execution_generation=2,
            )
        )
        await db.commit()
    for source in execution.sources:
        Path(source.temp_path).write_bytes(b"new worker owned staging copy")

    async def recovered_process(_sem, *, item_id, src, **_kwargs):
        calls.append(src.seq)
        async with execution.sessions() as db:
            item = await db.get(ImportBatchJobItem, item_id)
            assert item.status == "pending"
            item.status = "succeeded"
            item.review_batch_id = "new-review"
            await db.commit()

    monkeypatch.setattr(batch, "_process_source", recovered_process)
    monkeypatch.setattr(
        batch, "_merge_image_texts", AsyncMock(return_value={"merged": False})
    )
    await batch.run_batch_job(
        job_id=execution.job_id,
        sources=execution.sources,
        subject=None,
        options={},
        concurrency=2,
        execution_fence=("synthetic-task", "new-owner", 2),
    )
    assert calls == [2]
    async with execution.sessions() as db:
        assert (await db.get(ImportBatchJob, execution.job_id)).status == "completed"
        item = (
            await db.execute(
                select(ImportBatchJobItem).where(
                    ImportBatchJobItem.job_id == execution.job_id,
                    ImportBatchJobItem.seq == 1,
                )
            )
        ).scalar_one()
        assert item.review_batch_id == "preserved-review"


@pytest.mark.asyncio
async def test_stale_owner_cannot_change_batch_item_or_terminal_state(execution):
    from app.features.pipeline_checkpoint import (
        clear_fencing_context,
        set_fencing_context,
    )

    async with execution.sessions() as db:
        job = await db.get(ImportBatchJob, execution.job_id)
        job.current_task_id = "synthetic-task"
        job.current_owner_token = "new-owner"
        job.execution_generation = 2
        await db.commit()
        item_id = await db.scalar(
            select(ImportBatchJobItem.id).where(
                ImportBatchJobItem.job_id == execution.job_id,
                ImportBatchJobItem.seq == 1,
            )
        )
    token = set_fencing_context("synthetic-task", "old-owner", 1)
    try:
        with pytest.raises(asyncio.CancelledError):
            await batch._update_item_with_trace(
                item_id,
                execution.job_id,
                fields={"status": "processing"},
                trace=batch._TraceData("ocr", "running"),
            )
        with pytest.raises(asyncio.CancelledError):
            await batch._set_job_status_with_trace(execution.job_id, "failed")
    finally:
        clear_fencing_context(token)
    async with execution.sessions() as db:
        assert (await db.get(ImportBatchJob, execution.job_id)).status == "queued"
        assert (await db.get(ImportBatchJobItem, item_id)).status == "pending"


@pytest.mark.asyncio
@pytest.mark.parametrize("exception", [False, True])
async def test_stale_merge_failure_cannot_overwrite_the_new_owners_success(
    execution, monkeypatch, exception
):
    from app.features import pipeline_coordinator_entry
    from app.features.pipeline_checkpoint import (
        clear_fencing_context,
        set_fencing_context,
    )

    async with execution.sessions() as db:
        job = await db.get(ImportBatchJob, execution.job_id)
        job.status = "merging"
        job.current_task_id = "synthetic-task"
        job.current_owner_token = "old-owner"
        job.execution_generation = 1
        await db.execute(
            update(ImportBatchJobItem)
            .where(
                ImportBatchJobItem.job_id == execution.job_id,
            )
            .values(
                status="succeeded",
                ocr_cleaned_text="synthetic OCR text",
                review_batch_id="old-review",
            )
        )
        await db.commit()

    async def late_pipeline(**_kwargs):
        async with execution.sessions() as db:
            job = await db.get(ImportBatchJob, execution.job_id)
            job.current_owner_token = "new-owner"
            job.execution_generation = 2
            job.status = "completed"
            job.merge_status = "completed"
            job.merged_batch_id = "new-review"
            job.merge_error = None
            await db.commit()
        if exception:
            raise RuntimeError("old owner delayed exception")
        return {"status": "failed", "errors": ["old owner delayed failure"]}

    monkeypatch.setattr(pipeline_coordinator_entry, "run_pipeline", late_pipeline)
    token = set_fencing_context("synthetic-task", "old-owner", 1)
    try:
        with pytest.raises(asyncio.CancelledError):
            await batch._merge_image_texts(execution.job_id, None, {})
    finally:
        clear_fencing_context(token)
    async with execution.sessions() as db:
        job = await db.get(ImportBatchJob, execution.job_id)
        assert job.current_owner_token == "new-owner"
        assert job.merge_status == "completed" and job.merged_batch_id == "new-review"
        assert job.merge_error is None


@pytest.mark.asyncio
async def test_sqlite_takeover_cannot_pass_between_merge_fence_check_and_commit(
    execution, monkeypatch
):
    from contextlib import asynccontextmanager

    from app.features import pipeline_coordinator_entry
    from app.features.pipeline_checkpoint import (
        clear_fencing_context,
        set_fencing_context,
    )

    old_commit_ready = asyncio.Event()
    release_old = asyncio.Event()
    new_started = asyncio.Event()
    new_done = asyncio.Event()
    async with execution.sessions() as db:
        job = await db.get(ImportBatchJob, execution.job_id)
        job.status = "merging"
        job.current_task_id = "synthetic-task"
        job.current_owner_token = "old-owner"
        job.execution_generation = 1
        await db.execute(
            update(ImportBatchJobItem)
            .where(
                ImportBatchJobItem.job_id == execution.job_id,
            )
            .values(
                status="succeeded",
                ocr_cleaned_text="synthetic OCR",
                review_batch_id="old-review",
            )
        )
        await db.commit()

    @asynccontextmanager
    async def old_sessions():
        async with execution.sessions() as db:
            commit = db.commit

            async def pause_before_commit():
                old_commit_ready.set()
                await release_old.wait()
                await commit()

            db.commit = pause_before_commit
            yield db

    async def takeover():
        async with execution.sessions() as db:
            new_started.set()
            await db.execute(
                update(ImportBatchJob)
                .where(
                    ImportBatchJob.job_id == execution.job_id,
                )
                .values(
                    current_owner_token="new-owner",
                    execution_generation=2,
                    status="completed",
                    merge_status="completed",
                    merged_batch_id="new-review",
                    merge_error=None,
                )
            )
            await db.commit()
            new_done.set()

    monkeypatch.setattr(batch, "async_session", old_sessions)
    monkeypatch.setattr(
        pipeline_coordinator_entry,
        "run_pipeline",
        AsyncMock(
            return_value={
                "status": "failed",
                "errors": ["old merge failure"],
            }
        ),
    )
    token = set_fencing_context("synthetic-task", "old-owner", 1)
    old = asyncio.create_task(batch._merge_image_texts(execution.job_id, None, {}))
    clear_fencing_context(token)
    await asyncio.wait_for(old_commit_ready.wait(), timeout=5)
    new = asyncio.create_task(takeover())
    try:
        await asyncio.wait_for(new_started.wait(), timeout=5)
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(new_done.wait(), timeout=0.1)
    finally:
        release_old.set()
        outcomes = await asyncio.gather(old, new, return_exceptions=True)
    assert all(not isinstance(outcome, BaseException) for outcome in outcomes)
    async with execution.sessions() as db:
        job = await db.get(ImportBatchJob, execution.job_id)
        assert job.current_owner_token == "new-owner" and job.execution_generation == 2
        assert job.merge_status == "completed" and job.merged_batch_id == "new-review"
        assert job.merge_error is None


@pytest.mark.asyncio
async def test_child_failure_drains_siblings_before_terminal_cleanup(
    execution, monkeypatch
):
    second_started = asyncio.Event()
    second_stopped = asyncio.Event()
    release = asyncio.Event()
    children = []
    source_existed_at_stop = []

    async def process(_sem, *, src, **_kwargs):
        children.append(asyncio.current_task())
        if src.seq == 1:
            await second_started.wait()
            raise RuntimeError("synthetic bookkeeping failure")
        second_started.set()
        try:
            await release.wait()
        finally:
            source_existed_at_stop.append(Path(src.temp_path).exists())
            second_stopped.set()

    monkeypatch.setattr(batch, "_process_source", process)
    try:
        await batch.run_batch_job(
            job_id=execution.job_id,
            sources=execution.sources,
            subject=None,
            options={},
            concurrency=2,
        )
        assert second_stopped.is_set(), (
            "job returned while another child could still write"
        )
        assert source_existed_at_stop == [True], "cleanup raced a running child"
        async with execution.sessions() as db:
            states = (
                (await db.execute(select(ImportBatchJobItem.status))).scalars().all()
            )
            assert states == ["failed", "failed"]
    finally:
        release.set()
        await asyncio.gather(*children, return_exceptions=True)


@pytest.mark.asyncio
async def test_failed_pipeline_emits_failed_trace(execution, monkeypatch):
    from app.features import pipeline_coordinator_entry

    update = AsyncMock()
    monkeypatch.setattr(batch, "_update_item_with_trace", update)
    monkeypatch.setattr(
        batch, "_run_vl_ocr", AsyncMock(return_value="1. synthetic question")
    )
    monkeypatch.setattr(
        pipeline_coordinator_entry,
        "run_pipeline",
        AsyncMock(
            return_value={"status": "failed", "errors": ["synthetic quality rejection"]}
        ),
    )
    result = await batch._run_single_image(
        1,
        "synthetic.png",
        b"",
        None,
        None,
        {"ocr_mode": "api", "batch_fast_mode": False},
        execution.job_id,
        1,
    )
    assert result["status"] == "failed"
    pipeline_done = [
        call.kwargs["trace"]
        for call in update.await_args_list
        if call.kwargs["trace"].step == "pipeline"
        and call.kwargs["trace"].status != "running"
    ]
    assert len(pipeline_done) == 1 and pipeline_done[0].status == "failed"


@pytest.mark.asyncio
async def test_parent_cancellation_propagates_without_terminal_write(
    execution, monkeypatch
):
    started = asyncio.Event()
    stopped = []

    async def process(_sem, *, src, **_kwargs):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.append(Path(src.temp_path).exists())

    monkeypatch.setattr(batch, "_process_source", process)
    task = asyncio.create_task(
        batch.run_batch_job(
            job_id=execution.job_id,
            sources=execution.sources,
            subject=None,
            options={},
            concurrency=2,
        )
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert stopped and all(stopped)
    async with execution.sessions() as db:
        job = await db.get(ImportBatchJob, execution.job_id)
        # The durable dispatcher/fence owner, rather than the cancelled child,
        # decides whether this execution is retried, interrupted or cancelled.
        assert job.status == "running" and job.finished_at is None


@pytest.mark.asyncio
async def test_missing_staged_source_finishes_as_retryable_item(execution, monkeypatch):
    async def process(_sem, *, item_id, **_kwargs):
        async with execution.sessions() as db:
            await db.execute(
                update(ImportBatchJobItem)
                .where(
                    ImportBatchJobItem.id == item_id,
                )
                .values(status="succeeded", review_batch_id="synthetic-review")
            )
            await db.commit()

    monkeypatch.setattr(batch, "_process_source", process)
    await batch.run_batch_job(
        job_id=execution.job_id,
        sources=execution.sources[:1],
        subject=None,
        options={},
        concurrency=1,
    )
    async with execution.sessions() as db:
        items = (
            (
                await db.execute(
                    select(ImportBatchJobItem).order_by(ImportBatchJobItem.seq)
                )
            )
            .scalars()
            .all()
        )
        assert items[0].status == "succeeded"
        assert items[1].status == "failed" and items[1].finished_at


@pytest.mark.asyncio
async def test_missing_item_mapping_cannot_report_empty_success(execution):
    async with execution.sessions() as db:
        await db.execute(delete(ImportBatchJobItem))
        await db.commit()
    await batch.run_batch_job(
        job_id=execution.job_id,
        sources=execution.sources,
        subject=None,
        options={},
        concurrency=1,
    )
    async with execution.sessions() as db:
        job = await db.get(ImportBatchJob, execution.job_id)
        assert job.status == "failed"
