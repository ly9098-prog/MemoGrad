"""Retain small, credential-free upload inputs for manual recovery.

The queue payload remains the fallback for imports admitted before this context
was written. Missing legacy context is reported instead of guessing a subject.
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.cache import cache

logger = logging.getLogger(__name__)
_PREFIX = "import:recovery:context"
_TTL = 7 * 86400


async def save_recovery_context(identifier: str, context: dict[str, Any]) -> None:
    await cache.set(f"{_PREFIX}:{identifier}", context, ttl=_TTL)


async def load_recovery_context(identifier: str, source_type: str) -> dict[str, Any]:
    cached = await cache.get(f"{_PREFIX}:{identifier}")
    if isinstance(cached, dict):
        return cached
    from app.services.task_queue_service import task_queue

    prefix = {"image": "image", "excel": "excel", "batch_image": "batch_image"}.get(
        source_type,
        "import",
    )
    try:
        task = await task_queue.get_task_v2(f"{prefix}:{identifier}")
    except Exception:
        logger.info("Recovery queue metadata unavailable: identifier=%s", identifier)
        return {}
    data = (task or {}).get("data") or {}
    return data.get("payload") or {} if isinstance(data, dict) else {}
