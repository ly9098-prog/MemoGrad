"""Reserve and submit the existing app-side PDF resume without weakening fencing."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_pipeline import ImportPipeline
from app.services.import_recovery_service import ImportRecoveryError
from app.services.task_queue_contract import EnqueueResult

ResumeEnqueue = Callable[..., Awaitable[EnqueueResult]]


async def _reserve_resume(
    db: AsyncSession, row: ImportPipeline, retry_token: str
) -> None:
    result = await db.execute(
        update(ImportPipeline)
        .where(
            ImportPipeline.pipeline_id == row.pipeline_id,
            ImportPipeline.status.in_(("paused", "failed")),
            ImportPipeline.created_by == row.created_by,
            ImportPipeline.current_task_id == row.current_task_id,
            ImportPipeline.current_owner_token == row.current_owner_token,
            ImportPipeline.execution_generation == row.execution_generation,
        )
        .values(
            status="queued",
            error_message=None,
            finished_at=None,
            current_task_id=f"resume:{retry_token}",
            current_owner_token=f"pending:{retry_token}",
            execution_generation=0,
            execution_status="queued",
        )
        .execution_options(synchronize_session=False)
    )
    if not result.rowcount:
        await db.rollback()
        raise ImportRecoveryError("流水线已在恢复或执行状态已变化", 409)
    await db.commit()


async def _compensate_resume(
    db: AsyncSession, row: ImportPipeline, retry_token: str
) -> None:
    # Preserve the original failure, but revoke this reservation as well: an
    # enqueue exception can occur after Redis has accepted the task.
    await db.execute(
        update(ImportPipeline)
        .where(
            ImportPipeline.pipeline_id == row.pipeline_id,
            ImportPipeline.status == "queued",
            ImportPipeline.current_task_id == f"resume:{retry_token}",
            ImportPipeline.current_owner_token == f"pending:{retry_token}",
            ImportPipeline.execution_generation == 0,
            ImportPipeline.execution_status == "queued",
        )
        .values(
            status=row.status,
            error_message=row.error_message,
            finished_at=row.finished_at,
            execution_status="failed",
            current_task_id=f"rejected:{retry_token}",
        )
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def submit_public_resume(
    db: AsyncSession,
    row: ImportPipeline,
    staging_object_id: str,
    subject: str | None,
    options: dict[str, Any],
    enqueue: ResumeEnqueue,
) -> None:
    """Hand off the observed owner atomically before a new resume task can run."""
    retry_token = uuid.uuid4().hex
    await _reserve_resume(db, row, retry_token)
    try:
        result = await enqueue(
            pipeline_id=row.pipeline_id,
            staging_object_id=staging_object_id,
            subject=subject,
            subject_id=None,
            options=options,
            retry_token=retry_token,
        )
        if not result:
            raise ImportRecoveryError("任务队列已满，请稍后重试", 503)
    except BaseException:
        await _compensate_resume(db, row, retry_token)
        raise
