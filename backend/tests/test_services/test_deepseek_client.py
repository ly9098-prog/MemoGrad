"""Regression tests for DeepSeek client model configuration.

Covers:
1. DeepSeekClient.chat() 在 model=None 时直接失败，禁止恢复隐藏默认模型
2. 显式传模型名时不被覆盖
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.ai.client import DeepSeekClient
from app.core.ai_runtime_guard import AIRuntimeGuard
from app.services.safe_remote_fetch import RemoteResponse


def _make_remote(status=200, model="deepseek-v4-flash"):
    """Build a RemoteResponse with a chat-completions body."""
    data = json.dumps(
        {
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"total_tokens": 10},
            "model": model,
        }
    ).encode("utf-8")
    return RemoteResponse(
        status=status,
        data=data,
        content_type="application/json",
        final_url="https://api.deepseek.com",
    )


def _make_client(api_key="sk-test-key", base_url="https://api.deepseek.com"):
    """Create a client instance with the key configured for runtime use."""
    client = DeepSeekClient()
    client._api_key = api_key
    client._base_url = base_url
    client.timeout = 60
    return client


@pytest.mark.asyncio
async def test_chat_model_none_is_rejected():
    """model=None 时应失败关闭，要求后台配置模型标识。"""
    client = _make_client()

    with (
        patch("app.ai.client.request_remote_bytes") as mock_req,
        pytest.raises(RuntimeError, match="AI模型标识未配置"),
    ):
        await client.chat(
            messages=[{"role": "user", "content": "hello"}],
            model=None,
        )

    mock_req.assert_not_called()


@pytest.mark.asyncio
async def test_chat_passes_model_str():
    """显式传模型名时不应被兜底覆盖。"""
    client = _make_client()

    with patch(
        "app.ai.client.request_remote_bytes",
        return_value=_make_remote(model="custom-model"),
    ) as mock_req:
        await client.chat(
            messages=[{"role": "user", "content": "hello"}],
            model="custom-model",
        )

    payload = json.loads(mock_req.call_args.kwargs["body"])
    assert payload["model"] == "custom-model"


@pytest.mark.asyncio
async def test_chat_model_none_does_not_start_request_or_tag():
    """model=None 时不发请求，也不上报缺失模型的 Sentry tag。"""
    client = _make_client()

    with (
        patch("app.ai.client.request_remote_bytes") as mock_req,
        patch("app.ai.client.set_tag") as mock_set_tag,
        pytest.raises(RuntimeError, match="AI模型标识未配置"),
    ):
        await client.chat(messages=[{"role": "user", "content": "hi"}], model=None)

    mock_req.assert_not_called()
    mock_set_tag.assert_not_called()


@pytest.fixture
def isolated_guard(monkeypatch):
    from app.ai import client as client_module

    guard = AIRuntimeGuard()
    monkeypatch.setattr(guard, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(client_module, "ai_runtime_guard", guard)
    monkeypatch.setattr(client_module.settings, "AI_MAX_CONCURRENCY", 1)
    monkeypatch.setattr(client_module.settings, "AI_QUEUE_WAIT_TIMEOUT_SEC", 1)
    return guard


@pytest.mark.asyncio
@pytest.mark.parametrize("bounded", [False, True])
async def test_gateway_preserves_complete_content_and_finish_reason(
    isolated_guard, monkeypatch, bounded
):
    from app.ai import gateway

    monkeypatch.setattr(gateway, "llm", _make_client())
    content = json.dumps(
        {
            "title": "lesson",
            "summary": "summary",
            "sections": [{"points": ["完整正文。" * 800]}],
        },
        ensure_ascii=False,
    )
    response = RemoteResponse(
        status=200,
        data=json.dumps(
            {
                "choices": [
                    {"message": {"content": content}, "finish_reason": "length"}
                ],
                "usage": {"total_tokens": 37},
            }
        ).encode(),
        content_type="application/json",
        final_url="https://api.deepseek.com",
    )
    runtime = gateway.LLMRuntimeConfig(
        api_key="synthetic-test-key",
        base_url="https://api.deepseek.com",
        model_name="test-model",
        provider="openai_compatible",
    )
    kwargs = {"deadline": time.monotonic() + 0.5} if bounded else {}
    with patch("app.ai.client.request_remote_bytes", return_value=response):
        result = await gateway.chat_with_db_model(
            object(), [{"role": "user", "content": "hi"}], runtime=runtime, **kwargs
        )
    assert result["content"] == content
    assert result["finish_reason"] == "length"
    assert result["tokens_used"] == 37


@pytest.mark.asyncio
@pytest.mark.parametrize("bounded", [False, True])
async def test_only_explicit_deadline_includes_queue_wait(isolated_guard, bounded):
    sem, _ = await isolated_guard.acquire_slot()
    release = asyncio.get_running_loop().call_later(
        0.06, isolated_guard.release_slot, sem
    )
    kwargs = {"deadline": time.monotonic() + 0.25} if bounded else {}
    try:
        with patch(
            "app.ai.client.request_remote_bytes", return_value=_make_remote()
        ) as remote:
            await _make_client().chat(
                messages=[{"role": "user", "content": "hi"}],
                model="test-model",
                timeout=0.25,
                **kwargs,
            )
    finally:
        release.cancel()
    remaining = remote.call_args.kwargs["timeout"]
    if bounded:
        assert 0 < remaining < 0.22
    else:
        assert 0.23 < remaining <= 0.25


@pytest.mark.asyncio
@pytest.mark.parametrize("bounded", [False, True])
async def test_only_explicit_deadline_includes_rate_limit_wait(isolated_guard, bounded):
    async def admission():
        await asyncio.sleep(0.06)

    isolated_guard.enforce_rate_limit.side_effect = admission
    kwargs = {"deadline": time.monotonic() + 0.25} if bounded else {}
    with patch(
        "app.ai.client.request_remote_bytes", return_value=_make_remote()
    ) as remote:
        await _make_client().chat(
            messages=[{"role": "user", "content": "hi"}],
            model="test-model",
            timeout=0.25,
            **kwargs,
        )
    remaining = remote.call_args.kwargs["timeout"]
    if bounded:
        assert 0 < remaining < 0.22
    else:
        assert 0.23 < remaining <= 0.25


@pytest.mark.asyncio
async def test_legacy_cancellation_does_not_join_transport(isolated_guard):
    loop = asyncio.get_running_loop()
    started = asyncio.Event()
    finished = asyncio.Event()
    release = threading.Event()

    def transport(*_args, **_kwargs):
        loop.call_soon_threadsafe(started.set)
        try:
            assert release.wait(2)
            return _make_remote()
        finally:
            loop.call_soon_threadsafe(finished.set)

    with patch("app.ai.client.request_remote_bytes", side_effect=transport) as remote:
        task = asyncio.create_task(
            _make_client().chat(
                messages=[{"role": "user", "content": "hi"}], model="test-model"
            )
        )
        try:
            await asyncio.wait_for(started.wait(), 1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError) as caught:
                await asyncio.wait_for(task, 0.1)
            assert type(caught.value) is asyncio.CancelledError
            assert not finished.is_set()
            assert not isolated_guard._semaphore().locked()
        finally:
            release.set()
            await asyncio.wait_for(finished.wait(), 1)
        assert remote.call_count == 1


@pytest.mark.asyncio
async def test_bounded_rate_limit_uses_deadline_without_dispatch(isolated_guard):
    async def admission():
        await asyncio.sleep(1)

    isolated_guard.enforce_rate_limit.side_effect = admission
    with patch("app.ai.client.request_remote_bytes") as remote:
        with pytest.raises(TimeoutError):
            await _make_client().chat(
                messages=[{"role": "user", "content": "hi"}],
                model="test-model",
                deadline=time.monotonic() + 0.01,
            )
    remote.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [200, 400])
async def test_cancelled_bounded_call_never_negotiates_another_request(
    isolated_guard, status
):
    from app.ai.client import ChatCompletionCancelled

    loop = asyncio.get_running_loop()
    started = asyncio.Event()
    release = threading.Event()

    def transport(*_args, **_kwargs):
        loop.call_soon_threadsafe(started.set)
        assert release.wait(2)
        if status == 200:
            return _make_remote()
        return RemoteResponse(
            status=400,
            data=b'{"error":{"message":"Unsupported parameter: response_format"}}',
            content_type="application/json",
            final_url="https://api.deepseek.com",
        )

    with patch("app.ai.client.request_remote_bytes", side_effect=transport) as remote:
        task = asyncio.create_task(
            _make_client().chat(
                messages=[{"role": "user", "content": "hi"}],
                model="test-model",
                response_format={"type": "json_object"},
                deadline=time.monotonic() + 0.5,
            )
        )
        try:
            await asyncio.wait_for(started.wait(), 1)
            task.cancel()
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            assert not task.done()
        finally:
            release.set()
        with pytest.raises(asyncio.CancelledError) as caught:
            await task
        assert remote.call_count == 1
        if status == 200:
            assert isinstance(caught.value, ChatCompletionCancelled)
            assert caught.value.result["tokens_used"] == 10


@pytest.mark.asyncio
async def test_expired_executor_budget_does_not_dispatch(isolated_guard, monkeypatch):
    from app.ai import client as client_module

    original_to_thread = asyncio.to_thread
    release_executor = asyncio.Event()
    worker_exited = asyncio.Event()

    async def delayed_worker(callback, *args, **kwargs):
        try:
            await release_executor.wait()
            return await original_to_thread(callback, *args, **kwargs)
        finally:
            worker_exited.set()

    monkeypatch.setattr(client_module.asyncio, "to_thread", delayed_worker)
    remote = Mock(side_effect=AssertionError("expired work must not dispatch"))
    monkeypatch.setattr(client_module, "request_remote_bytes", remote)
    try:
        watchdog = asyncio.timeout(0.2)
        with pytest.raises(TimeoutError):
            async with watchdog:
                await _make_client().chat(
                    messages=[{"role": "user", "content": "hi"}],
                    model="test-model",
                    deadline=time.monotonic() + 0.01,
                )
        assert not watchdog.expired()
        await asyncio.sleep(0)
        assert worker_exited.is_set()
        assert not release_executor.is_set()
        assert not isolated_guard._semaphore().locked()
    finally:
        release_executor.set()
    remote.assert_not_called()
