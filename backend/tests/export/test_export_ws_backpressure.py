"""Backpressure regression tests for the export WebSocket push service.

Covers the known root cause: a slow socket must not block the shared Redis
subscriber, other sockets of the same user, or other users. Every send and
stale-connection close has a short deadline, and client ping floods are
throttled through the same bounded send boundary.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections import deque

import pytest

from app.services.export import push_service

EVENT = {"type": "export_status", "task_id": 1, "status": "completed"}


class _BlockingSocket:
    """Socket whose send and close both hang until cancelled."""

    def __init__(self) -> None:
        self.closed = 0

    async def send_text(self, text: str) -> None:
        await asyncio.Event().wait()

    async def send_json(self, payload: dict) -> None:
        await asyncio.Event().wait()

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed += 1
        await asyncio.Event().wait()


class _FastSocket:
    def __init__(self) -> None:
        self.sent_texts: list[str] = []
        self.sent_json: list[dict] = []
        self.closed = 0

    async def send_text(self, text: str) -> None:
        self.sent_texts.append(text)

    async def send_json(self, payload: dict) -> None:
        self.sent_json.append(payload)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed += 1


class _HandlerSocket:
    def __init__(self, messages: list[str]) -> None:
        self._messages = deque(messages)
        self.sent: list[dict] = []
        self.closed: tuple[int, str] | None = None

    async def accept(self, subprotocol: str | None = None) -> None:
        pass

    async def receive_text(self) -> str:
        if self._messages:
            return self._messages.popleft()
        await asyncio.Event().wait()

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = (code, reason)


@pytest.fixture(autouse=True)
def _clean_registry(monkeypatch):
    monkeypatch.setattr(push_service, "start_redis_subscriber", lambda: None)
    push_service._connections.clear()
    yield
    push_service._connections.clear()


@pytest.mark.asyncio
async def test_slow_socket_times_out_and_second_user_still_served(monkeypatch):
    monkeypatch.setattr(push_service, "_SEND_TIMEOUT_SEC", 0.02)
    monkeypatch.setattr(push_service, "_CLEANUP_TIMEOUT_SEC", 0.02)

    slow = _BlockingSocket()
    second_user = _FastSocket()
    push_service._connections = {1: {slow}, 2: {second_user}}

    started = time.monotonic()
    assert await push_service.send_to_user(1, EVENT) == 0
    assert time.monotonic() - started < 1.0
    assert 1 not in push_service._connections
    assert slow.closed == 1

    assert await push_service.send_to_user(2, EVENT) == 1
    assert len(second_user.sent_texts) == 1


@pytest.mark.asyncio
async def test_slow_socket_does_not_block_fast_socket_of_same_user(monkeypatch):
    monkeypatch.setattr(push_service, "_SEND_TIMEOUT_SEC", 0.02)
    monkeypatch.setattr(push_service, "_CLEANUP_TIMEOUT_SEC", 0.02)

    slow = _BlockingSocket()
    fast = _FastSocket()
    push_service._connections = {1: {slow, fast}}

    assert await push_service.send_to_user(1, EVENT) == 1
    assert len(fast.sent_texts) == 1
    assert slow not in push_service._connections[1]
    assert fast in push_service._connections[1]


@pytest.mark.asyncio
async def test_stale_cleanup_close_has_its_own_deadline(monkeypatch):
    monkeypatch.setattr(push_service, "_SEND_TIMEOUT_SEC", 0.02)
    monkeypatch.setattr(push_service, "_CLEANUP_TIMEOUT_SEC", 0.02)

    slow = _BlockingSocket()
    push_service._connections = {1: {slow}}

    started = time.monotonic()
    assert await push_service.send_to_user(1, EVENT) == 0
    assert time.monotonic() - started < 1.0
    assert 1 not in push_service._connections
    assert slow.closed == 1


@pytest.mark.asyncio
async def test_pong_send_uses_bounded_send_and_cleans_up(monkeypatch):
    monkeypatch.setattr(push_service, "_SEND_TIMEOUT_SEC", 0.02)
    monkeypatch.setattr(push_service, "_CLEANUP_TIMEOUT_SEC", 0.02)

    ws = _HandlerSocket([json.dumps({"type": "ping"})])
    monkeypatch.setattr(
        ws,
        "send_json",
        lambda payload: _BlockingSocket().send_json(payload),
    )
    task = asyncio.create_task(push_service.handle_export_ws(ws, 7, auth_token="token"))
    await asyncio.wait_for(task, timeout=1.0)
    assert 7 not in push_service._connections
    assert ws.closed is not None


@pytest.mark.asyncio
async def test_ping_pong_throttled_through_same_send_boundary(monkeypatch):
    calls: list[dict] = []
    original_send_json = push_service._send_json_bounded

    async def recording_send(ws, payload):
        calls.append(payload)
        return await original_send_json(ws, payload)

    monkeypatch.setattr(push_service, "_send_json_bounded", recording_send)
    monkeypatch.setattr(push_service, "_SEND_TIMEOUT_SEC", 0.01)
    monkeypatch.setattr(push_service, "_CLEANUP_TIMEOUT_SEC", 0.01)
    monkeypatch.setattr(push_service, "_MIN_PONG_INTERVAL_SEC", 60)
    monkeypatch.setattr(push_service, "_HEARTBEAT_INTERVAL", 999)
    monkeypatch.setattr(push_service, "_AUTH_RECHECK_INTERVAL", 999)

    ws = _HandlerSocket([json.dumps({"type": "ping"}), json.dumps({"type": "ping"})])
    task = asyncio.create_task(push_service.handle_export_ws(ws, 8, auth_token="token"))
    await asyncio.sleep(0.1)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    assert 8 not in push_service._connections
    assert [payload["type"] for payload in calls] == ["pong"]
    assert len(ws.sent) == 1
