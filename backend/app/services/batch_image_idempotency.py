"""Request identity and conflict checks shared by batch upload admission paths."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem


class BatchSubmissionConflictError(ValueError):
    """An idempotency key has already been used for another submission."""


def validate_submission_ids(
    *,
    request_id: str | None,
    batch_id: str | None,
    image_id: str | None,
    image_ids: list[str],
) -> None:
    for value in (request_id, batch_id, image_id, *image_ids):
        if value is not None and (
            not value.strip()
            or len(value) > 64
            or any(ord(char) < 32 for char in value)
        ):
            raise ValueError("导入标识必须为 1–64 个非空白字符，不能包含控制字符")
    if len(image_ids) != len(set(image_ids)):
        raise ValueError("image_ids 不能重复")


def submission_fingerprint(payload: dict[str, Any]) -> str:
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def duplicate_submission(
    db: AsyncSession,
    job_id: str,
    fingerprint: str,
    created_by: str | None,
) -> ImportBatchJob:
    existing = await db.get(ImportBatchJob, job_id, populate_existing=True)
    if existing is None:
        raise BatchSubmissionConflictError("原任务已不存在，请使用新的 request_id")
    if existing.submission_fingerprint is None:
        raise BatchSubmissionConflictError(
            "历史任务缺少完整提交指纹，无法确认一致，请查询原任务或使用新的导入标识"
        )
    if existing.created_by != created_by or (
        existing.submission_fingerprint != fingerprint
    ):
        raise BatchSubmissionConflictError(
            "request_id 已用于其他文件或参数，请使用新的 request_id"
        )
    return ImportBatchJob(
        job_id=existing.job_id,
        status="duplicate",
        total=existing.total,
        concurrency=existing.concurrency,
    )


async def reject_reused_image_ids(
    db: AsyncSession,
    batch_id: str | None,
    image_ids: list[str | None],
) -> None:
    if not batch_id:
        return
    existing = await db.scalar(
        select(ImportBatchJobItem.id)
        .where(
            ImportBatchJobItem.batch_import_id == batch_id,
            ImportBatchJobItem.image_import_id.in_(
                [value for value in image_ids if value]
            ),
        )
        .limit(1)
    )
    if existing is not None:
        raise BatchSubmissionConflictError(
            "batch_id/image_ids 已使用，请恢复失败条目或使用新的标识"
        )
