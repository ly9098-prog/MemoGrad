"""Manual recovery uses original bytes/settings and preserves successful items."""

from __future__ import annotations

import hashlib
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import UploadFile
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import Headers

from app.models.admin import Subject
from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem
from app.models.import_pipeline import ImportPipeline
from app.services import batch_image_recovery_service as batch
from app.services import import_recovery_service as recovery
from app.services import task_queue_worker as queue
from app.services.import_recovery_context import save_recovery_context
from app.services.task_queue_contract import EnqueueResult


def image_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (16, 16), "white").save(output, format="PNG")
    return output.getvalue()


def upload(content: bytes | None = None, name: str = "original.png") -> UploadFile:
    return UploadFile(
        BytesIO(image_bytes() if content is None else content),
        filename=name,
        headers=Headers({"content-type": "image/png"}),
    )


@pytest_asyncio.fixture
async def db(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [
        Subject.__table__,
        ImportPipeline.__table__,
        ImportBatchJob.__table__,
        ImportBatchJobItem.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync: Subject.metadata.create_all(sync, tables=tables)
        )
    monkeypatch.setattr(
        recovery,
        "async_store_file",
        AsyncMock(
            return_value=SimpleNamespace(object_id="staged-original"),
        ),
    )
    monkeypatch.setattr(
        recovery.runtime,
        "_get_image_pipeline_status",
        AsyncMock(
            return_value={"status": "failed", "errors": ["ocr.remote_timeout"]},
        ),
    )
    monkeypatch.setattr(
        recovery.orchestrator, "_get_stage_checkpoint", AsyncMock(return_value=None)
    )
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


async def seed_pipeline(db) -> None:
    db.add(
        ImportPipeline(
            pipeline_id="img-failed",
            source_type="image",
            source_file="original.png",
            source_sha256=hashlib.sha256(image_bytes()).hexdigest(),
            status="failed",
            current_task_id="image:img-failed",
            current_owner_token="original-owner",
            execution_generation=3,
            execution_status="processing",
            error_message="ocr.remote_timeout",
            finished_at=datetime(2026, 11, 18, 12, 0),
            created_by="admin:1",
            chunk_size=1,
        )
    )
    await db.commit()
    await save_recovery_context(
        "img-failed",
        {
            "source_type": "image",
            "source_file": "original.png",
            "subject": "DS",
            "subject_id": 3,
            "created_by": "admin:1",
            "options": {
                "enable_ai_repair": False,
                "image_fast_mode": False,
                "confidence_threshold": 0.75,
            },
        },
    )


@pytest.mark.asyncio
async def test_image_resume_without_checkpoint_preserves_options_and_identity(
    db, monkeypatch
):
    await seed_pipeline(db)
    enqueue = AsyncMock(return_value=EnqueueResult())
    monkeypatch.setattr(queue, "enqueue_admin_resume", enqueue)
    result = await recovery.resume_import(db, "img-failed", upload(), {})
    assert result == {
        "pipeline_id": "img-failed",
        "status": "processing",
        "resumed_chunks": [],
        "failed_stage": None,
        "completed_stages": 0,
        "artifact_stages": [],
        "true_resume": False,
    }
    payload = enqueue.await_args.kwargs
    assert payload["source_type"] == "image"
    assert (payload["subject"], payload["subject_id"], payload["created_by"]) == (
        "DS",
        3,
        "admin:1",
    )
    assert payload["options"] == {
        "enable_ai_repair": False,
        "image_fast_mode": False,
        "confidence_threshold": 0.75,
    }
    assert payload["retry_token"]
    await db.refresh(await db.get(ImportPipeline, "img-failed"))
    assert (await db.get(ImportPipeline, "img-failed")).status == "queued"
    with pytest.raises(recovery.ImportRecoveryError) as exc:
        await recovery.resume_import(db, "img-failed", upload(), {})
    assert exc.value.status_code == 409
    assert enqueue.await_count == 1


@pytest.mark.asyncio
async def test_wrong_original_bytes_are_rejected_before_queue_or_state_change(
    db, monkeypatch
):
    await seed_pipeline(db)
    enqueue = AsyncMock()
    monkeypatch.setattr(queue, "enqueue_admin_resume", enqueue)
    with pytest.raises(recovery.ImportRecoveryError, match="不一致") as exc:
        await recovery.resume_import(db, "img-failed", upload(b"different"), {})
    assert exc.value.status_code == 400
    enqueue.assert_not_awaited()
    assert (await db.get(ImportPipeline, "img-failed")).status == "failed"


@pytest.mark.asyncio
async def test_resume_queue_rejection_remains_retryable_and_cleans_temp(
    db, monkeypatch
):
    await seed_pipeline(db)
    enqueue = AsyncMock(return_value=EnqueueResult(accepted=False, reason="queue_full"))
    monkeypatch.setattr(queue, "enqueue_admin_resume", enqueue)
    with pytest.raises(recovery.ImportRecoveryError) as exc:
        await recovery.resume_import(
            db, "img-failed", upload(), {"confidence_threshold": 0.8}
        )
    assert exc.value.status_code == 503
    row = await db.get(ImportPipeline, "img-failed")
    await db.refresh(row)
    assert row.status == "failed"
    assert row.error_message == "ocr.remote_timeout"
    assert row.finished_at == datetime(2026, 11, 18, 12, 0)
    enqueue.return_value = EnqueueResult()
    await recovery.resume_import(db, "img-failed", upload(), {})
    assert (
        enqueue.await_args_list[0].kwargs["retry_token"]
        != enqueue.await_args_list[1].kwargs["retry_token"]
    )
    assert enqueue.await_args_list[0].kwargs["options"]["confidence_threshold"] == 0.8


async def seed_batch(db) -> None:
    db.add(
        ImportBatchJob(
            job_id="job-1",
            status="completed",
            total=2,
            concurrency=2,
            current_task_id="batch_image:job-1",
            current_owner_token="original-owner",
            execution_generation=3,
            execution_status="completed",
        )
    )
    await db.flush()
    db.add_all(
        [
            ImportBatchJobItem(
                id=1,
                job_id="job-1",
                seq=1,
                status="succeeded",
                review_batch_id="success-batch",
                question_count=2,
            ),
            ImportBatchJobItem(
                id=2,
                job_id="job-1",
                seq=2,
                status="failed",
                source_file="original.png",
                source_sha256=hashlib.sha256(image_bytes()).hexdigest(),
                error_message="ocr.remote_timeout",
            ),
        ]
    )
    await db.commit()
    await save_recovery_context(
        "job-1",
        {
            "subject": "DS",
            "subject_id": 3,
            "options": {"ocr_mode": "api", "batch_fast_mode": False},
        },
    )


@pytest.mark.asyncio
async def test_failed_item_without_ocr_cache_reuploads_inside_same_job(db, monkeypatch):
    await seed_batch(db)
    enqueue = AsyncMock(return_value=EnqueueResult())
    monkeypatch.setattr(queue, "enqueue_batch_image_job", enqueue)
    result = await batch.retry_batch_image_item(db, 2, upload())
    assert result["job_id"] == "job-1" and result["status"] == "queued"
    assert enqueue.await_args.kwargs["source_seqs"] == [2]
    assert enqueue.await_args.kwargs["source_files"] == ["original.png"]
    assert enqueue.await_args.kwargs["options"]["ocr_mode"] == "api"
    first = await db.get(ImportBatchJobItem, 1)
    second = await db.get(ImportBatchJobItem, 2)
    await db.refresh(second)
    assert (first.status, first.review_batch_id, first.question_count) == (
        "succeeded",
        "success-batch",
        2,
    )
    assert second.status == "pending" and second.ocr_raw_text is None
    with pytest.raises(recovery.ImportRecoveryError) as exc:
        await batch.retry_batch_image_item(db, 2, upload())
    assert exc.value.status_code == 409
    assert enqueue.await_count == 1


@pytest.mark.asyncio
async def test_batch_queue_rejection_restores_only_selected_failed_item(
    db, monkeypatch
):
    await seed_batch(db)
    monkeypatch.setattr(
        queue,
        "enqueue_batch_image_job",
        AsyncMock(
            return_value=EnqueueResult(accepted=False, reason="redis_unavailable"),
        ),
    )
    with pytest.raises(recovery.ImportRecoveryError) as exc:
        await batch.retry_batch_image_item(db, 2, upload())
    assert exc.value.status_code == 503
    row = await db.get(ImportBatchJobItem, 2)
    await db.refresh(row)
    assert (row.status, row.error_message) == ("failed", "ocr.remote_timeout")
    job = await db.get(ImportBatchJob, "job-1")
    await db.refresh(job)
    assert job.status == "completed"
    assert (await db.get(ImportBatchJobItem, 1)).review_batch_id == "success-batch"


@pytest.mark.asyncio
async def test_successful_batch_item_is_never_resubmitted(db, monkeypatch):
    await seed_batch(db)
    enqueue = AsyncMock()
    monkeypatch.setattr(queue, "enqueue_batch_image_job", enqueue)
    with pytest.raises(recovery.ImportRecoveryError) as exc:
        await batch.retry_batch_image_item(db, 1, upload())
    assert exc.value.status_code == 409
    enqueue.assert_not_awaited()
