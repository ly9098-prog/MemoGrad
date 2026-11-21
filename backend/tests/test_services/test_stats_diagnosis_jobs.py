"""Non-blocking diagnosis lifecycle with isolated state and no real provider."""

import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from app.core.cache import CacheClient, CacheUnavailableError
from app.services import stats_diagnosis_jobs as jobs


@pytest.fixture
def harness(monkeypatch):
    cache = CacheClient()
    cache._enabled = False
    monkeypatch.setattr(jobs, "cache", cache)
    tasks = []

    def spawn(coro, **kwargs):
        task = asyncio.create_task(coro)
        tasks.append(task)
        return task

    monkeypatch.setattr(jobs, "create_background_task", spawn)
    snapshot = {
        "summary": "即时分析",
        "generated": False,
        "weak_points": [],
        "strong_points": [],
    }
    monkeypatch.setattr(jobs, "_snapshot", AsyncMock(return_value=snapshot))
    session = AsyncMock()

    @asynccontextmanager
    async def session_factory():
        yield session

    monkeypatch.setattr(jobs, "async_session", session_factory)
    monkeypatch.setattr(jobs, "lock_active_user", AsyncMock(return_value=True))
    provider = AsyncMock(return_value={"summary": "完整分析", "generated": True})
    monkeypatch.setattr(jobs.stats_service, "get_ai_diagnosis", provider)
    return cache, tasks, session, provider


@pytest.mark.asyncio
async def test_returns_local_without_waiting_and_polls_completed_result(harness):
    cache, tasks, session, provider = harness
    gate = asyncio.Event()

    async def slow(*args):
        await gate.wait()
        return {"summary": "完整分析", "generated": True}

    provider.side_effect = slow
    initial = await jobs.get_diagnosis(object(), 17)
    assert initial["status"] == "pending"
    assert initial["summary"] == "即时分析"
    assert len(tasks) == 1
    same = await jobs.get_diagnosis(object(), 17, refresh=True)
    assert same == initial
    assert len(tasks) == 1
    gate.set()
    await tasks[0]
    final = await jobs.get_diagnosis(object(), 17, poll_only=True)
    assert final == {"summary": "完整分析", "generated": True, "status": "ready"}
    session.commit.assert_awaited_once()
    assert provider.await_args.args[0] is session


@pytest.mark.asyncio
async def test_poll_only_never_starts_a_task_and_is_user_scoped(harness):
    _, tasks, _, _ = harness
    local = await jobs.get_diagnosis(object(), 18, poll_only=True)
    assert local["status"] == "ready"
    assert not tasks
    await jobs.get_diagnosis(object(), 17)
    await tasks[0]
    assert (await jobs.get_diagnosis(object(), 18, poll_only=True))[
        "summary"
    ] == "即时分析"


@pytest.mark.asyncio
async def test_failure_and_shutdown_leave_terminal_local_data(harness):
    _, tasks, _, provider = harness
    provider.side_effect = RuntimeError("synthetic provider failure")
    await jobs.get_diagnosis(object(), 17)
    await tasks[0]
    assert (await jobs.get_diagnosis(object(), 17, poll_only=True))["status"] == "ready"


@pytest.mark.asyncio
async def test_expired_pending_marker_does_not_leave_a_permanent_loading_state(harness):
    cache, tasks, _, _ = harness
    await cache.set_strict(
        f"{jobs.RESULT_KEY_PREFIX}:17",
        {
            "data": {"summary": "即时分析", "generated": False, "status": "pending"},
            "pending_until": 0,
        },
    )
    result = await jobs.get_diagnosis(object(), 17, poll_only=True)
    assert result["status"] == "ready"
    assert not tasks


@pytest.mark.asyncio
async def test_expired_owner_cannot_overwrite_a_newer_result(harness):
    cache, tasks, _, provider = harness
    gate = asyncio.Event()

    async def slow(*args):
        await gate.wait()
        return {"summary": "obsolete", "generated": True}

    provider.side_effect = slow
    await jobs.get_diagnosis(object(), 17)
    key, lease = f"{jobs.RESULT_KEY_PREFIX}:17", f"{jobs.LEASE_KEY_PREFIX}:17"
    await cache.release_lock(lease, cache._local_get(lease))
    await cache.acquire_lock_strict(lease, "new-owner")
    await cache.set_strict(key, {"data": {"summary": "newer", "status": "ready"}})
    gate.set()
    await tasks[0]
    assert (await jobs.get_diagnosis(object(), 17, poll_only=True))[
        "summary"
    ] == "newer"


@pytest.mark.asyncio
async def test_cache_outage_returns_terminal_local_data_without_a_provider_call(
    harness, monkeypatch
):
    cache, tasks, _, provider = harness
    monkeypatch.setattr(
        cache, "get_strict", AsyncMock(side_effect=CacheUnavailableError)
    )
    result = await jobs.get_diagnosis(object(), 17)
    assert result["status"] == "ready"
    assert result["summary"] == "即时分析"
    assert tasks == []
    provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_task_cancellation_leaves_terminal_data_and_releases_the_lease(harness):
    cache, tasks, _, provider = harness
    started = asyncio.Event()

    async def slow(*args):
        started.set()
        await asyncio.Event().wait()

    provider.side_effect = slow
    await jobs.get_diagnosis(object(), 17)
    await started.wait()
    tasks[0].cancel()
    with pytest.raises(asyncio.CancelledError):
        await tasks[0]
    assert (await jobs.get_diagnosis(object(), 17, poll_only=True))["status"] == "ready"
    assert await cache.get_strict(f"{jobs.LEASE_KEY_PREFIX}:17") is None


@pytest.mark.asyncio
async def test_normal_learning_mutation_does_not_discard_the_active_job(harness):
    cache, tasks, _, provider = harness
    gate = asyncio.Event()

    async def slow(*args):
        await gate.wait()
        return {"summary": "完整分析", "generated": True}

    provider.side_effect = slow
    await jobs.get_diagnosis(object(), 17)
    cache._local_delete("stats:*:17")
    gate.set()
    await tasks[0]
    result = await jobs.get_diagnosis(object(), 17, poll_only=True)
    assert result["summary"] == "完整分析"
    assert result["status"] == "ready"


@pytest.mark.asyncio
async def test_poll_cache_outage_keeps_pending_and_recovers_without_repurchase(
    harness, monkeypatch
):
    cache, tasks, _, provider = harness
    snapshot = jobs._snapshot
    await jobs.get_diagnosis(object(), 17)
    await tasks[0]
    snapshot.assert_awaited_once()
    real_get = cache.get_strict
    monkeypatch.setattr(
        cache, "get_strict", AsyncMock(side_effect=CacheUnavailableError)
    )
    assert await jobs.get_diagnosis(object(), 17, poll_only=True) == {
        "status": "pending"
    }
    snapshot.assert_awaited_once()
    monkeypatch.setattr(cache, "get_strict", real_get)
    assert (await jobs.get_diagnosis(object(), 17, poll_only=True))[
        "summary"
    ] == "完整分析"
    provider.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("refresh", [False, True])
async def test_overlapping_snapshot_cannot_restart_a_newer_completed_job(
    harness, monkeypatch, refresh
):
    cache, tasks, _, provider = harness
    if refresh:
        await cache.set_strict(
            f"{jobs.RESULT_KEY_PREFIX}:17",
            {
                "data": {"summary": "旧分析", "status": "ready"},
                "created_at": 1,
            },
        )
    first_read = asyncio.Event()
    resume = asyncio.Event()
    snapshot = jobs._snapshot

    async def delayed_snapshot(*args):
        first_read.set()
        await resume.wait()
        return await snapshot(*args)

    monkeypatch.setattr(jobs, "_snapshot", delayed_snapshot)
    first = asyncio.create_task(jobs.get_diagnosis(object(), 17, refresh=refresh))
    await first_read.wait()
    monkeypatch.setattr(jobs, "_snapshot", snapshot)
    await jobs.get_diagnosis(object(), 17, refresh=refresh)
    await tasks[0]
    resume.set()
    assert (await first)["summary"] == "完整分析"
    assert len(tasks) == 1
    provider.assert_awaited_once()


@pytest.mark.asyncio
async def test_publication_retries_a_transient_cache_failure(harness, monkeypatch):
    cache, tasks, _, provider = harness
    commit = cache.commit_guarded_strict
    failed = False

    async def intermittent(**kwargs):
        nonlocal failed
        if kwargs.get("deletes") and not failed:
            failed = True
            raise CacheUnavailableError()
        return await commit(**kwargs)

    monkeypatch.setattr(cache, "commit_guarded_strict", intermittent)
    await jobs.get_diagnosis(object(), 17)
    await tasks[0]
    assert failed
    assert (await jobs.get_diagnosis(object(), 17, poll_only=True))[
        "summary"
    ] == "完整分析"
    provider.assert_awaited_once()


@pytest.mark.asyncio
async def test_total_publish_outage_is_bounded_and_retains_the_lease(
    harness, monkeypatch
):
    cache, tasks, _, provider = harness
    await jobs.get_diagnosis(object(), 17)
    monkeypatch.setattr(
        cache, "commit_guarded_strict", AsyncMock(side_effect=CacheUnavailableError)
    )
    monkeypatch.setattr(jobs, "PUBLISH_TIMEOUT", 0.01)
    await asyncio.wait_for(tasks[0], timeout=1)
    assert await cache.get_strict(f"{jobs.LEASE_KEY_PREFIX}:17")
    provider.assert_awaited_once()


@pytest.mark.asyncio
async def test_disabled_account_is_rechecked_inside_publication_session(
    harness, monkeypatch
):
    cache, tasks, _, _ = harness
    monkeypatch.setattr(jobs, "lock_active_user", AsyncMock(return_value=False))
    await jobs.get_diagnosis(object(), 17)
    await tasks[0]
    assert await cache.get_strict(f"{jobs.RESULT_KEY_PREFIX}:17") is None
    assert await cache.get_strict(f"{jobs.LEASE_KEY_PREFIX}:17") is None


@pytest.mark.asyncio
async def test_erasure_revokes_job_ownership_and_removes_pending_data(
    harness, monkeypatch
):
    from app.services import account_erasure_service as erasure

    cache, tasks, _, provider = harness
    gate = asyncio.Event()

    async def slow(*args):
        await gate.wait()
        return {"summary": "旧账号分析", "generated": True}

    provider.side_effect = slow
    monkeypatch.setattr(erasure, "cache", cache)
    await jobs.get_diagnosis(object(), 17)
    await erasure._invalidate_user_caches(17, [])
    gate.set()
    await tasks[0]
    assert await cache.get_strict(f"{jobs.RESULT_KEY_PREFIX}:17") is None


@pytest.mark.asyncio
async def test_erasure_cache_failure_is_retryable(harness, monkeypatch):
    from app.services import account_erasure_service as erasure

    cache, _, _, _ = harness
    monkeypatch.setattr(erasure, "cache", cache)
    monkeypatch.setattr(
        cache, "delete_strict", AsyncMock(side_effect=CacheUnavailableError)
    )
    with pytest.raises(CacheUnavailableError):
        await erasure._invalidate_user_caches(17, [])


@pytest.mark.asyncio
async def test_registry_shutdown_uses_one_shared_grace_budget():
    from app.core import background_tasks

    release = asyncio.Event()
    started_count = 0
    started = asyncio.Event()

    async def slow_cleanup():
        nonlocal started_count
        started_count += 1
        if started_count == 3:
            started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            await release.wait()

    tasks = [
        background_tasks.create_background_task(
            slow_cleanup(), name=f"shutdown-budget-{index}"
        )
        for index in range(3)
    ]
    await started.wait()
    started_at = asyncio.get_running_loop().time()
    try:
        await background_tasks.cancel_all_tasks(timeout=0.05)
        elapsed = asyncio.get_running_loop().time() - started_at
        assert elapsed < 0.12
        assert not background_tasks._background_tasks
        await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True), timeout=0.2
        )
        assert all(task.cancelled() for task in tasks)
    finally:
        release.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_registry_shutdown_cancels_the_job_before_resources_close(
    harness, monkeypatch
):
    from app.core import background_tasks

    cache, _, _, provider = harness
    started = asyncio.Event()

    async def slow(*args):
        started.set()
        await asyncio.Event().wait()

    provider.side_effect = slow
    monkeypatch.setattr(
        jobs, "create_background_task", background_tasks.create_background_task
    )
    await jobs.get_diagnosis(object(), 17)
    await started.wait()
    await background_tasks.cancel_all_tasks(timeout=1)
    assert not background_tasks._background_tasks
    assert (await jobs.get_diagnosis(object(), 17, poll_only=True))["status"] == "ready"
    assert await cache.get_strict(f"{jobs.LEASE_KEY_PREFIX}:17") is None


@pytest.mark.asyncio
async def test_http_background_to_ready_lifecycle_uses_one_provider_task(harness):
    from types import SimpleNamespace

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.v1.stats import router
    from app.core.database import get_db
    from app.core.security import get_current_user

    _, tasks, _, provider = harness
    gate = asyncio.Event()

    async def slow(*args):
        await gate.wait()
        return {"summary": "完整分析", "generated": True}

    provider.side_effect = slow
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=17)
    async with AsyncClient(transport=ASGITransport(app), base_url="http://test") as client:
        initial = await client.get("/api/v1/stats/ai-diagnosis?background=true")
        assert initial.status_code == 200
        assert initial.json()["summary"] == "即时分析"
        assert initial.json()["status"] == "pending"
        duplicate = await client.get("/api/v1/stats/ai-diagnosis?background=true&refresh=true")
        assert duplicate.json()["status"] == "pending"
        assert len(tasks) == 1
        gate.set()
        await tasks[0]
        final = await client.get("/api/v1/stats/ai-diagnosis?poll_only=true")
        assert final.status_code == 200
        assert final.json()["summary"] == "完整分析"
        assert final.json()["status"] == "ready"
        assert final.json()["generated"] is True
        provider.assert_awaited_once()
