"""Reenter interrupted batch work only under the newly acquired DB fence."""

import asyncio

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem


async def lock_batch_job(db: AsyncSession, job_id: str) -> ImportBatchJob | None:
    if db.get_bind().dialect.name == "sqlite":
        # SQLite ignores FOR UPDATE. Acquire its write lock before reading the
        # owner so a takeover cannot commit between validation and an ORM flush.
        await db.execute(
            update(ImportBatchJob)
            .where(ImportBatchJob.job_id == job_id)
            .values(
                queued_at=ImportBatchJob.queued_at,
            )
        )
    return await db.get(
        ImportBatchJob, job_id, with_for_update=True, populate_existing=True
    )


def verify_batch_owner(job: ImportBatchJob | None) -> None:
    from app.features.pipeline_checkpoint import get_fencing_context

    fence = get_fencing_context()
    if fence is not None and (
        job is None
        or (
            job.current_task_id != fence["task_id"]
            or job.current_owner_token != fence["owner_token"]
            or job.execution_generation != fence["generation"]
        )
    ):
        raise asyncio.CancelledError("Batch execution ownership lost")


async def prepare_batch_reentry(
    db: AsyncSession,
    job_id: str,
    *,
    task_id: str,
    owner_token: str,
    generation: int,
) -> bool:
    job = await lock_batch_job(db, job_id)
    if job is None or (
        job.current_task_id != task_id
        or job.current_owner_token != owner_token
        or job.execution_generation != generation
        or not owner_token
    ):
        raise asyncio.CancelledError("Batch execution ownership lost")
    if job.status in {"completed", "completed_with_warnings", "failed", "cancelled"}:
        return False
    if job.status in {"running", "merging"}:
        # The new DB fence authorizes reentry. Late writes from an old owner are
        # rejected by verify_batch_owner; successful review batches survive.
        job.status = "queued"
        job.finished_at = None
        job.error_message = None
        await db.execute(
            update(ImportBatchJobItem)
            .where(
                ImportBatchJobItem.job_id == job_id,
                ImportBatchJobItem.status == "processing",
            )
            .values(
                status="pending", started_at=None, finished_at=None, error_message=None
            )
        )
        await db.commit()
    return True
