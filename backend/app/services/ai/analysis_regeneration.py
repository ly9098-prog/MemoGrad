"""Admission and honest failure semantics shared by direct and recovered generation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from math import ceil
from time import time
from typing import Any
from uuid import uuid4

from app.ai.answer_grounding import merge_grounded_diagnosis
from app.ai.fallback import get_fallback_analysis
from app.core.cache import CacheUnavailableError
from app.core.config import settings
from app.models.user_ai_policy import POLICY_FIELD_MAX
from app.services.ai.analysis_content import (
    _normalize_ai_analysis,
    is_valid_ai_analysis,
)
from app.services.ai.visual_cache import ai_analysis_generated_at
from app.services.ai_token_budget import record_token_usage
from app.services.user_ai_policy_service import (
    EffectiveUserAIPolicy,
    UserAIPolicyUnavailableError,
    get_effective_user_ai_policy,
    runtime_default_values,
)


@dataclass(frozen=True, slots=True)
class RegenerationLimit:
    reason: str
    retry_after_seconds: int | None
    limit_value: int | None


def preserved_response(
    wrong_question: Any,
    *,
    code: str,
    message: str,
    limit: RegenerationLimit | None = None,
) -> dict:
    stored = getattr(wrong_question, "ai_analysis", None)
    old = _normalize_ai_analysis(stored) if isinstance(stored, dict) else {}
    preserved = is_valid_ai_analysis(old)
    return {
        "content": old if preserved else get_fallback_analysis(),
        "model": "regeneration_rejected",
        "from_cache": preserved,
        "from_fallback": True,
        "cache_preserved": preserved,
        "force_regenerated": False,
        "tokens_used": 0,
        "duration_ms": 0,
        "generated_at": ai_analysis_generated_at(stored) if preserved else None,
        "error_code": code,
        "message": message,
        "limit_dimension": limit.reason if limit else None,
        "limit_value": limit.limit_value if limit else None,
        "retry_after_seconds": limit.retry_after_seconds if limit else None,
        # Background recovery must not repeatedly spend attempts on a denial.
        "retryable": False,
    }


async def admit_regeneration(
    *,
    cache: Any,
    db: Any = None,
    user_id: int,
    wrong_question: Any,
    policy: EffectiveUserAIPolicy | None = None,
) -> dict | None:
    try:
        effective_policy = policy
        if effective_policy is None:
            effective_policy = (
                await get_effective_user_ai_policy(db, user_id)
                if db is not None
                else EffectiveUserAIPolicy(**runtime_default_values().model_dump())
            )
    except UserAIPolicyUnavailableError:
        return preserved_response(
            wrong_question,
            code="ai_regeneration_unavailable",
            message="重新生成服务暂不可用，请稍后重试；已保留原复盘",
        )
    prefix = f"memograd:{settings.APP_ENV}:ai:regeneration:user:{user_id}"
    owner = uuid4().hex
    lock = f"{prefix}:admission"
    try:
        acquired = await cache.acquire_lock_strict(lock, owner, ttl=10)
        if not acquired:
            return _limited_response(
                wrong_question,
                RegenerationLimit("admission", 5, None),
            )
        try:
            reason = await _reserve_rolling_attempt(
                cache, prefix, lock, owner, wrong_question, effective_policy
            )
        finally:
            await cache.release_lock(lock, owner)
    except CacheUnavailableError:
        return preserved_response(
            wrong_question,
            code="ai_regeneration_unavailable",
            message="重新生成服务暂不可用，请稍后重试；已保留原复盘",
        )
    return None if reason is None else _limited_response(wrong_question, reason)


def _limited_response(
    wrong_question: Any,
    limit: RegenerationLimit,
) -> dict:
    wait = (
        f"，约 {limit.retry_after_seconds} 秒后重试"
        if limit.retry_after_seconds is not None
        else "，请稍后重试"
    )
    if limit.reason == "question":
        message = f"该题 24 小时内最多重新生成 {limit.limit_value} 次{wait}"
    elif limit.reason == "account":
        message = f"账号 24 小时内最多重新生成 {limit.limit_value} 次{wait}"
    elif limit.reason == "admission":
        message = "已有重新生成请求正在处理，请稍后重试"
    else:
        message = f"重新生成冷却中{wait}"
    return preserved_response(
        wrong_question,
        code="ai_regeneration_limited",
        message=message,
        limit=limit,
    )


async def _reserve_rolling_attempt(
    cache, prefix, lock, owner, wrong_question, policy
) -> RegenerationLimit | None:
    now = time()
    key = f"{prefix}:rolling-day"
    question_id = int(wrong_question.question_id)
    question_key = f"{prefix}:question:{question_id}:rolling-day"
    stored = await cache.get_strict(key)
    stored_question = await cache.get_strict(question_key)
    try:
        events = sorted([
            (float(at), int(qid))
            for at, qid in (stored or [])
            if float(at) > now - 86400
        ], key=lambda event: event[0])
        # Seed a new per-question ledger from the previous shared format.
        question_events = sorted(
            float(at)
            for at in (
                stored_question
                if stored_question is not None
                else [at for at, qid in events if qid == question_id]
            )
            if float(at) > now - 86400
        )
    except (TypeError, ValueError) as exc:
        raise CacheUnavailableError("Invalid regeneration ledger") from exc
    cooldown = policy.regeneration_cooldown_seconds
    if cooldown != -1 and events and events[-1][0] > now - cooldown:
        return RegenerationLimit(
            "cooldown",
            max(1, ceil(events[-1][0] + cooldown - now)),
            cooldown,
        )
    account_limit = policy.regeneration_account_24h_limit
    if account_limit != -1 and len(events) >= account_limit:
        reset_at = events[len(events) - account_limit][0] + 86400
        return RegenerationLimit(
            "account", max(1, ceil(reset_at - now)), account_limit
        )
    question_limit = policy.regeneration_question_24h_limit
    if question_limit != -1 and len(question_events) >= question_limit:
        reset_at = question_events[len(question_events) - question_limit] + 86400
        return RegenerationLimit(
            "question", max(1, ceil(reset_at - now)), question_limit
        )
    events.append((now, question_id))
    question_events.append(now)
    retention = POLICY_FIELD_MAX["regeneration_account_24h_limit"]
    migrated_values = []
    # Preserve still-live legacy history before it leaves the shared ledger,
    # including questions not requested since this format was introduced.
    for evicted_id in {qid for _, qid in events[:-retention]} - {question_id}:
        evicted_key = f"{prefix}:question:{evicted_id}:rolling-day"
        if await cache.get_strict(evicted_key) is None:
            migrated_values.append((
                evicted_key,
                [at for at, qid in events if qid == evicted_id],
                86400,
            ))
    # The most recent maximum-limit events suffice for any supported future
    # limit. Other questions must never evict this question's live history.
    events = events[-retention:]
    question_events = question_events[-POLICY_FIELD_MAX["regeneration_question_24h_limit"]:]
    committed = await cache.commit_guarded_strict(
        locks=[(lock, owner)],
        expected={},
        values=[(key, events, 86400), (question_key, question_events, 86400), *migrated_values],
    )
    if not committed:
        raise CacheUnavailableError("Regeneration admission lease expired")
    return None


async def admit_recovery_enqueue(*, cache: Any, user_id: int) -> dict | None:
    """Bound queue submissions too; worker execution still uses generation limits."""
    prefix = f"memograd:{settings.APP_ENV}:ai:recovery:user:{user_id}"
    try:
        admitted = await cache.reserve_rate_limits_strict(
            [
                (f"{prefix}:minute", 3, 60),
                (f"{prefix}:hour", 30, 3600),
            ]
        )
    except CacheUnavailableError:
        return {
            "code": "ai_regeneration_unavailable",
            "message": "恢复服务暂不可用，请稍后重试",
        }
    if admitted:
        return None
    return {
        "code": "ai_regeneration_limited",
        "message": "恢复请求过于频繁，请稍后重试",
    }


def _teaching_content(value: dict) -> tuple[str, ...]:
    return tuple(
        re.sub(r"\s+", "", str(value.get(key) or ""))
        for key in ("mistake_diagnosis", "knowledge_patch", "review_task")
    )


async def reject_unsuccessful_regeneration(arguments: Any, review: Any) -> dict | None:
    """Never publish repeated content or a deterministic rule repair as a new analysis."""
    if not arguments.effective_force:
        return None
    stored = getattr(arguments.wrong_question, "ai_analysis", None)
    reason = _rejection_reason(stored, review)
    if reason is None:
        return None
    code, message = reason
    response = preserved_response(arguments.wrong_question, code=code, message=message)
    response.update(
        tokens_used=review.usage.total_tokens_used,
        duration_ms=review.usage.total_duration_ms,
    )
    # A rejected answer was still a billed model call. Persist its usage without
    # changing the analysis or generation marker used by status polling.
    await record_token_usage(
        arguments.db,
        arguments.user_id,
        "error_analysis",
        str(arguments.context.get("question", "")),
        "",
        {**response, "model": arguments.result.get("model", "unknown")},
    )
    return response


def _rejection_reason(stored: Any, review: Any) -> tuple[str, str] | None:
    if review.ack_failure is not None:
        return review.ack_failure.error_code, "新复盘未通过图片校验，已保留原复盘"
    if not review.parsed_valid:
        return "ai_response_parse_failed", "新复盘内容不完整，已保留原复盘"
    if not review.grounding.valid:
        return "ai_regeneration_unchanged", "新复盘未通过答案事实校验，已保留原复盘"
    if not isinstance(stored, dict):
        return None
    candidate = dict(review.parsed)
    candidate["mistake_diagnosis"] = merge_grounded_diagnosis(
        review.grounding.answer_grounding, candidate.get("mistake_diagnosis", "")
    )
    old = _normalize_ai_analysis(stored)
    if is_valid_ai_analysis(old) and _teaching_content(old) in (
        _teaching_content(review.parsed),
        _teaching_content(candidate),
    ):
        return "ai_regeneration_unchanged", "模型本次未提供不同的讲解，已保留原复盘"
    return None
