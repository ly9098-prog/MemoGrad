"""Upload ownership and durable admission failures for both Admin OCR pages."""

from __future__ import annotations

import asyncio
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import HTTPException, UploadFile
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import admin_imports as routes
from app.core.database import Base
from app.features import batch_image_import_service as batch
from app.features import ocr_mode
from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem
from app.services import import_recovery_context, staging_storage, task_queue_worker
from app.services.streaming_upload_handler import TempFile
from app.services.task_queue_service import EnqueueResult
from app.services.task_queue_worker import (
    enqueue_batch_image_job as real_enqueue_batch_job,
)


@pytest_asyncio.fixture
async def upload_env(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'uploads.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(batch, "async_session", sessions)
    monkeypatch.setattr(ocr_mode, "validate_ocr_mode_dependencies", lambda _mode: None)
    monkeypatch.setattr(import_recovery_context, "save_recovery_context", AsyncMock())
    from app.services import health_check_service, sse_pubsub

    monkeypatch.setattr(sse_pubsub, "publish_event", AsyncMock())
    monkeypatch.setattr(
        health_check_service,
        "check_ai_model_config",
        AsyncMock(return_value=SimpleNamespace(severity="ok")),
    )
    temporaries = []

    async def stream(_upload, **_kwargs):
        path = tmp_path / f"source-{len(temporaries)}.png"
        Image.new("RGB", (80, 60), "white").save(path)
        temporary = TempFile(path=str(path), size=path.stat().st_size)
        temporaries.append(temporary)
        return temporary

    monkeypatch.setattr(routes, "stream_to_temp", stream)
    queue = AsyncMock(return_value=EnqueueResult(True, "synthetic-task", ""))
    stage = AsyncMock(return_value=SimpleNamespace(object_id="synthetic-staging"))
    monkeypatch.setattr(task_queue_worker, "enqueue_batch_image_job", queue)
    monkeypatch.setattr(staging_storage, "async_store_file", stage)
    try:
        async with sessions() as db:
            yield SimpleNamespace(
                db=db,
                sessions=sessions,
                temporaries=temporaries,
                queue=queue,
                stage=stage,
            )
    finally:
        await engine.dispose()


async def submit(env, **overrides):
    values = dict(
        files=[UploadFile(filename="page.png", file=BytesIO(b"synthetic upload"))],
        subject=None,
        subject_id=None,
        concurrency=1,
        enable_ai_repair=False,
        confidence_threshold=0.6,
        batch_fast_mode=True,
        ocr_mode="local",
        batch_id="synthetic-batch",
        image_id=None,
        image_ids=["synthetic-image"],
        request_id="synthetic-request",
        current_admin=SimpleNamespace(id=12),
        db=env.db,
    )
    values.update(overrides)
    return await routes.batch_image_upload(**values)


@pytest.mark.asyncio
async def test_success_releases_request_temp_after_durable_handoff(upload_env):
    result = await submit(upload_env)
    assert result.total == 1
    assert upload_env.queue.await_count == 1
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)


@pytest.mark.asyncio
async def test_confirmed_duplicate_does_not_dispatch_again_or_leak_temp(
    upload_env,
):
    first = await submit(upload_env)
    second = await submit(upload_env)
    assert second.duplicate and second.job_id == first.job_id
    assert upload_env.queue.await_count == 1
    assert {call.kwargs["job_id"] for call in upload_env.queue.await_args_list} == {
        first.job_id
    }
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"confidence_threshold": 0.8},
        {"image_ids": ["other-image"]},
        {"subject": "math2"},
        {"enable_ai_repair": True},
        {"current_admin": SimpleNamespace(id=13)},
    ],
)
async def test_reused_request_key_rejects_different_inputs(upload_env, overrides):
    await submit(upload_env)
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env, **overrides)
    assert failure.value.status_code == 409
    assert upload_env.queue.await_count == 1
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)


@pytest.mark.asyncio
async def test_duplicate_response_replays_actual_job_metadata(upload_env):
    first = await submit(upload_env)
    async with upload_env.sessions() as db:
        job = await db.get(ImportBatchJob, first.job_id)
        job.status = "completed"
        job.concurrency = 3
        await db.commit()
    second = await submit(upload_env)
    assert second.duplicate
    assert (
        second.status == "completed" and second.total == 1 and second.concurrency == 3
    )
    assert upload_env.queue.await_count == 1


@pytest.mark.asyncio
async def test_new_request_key_cannot_reuse_already_owned_image_ids(upload_env):
    await submit(upload_env)
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env, request_id="another-request")
    assert failure.value.status_code == 409
    assert upload_env.queue.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"request_id": " "},
        {"request_id": "x" * 65},
        {"image_ids": ["x" * 65]},
        {
            "files": [
                UploadFile(file=BytesIO(), filename="one.png"),
                UploadFile(file=BytesIO(), filename="two.png"),
            ],
            "image_ids": ["same", "same"],
        },
    ],
)
async def test_invalid_submission_ids_are_rejected_before_staging(
    upload_env, overrides
):
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env, **overrides)
    assert failure.value.status_code == 422
    upload_env.stage.assert_not_awaited()
    upload_env.queue.assert_not_awaited()


@pytest.mark.asyncio
async def test_staging_failure_does_not_create_unexecutable_job(upload_env):
    upload_env.stage.side_effect = OSError("synthetic disk full")
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env)
    assert failure.value.status_code == 503
    assert not upload_env.queue.called
    assert not (await upload_env.db.execute(select(ImportBatchJob))).scalars().all()
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)


@pytest.mark.asyncio
async def test_queue_rejection_is_terminal_and_items_can_be_retried(upload_env):
    upload_env.queue.return_value = EnqueueResult(False, "", "queue_full")
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env)
    assert failure.value.status_code == 503
    async with upload_env.sessions() as db:
        job = (await db.execute(select(ImportBatchJob))).scalar_one()
        item = (await db.execute(select(ImportBatchJobItem))).scalar_one()
        assert job.status == "failed" and job.finished_at is not None
        assert item.status == "failed" and item.finished_at is not None
        assert job.error_message and item.error_message
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)


@pytest.mark.asyncio
async def test_staging_cancellation_releases_temp_without_admitting(upload_env):
    upload_env.stage.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await submit(upload_env)
    assert not upload_env.queue.called
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)


@pytest.mark.asyncio
async def test_validated_mode_is_the_mode_passed_to_worker(upload_env):
    await submit(upload_env, ocr_mode=" API ")
    assert upload_env.queue.await_args.kwargs["options"]["ocr_mode"] == "api"


@pytest.mark.asyncio
async def test_unknown_queue_outcome_keeps_worker_ownership_and_reclaims_temp(
    upload_env,
):
    upload_env.queue.side_effect = TimeoutError("synthetic acknowledgement loss")
    with pytest.raises(TimeoutError):
        await submit(upload_env)
    async with upload_env.sessions() as db:
        job = (await db.execute(select(ImportBatchJob))).scalar_one()
        assert job.status == "queued" and job.finished_at is None
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)


@pytest.mark.asyncio
async def test_lost_lua_reply_is_not_rejection_and_same_key_repairs_handoff(
    upload_env, monkeypatch
):
    import fakeredis
    import fakeredis.aioredis
    from redis.exceptions import TimeoutError as RedisTimeoutError

    from app.services.task_queue_keys import _V2_TASK_PREFIX, _v2_q_key
    from app.services.task_queue_lua_v2_claim import _LUA_ENQUEUE_V2
    from app.services.task_queue_service import DurableTaskQueue

    server = fakeredis.FakeServer()
    observer = fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)
    queue = DurableTaskQueue()
    queue._redis_enabled = True
    calls = 0

    async def client():
        return fakeredis.aioredis.FakeRedis(server=server, decode_responses=True)

    async def lose_first_reply(redis_client, _name, count, *arguments):
        nonlocal calls
        result = await redis_client.eval(_LUA_ENQUEUE_V2, count, *arguments)
        calls += 1
        if calls == 1:
            raise RedisTimeoutError("synthetic lost response after Redis commit")
        return result

    monkeypatch.setattr(queue, "_get_script_client", client)
    monkeypatch.setattr(queue, "_load_scripts", AsyncMock())
    monkeypatch.setattr(queue, "_evalsha_or_reload", lose_first_reply)
    monkeypatch.setattr(task_queue_worker, "task_queue", queue)
    monkeypatch.setattr(
        task_queue_worker, "async_touch_object", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(
        task_queue_worker, "_can_use_local_execution_fallback", lambda: False
    )
    monkeypatch.setattr(
        task_queue_worker, "enqueue_batch_image_job", real_enqueue_batch_job
    )
    try:
        with pytest.raises(HTTPException) as failure:
            await submit(upload_env)
        assert failure.value.status_code == 503 and "未确认" in failure.value.detail
        async with upload_env.sessions() as db:
            job = (await db.execute(select(ImportBatchJob))).scalar_one()
            item = (await db.execute(select(ImportBatchJobItem))).scalar_one()
            assert job.status == "queued" and item.status == "pending"
        repeated = await submit(upload_env)
        assert repeated.duplicate and repeated.job_id == job.job_id
        monkeypatch.setattr(
            task_queue_worker,
            "async_touch_object",
            AsyncMock(side_effect=OSError("synthetic staging outage")),
        )
        confirmed = await submit(upload_env)
        assert confirmed.duplicate and confirmed.status == "queued"
        task_id = f"batch_image:{job.job_id}"
        assert await observer.lrange(_v2_q_key("batch_image"), 0, -1) == [task_id]
        assert (
            await observer.hget(f"{_V2_TASK_PREFIX}:{task_id}", "status") == "pending"
        )
    finally:
        await observer.aclose()


@pytest.mark.asyncio
async def test_late_rejection_does_not_overwrite_a_claimed_worker(upload_env):
    first = await submit(upload_env)
    async with upload_env.sessions() as db:
        job = await db.get(ImportBatchJob, first.job_id)
        job.status = "running"
        job.current_owner_token = "synthetic-owner"
        await db.commit()
    upload_env.queue.return_value = EnqueueResult(False, "", "queue_full")
    response = await submit(upload_env)
    assert response.duplicate and response.status == "running"
    assert upload_env.queue.await_count == 1
    async with upload_env.sessions() as db:
        job = (await db.execute(select(ImportBatchJob))).scalar_one()
        assert job.status == "running" and job.current_owner_token == "synthetic-owner"
        assert job.finished_at is None


@pytest.mark.asyncio
async def test_concurrent_replay_cannot_compensate_an_inflight_delivery(
    upload_env, monkeypatch
):
    first_started = asyncio.Event()
    second_prepared = asyncio.Event()
    release = asyncio.Event()
    prepared = 0

    async def context_ready(*_args):
        nonlocal prepared
        prepared += 1
        if prepared == 2:
            second_prepared.set()

    async def queue(**_kwargs):
        if not first_started.is_set():
            first_started.set()
            await asyncio.wait_for(release.wait(), timeout=5)
            return EnqueueResult(True, "same-task", "")
        return EnqueueResult(False, "", "queue_full")

    monkeypatch.setattr(import_recovery_context, "save_recovery_context", context_ready)
    upload_env.queue.side_effect = queue
    first = asyncio.create_task(submit(upload_env))
    await asyncio.wait_for(first_started.wait(), timeout=5)
    async with upload_env.sessions() as second_db:
        second = asyncio.create_task(submit(upload_env, db=second_db))
        try:
            await asyncio.wait_for(second_prepared.wait(), timeout=5)
            assert upload_env.queue.await_count == 1, (
                "concurrent producer entered enqueue"
            )
        finally:
            # A confirmed replay must skip the second transport attempt.
            release.set()
            outcomes = await asyncio.gather(first, second, return_exceptions=True)
    assert all(not isinstance(outcome, BaseException) for outcome in outcomes)
    async with upload_env.sessions() as db:
        job = (await db.execute(select(ImportBatchJob))).scalar_one()
        item = (await db.execute(select(ImportBatchJobItem))).scalar_one()
        assert job.status == "queued" and item.status == "pending"


@pytest.mark.asyncio
async def test_refusal_after_an_unknown_delivery_does_not_close_a_possible_task(
    upload_env,
):
    upload_env.queue.return_value = EnqueueResult(False, "", "redis_unavailable")
    with pytest.raises(HTTPException):
        await submit(upload_env)
    upload_env.queue.return_value = EnqueueResult(False, "", "queue_full")
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env)
    assert failure.value.status_code == 503 and "未确认" in failure.value.detail
    async with upload_env.sessions() as db:
        job = (await db.execute(select(ImportBatchJob))).scalar_one()
        item = (await db.execute(select(ImportBatchJobItem))).scalar_one()
        assert job.status == "queued" and job.execution_status == "enqueue_unknown"
        assert item.status == "pending"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides", [{"subject": "math2"}, {"current_admin": SimpleNamespace(id=13)}]
)
async def test_legacy_image_key_uses_the_same_identity_checks(upload_env, overrides):
    identity = {"request_id": None, "image_id": "legacy-image", "image_ids": []}
    await submit(upload_env, **identity)
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env, **identity, **overrides)
    assert failure.value.status_code == 409 and upload_env.queue.await_count == 1


@pytest.mark.asyncio
async def test_historical_missing_fingerprint_never_silently_discards_a_new_upload(
    upload_env,
):
    first = await submit(upload_env)
    async with upload_env.sessions() as db:
        job = await db.get(ImportBatchJob, first.job_id)
        job.status = "completed"
        job.submission_fingerprint = None
        await db.commit()
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env)
    assert failure.value.status_code == 409 and "历史任务" in failure.value.detail
    assert upload_env.queue.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("historical", [False, True])
async def test_different_file_bytes_are_never_silently_treated_as_duplicate(
    upload_env, monkeypatch, historical
):
    first = await submit(upload_env)
    if historical:
        async with upload_env.sessions() as db:
            job = await db.get(ImportBatchJob, first.job_id)
            job.submission_fingerprint = None
            await db.commit()

    async def black_image(_upload, **_kwargs):
        path = Path(upload_env.temporaries[0].path).with_name("different.png")
        Image.new("RGB", (80, 60), "black").save(path)
        temporary = TempFile(str(path), path.stat().st_size)
        upload_env.temporaries.append(temporary)
        return temporary

    monkeypatch.setattr(routes, "stream_to_temp", black_image)
    with pytest.raises(HTTPException) as failure:
        await submit(upload_env)
    assert failure.value.status_code == 409
    assert upload_env.queue.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("acknowledged", [False, True])
async def test_repeated_cancellation_persists_delivery_state_before_unlocking(
    upload_env, monkeypatch, acknowledged
):
    queue_started = asyncio.Event()
    commit_started = asyncio.Event()
    release_commit = asyncio.Event()
    commit = upload_env.db.commit
    commits = 0

    async def wait_in_queue(**_kwargs):
        queue_started.set()
        if acknowledged:
            return EnqueueResult(True, "synthetic-task", "")
        await asyncio.Event().wait()

    async def controlled_commit():
        nonlocal commits
        commits += 1
        if commits == 2:
            commit_started.set()
            await release_commit.wait()
        await commit()

    upload_env.queue.side_effect = wait_in_queue
    monkeypatch.setattr(upload_env.db, "commit", controlled_commit)
    parent = asyncio.create_task(submit(upload_env))
    try:
        await asyncio.wait_for(queue_started.wait(), timeout=5)
        if not acknowledged:
            parent.cancel()
        await asyncio.wait_for(commit_started.wait(), timeout=5)
        parent.cancel()
    finally:
        release_commit.set()
    with pytest.raises(asyncio.CancelledError):
        await parent
    async with upload_env.sessions() as db:
        job = (await db.execute(select(ImportBatchJob))).scalar_one()
        assert job.status == "queued"
        assert job.execution_status == (
            "enqueued" if acknowledged else "enqueue_unknown"
        )
    assert all(
        not Path(temporary.path).exists() for temporary in upload_env.temporaries
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome", [None, RuntimeError("synthetic failure"), asyncio.CancelledError()]
)
async def test_single_upload_always_closes_request_temp(
    upload_env, monkeypatch, outcome
):
    async def start(**kwargs):
        assert Path(kwargs["file_path"]).is_file()
        if outcome is not None:
            raise outcome
        return {
            "pipeline_id": "img_synthetic",
            "status": "queued",
            "source_type": "image",
        }

    monkeypatch.setattr(routes, "svc_start_import_pipeline", start)
    call = routes.upload_import_file(
        file=UploadFile(filename="page.png", file=BytesIO(b"synthetic")),
        subject=None,
        subject_id=None,
        enable_ai_repair=False,
        confidence_threshold=0.6,
        image_fast_mode=True,
        current_admin=SimpleNamespace(id=12),
    )
    if outcome is not None:
        with pytest.raises(type(outcome)):
            await call
    else:
        await call
    assert all(not Path(tmp.path).exists() for tmp in upload_env.temporaries)
