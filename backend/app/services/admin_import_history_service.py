"""Paginated read model for document/image pipelines and batch-image jobs."""

from __future__ import annotations

from math import ceil
from typing import Any

from sqlalchemy import Integer, cast, func, literal, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time_utils import serialize_utc_datetime
from app.features.pipeline_orchestrator import _get_pipeline_store
from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem
from app.models.import_pipeline import ImportPipeline, ImportPipelineChunk
from app.models.question_import import QuestionImport
from app.services.import_pipeline_service import _get_image_pipeline_status


def _run_rows() -> Any:
    pipelines = select(
        ImportPipeline.pipeline_id,
        literal("pipeline").label("run_type"),
        ImportPipeline.source_type,
        ImportPipeline.source_file,
        ImportPipeline.status,
        ImportPipeline.total_pages,
        ImportPipeline.error_message,
        ImportPipeline.started_at,
        ImportPipeline.finished_at,
        ImportPipeline.quality_report,
        ImportPipeline.alerts,
        cast(literal(None), Integer).label("total_images"),
        literal(None).label("merged_batch_id"),
    )
    first_file = (
        select(func.min(ImportBatchJobItem.source_file))
        .where(
            ImportBatchJobItem.job_id == ImportBatchJob.job_id,
        )
        .correlate(ImportBatchJob)
        .scalar_subquery()
    )
    jobs = select(
        ImportBatchJob.job_id.label("pipeline_id"),
        literal("batch_image").label("run_type"),
        ImportBatchJob.source_type,
        first_file.label("source_file"),
        ImportBatchJob.status,
        cast(literal(None), Integer).label("total_pages"),
        ImportBatchJob.error_message,
        ImportBatchJob.started_at,
        ImportBatchJob.finished_at,
        literal(None).label("quality_report"),
        literal(None).label("alerts"),
        ImportBatchJob.total.label("total_images"),
        ImportBatchJob.merged_batch_id,
    ).where(
        ~select(ImportPipeline.pipeline_id)
        .where(
            ImportPipeline.pipeline_id == ImportBatchJob.job_id,
        )
        .exists()
    )
    return union_all(pipelines, jobs).subquery()


async def _batch_links(db: AsyncSession, rows: list[Any]) -> dict[str, set[str]]:
    links: dict[str, set[str]] = {row.pipeline_id: set() for row in rows}
    if not links:
        return links
    chunk_links = await db.execute(
        select(
            ImportPipelineChunk.pipeline_id,
            ImportPipelineChunk.batch_id,
        ).where(
            ImportPipelineChunk.pipeline_id.in_(links),
            ImportPipelineChunk.batch_id.is_not(None),
        )
    )
    item_links = await db.execute(
        select(
            ImportBatchJobItem.job_id,
            ImportBatchJobItem.review_batch_id,
        ).where(
            ImportBatchJobItem.job_id.in_(links),
            ImportBatchJobItem.review_batch_id.is_not(None),
        )
    )
    for identifier, batch_id in [*chunk_links.all(), *item_links.all()]:
        if batch_id:
            links[identifier].add(batch_id)
    for row in rows:
        if row.merged_batch_id:
            links[row.pipeline_id] = {row.merged_batch_id}
    return links


async def _snapshot(row: Any) -> dict[str, Any]:
    if row.run_type == "batch_image":
        return {}
    if row.source_type == "image":
        return await _get_image_pipeline_status(row.pipeline_id) or {}
    return await _get_pipeline_store(row.pipeline_id) or {}


def _run_item(
    row: Any, snapshot: dict, batches: set[str], counts: dict[str, int]
) -> dict:
    item = {
        "pipeline_id": row.pipeline_id,
        "run_type": row.run_type,
        "source_type": row.source_type,
        "source_file": row.source_file,
        "status": row.status,
        "total_pages": row.total_pages,
        "error_message": row.error_message,
        "started_at": serialize_utc_datetime(row.started_at)
        if row.started_at
        else None,
        "finished_at": serialize_utc_datetime(row.finished_at)
        if row.finished_at
        else None,
        "batch_id": next(iter(batches)) if len(batches) == 1 else None,
        "batch_ids": sorted(batches),
        "question_count": sum(counts.get(batch_id, 0) for batch_id in batches),
    }
    if not batches and row.status in {"completed", "completed_with_warnings"}:
        # Legacy non-chunked runs may predate durable batch linkage.
        item["question_count"] = snapshot.get("question_count")
    if row.run_type == "batch_image":
        item.update(job_id=row.pipeline_id, total_images=row.total_images)
    for field in ("quality_report", "alerts"):
        value = snapshot.get(field) or getattr(row, field)
        if value:
            item[field] = value
    return item


async def list_import_runs(
    db: AsyncSession,
    page: int,
    page_size: int,
    status: str | None = None,
    source_type: str | None = None,
    sort_by: str = "started_at",
    keyword: str | None = None,
) -> dict[str, Any]:
    runs = _run_rows()
    conditions = []
    if status:
        conditions.append(runs.c.status == status)
    if source_type:
        conditions.append(runs.c.source_type == source_type)
    if keyword:
        pattern = f"%{keyword}%"
        conditions.append(
            or_(runs.c.pipeline_id.ilike(pattern), runs.c.source_file.ilike(pattern))
        )
    total = int(
        await db.scalar(select(func.count()).select_from(runs).where(*conditions)) or 0
    )
    allowed = {
        "started_at",
        "finished_at",
        "status",
        "source_type",
        "total_pages",
        "pipeline_id",
    }
    order = runs.c[sort_by if sort_by in allowed else "started_at"]
    result = await db.execute(
        select(runs)
        .where(*conditions)
        .order_by(
            order.desc().nulls_last(),
            runs.c.pipeline_id.desc(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return await _project_page(db, list(result.all()), total, page, page_size)


async def _project_page(
    db: AsyncSession,
    rows: list[Any],
    total: int,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    links = await _batch_links(db, rows)
    snapshots = {row.pipeline_id: await _snapshot(row) for row in rows}
    for identifier, snapshot in snapshots.items():
        if snapshot.get("batch_id"):
            links[identifier].add(snapshot["batch_id"])
    batch_ids = {bid for batches in links.values() for bid in batches}
    counts = {}
    if batch_ids:
        result = await db.execute(
            select(
                QuestionImport.batch_id,
                func.count(QuestionImport.id),
            )
            .where(QuestionImport.batch_id.in_(batch_ids))
            .group_by(QuestionImport.batch_id)
        )
        counts = dict(result.all())
    return {
        "items": [
            _run_item(row, snapshots[row.pipeline_id], links[row.pipeline_id], counts)
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": ceil(total / page_size),
    }
