from __future__ import annotations

import time

import pytest

from app.core.ai_runtime_guard import AIRuntimeGuard, AIResourceRejectedError
from app.core.log_context import bind_log_context, clear_log_context, reset_log_context


@pytest.mark.asyncio
async def test_explicit_unlimited_rpm_bypasses_gateway_rate_limit(monkeypatch):
    from app.core import ai_runtime_guard as module

    monkeypatch.setattr(module.settings, "REDIS_URL", "")
    monkeypatch.setattr(module.settings, "AI_USER_RPM_LIMIT", 100)
    guard = AIRuntimeGuard()
    tokens = bind_log_context(user_id="41")
    try:
        await guard.enforce_rate_limit(1)
        with pytest.raises(AIResourceRejectedError) as exc:
            await guard.enforce_rate_limit(1)
        assert exc.value.reason == "ai_rate_limited"
        await guard.enforce_rate_limit(-1)
    finally:
        reset_log_context(tokens)
        clear_log_context()


@pytest.mark.asyncio
async def test_explicit_unlimited_rpm_is_still_measured(monkeypatch):
    from app.core import ai_runtime_guard as module

    monkeypatch.setattr(module.settings, "REDIS_URL", "")
    guard = AIRuntimeGuard()
    tokens = bind_log_context(user_id="42")
    window_key = ("u:42", int(time.time() // 60))
    try:
        await guard.enforce_rate_limit(-1)
        await guard.enforce_rate_limit(-1)
        assert guard._local_rate[window_key] == 2
    finally:
        reset_log_context(tokens)
        clear_log_context()
