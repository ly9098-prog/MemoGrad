"""Local remote-first policy tests; neither real models nor sockets are used."""

from __future__ import annotations

import asyncio
import sys
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.config import settings
from app.core.ocr_runtime_config import OcrRuntimeConfig
from app.core.ocr_types import WorkerResult
from app.services import ocr_paddlex_http_client as remote_module
from app.services.ocr_cpu_fallback_client import CpuFallbackOcrWorkerClient
from app.services.ocr_worker_client import create_ocr_worker_client


@pytest.fixture
def ports(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "test")
    guard = SimpleNamespace(
        acquire_global=AsyncMock(return_value="test-lease"),
        release_global=AsyncMock(),
        renew_global=AsyncMock(return_value=True),
    )
    monkeypatch.setattr(remote_module, "get_global_concurrency", lambda: guard)
    monkeypatch.setattr(remote_module, "_compute_backoff", lambda *a, **k: 0)
    instances = []

    class Local:
        def __init__(self, config):
            self.config = config
            self.recognize = AsyncMock(side_effect=self.success)
            self.shutdown = AsyncMock()
            self.metrics = {"backend": "local_process"}
            instances.append(self)

        async def success(self, image, page_index, **kwargs):
            return WorkerResult(
                page_index=page_index,
                status="success",
                engine_fingerprint="cpu-fingerprint",
                result={
                    "text": image.decode(),
                    "boxes": [[1, 2, 3, 4]],
                    "engine_fingerprint": "cpu-fingerprint",
                },
            )

    monkeypatch.setitem(
        sys.modules,
        "app.services.ocr_local_worker_client",
        SimpleNamespace(LocalOcrWorkerClient=Local),
    )
    return instances


def config(**kwargs):
    return replace(
        OcrRuntimeConfig(
            enabled=True,
            profile="local_import",
            execution_backend="paddlex_http",
            remote_url="http://test.invalid/ocr",
            use_gpu=True,
        ),
        **kwargs,
    )


def response():
    return httpx.Response(
        200,
        json={
            "errorCode": 0,
            "result": {
                "ocrResults": [
                    {
                        "prunedResult": {
                            "rec_texts": ["remote text"],
                            "rec_scores": [0.9],
                            "rec_boxes": [[1, 2, 3, 4]],
                        }
                    }
                ]
            },
        },
    )


@pytest.mark.asyncio
async def test_remote_success_does_not_initialize_cpu(ports):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: response())
    ) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        result = await client.recognize(b"image", 7)
        assert result.status == "success"
        assert result.result["text"] == "remote text"
        assert ports == []
        await client.shutdown()
        assert not http.is_closed  # injected transport belongs to the caller


@pytest.mark.asyncio
@pytest.mark.parametrize("exc_type", [httpx.ConnectError, httpx.ConnectTimeout])
async def test_connection_failure_uses_cpu_once_and_preserves_input(ports, exc_type):
    requests = []

    def unavailable(request):
        requests.append(request)
        raise exc_type("private connection detail", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        result = await client.recognize(b"original image", 4, options={"rotate": False})
        assert isinstance(client, CpuFallbackOcrWorkerClient)
        assert len(requests) == 1  # stopped service is not retried before CPU recovery
        assert len(ports) == 1
        assert ports[0].config.execution_backend == "local_process"
        assert ports[0].config.use_gpu is False
        assert ports[0].config.unsafe_thread_fallback_enabled is False
        ports[0].recognize.assert_awaited_once_with(
            b"original image",
            4,
            mode="boxes",
            options={"rotate": False},
        )
        assert result.status == "success"
        assert result.result["execution_backend"] == "local_process"
        assert result.result["engine_fingerprint"] == "cpu-fingerprint"
        assert result.result["fallback_from"] == "paddlex_http"
        assert client.metrics["cpu_fallback_count"] == 1
        await client.shutdown()
        await client.shutdown()
        ports[0].shutdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_connection_failure_notifies_before_cpu_work_starts(ports):
    events = []

    def unavailable(request):
        raise httpx.ConnectError("stopped", request=request)

    async def notify(event):
        events.append((event, ports[0].recognize.await_count if ports else 0))

    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        result = await client.recognize_batch(
            [(3, b"image")],
            options={"_ocr_fallback_notify": notify},
        )
        assert result[0].status == "success"
        assert events == [({
            "backend": "local_process",
            "fallback_from": "paddlex_http",
            "fallback_reason": "ocr.remote_connect_error",
            "page_index": 3,
        }, 0)]
        assert ports[0].recognize.await_count == 1
        await client.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "outcome",
    [httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout, 401, 403, 429, 500, 503],
)
async def test_no_cpu_for_post_connect_errors_or_overload(ports, outcome):
    def handler(request):
        if isinstance(outcome, int):
            return httpx.Response(outcome, json={"errorCode": -1})
        raise outcome("private error", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        result = await client.recognize(b"image")
        assert result.status == "failed"
        assert ports == []
        assert not result.result.get("remote_unavailable")
        await client.shutdown()


@pytest.mark.asyncio
async def test_batch_keeps_remote_success_and_continues_cpu_during_connect_circuit(
    ports,
):
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            return response()
        raise httpx.ConnectError("stopped", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        results = await client.recognize_batch(
            [(n, f"image {n}".encode()) for n in range(9)]
        )
        assert len(results) == 9
        assert all(r.status == "success" for r in results)
        assert results[0].result["text"] == "remote text"
        assert [r.page_index for r in results] == list(range(9))
        assert len(ports) == 1
        assert ports[0].recognize.await_count == 8
        assert (
            calls == 6
        )  # successful request then five connection failures; circuit opens
        await client.shutdown()


@pytest.mark.asyncio
async def test_remote_recovery_is_preferred_after_cpu(ports):
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ConnectError("stopped", request=request)
        return response()

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        first = await client.recognize(b"local text")
        second = await client.recognize(b"image")
        assert first.result["text"] == "local text"
        assert second.result["text"] == "remote text"
        assert ports[0].recognize.await_count == 1
        await client.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"profile": "cloud_api"},
        {"profile": ""},
        {"environment": "production"},
    ],
)
async def test_cloud_unknown_and_production_config_never_enable_cpu(ports, overrides):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: response())
    ) as http:
        client = create_ocr_worker_client(config(**overrides), http_client=http)
        assert isinstance(client, remote_module.PaddleXHttpOcrWorkerClient)
        assert not client._connection_fallback_enabled
        await client.shutdown()
    assert ports == []


@pytest.mark.asyncio
async def test_production_app_env_overrides_inconsistent_local_config(
    ports, monkeypatch
):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: response())
    ) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        assert isinstance(client, remote_module.PaddleXHttpOcrWorkerClient)
        await client.shutdown()


@pytest.mark.asyncio
async def test_cpu_cancellation_propagates_and_shutdown_releases_both(ports):
    def handler(request):
        raise httpx.ConnectError("stopped", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        local = client._get_local()
        entered = asyncio.Event()

        async def block(*a, **k):
            entered.set()
            await asyncio.Event().wait()

        local.recognize.side_effect = block
        task = asyncio.create_task(
            client.recognize_batch([(1, b"image"), (2, b"image")])
        )
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await client.shutdown()
        assert (await client.recognize(b"image")).stable_error_code == "ocr.shutdown"
        local.shutdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_cpu_initialization_failure_is_visible_not_empty_or_remote_success(
    ports, monkeypatch
):
    def unavailable(request):
        raise httpx.ConnectError("stopped", request=request)

    def no_cpu(*args):
        raise ImportError("private system path")

    monkeypatch.setattr(
        sys.modules["app.services.ocr_local_worker_client"],
        "LocalOcrWorkerClient",
        no_cpu,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        result = await client.recognize(b"image")
        assert result.status == "failed"
        assert result.stable_error_code == "ocr.engine_not_available"
        assert "WSL CPU OCR" in result.result["error"]
        assert "private" not in result.result["error"]
        await client.shutdown()


@pytest.mark.asyncio
async def test_cloud_gateway_rejects_injected_local_fallback_client(ports):
    from app.core.deployment_profile import DeploymentProfile
    from app.features.ocr_gateway import OCRGateway

    def down(request):
        raise httpx.ConnectError("stopped", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(down)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        gateway = OCRGateway(
            mode="gateway", profile=DeploymentProfile.CLOUD_API, worker_client=client
        )
        results = await gateway.recognize_pages([(1, b"image")])
        assert results[0].stable_error_code == "ocr.engine_not_available"
        assert ports == []
        await gateway.shutdown()


@pytest.mark.asyncio
async def test_shutdown_while_remote_in_flight_cannot_start_cpu(ports):
    entered, release = asyncio.Event(), asyncio.Event()

    async def down(request):
        entered.set()
        await release.wait()
        raise httpx.ConnectError("stopped", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(down)) as http:
        client = create_ocr_worker_client(config(), http_client=http)
        task = asyncio.create_task(client.recognize(b"image"))
        await entered.wait()
        await client.shutdown()
        release.set()
        result = await task
        assert result.status == "failed"
        assert ports == []


@pytest.mark.asyncio
async def test_cpu_remaining_deadline_is_enforced_and_cancels_work(ports):
    def down(request):
        raise httpx.ConnectError("stopped", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(down)) as http:
        client = create_ocr_worker_client(config(total_deadline=0.05), http_client=http)
        local = client._get_local()
        cancelled = asyncio.Event()

        async def block(*a, **k):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        local.recognize.side_effect = block
        result = await client.recognize(b"image")
        assert result.stable_error_code == "ocr.execution_timeout"
        assert cancelled.is_set()
        await client.shutdown()


@pytest.mark.asyncio
async def test_cpu_cleanup_still_runs_when_remote_shutdown_is_cancelled(ports):
    remote = SimpleNamespace(shutdown=AsyncMock(side_effect=asyncio.CancelledError))
    client = CpuFallbackOcrWorkerClient(config(), remote)
    local = client._get_local()
    with pytest.raises(asyncio.CancelledError):
        await client.shutdown(graceful_timeout=2, kill_timeout=3)
    local.shutdown.assert_awaited_once_with(graceful_timeout=2, kill_timeout=3)


def test_cpu_payload_source_survives_geometry_builder(ports):
    from app.features.ocr_layout_blocks import build_pre_extracted_ocr_blocks

    blocks = build_pre_extracted_ocr_blocks(
        image_bytes=b"no-image-dimensions",
        cleaned_text="CPU text",
        ocr_result={
            "execution_backend": "local_process",
            "fallback_from": "paddlex_http",
            "fallback_reason": "ocr.remote_connect_error",
            "engine_fingerprint": "cpu-v1",
        },
    )
    assert blocks[0]["execution_backend"] == "local_process"
    assert blocks[0]["fallback_from"] == "paddlex_http"


@pytest.mark.asyncio
async def test_cancelled_and_concurrent_shutdown_wait_for_cpu_cleanup(ports):
    remote = SimpleNamespace(shutdown=AsyncMock())
    client = CpuFallbackOcrWorkerClient(config(), remote)
    local = client._get_local()
    entered, release, stopped = asyncio.Event(), asyncio.Event(), asyncio.Event()

    async def drain(**kwargs):
        entered.set()
        await release.wait()
        stopped.set()

    local.shutdown.side_effect = drain
    first = asyncio.create_task(client.shutdown())
    await entered.wait()
    first.cancel()
    second = asyncio.create_task(client.shutdown())
    await asyncio.sleep(0)
    assert not first.done() and not second.done()
    assert not stopped.is_set()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await first
    await second
    await client.shutdown()
    assert stopped.is_set()
    local.shutdown.assert_awaited_once()


@pytest.mark.asyncio
async def test_late_remote_success_does_not_erase_connect_circuit_reason(ports):
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def handler(request):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            await release.wait()
            return response()
        raise httpx.ConnectError("stopped", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_ocr_worker_client(
            config(remote_max_concurrency=2), http_client=http
        )
        late_success = asyncio.create_task(client.recognize(b"remote"))
        await entered.wait()
        for _ in range(5):
            assert (await client.recognize(b"cpu")).status == "success"
        assert client._remote._circuit_state == "open"
        release.set()
        assert (await late_success).status == "success"
        assert client._remote._circuit_state == "open"
        after = await client.recognize(b"cpu after late success")
        assert after.status == "success"
        assert after.result["execution_backend"] == "local_process"
        assert calls == 6
        assert ports[0].recognize.await_count == 6
        await client.shutdown()
