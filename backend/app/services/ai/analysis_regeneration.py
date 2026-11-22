"""Admission and honest failure semantics shared by direct and recovered generation."""

from __future__ import annotations

import re
from time import time
from typing import Any
from uuid import uuid4

from app.ai.answer_grounding import merge_grounded_diagnosis
from app.ai.fallback import get_fallback_analysis
from app.core.cache import CacheUnavailableError
from app.core.config import settings
from app.services.ai.analysis_content import (
    _normalize_ai_analysis,
    is_valid_ai_analysis,
)
from app.services.ai.visual_cache import ai_analysis_generated_at
from app.services.ai_token_budget import record_token_usage


def preserved_response(wrong_question: Any, *, code: str, message: str) -> dict:
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
        # Background recovery must not repeatedly spend attempts on a denial.
        "retryable": False,
    }


async def admit_regeneration(
    *, cache: Any, user_id: int, wrong_question: Any
) -> dict | None:
    prefix = f"memograd:{settings.APP_ENV}:ai:regeneration:user:{user_id}"
    owner = uuid4().hex
    lock = f"{prefix}:admission"
    try:
        acquired = await cache.acquire_lock_strict(lock, owner, ttl=10)
        if not acquired:
            return _limited_response(wrong_question)
        try:
            admitted = await _reserve_rolling_attempt(
                cache, prefix, lock, owner, wrong_question
            )
        finally:
            await cache.release_lock(lock, owner)
    except CacheUnavailableError:
        return preserved_response(
            wrong_question,
            code="ai_regeneration_unavailable",
            message="重新生成服务暂不可用，请稍后重试；已保留原复盘",
        )
    return None if admitted else _limited_response(wrong_question)


def _limited_response(wrong_question: Any) -> dict:
    return preserved_response(
        wrong_question,
        code="ai_regeneration_limited",
        message="重新生成次数受限：每分钟1次，每题24小时内3次，账号24小时内20次；请稍后再试",
    )


async def _reserve_rolling_attempt(cache, prefix, lock, owner, wrong_question) -> bool:
    now = time()
    key = f"{prefix}:rolling-day"
    stored = await cache.get_strict(key)
    try:
        events = [
            (float(at), int(qid))
            for at, qid in (stored or [])
            if float(at) > now - 86400
        ]
    except (TypeError, ValueError) as exc:
        raise CacheUnavailableError("Invalid regeneration ledger") from exc
    question_id = int(wrong_question.question_id)
    if any(at > now - 60 for at, _ in events):
        return False
    if len(events) >= 20 or sum(qid == question_id for _, qid in events) >= 3:
        return False
    events.append((now, question_id))
    committed = await cache.commit_guarded_strict(
        locks=[(lock, owner)],
        expected={},
        values=[(key, events, 86400)],
    )
    if not committed:
        raise CacheUnavailableError("Regeneration admission lease expired")
    return True


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
