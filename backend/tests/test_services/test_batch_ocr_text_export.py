"""Partial OCR sidecars remain useful after downstream parsing failures."""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem
from app.services import batch_ocr_text_export as exports


@pytest_asyncio.fixture
async def text_db(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'texts.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            db.add(ImportBatchJob(job_id="synthetic-job", status="failed", total=3))
            db.add_all(
                [
                    ImportBatchJobItem(
                        id=2,
                        job_id="synthetic-job",
                        seq=2,
                        status="failed",
                        source_file="二.png",
                        ocr_raw_text="原始 OCR\n第2页",
                        ocr_cleaned_text="清洗文本\n第2页",
                    ),
                    ImportBatchJobItem(
                        id=1,
                        job_id="synthetic-job",
                        seq=1,
                        status="succeeded",
                        source_file="one.png",
                        ocr_raw_text="first raw",
                        ocr_cleaned_text="first cleaned",
                    ),
                    ImportBatchJobItem(
                        id=3,
                        job_id="synthetic-job",
                        seq=3,
                        status="pending",
                        source_file="three.png",
                    ),
                ]
            )
            await db.commit()
            yield db
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_partial_export_preserves_order_and_marks_missing_text(text_db):
    result = await exports.export_batch_ocr_text(text_db, "synthetic-job", "cleaned")
    assert result.filename == "ocr-synthetic-job-cleaned.txt"
    assert "cached: 2/3" in result.content
    assert result.content.index("first cleaned") < result.content.index("清洗文本")
    assert (
        "three.png [pending]" in result.content
        and "OCR text unavailable" in result.content
    )
    assert "原始 OCR" not in result.content


@pytest.mark.asyncio
async def test_failed_item_raw_text_is_available_without_rerunning_ocr(text_db):
    result = await exports.export_item_ocr_text(text_db, 2, "raw")
    assert "原始 OCR\n第2页" in result.content
    assert "first raw" not in result.content and "清洗文本" not in result.content


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,identifier,code",
    [("batch", "unknown", 404), ("item", 99, 404), ("item", 3, 409)],
)
async def test_absent_tasks_or_caches_are_explicit_errors(
    text_db, kind, identifier, code
):
    function = (
        exports.export_batch_ocr_text
        if kind == "batch"
        else exports.export_item_ocr_text
    )
    with pytest.raises(exports.OcrTextExportError) as failure:
        await function(text_db, identifier, "cleaned")
    assert failure.value.status_code == code


@pytest.mark.asyncio
async def test_utf8_size_budget_is_checked_in_bytes(text_db, monkeypatch):
    monkeypatch.setattr(exports, "MAX_EXPORT_BYTES", 250)
    item = await text_db.get(ImportBatchJobItem, 2)
    item.ocr_raw_text = "中" * 100
    await text_db.commit()
    with pytest.raises(exports.OcrTextExportError) as failure:
        await exports.export_item_ocr_text(text_db, 2, "raw")
    assert failure.value.status_code == 413
