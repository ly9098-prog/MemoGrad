"""Retry one failed batch item through the existing batch-image worker.

Successful items and their review batches are never resubmitted. The original
job's durable fence serializes manual retry with any active batch execution.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import UploadFile
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem
from app.services import import_pipeline_service as runtime
from app.services.import_recovery_context import load_recovery_context
from app.services.import_recovery_service import (
    ImportRecoveryError,
    stage_recovery_file,
)


async def _load_item(
    db: AsyncSession,
    item_id: int,
) -> tuple[ImportBatchJobItem, ImportBatchJob]:
    item = await db.get(ImportBatchJobItem, item_id)
    if item is None:
        raise ImportRecoveryError("批量导题条目不存在", 404)
    job = await db.get(ImportBatchJob, item.job_id)
    if job is None:
        raise ImportRecoveryError("批量导题任务不存在", 404)
    if item.status != "failed":
        raise ImportRecoveryError("仅支持重新上传失败条目，成功条目不会重复导入", 409)
    if job.status not in {"failed", "completed", "cancelled", "interrupted"}:
        raise ImportRecoveryError("批量任务仍在处理中，请等待结束后重试", 409)
    return item, job


async def _claim_item(
    db: AsyncSession,
    item: ImportBatchJobItem,
    job: ImportBatchJob,
    retry_token: str,
) -> None:
    claimed = await db.execute(
        update(ImportBatchJob)
        .where(
            ImportBatchJob.job_id == job.job_id,
            ImportBatchJob.status.in_(
                ("failed", "completed", "cancelled", "interrupted")
            ),
            ImportBatchJob.current_task_id == job.current_task_id,
            ImportBatchJob.current_owner_token == job.current_owner_token,
            ImportBatchJob.execution_generation == job.execution_generation,
        )
        .values(
            status="queued",
            finished_at=None,
            error_message=None,
            current_task_id=f"batch_image:{retry_token}",
            current_owner_token=f"pending:{retry_token}",
            execution_generation=0,
            execution_status="queued",
        )
        .execution_options(synchronize_session=False)
    )
    if not claimed.rowcount:
        await db.rollback()
        raise ImportRecoveryError("任务已在处理或已提交重试，请刷新状态", 409)
    changed = await db.execute(
        update(ImportBatchJobItem)
        .where(
            ImportBatchJobItem.id == item.id,
            ImportBatchJobItem.status == "failed",
        )
        .values(status="pending", error_message=None, finished_at=None)
        .execution_options(synchronize_session=False)
    )
    if not changed.rowcount:
        await db.rollback()
        raise ImportRecoveryError("条目已在处理或已提交重试，请刷新状态", 409)
    await db.commit()


async def _restore_item(
    db: AsyncSession,
    item: ImportBatchJobItem,
    job: ImportBatchJob,
    retry_token: str,
) -> None:
    restored = await db.execute(
        update(ImportBatchJob)
        .where(
            ImportBatchJob.job_id == job.job_id,
            ImportBatchJob.status == "queued",
            ImportBatchJob.current_task_id == f"batch_image:{retry_token}",
            ImportBatchJob.execution_status == "queued",
        )
        .values(
            status=job.status,
            error_message=job.error_message,
            finished_at=job.finished_at,
            execution_status="failed",
            current_task_id=f"rejected:{retry_token}",
        )
        .execution_options(synchronize_session=False)
    )
    if not restored.rowcount:
        await db.rollback()
        return
    await db.execute(
        update(ImportBatchJobItem)
        .where(
            ImportBatchJobItem.id == item.id,
            ImportBatchJobItem.status == "pending",
        )
        .values(
            status="failed",
            error_message=item.error_message,
            finished_at=item.finished_at,
        )
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def retry_batch_image_item(
    db: AsyncSession,
    item_id: int,
    file: UploadFile,
) -> dict[str, Any]:
    from app.services.task_queue_worker import enqueue_batch_image_job

    item, job = await _load_item(db, item_id)
    context = await load_recovery_context(job.job_id, "batch_image")
    if not context:
        raise ImportRecoveryError(
            "原任务设置已过期，无法安全恢复，请重新创建导入任务",
            409,
            "IMPORT_RECOVERY_CONTEXT_EXPIRED",
        )
    staged = await stage_recovery_file(file, "image", item.source_sha256)
    retry_token = uuid.uuid4().hex
    await _claim_item(db, item, job, retry_token)
    try:
        result = await enqueue_batch_image_job(
            job_id=job.job_id,
            staging_object_ids=[staged.object_id],
            subject=context.get("subject"),
            subject_id=context.get("subject_id", job.subject_id),
            options=context.get("options") or {},
            concurrency=job.concurrency,
            source_seqs=[item.seq],
            source_files=[item.source_file or file.filename or "image.png"],
            retry_token=retry_token,
        )
        if not result:
            raise ImportRecoveryError(
                runtime._queue_rejection_message(result.reason), 503
            )
    except Exception:
        await _restore_item(db, item, job, retry_token)
        raise
    return {
        "job_id": job.job_id,
        "item_id": item.id,
        "status": "queued",
        "review_batch_id": item.review_batch_id,
        "question_count": item.question_count or 0,
        "error_message": None,
    }
