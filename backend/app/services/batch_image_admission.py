"""Serialize batch delivery and compensate only a confirmed, quiescent refusal."""

import asyncio
from collections.abc import Awaitable, Callable

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import utcnow
from app.models.import_batch_job import (
    BatchJobTraceEvent,
    ImportBatchJob,
    ImportBatchJobItem,
)
from app.services.import_enqueue_outcome import (
    ImportEnqueueUncertainError,
    require_known_enqueue_outcome,
)
from app.services.task_queue_contract import EnqueueResult


async def _commit_delivery_state(db: AsyncSession) -> bool:
    commit = asyncio.create_task(db.commit())
    cancelled = False
    while not commit.done():
        try:
            await asyncio.shield(commit)
        except asyncio.CancelledError:
            cancelled = True
    commit.result()
    return cancelled


async def dispatch_batch_admission(
    db: AsyncSession,
    job_id: str,
    enqueue: Callable[[], Awaitable[EnqueueResult]],
) -> EnqueueResult | None:
    """Hold a DB write lock across dispatch and compensation, including SQLite."""
    await db.rollback()  # admission is committed; discard any stale read snapshot
    await db.execute(
        update(ImportBatchJob)
        .where(ImportBatchJob.job_id == job_id)
        .values(
            queued_at=ImportBatchJob.queued_at,
        )
    )
    job = await db.get(ImportBatchJob, job_id, populate_existing=True)
    if (
        job is None
        or job.status != "queued"
        or job.current_owner_token
        or job.execution_status == "enqueued"
    ):
        await db.rollback()
        return None
    previously_uncertain = job.execution_status == "enqueue_unknown"
    try:
        result = await enqueue()
        require_known_enqueue_outcome(result, job_id)
    except (Exception, asyncio.CancelledError) as exc:
        job.execution_status = "enqueue_unknown"
        cancelled = await _commit_delivery_state(db)
        if cancelled and not isinstance(exc, asyncio.CancelledError):
            raise asyncio.CancelledError from exc
        raise
    if not result and previously_uncertain:
        await db.commit()
        raise ImportEnqueueUncertainError(job_id)
    if not result:
        await fail_batch_admission(db, job_id, f"任务入队失败: {result.reason}")
    else:
        job.execution_status = "enqueued"
        if await _commit_delivery_state(db):
            raise asyncio.CancelledError
    return result


async def fail_batch_admission(db: AsyncSession, job_id: str, message: str) -> None:
    """Fail only an unclaimed upload after the queue explicitly rejected it.

    A worker that has started owns the lifecycle. Shared staging objects are
    retained under the existing retention policy, not deleted by the producer.
    """
    job = await db.get(
        ImportBatchJob, job_id, with_for_update=True, populate_existing=True
    )
    if job is None or job.status != "queued" or job.current_owner_token:
        return
    now = utcnow()
    job.status = "failed"
    job.error_message = message
    job.execution_status = "failed"
    job.finished_at = now
    job.updated_at = now
    await db.execute(
        update(ImportBatchJobItem)
        .where(
            ImportBatchJobItem.job_id == job_id, ImportBatchJobItem.status == "pending"
        )
        .values(status="failed", error_message=message, finished_at=now, updated_at=now)
    )
    db.add(
        BatchJobTraceEvent(
            job_id=job_id,
            seq=job.next_event_seq,
            step="error",
            status="failed",
            message=message[:512],
            created_at=now,
        )
    )
    job.next_event_seq += 1
    await db.commit()
