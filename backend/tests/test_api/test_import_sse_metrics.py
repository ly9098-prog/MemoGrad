"""Exercise real SSE admission and counter updates without Redis or database IO."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.api.v1 import admin_imports
from app.core import admin_security, database
from app.features import batch_image_import_service as batch_svc
from app.schemas.import_review import PipelineStatusResponse
from app.services import import_sse_metrics
from app.services.runtime_sse_metrics import append_sse_metrics


@pytest.fixture
def counters(monkeypatch):
    values = dict.fromkeys(import_sse_metrics.counters, 0)
    monkeypatch.setattr(import_sse_metrics, "counters", values)
    monkeypatch.setattr(batch_svc, "_active_sse_connections", {}, raising=False)
    return values


@pytest.mark.asyncio
@pytest.mark.parametrize("active,admin,status,code,key", [
    ({1: 50}, {"id": 1}, 503, "SSE_GLOBAL_LIMIT", "global_rejected"),
    ({1: 45, 2: 5}, {"id": 2}, 503, "SSE_GLOBAL_LIMIT", "global_rejected"),
    ({1: 5}, {"id": 1}, 429, "SSE_LIMIT", "per_user_rejected"),
    ({1: 5}, SimpleNamespace(id=1), 429, "SSE_LIMIT", "per_user_rejected"),
])
async def test_sse_limits_increment_only_matching_counter(
    monkeypatch, counters, active, admin, status, code, key
):
    monkeypatch.setattr(batch_svc, "_active_sse_connections", active)
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=True))
    result = await admin_imports.stream_batch_image_job(
        "synthetic", request, last_event_id_query=0, last_event_id_header=None,
        admin_user=admin, db=AsyncMock(),
    )
    assert result.status_code == status
    assert json.loads(result.body)["code"] == code
    assert counters[key] == 1
    assert sum(counters.values()) == 1
    request.is_disconnected.assert_not_awaited()
    assert batch_svc._active_sse_connections is active
    from app.services import sse_pubsub

    monkeypatch.setattr(sse_pubsub, "check_health", AsyncMock(return_value=True))
    lines = []
    await append_sse_metrics(lines)
    assert f"sse_{key} 1" in lines
    assert lines.count(f"sse_{key} 1") == 1


@pytest.mark.asyncio
async def test_disconnect_counter_and_subscription_cleanup(monkeypatch, counters):
    observed = []
    auth_db = AsyncMock()

    async def disconnected():
        observed.append((dict(counters), dict(batch_svc._active_sse_connections)))
        return True

    async def subscribe(*_args):
        await asyncio.Event().wait()

    monkeypatch.setattr(admin_imports, "_run_sse_subscribe", subscribe)
    response = await admin_imports.stream_batch_image_job(
        "synthetic", SimpleNamespace(is_disconnected=disconnected),
        last_event_id_query=0, last_event_id_header=None, admin_user={"id": 7}, db=auth_db,
    )
    auth_db.close.assert_awaited_once()
    assert response.headers["Cache-Control"] == "no-cache"
    assert response.headers["X-Accel-Buffering"] == "no"
    assert [chunk async for chunk in response.body_iterator] == []
    assert observed[0][0]["active"] == 1
    assert observed[0][1] == {7: 1}
    assert counters["disconnected"] == 1
    assert counters["active"] == 0
    assert batch_svc._active_sse_connections == {7: 0}


@pytest.mark.asyncio
@pytest.mark.parametrize("elapsed,event,key", [
    (7201, "timeout", "max_duration_closed"),
    (301, "idle_timeout", "max_idle_closed"),
])
async def test_timeout_counters_keep_existing_priority(monkeypatch, counters, elapsed, event, key):
    calls = iter([100.0, 100.0 + elapsed, 100.0 + elapsed])
    monkeypatch.setattr(admin_imports, "time", SimpleNamespace(time=lambda: next(calls)))

    async def subscribe(*_args):
        await asyncio.Event().wait()

    monkeypatch.setattr(admin_imports, "_run_sse_subscribe", subscribe)
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
    response = await admin_imports.stream_batch_image_job(
        "synthetic", request, last_event_id_query=0, last_event_id_header=None,
        admin_user=SimpleNamespace(id=8), db=AsyncMock(),
    )
    chunks = [chunk async for chunk in response.body_iterator]
    assert len(chunks) == 1 and chunks[0].startswith(f"event: {event}\n")
    assert counters[key] == 1
    request.is_disconnected.assert_not_awaited()
    assert batch_svc._active_sse_connections == {8: 0}


@pytest.mark.asyncio
async def test_pipeline_stream_pushes_changed_snapshots_and_releases_sessions(monkeypatch, counters):
    auth_db = AsyncMock()
    status_db = AsyncMock()
    session_scope = MagicMock()
    session_scope.__aenter__ = AsyncMock(return_value=status_db)
    session_scope.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(database, "async_session", MagicMock(return_value=session_scope))
    monkeypatch.setattr(admin_imports, "_PIPELINE_SSE_POLL_SECONDS", 0)
    running = PipelineStatusResponse(pipeline_id="pipe-1", status="running", ocr_progress="50%")
    done = running.model_copy(update={"status": "completed_with_warnings", "question_count": 5})
    lookup = AsyncMock(side_effect=[running, running, done])
    monkeypatch.setattr(admin_imports, "svc_get_pipeline_status", lookup)

    response = await admin_imports.stream_admin_pipeline_status(
        "pipe-1", SimpleNamespace(is_disconnected=AsyncMock(return_value=False)),
        current_admin=SimpleNamespace(id=12), db=auth_db,
    )
    auth_db.close.assert_awaited_once()
    assert response.media_type == "text/event-stream"
    assert response.headers["X-Accel-Buffering"] == "no"
    chunks = [chunk async for chunk in response.body_iterator]
    assert [chunk.splitlines()[0] for chunk in chunks] == [
        "event: status", ": heartbeat", "event: status", "event: done",
    ]
    assert json.loads(chunks[0].splitlines()[1][6:])["ocr_progress"] == "50%"
    assert json.loads(chunks[2].splitlines()[1][6:])["question_count"] == 5
    assert json.loads(chunks[3].splitlines()[1][6:])["status"] == "completed_with_warnings"
    assert [call.args[1] for call in lookup.await_args_list] == [auth_db, status_db, status_db]
    assert session_scope.__aexit__.await_count == 2
    assert counters["active"] == 0


def test_pipeline_stream_requires_import_read_and_returns_404_for_missing_task(monkeypatch, counters):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(admin_imports.router)
    permissions = AsyncMock(return_value=set())
    lookup = AsyncMock(side_effect=ValueError("missing"))
    auth_db = AsyncMock()
    monkeypatch.setattr(admin_security, "_get_permission_names", permissions)
    monkeypatch.setattr(admin_imports, "svc_get_pipeline_status", lookup)
    app.dependency_overrides[admin_security.get_current_admin] = lambda: SimpleNamespace(
        id=12, role_id=1,
    )
    app.dependency_overrides[database.get_db] = lambda: auth_db
    client = TestClient(app)
    path = "/api/admin/v1/imports/pipelines/missing/stream"

    assert client.get(path).status_code == 403
    lookup.assert_not_awaited()
    permissions.return_value = {"import:read"}
    assert client.get(path).status_code == 404
    lookup.assert_awaited_once_with("missing", auth_db)
    auth_db.close.assert_awaited_once()
    assert counters["active"] == 0
