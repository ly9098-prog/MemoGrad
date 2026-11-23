from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.ai_runtime_guard import AIResourceRejectedError
from app.services import embedding_service


def _config():
    return SimpleNamespace(
        api_key="test-key",
        base_url="https://embedding.example/v1",
        model="embedding-model",
        dim=2,
        timeout=5,
        batch_size=2,
    )


@pytest.mark.asyncio
async def test_embedding_uses_the_reserved_user_rpm(monkeypatch):
    guard = AsyncMock()
    request = AsyncMock(return_value=(200, {"data": [{"embedding": [0.1, 0.2]}]}))
    monkeypatch.setattr(embedding_service.ai_runtime_guard, "enforce_rate_limit", guard)
    monkeypatch.setattr(embedding_service, "_request_embeddings", request)

    result = await embedding_service.get_embedding(
        "普通用户查询",
        config=_config(),
        rate_limit=-1,
    )

    assert result == [0.1, 0.2]
    guard.assert_awaited_once_with(-1)


@pytest.mark.asyncio
async def test_embedding_admission_failure_propagates_to_release_token_hold(monkeypatch):
    guard = AsyncMock(
        side_effect=AIResourceRejectedError("ai_rate_limited", retry_after_sec=4)
    )
    request = AsyncMock()
    monkeypatch.setattr(embedding_service.ai_runtime_guard, "enforce_rate_limit", guard)
    monkeypatch.setattr(embedding_service, "_request_embeddings", request)

    with pytest.raises(AIResourceRejectedError):
        await embedding_service.get_embedding("普通用户查询", config=_config())

    request.assert_not_awaited()
