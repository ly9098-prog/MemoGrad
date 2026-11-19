"""Recovery admission, task ownership and legacy context boundaries."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_batch_job import ImportBatchJob
from app.models.import_pipeline import ImportPipeline
from app.services import batch_image_recovery_service as batch
from app.services import import_recovery_service as recovery
from app.services import task_queue_worker as queue
from app.services.db_fencing import (
    FencingVerificationError,
    conditional_update_with_fencing,
    initialize_fencing_fields,
    verify_fencing_or_raise,
)
from app.services.import_recovery_context import load_recovery_context
from app.services.task_queue_contract import EnqueueResult
from tests.test_services.test_import_recovery_service import (
    db as _shared_db,
)
from tests.test_services.test_import_recovery_service import (
    seed_batch,
    seed_pipeline,
    upload,
)

recovery_db = _shared_db


async def _admit_retry(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch, kind: str
) -> tuple[type[ImportPipeline] | type[ImportBatchJob], str, str, str]:
    enqueue = AsyncMock(return_value=EnqueueResult())
    if kind == "pipeline":
        await seed_pipeline(db)
        monkeypatch.setattr(queue, "enqueue_admin_resume", enqueue)
        await recovery.resume_import(db, "img-failed", upload(), {})
        return (
            ImportPipeline,
            "img-failed",
            "image:img-failed",
            f"admin_resume:{enqueue.await_args.kwargs['retry_token']}",
        )
    await seed_batch(db)
    monkeypatch.setattr(queue, "enqueue_batch_image_job", enqueue)
    await batch.retry_batch_image_item(db, 2, upload())
    return (
        ImportBatchJob,
        "job-1",
        "batch_image:job-1",
        f"batch_image:{enqueue.await_args.kwargs['retry_token']}",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["pipeline", "batch"])
async def test_manual_retry_hands_off_old_fence_and_rejects_late_old_worker(
    recovery_db: AsyncSession, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    db = recovery_db
    model, identifier, old_task, new_task = await _admit_retry(db, monkeypatch, kind)
    assert not await initialize_fencing_fields(
        db, model, identifier, task_id=old_task, owner_token="old-late", generation=99
    )
    with pytest.raises(FencingVerificationError):
        await verify_fencing_or_raise(
            db,
            model,
            identifier,
            expected_task_id=old_task,
            expected_generation=3,
            expected_owner_token="original-owner",
        )
    assert await initialize_fencing_fields(
        db, model, identifier, task_id=new_task, owner_token="new-owner", generation=1
    )
    assert not await conditional_update_with_fencing(
        db,
        model,
        identifier,
        expected_task_id=old_task,
        expected_owner_token="original-owner",
        expected_generation=3,
        status="failed",
    )
    assert await conditional_update_with_fencing(
        db,
        model,
        identifier,
        expected_task_id=new_task,
        expected_owner_token="new-owner",
        expected_generation=1,
        status="processing",
    )
    await db.commit()
    assert await initialize_fencing_fields(
        db,
        model,
        identifier,
        task_id=new_task,
        owner_token="reclaimed-owner",
        generation=2,
    )
    assert not await initialize_fencing_fields(
        db, model, identifier, task_id=new_task, owner_token="new-owner", generation=1
    )


@pytest.mark.asyncio
async def test_missing_legacy_context_returns_actionable_code_before_staging(
    recovery_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await seed_pipeline(recovery_db)
    monkeypatch.setattr(recovery, "load_recovery_context", AsyncMock(return_value={}))
    stage = AsyncMock()
    monkeypatch.setattr(recovery, "stage_recovery_file", stage)
    with pytest.raises(recovery.ImportRecoveryError) as error:
        await recovery.resume_import(recovery_db, "img-failed", upload(), {})
    assert error.value.code == "IMPORT_RECOVERY_CONTEXT_EXPIRED"
    assert error.value.status_code == 409
    stage.assert_not_awaited()


@pytest.mark.asyncio
async def test_batch_requires_original_context_even_with_original_upload(
    recovery_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await seed_batch(recovery_db)
    monkeypatch.setattr(batch, "load_recovery_context", AsyncMock(return_value={}))
    enqueue = AsyncMock()
    monkeypatch.setattr(queue, "enqueue_batch_image_job", enqueue)
    with pytest.raises(recovery.ImportRecoveryError) as error:
        await batch.retry_batch_image_item(recovery_db, 2, upload())
    assert error.value.code == "IMPORT_RECOVERY_CONTEXT_EXPIRED"
    enqueue.assert_not_awaited()


@pytest.mark.asyncio
async def test_legacy_pipeline_allows_explicit_original_settings(
    recovery_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await seed_pipeline(recovery_db)
    monkeypatch.setattr(recovery, "load_recovery_context", AsyncMock(return_value={}))
    enqueue = AsyncMock(return_value=EnqueueResult())
    monkeypatch.setattr(queue, "enqueue_admin_resume", enqueue)
    settings = {
        "enable_ai_repair": False,
        "confidence_threshold": 0.75,
        "image_fast_mode": False,
        "enable_ocr_correction": False,
        "subject_id": 3,
        "subject": "DS",
    }
    await recovery.resume_import(recovery_db, "img-failed", upload(), settings)
    payload = enqueue.await_args.kwargs
    assert payload["subject_id"] == 3 and payload["subject"] == "DS"
    assert payload["options"] == {
        name: value
        for name, value in settings.items()
        if name not in {"subject", "subject_id"}
    }


@pytest.mark.asyncio
async def test_original_queue_payload_recovers_legacy_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.cache import cache
    from app.services.task_queue_service import task_queue

    context = {
        "source_type": "image",
        "subject_id": 5,
        "options": {"enable_ai_repair": False, "image_fast_mode": False},
    }
    monkeypatch.setattr(cache, "get", AsyncMock(return_value=None))
    get_task = AsyncMock(return_value={"data": {"payload": context}})
    monkeypatch.setattr(task_queue, "get_task_v2", get_task)
    assert await load_recovery_context("legacy-image", "image") == context
    get_task.assert_awaited_once_with("image:legacy-image")


@pytest.mark.asyncio
async def test_retry_task_ids_fit_business_fence_columns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enqueue = AsyncMock(return_value=EnqueueResult())
    monkeypatch.setattr(queue, "_enqueue_v2_with_local_fallback", enqueue)
    await queue.enqueue_admin_resume(
        "x" * 64,
        "staged",
        "image",
        "original.png",
        "DS",
        3,
        {"enable_ai_repair": False},
        retry_token="a" * 32,
    )
    await queue.enqueue_batch_image_job(
        "x" * 64,
        ["staged"],
        "DS",
        3,
        {},
        retry_token="b" * 32,
        source_seqs=[3],
        source_files=["third.png"],
    )
    for call in enqueue.await_args_list:
        assert len(call.kwargs["task_id"]) <= 64


@pytest.mark.asyncio
async def test_queue_failure_invalidates_ambiguous_task_reservation(
    recovery_db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await seed_pipeline(recovery_db)
    enqueue = AsyncMock(side_effect=RuntimeError("isolated queue failure"))
    monkeypatch.setattr(queue, "enqueue_admin_resume", enqueue)
    with pytest.raises(RuntimeError, match="isolated queue"):
        await recovery.resume_import(recovery_db, "img-failed", upload(), {})
    retry_task = f"admin_resume:{enqueue.await_args.kwargs['retry_token']}"
    assert not await initialize_fencing_fields(
        recovery_db,
        ImportPipeline,
        "img-failed",
        task_id=retry_task,
        owner_token="ambiguous-worker",
        generation=1,
    )
