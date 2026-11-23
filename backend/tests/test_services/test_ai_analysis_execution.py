"""Contracts for AI-analysis generation locking and post-lock preparation."""

from __future__ import annotations

import logging

import pytest

from app.services.ai.analysis_execution import (
    begin_analysis_generation,
    finish_analysis_generation,
    prepare_locked_analysis_inputs,
    review_locked_analysis_cache,
)


class Cache:
    def __init__(self, *, enabled=True, have_lock=True, fail=False):
        self.enabled = enabled
        self.have_lock = have_lock
        self.fail = fail
        self.calls = []
        from app.core.cache import CacheClient
        self.admission_cache = CacheClient()
        self.admission_cache._enabled = False

    def __getattr__(self, name):
        if name in {"acquire_lock_strict", "get_strict", "commit_guarded_strict"}:
            return getattr(self.admission_cache, name)
        raise AttributeError(name)

    @property
    def is_enabled(self):
        return self.enabled

    async def acquire_lock(self, key, value, ttl):
        self.calls.append(("acquire", key, value, ttl))
        if self.fail:
            raise RuntimeError("redis unavailable")
        return self.have_lock

    async def reserve_rate_limits_strict(self, limits):
        return True

    async def release_lock(self, key, value):
        if key.endswith(":admission"):
            return await self.admission_cache.release_lock(key, value)
        self.calls.append(("release", key, value))


class Db:
    def __init__(self):
        self.refreshed = []

    async def refresh(self, value):
        self.refreshed.append(value)


@pytest.mark.asyncio
async def test_generation_lease_covers_local_and_cross_process_locks():
    cache = Cache()
    generating = {1}

    assert (
        await begin_analysis_generation(
            wrong_question_id=1,
            user_id=2,
            timeout_sec=30,
            lock_grace_sec=15,
            generating=generating,
            cache=cache,
        )
        is None
    )
    assert cache.calls == []

    lease = await begin_analysis_generation(
        wrong_question_id=3,
        user_id=2,
        timeout_sec=30,
        lock_grace_sec=15,
        generating=generating,
        cache=cache,
    )
    assert lease is not None and lease.have_lock
    assert cache.calls[0][0] == "acquire"
    assert cache.calls[0][1] == "ai:error_analysis:3"
    assert cache.calls[0][3] == 45
    assert cache.calls[0][2].startswith("2:")

    await finish_analysis_generation(
        wrong_question_id=3,
        generating=generating,
        lease=lease,
        cache=cache,
    )
    assert cache.calls[1] == ("release", "ai:error_analysis:3", cache.calls[0][2])
    assert 3 not in generating


@pytest.mark.asyncio
async def test_generation_lease_releases_local_reservation_on_failure_or_contention():
    generating = set()
    failing = Cache(fail=True)
    with pytest.raises(RuntimeError):
        await begin_analysis_generation(
            wrong_question_id=4,
            user_id=2,
            timeout_sec=30,
            lock_grace_sec=15,
            generating=generating,
            cache=failing,
        )
    assert 4 not in generating

    disabled = Cache(enabled=False, have_lock=False)
    lease = await begin_analysis_generation(
        wrong_question_id=4,
        user_id=2,
        timeout_sec=30,
        lock_grace_sec=15,
        generating=generating,
        cache=disabled,
    )
    assert lease is not None and not lease.have_lock
    assert 4 in generating
    await finish_analysis_generation(
        wrong_question_id=4,
        generating=generating,
        lease=lease,
        cache=disabled,
    )
    assert disabled.calls == [("acquire", "ai:error_analysis:4", lease.lock_value, 45)]

    contention = Cache(enabled=True, have_lock=False)
    assert (
        await begin_analysis_generation(
            wrong_question_id=4,
            user_id=2,
            timeout_sec=30,
            lock_grace_sec=15,
            generating=generating,
            cache=contention,
        )
        is None
    )
    assert 4 not in generating


@pytest.mark.asyncio
async def test_locked_cache_review_refreshes_and_reuses_only_matching_cache():
    logger = logging.getLogger("test-analysis-execution")
    db = Db()
    wrong_question = type("W", (), {"id": 7, "ai_analysis": {"_meta": {}}})()
    question = type("Q", (), {"id": 3})()

    def signature(*args, **kwargs):
        return f"signature:{kwargs.get('visual_sources')}"

    def cached_response(*args, **kwargs):
        return (
            {"model": "cache"}
            if kwargs["expected_input_signature"] == "signature:['x']"
            else None
        )

    review = await review_locked_analysis_cache(
        db,
        wrong_question,
        question,
        user_id=2,
        force=False,
        requires_visual=True,
        stored_visual_sources=["x"],
        knowledge_points=[],
        model_signature="model",
        input_signature=signature,
        cached_response=cached_response,
        cache_age=lambda _: 123,
        logger=logger,
    )
    assert db.refreshed == [wrong_question]
    assert review.response == {"model": "cache"}

    force_review = await review_locked_analysis_cache(
        db,
        wrong_question,
        question,
        user_id=2,
        force=True,
        requires_visual=True,
        stored_visual_sources=["x"],
        knowledge_points=[],
        model_signature="model",
        input_signature=signature,
        cached_response=cached_response,
        cache_age=lambda _: 123,
        logger=logger,
    )
    assert force_review.response is None
    assert force_review.input_signature == "signature:['x']"


@pytest.mark.asyncio
async def test_locked_inputs_preserve_failure_and_grounding_contracts():
    logger = logging.getLogger("test-analysis-execution")
    wrong_question = type("W", (), {"id": 7})()
    question = type("Q", (), {"id": 3})()

    async def visual_inputs(value, *, fail=False, urls=()):
        return list(urls), {
            "structured_visual": "<math>x</math>",
            "declared_source_count": 1 if fail else 0,
        }

    missing = await prepare_locked_analysis_inputs(
        wrong_question,
        question,
        current_answer_grounding={"answer": "B"},
        requires_visual=True,
        runtime=object(),
        knowledge_points=[],
        timeout_sec=30,
        logger=logger,
        prepare_visual_inputs=lambda q: visual_inputs(q, fail=True),
        build_context=lambda *args: {"question": {}},
        build_prompt_grounding=lambda value: {"prompt": value},
        build_expected_answer_check=lambda value: ["B"],
    )
    assert missing.response["error_code"] == "vision_input_missing"

    unconfigured = await prepare_locked_analysis_inputs(
        wrong_question,
        question,
        current_answer_grounding={"answer": "B"},
        requires_visual=False,
        runtime=None,
        knowledge_points=[],
        timeout_sec=30,
        logger=logger,
        prepare_visual_inputs=lambda q: visual_inputs(q),
        build_context=lambda *args: {"question": {}},
        build_prompt_grounding=lambda value: {"prompt": value},
        build_expected_answer_check=lambda value: ["B"],
    )
    assert unconfigured.response["error_code"] == "ai_model_unconfigured"

    ready = await prepare_locked_analysis_inputs(
        wrong_question,
        question,
        current_answer_grounding={"answer": "B"},
        requires_visual=False,
        runtime=object(),
        knowledge_points=["kp"],
        timeout_sec=30,
        logger=logger,
        prepare_visual_inputs=lambda q: visual_inputs(
            q, urls=["data:image/png;base64,x"]
        ),
        build_context=lambda w, q, kps: {"question": {}, "knowledge_points": kps},
        build_prompt_grounding=lambda value: {"prompt": value},
        build_expected_answer_check=lambda value: ["B"],
    )
    assert ready.response is None
    assert ready.image_data_urls == ["data:image/png;base64,x"]
    assert ready.context["question"]["structured_visual"] == "<math>x</math>"
    assert ready.answer_grounding == {"answer": "B"}
    assert ready.prompt_grounding == {"prompt": {"answer": "B"}}
    assert ready.expected_answer_check == ["B"]
    assert ready.model_timeout_sec == 30


@pytest.mark.asyncio
async def test_regeneration_admission_is_atomic_and_separate_per_user():
    import asyncio
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.services.ai.analysis_regeneration import admit_regeneration

    client = CacheClient()
    client._enabled = False
    wq = SimpleNamespace(id=44, question_id=4, ai_analysis=None)
    responses = await asyncio.gather(*[
        admit_regeneration(cache=client, user_id=51, wrong_question=wq)
        for _ in range(20)
    ])
    assert sum(value is None for value in responses) == 1
    assert all(value["error_code"] == "ai_regeneration_limited" for value in responses if value)
    assert await admit_regeneration(cache=client, user_id=52, wrong_question=wq) is None


@pytest.mark.asyncio
async def test_regeneration_admission_fails_closed_on_redis_outage():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.core.cache import CacheUnavailableError
    from app.services.ai.analysis_regeneration import admit_regeneration

    client = SimpleNamespace(acquire_lock_strict=AsyncMock(
        side_effect=CacheUnavailableError("unavailable")
    ))
    result = await admit_regeneration(cache=client, user_id=51,
                                     wrong_question=SimpleNamespace(id=44, question_id=4, ai_analysis=None))
    assert result["error_code"] == "ai_regeneration_unavailable"
    assert result["force_regenerated"] is False


@pytest.mark.asyncio
async def test_daily_regeneration_limits_cannot_be_bypassed_by_switching_questions(monkeypatch):
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.services.ai.analysis_regeneration import admit_regeneration

    client = CacheClient()
    client._enabled = False
    from app.services.ai import analysis_regeneration
    clock = [100000.0]
    monkeypatch.setattr(analysis_regeneration, "time", lambda: clock[0])
    async def attempt(question_id):
        return await admit_regeneration(cache=client, user_id=51,
                                        wrong_question=SimpleNamespace(id=question_id, question_id=question_id, ai_analysis=None))
    def elapse_minute():
        clock[0] += 61
    for _ in range(3):
        assert await attempt(44) is None
        elapse_minute()
    assert (await attempt(44))["error_code"] == "ai_regeneration_limited"
    # Denials do not charge any of the other counters.
    for i in range(17):
        assert await attempt(100 + i) is None
        elapse_minute()
    assert (await attempt(999))["error_code"] == "ai_regeneration_limited"


@pytest.mark.asyncio
async def test_rolling_day_and_recreated_wrong_record_do_not_reset_question_budget(monkeypatch):
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.services.ai import analysis_regeneration as module

    client = CacheClient()
    client._enabled = False
    clock = [100000.0]
    monkeypatch.setattr(module, "time", lambda: clock[0])
    async def attempt(at, wrong_id=44, question_id=4):
        clock[0] = 100000 + at
        return await module.admit_regeneration(
            cache=client, user_id=51,
            wrong_question=SimpleNamespace(id=wrong_id, question_id=question_id, ai_analysis=None),
        )
    assert await attempt(0) is None
    assert await attempt(86280) is None
    assert await attempt(86341) is None
    assert await attempt(86402) is None
    assert (await attempt(86463))["error_code"] == "ai_regeneration_limited"
    assert (await attempt(86524, wrong_id=999))["error_code"] == "ai_regeneration_limited"
    # Other questions have their own allowance but the user rolling cap is shared.
    for i in range(17):
        assert await attempt(86600 + 61 * i, question_id=100 + i) is None
    assert (await attempt(88000, question_id=888))["error_code"] == "ai_regeneration_limited"


@pytest.mark.asyncio
async def test_expired_regeneration_admission_lease_cannot_commit_a_paid_attempt():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.services.ai.analysis_regeneration import admit_regeneration

    client = SimpleNamespace(acquire_lock_strict=AsyncMock(return_value=True),
                             release_lock=AsyncMock(), get_strict=AsyncMock(return_value=None),
                             commit_guarded_strict=AsyncMock(return_value=False))
    result = await admit_regeneration(cache=client, user_id=51,
        wrong_question=SimpleNamespace(id=44, question_id=4, ai_analysis=None))
    assert result["error_code"] == "ai_regeneration_unavailable"
    client.release_lock.assert_awaited_once()


@pytest.mark.asyncio
async def test_unlimited_regeneration_ledger_is_bounded_and_restores_finite_limits(
    monkeypatch,
):
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.core.config import settings
    from app.services.ai import analysis_regeneration as module
    from app.services.user_ai_policy_service import EffectiveUserAIPolicy

    client = CacheClient()
    client._enabled = False
    clock = [100_000.0]
    monkeypatch.setattr(module, "time", lambda: clock[0])
    unlimited = EffectiveUserAIPolicy(
        regeneration_cooldown_seconds=-1,
        regeneration_question_24h_limit=-1,
        regeneration_account_24h_limit=-1,
        daily_token_limit=-1,
        monthly_token_limit=-1,
        rpm_limit=-1,
    )
    finite = EffectiveUserAIPolicy(
        regeneration_cooldown_seconds=-1,
        regeneration_question_24h_limit=1,
        regeneration_account_24h_limit=3,
        daily_token_limit=-1,
        monthly_token_limit=-1,
        rpm_limit=-1,
    )

    active = {"policy": unlimited}

    async def policy_for(_db, _user_id):
        return active["policy"]

    monkeypatch.setattr(module, "get_effective_user_ai_policy", policy_for)
    wrong_question = SimpleNamespace(id=44, question_id=4, ai_analysis=None)
    for _ in range(1_005):
        clock[0] += 1
        assert (
            await module.admit_regeneration(
                cache=client,
                db=object(),
                user_id=51,
                wrong_question=wrong_question,
            )
            is None
        )

    ledger_key = (
        f"memograd:{settings.APP_ENV}:ai:regeneration:user:51:rolling-day"
    )
    assert len(await client.get_strict(ledger_key)) == 1_000

    active["policy"] = finite
    result = await module.admit_regeneration(
        cache=client,
        db=object(),
        user_id=51,
        wrong_question=wrong_question,
    )
    assert result["error_code"] == "ai_regeneration_limited"
    assert result["limit_dimension"] == "account"
    assert result["limit_value"] == 3
    assert result["retry_after_seconds"] > 0


@pytest.mark.asyncio
async def test_regeneration_admission_uses_unlimited_user_policy(monkeypatch):
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.services.ai import analysis_regeneration as module

    policy = SimpleNamespace(
        regeneration_cooldown_seconds=-1,
        regeneration_question_24h_limit=-1,
        regeneration_account_24h_limit=-1,
    )

    async def effective_policy(_db, _user_id):
        return policy

    monkeypatch.setattr(module, "get_effective_user_ai_policy", effective_policy)
    client = CacheClient()
    client._enabled = False
    wrong = SimpleNamespace(id=44, question_id=4, ai_analysis=None)
    for _ in range(8):
        assert (
            await module.admit_regeneration(
                cache=client, db=object(), user_id=51, wrong_question=wrong
            )
            is None
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("initial_question_limit", [3, -1])
async def test_other_questions_cannot_evict_live_per_question_history(
    monkeypatch, initial_question_limit
):
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.core.config import settings
    from app.services.ai import analysis_regeneration as module

    client = CacheClient()
    client._enabled = False
    clock = [100_000.0]
    monkeypatch.setattr(module, "time", lambda: clock[0])
    policy = SimpleNamespace(
        regeneration_cooldown_seconds=-1,
        regeneration_question_24h_limit=initial_question_limit,
        regeneration_account_24h_limit=-1,
    )

    async def attempt(question_id):
        return await module.admit_regeneration(
            cache=client,
            user_id=51,
            wrong_question=SimpleNamespace(question_id=question_id, ai_analysis=None),
            policy=policy,
        )

    for _ in range(3):
        assert await attempt(4) is None
    for index in range(1_005):
        clock[0] += 1
        assert await attempt(100 + index // 3) is None

    prefix = f"memograd:{settings.APP_ENV}:ai:regeneration:user:51"
    assert len(await client.get_strict(f"{prefix}:rolling-day")) == 1_000
    assert len(await client.get_strict(f"{prefix}:question:4:rolling-day")) == 3
    policy.regeneration_question_24h_limit = 3
    denied = await attempt(4)
    assert denied["limit_dimension"] == "question"
    assert denied["retry_after_seconds"] == 86_400 - 1_005
    clock[0] = 100_000 + 86_400
    assert await attempt(4) is None
    assert len(await client.get_strict(f"{prefix}:question:4:rolling-day")) == 1


@pytest.mark.asyncio
async def test_per_question_ledger_seeds_legacy_shared_history(monkeypatch):
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.core.config import settings
    from app.services.ai import analysis_regeneration as module

    client = CacheClient()
    client._enabled = False
    monkeypatch.setattr(module, "time", lambda: 100_000.0)
    prefix = f"memograd:{settings.APP_ENV}:ai:regeneration:user:51"
    await client.set(f"{prefix}:rolling-day", [(99_000, 4), (99_500, 4)], ttl=86_400)
    policy = SimpleNamespace(
        regeneration_cooldown_seconds=-1,
        regeneration_question_24h_limit=3,
        regeneration_account_24h_limit=-1,
    )
    wrong = SimpleNamespace(question_id=4, ai_analysis=None)
    assert await module.admit_regeneration(
        cache=client, user_id=51, wrong_question=wrong, policy=policy
    ) is None
    denied = await module.admit_regeneration(
        cache=client, user_id=51, wrong_question=wrong, policy=policy
    )
    assert denied["limit_dimension"] == "question"
    assert len(await client.get_strict(f"{prefix}:question:4:rolling-day")) == 3


@pytest.mark.asyncio
async def test_legacy_question_history_survives_eviction_before_first_new_request(monkeypatch):
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.core.config import settings
    from app.services.ai import analysis_regeneration as module

    client = CacheClient()
    client._enabled = False
    monkeypatch.setattr(module, "time", lambda: 100_000.0)
    prefix = f"memograd:{settings.APP_ENV}:ai:regeneration:user:51"
    legacy_events = [(98_000, 4)] * 3 + [(99_000, 100 + i // 3) for i in range(997)]
    await client.set(f"{prefix}:rolling-day", legacy_events, ttl=86_400)
    policy = SimpleNamespace(
        regeneration_cooldown_seconds=-1,
        regeneration_question_24h_limit=3,
        regeneration_account_24h_limit=-1,
    )
    for _ in range(3):
        assert await module.admit_regeneration(
            cache=client, user_id=51,
            wrong_question=SimpleNamespace(question_id=9999, ai_analysis=None), policy=policy,
        ) is None
    denied = await module.admit_regeneration(
        cache=client, user_id=51,
        wrong_question=SimpleNamespace(question_id=4, ai_analysis=None), policy=policy,
    )
    assert denied["limit_dimension"] == "question"
    assert len(await client.get_strict(f"{prefix}:question:4:rolling-day")) == 3


@pytest.mark.asyncio
async def test_local_capacity_rejects_regeneration_without_partial_charge():
    from types import SimpleNamespace

    from app.core.cache import CacheClient
    from app.core.config import settings
    from app.services.ai import analysis_regeneration as module

    client = CacheClient()
    client._enabled = False
    client._local_max_size = 2  # Admission lock + shared ledger leave no question slot.
    result = await module.admit_regeneration(
        cache=client, user_id=51,
        wrong_question=SimpleNamespace(question_id=4, ai_analysis=None),
    )
    assert result["error_code"] == "ai_regeneration_unavailable"
    prefix = f"memograd:{settings.APP_ENV}:ai:regeneration:user:51"
    assert await client.get_strict(f"{prefix}:rolling-day") is None
    assert await client.get_strict(f"{prefix}:question:4:rolling-day") is None
