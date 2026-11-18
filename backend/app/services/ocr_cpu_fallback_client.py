"""Remote-first OCR with lazy, process-isolated CPU recovery for local imports."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import replace
from typing import TYPE_CHECKING

from app.core.config import settings
from app.core.ocr_runtime_config import OcrRuntimeConfig
from app.core.ocr_types import STABLE_ERROR_CODES, WorkerResult

if TYPE_CHECKING:
    from app.services.ocr_local_worker_client import LocalOcrWorkerClient
    from app.services.ocr_paddlex_http_client import PaddleXHttpOcrWorkerClient

logger = logging.getLogger(__name__)


def allows_local_cpu_fallback(config: OcrRuntimeConfig) -> bool:
    """An explicit local profile is required; production always fails closed."""
    return (
        config.profile == "local_import"
        and config.environment != "production"
        and settings.APP_ENV.strip().lower() != "production"
    )


class CpuFallbackOcrWorkerClient:
    """Use CPU only when the remote client confirms a pre-connection failure.

    Read/write timeouts, auth failures, overload and invalid input are not
    evidence that the service is stopped. They keep their original errors.
    """

    cpu_fallback_enabled = True

    def __init__(
        self, config: OcrRuntimeConfig, remote: PaddleXHttpOcrWorkerClient
    ) -> None:
        if not allows_local_cpu_fallback(config):
            raise ValueError(
                "CPU OCR fallback requires a non-production local_import profile"
            )
        self._config = config
        self._remote = remote
        self._local: LocalOcrWorkerClient | None = None
        self._closed = False
        self._fallback_count = 0
        self._shutdown_task: asyncio.Task[None] | None = None

    def _get_local(self) -> LocalOcrWorkerClient:
        if self._local is None:
            from app.services.ocr_local_worker_client import LocalOcrWorkerClient

            cpu_config = replace(
                self._config,
                execution_backend="local_process",
                use_gpu=False,
                gpu_shards=1,
                remote_fallback_enabled=False,
                unsafe_thread_fallback_enabled=False,
            )
            self._local = LocalOcrWorkerClient(cpu_config)
        return self._local

    async def recognize(
        self,
        image_bytes: bytes,
        page_index: int = 0,
        *,
        mode: str = "boxes",
        options: dict | None = None,
    ) -> WorkerResult:
        if self._closed:
            return self._failure(page_index, "SHUTDOWN", "OCR client is shut down")
        started = time.monotonic()
        remote = await self._remote.recognize(
            image_bytes,
            page_index,
            mode=mode,
            options=options,
        )
        if remote.status == "success" or not (remote.result or {}).get(
            "remote_unavailable"
        ):
            return remote
        remaining = self._config.total_deadline - (time.monotonic() - started)
        if remaining <= 0 or self._closed:
            return remote
        if not allows_local_cpu_fallback(self._config):
            return remote
        return await self._recognize_cpu(
            image_bytes,
            page_index,
            mode,
            options,
            remaining,
            remote.stable_error_code,
        )

    async def _recognize_cpu(
        self,
        image_bytes: bytes,
        page_index: int,
        mode: str,
        options: dict | None,
        remaining: float,
        reason: str | None,
    ) -> WorkerResult:
        self._fallback_count += 1
        logger.warning(
            "Remote OCR connection unavailable; using local PaddleOCR CPU: page=%s code=%s",
            page_index,
            reason,
        )
        try:
            local = self._get_local()
            result = await asyncio.wait_for(
                local.recognize(image_bytes, page_index, mode=mode, options=options),
                timeout=remaining,
            )
        except TimeoutError:
            result = self._failure(page_index, "EXECUTION_TIMEOUT", "WSL CPU OCR 超时")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Local CPU OCR unavailable: error_type=%s", type(exc).__name__)
            result = self._failure(
                page_index,
                "ENGINE_NOT_AVAILABLE",
                f"远程 OCR 服务无法连接，WSL CPU OCR 不可用（{type(exc).__name__}）",
            )
        result.result = {
            **(result.result or {}),
            "execution_backend": "local_process",
            "use_gpu": False,
            "fallback_from": "paddlex_http",
            "fallback_reason": reason,
        }
        return result

    async def recognize_batch(
        self,
        images: list[tuple[int, bytes]],
        *,
        mode: str = "boxes",
        options: dict | None = None,
    ) -> list[WorkerResult]:
        """Bound running coroutines as well as the underlying CPU worker queue."""
        resolved: list[WorkerResult | None] = [None] * len(images)
        next_pos = 0

        async def run_pages() -> None:
            nonlocal next_pos
            while next_pos < len(images):
                pos = next_pos
                next_pos += 1
                idx, image = images[pos]
                try:
                    resolved[pos] = await self.recognize(
                        image, idx, mode=mode, options=options
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    resolved[pos] = self._failure(
                        idx, "ENGINE_ERROR", type(exc).__name__
                    )

        workers = [
            asyncio.create_task(run_pages())
            for _ in range(
                min(max(1, self._config.remote_max_concurrency), len(images))
            )
        ]
        try:
            await asyncio.gather(*workers)
        finally:
            for worker in workers:
                worker.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
        return sorted(
            (r for r in resolved if r is not None), key=lambda r: r.page_index
        )

    async def shutdown(
        self,
        *,
        graceful_timeout: float | None = None,
        kill_timeout: float | None = None,
    ) -> None:
        if self._shutdown_task is None:
            self._closed = True
            self._shutdown_task = asyncio.create_task(
                self._shutdown_clients(graceful_timeout, kill_timeout)
            )
        # Lifespan/caller cancellation must not strand native CPU workers.
        # Concurrent and later callers join the same cleanup operation.
        cancelled = False
        while not self._shutdown_task.done():
            try:
                await asyncio.shield(self._shutdown_task)
            except asyncio.CancelledError:
                cancelled = True
            except Exception:
                break
        if cancelled:
            if not self._shutdown_task.cancelled():
                self._shutdown_task.exception()
            raise asyncio.CancelledError
        self._shutdown_task.result()

    async def _shutdown_clients(
        self,
        graceful_timeout: float | None,
        kill_timeout: float | None,
    ) -> None:
        try:
            await self._remote.shutdown(
                graceful_timeout=graceful_timeout,
                kill_timeout=kill_timeout,
            )
        finally:
            if self._local is not None:
                await self._local.shutdown(
                    graceful_timeout=graceful_timeout,
                    kill_timeout=kill_timeout,
                )

    @property
    def metrics(self) -> dict:
        return {
            **self._remote.metrics,
            "cpu_fallback_enabled": True,
            "cpu_fallback_count": self._fallback_count,
            "cpu_fallback": self._local.metrics if self._local is not None else None,
        }

    @staticmethod
    def _failure(page_index: int, code: str, message: str) -> WorkerResult:
        return WorkerResult(
            page_index=page_index,
            status="failed",
            stable_error_code=STABLE_ERROR_CODES[code],
            error_type=code.lower(),
            result={"failed": True, "error": message},
        )
