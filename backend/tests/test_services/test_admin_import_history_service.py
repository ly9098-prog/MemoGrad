"""History includes zero-item failures and applies pagination/filtering in SQL."""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem
from app.models.import_pipeline import ImportPipeline, ImportPipelineChunk
from app.models.question_import import QuestionImport
from app.models.admin import Subject
from app.services import admin_import_history_service as history
from app.services.admin_import_service import (
    get_import_batch_detail,
    list_import_batches,
)


@pytest_asyncio.fixture
async def db(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [
        Subject.__table__,
        ImportPipeline.__table__,
        ImportPipelineChunk.__table__,
        ImportBatchJob.__table__,
        ImportBatchJobItem.__table__,
        QuestionImport.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync: Subject.metadata.create_all(sync, tables=tables)
        )
    monkeypatch.setattr(history, "_get_pipeline_store", AsyncMock(return_value={}))
    monkeypatch.setattr(
        history, "_get_image_pipeline_status", AsyncMock(return_value={})
    )
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


def question(identifier: int, batch_id: str, status: str = "pending") -> QuestionImport:
    return QuestionImport(
        id=identifier,
        batch_id=batch_id,
        source_type="image",
        source_file="same.png",
        status=status,
        raw_data={},
        parsed_content={"text": f"题目{identifier}"},
        parsed_answer="A",
        ai_generated=False,
        ai_answer_flag=False,
    )


@pytest.mark.asyncio
async def test_batch_id_filter_is_exact_and_detail_total_respects_status(db):
    db.add_all(
        [
            question(1, "batch_1"),
            question(2, "batch_1", "approved"),
            question(3, "batch_10"),
            question(4, "batchX1"),
        ]
    )
    await db.commit()
    batches, total = await list_import_batches(db, 1, 1, batch_id="batch_1")
    assert total == 1 and [item["batch_id"] for item in batches] == ["batch_1"]
    assert batches[0]["total_count"] == 2
    detail = await get_import_batch_detail(db, "batch_1", 1, 1, "approved")
    assert (
        detail.total_count,
        detail.total,
        detail.total_pages,
        len(detail.items),
    ) == (2, 1, 1, 1)
    assert detail.items[0].id == 2
    beyond = await get_import_batch_detail(db, "batch_1", 2, 1, "approved")
    assert beyond.items == [] and beyond.total == 1 and beyond.total_pages == 1
    empty = await get_import_batch_detail(db, "batch_1", 1, 20, "rejected")
    assert empty.items == [] and empty.total == 0 and empty.total_pages == 0


async def seed_runs(db) -> None:
    now = datetime(2026, 11, 18, 12)
    db.add_all(
        [
            ImportPipeline(
                pipeline_id="img-timeout",
                source_type="image",
                source_file="failed.png",
                status="failed",
                chunk_size=1,
                started_at=now,
                error_message="ocr.remote_timeout",
                quality_report={"grade": "D"},
            ),
            ImportPipeline(
                pipeline_id="pl-complete",
                source_type="pdf",
                source_file="paper.pdf",
                status="completed",
                chunk_size=1,
                started_at=now - timedelta(minutes=1),
            ),
            ImportBatchJob(
                job_id="batch-partial",
                source_type="image",
                status="completed",
                total=2,
                concurrency=2,
                started_at=now - timedelta(minutes=2),
            ),
        ]
    )
    await db.flush()
    db.add_all(
        [
            ImportPipelineChunk(
                pipeline_id="pl-complete",
                chunk_index=0,
                page_start=1,
                page_end=1,
                status="completed",
                batch_id="review-pdf",
                question_count=1,
            ),
            ImportBatchJobItem(
                job_id="batch-partial",
                seq=1,
                source_file="success.png",
                status="succeeded",
                review_batch_id="review-image",
                question_count=2,
            ),
            ImportBatchJobItem(
                job_id="batch-partial", seq=2, source_file="failed.png", status="failed"
            ),
            question(1, "review-pdf"),
            question(2, "review-image"),
            question(3, "review-image"),
        ]
    )
    await db.commit()


@pytest.mark.asyncio
async def test_history_keeps_zero_item_failures_and_batch_jobs_with_exact_content_links(
    db,
):
    await seed_runs(db)
    page = await history.list_import_runs(db, 1, 2)
    assert (page["total"], page["total_pages"]) == (3, 2)
    assert [row["pipeline_id"] for row in page["items"]] == [
        "img-timeout",
        "pl-complete",
    ]
    failure, document = page["items"]
    assert failure["question_count"] == 0 and failure["batch_id"] is None
    assert failure["error_message"] == "ocr.remote_timeout"
    assert failure["quality_report"] == {"grade": "D"}
    assert document["batch_id"] == "review-pdf" and document["question_count"] == 1
    second = await history.list_import_runs(db, 2, 2)
    batch = second["items"][0]
    assert (batch["job_id"], batch["run_type"], batch["question_count"]) == (
        "batch-partial",
        "batch_image",
        2,
    )
    assert batch["batch_id"] == "review-image" and batch["total_images"] == 2
    assert (await history.list_import_runs(db, 4, 2))["items"] == []


@pytest.mark.asyncio
async def test_history_status_source_and_keyword_filter_share_count_and_page(db):
    await seed_runs(db)
    failed = await history.list_import_runs(
        db, 1, 20, status="failed", source_type="image"
    )
    assert failed["total"] == 1 and failed["items"][0]["pipeline_id"] == "img-timeout"
    complete_images = await history.list_import_runs(
        db, 1, 20, status="completed", source_type="image"
    )
    assert (
        complete_images["total"] == 1
        and complete_images["items"][0]["job_id"] == "batch-partial"
    )
    keyword = await history.list_import_runs(
        db, 1, 20, keyword="paper.pdf", sort_by="__dict__"
    )
    assert keyword["total"] == 1 and keyword["items"][0]["batch_id"] == "review-pdf"
