"""AI 学习引擎核心服务。"""

import json
import logging
import random
from datetime import timedelta

logger = logging.getLogger(__name__)

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.fallback import (
    get_fallback_explain,
    get_fallback_mistake_analysis,
    get_fallback_report,
)
from app.ai.gateway import chat_with_db_model
from app.core.ai_runtime_guard import AIResourceRejectedError
from app.ai.prompts_learning import (
    build_explain_prompt,
    build_mistake_analysis_prompt,
    build_report_prompt,
)
from app.core.config import settings
from app.core.time_utils import shanghai_date_utc_range, shanghai_today, utcnow
from app.features.token_budget import estimate_tokens
from app.models.ai_chat import AiChat
from app.models.practice_record import PracticeRecord
from app.models.question import Question

# Preserve the existing public budget imports for AI callers.
from app.services.ai_token_budget import TokenReservation as TokenReservation
from app.services.ai_token_budget import (
    cancel_token_reservation as cancel_token_reservation,
)
from app.services.ai_token_budget import record_token_usage as record_token_usage
from app.services.ai_token_budget import reserve_token_budget as reserve_token_budget
from app.services.ai_token_budget import (
    settle_token_reservation as settle_token_reservation,
)
from app.services.knowledge_point_service import load_question_kps
from app.services.subject_resolution import resolve_subject_ids

# ============================================================
# Token 用量控制
# ============================================================


def estimate_chat_token_reservation(
    messages: list[dict], max_output_tokens: int | None = None
) -> int:
    """Bound one chat call by estimated prompt tokens plus its output cap."""
    prompt_parts: list[str] = []
    image_count = 0

    def collect(content) -> None:
        nonlocal image_count
        if isinstance(content, str):
            prompt_parts.append(content)
            return
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "image_url":
                    image_count += 1
                else:
                    collect(item)
            return
        if isinstance(content, dict):
            if content.get("type") == "image_url":
                image_count += 1
                return
            for key in ("text", "content", "value"):
                if key in content:
                    collect(content[key])
                    return

    for message in messages:
        if isinstance(message, dict):
            collect(message.get("content", ""))
        else:
            collect(message)
    output_cap = (
        int(max_output_tokens)
        if max_output_tokens is not None
        else int(settings.AI_SINGLE_MAX_TOKENS)
    )
    prompt_tokens = max(1, estimate_tokens("\n".join(prompt_parts)))
    # OpenAI-compatible vision endpoints charge image tokens separately. This
    # conservative allowance prevents a near-limit request from under-reserving.
    return prompt_tokens + max(1, output_cap) + image_count * 1024


async def check_token_limit(
    db: AsyncSession, user_id: int, tokens_needed: int = 0
) -> bool:
    """检查用户是否超出 token 限额（日 + 月）。返回 True 表示可以继续调用。"""
    from app.services.user_ai_policy_service import (
        UserAIPolicyUnavailableError,
        get_effective_user_ai_policy,
    )

    try:
        policy = await get_effective_user_ai_policy(db, user_id)
    except UserAIPolicyUnavailableError as exc:
        raise AIResourceRejectedError(
            "ai_user_policy_unavailable", retry_after_sec=5
        ) from exc
    daily_limit = policy.daily_token_limit
    monthly_limit = policy.monthly_token_limit

    if daily_limit <= 0 and monthly_limit <= 0:
        return True

    today_date = shanghai_today()
    today = shanghai_date_utc_range(today_date)[0]
    first_of_month = shanghai_date_utc_range(today_date.replace(day=1))[0]

    # One indexed user/month scan instead of two round-trips.  The monthly
    # predicate bounds the row set; CASE derives the daily subtotal from the
    # same scan.
    result = await db.execute(
        select(
            func.coalesce(
                func.sum(
                    case((AiChat.created_at >= today, AiChat.tokens_used), else_=0)
                ),
                0,
            ),
            func.coalesce(func.sum(AiChat.tokens_used), 0),
        ).where(
            AiChat.user_id == user_id,
            AiChat.created_at >= first_of_month,
        )
    )
    used_today, used_monthly = result.one()

    if daily_limit > 0 and (int(used_today or 0) + tokens_needed) > daily_limit:
        return False
    if monthly_limit > 0 and (int(used_monthly or 0) + tokens_needed) > monthly_limit:
        return False

    return True


async def _call_ai(
    messages: list,
    db: AsyncSession | None = None,
    *,
    rate_limit: int | None = None,
) -> dict | None:
    """调用配置模型；未配置返回 None，已尝试调用的失败交给配额边界处理。"""
    if db is None:
        return None
    return await chat_with_db_model(
        db, messages, feature="analysis", rate_limit=rate_limit
    )


async def _call_ai_reserved(
    messages: list, db: AsyncSession, reservation: TokenReservation
) -> dict | None:
    """Preserve a hold on uncertain provider failure while retaining fallback."""
    try:
        result = await _call_ai(messages, db, rate_limit=reservation.rpm_limit)
    except AIResourceRejectedError:
        # The guard rejected the request before provider transport. This is a
        # known zero-cost outcome, so the token hold must not leak.
        await cancel_token_reservation(reservation)
        return None
    except RuntimeError:
        return None
    if result is None:
        await cancel_token_reservation(reservation)
    return result


def _parse_json_response(content: str) -> dict | None:
    """解析 AI 返回的 JSON，支持 markdown code fence。"""
    if not content:
        return None
    # 尝试提取 ```json ... ``` 中的内容
    content = content.strip()
    if content.startswith("```"):
        lines = content.split("\n")
        if len(lines) > 1 and lines[-1].strip() == "```":
            content = "\n".join(lines[1:-1])
            if content.startswith("json"):
                content = content[4:]
    # 尝试查找 JSON 对象
    brace_start = content.find("{")
    if brace_start == -1:
        return None
    brace_end = content.rfind("}")
    if brace_end == -1:
        return None
    try:
        return json.loads(content[brace_start : brace_end + 1])
    except (json.JSONDecodeError, KeyError):
        return None


# ============================================================
# AI 题目讲解
# ============================================================


# ============================================================
# 共享题目装载
# ============================================================


async def _load_active_question(db: AsyncSession, question_id: int):
    """Load an active question or raise the historical not-found error."""
    result = await db.execute(
        select(Question).where(Question.id == question_id, Question.is_active)
    )
    question = result.scalar_one_or_none()
    if not question:
        raise ValueError("题目不存在")
    return question


def _question_stem(question) -> str:
    """Return the raw stem text for dict and legacy content shapes."""
    if isinstance(question.content, dict):
        return question.content.get("text", "")
    return str(question.content or "")


_EXPLAIN_LIMIT_COPY = "今日 AI 调用额度已用尽，请明天再试。"


def _explain_unavailable_payload(
    question_id: int,
    knowledge_points: list,
    explanation: str,
) -> dict:
    """Return the quota/fallback explain payload."""
    return {
        "question_id": question_id,
        "explanation": explanation,
        "solution_steps": [],
        "key_knowledge_points": knowledge_points,
        "common_mistakes": [],
        "tokens_used": 0,
        "from_fallback": True,
    }


def _explain_success_payload(question_id: int, parsed: dict, tokens_used: int) -> dict:
    """Return the model-backed explain payload."""
    return {
        "question_id": question_id,
        "explanation": parsed.get("explanation", ""),
        "solution_steps": parsed.get("solution_steps", []),
        "key_knowledge_points": parsed.get("key_knowledge_points", []),
        "common_mistakes": parsed.get("common_mistakes", []),
        "tokens_used": tokens_used,
        "from_fallback": False,
    }


async def ai_explain(
    db: AsyncSession,
    user_id: int,
    question_id: int,
    user_answer: str | None = None,
    is_correct: bool | None = None,
    focus: str = "solution",
) -> dict:
    """AI 题目讲解。"""

    q = await _load_active_question(db, question_id)
    kp_map = await load_question_kps(db, [q.id])
    q_kps = kp_map.get(q.id, [])

    messages = _build_explain_messages(q, q_kps, user_answer, is_correct, focus)
    reservation = await reserve_token_budget(db, user_id, estimate_chat_token_reservation(messages))
    if reservation is None:
        return _explain_unavailable_payload(question_id, q_kps, _EXPLAIN_LIMIT_COPY)

    result = await _call_ai_reserved(messages, db, reservation)
    if result is None:
        fallback = get_fallback_explain()
        return _explain_unavailable_payload(question_id, q_kps, fallback["explanation"])

    parsed = _parse_json_response(result["content"])
    if parsed is None:
        parsed = {"explanation": result["content"], "solution_steps": [], "key_knowledge_points": [], "common_mistakes": []}

    await record_token_usage(db, user_id, "ai_explain", f"question_id={question_id} focus={focus}", result["content"], result)
    await settle_token_reservation(reservation, result["tokens_used"])

    return _explain_success_payload(question_id, parsed, result["tokens_used"])


def _build_explain_messages(
    question,
    knowledge_points: list,
    user_answer: str | None,
    is_correct: bool | None,
    focus: str,
) -> list:
    """Build the explain prompt from the loaded question projection."""
    return build_explain_prompt(
        stem=_question_stem(question),
        options=question.options,
        answer=question.answer,
        analysis=question.analysis,
        knowledge_points=knowledge_points,
        user_answer=user_answer,
        is_correct=is_correct,
        focus=focus,
    )


# ============================================================
# AI 错因分析
# ============================================================


_MISTAKE_ERROR_TYPE_LABELS = {
    "概念理解错误": "概念理解错误",
    "计算错误": "计算错误",
    "审题错误": "审题错误",
    "思路错误": "思路错误",
    "concept_misunderstanding": "概念理解错误",
    "calculation_error": "计算错误",
    "misreading": "审题错误",
    "approach_error": "思路错误",
}

_MISTAKE_LIMIT_PAYLOAD = (
    "limit_exceeded",
    "额度用尽",
    "今日 AI 调用额度已用尽，请明天再试。",
    "建议自行查看题目解析。",
)


def _mistake_unavailable_payload(
    error_type: str,
    error_type_label: str,
    analysis: str,
    suggestion: str,
) -> dict:
    """Return the quota/fallback mistake-analysis payload."""
    return {
        "error_type": error_type,
        "error_type_label": error_type_label,
        "analysis": analysis,
        "suggestion": suggestion,
        "tokens_used": 0,
        "from_fallback": True,
    }


def _mistake_success_payload(error_type: str, parsed: dict, tokens_used: int) -> dict:
    """Return the model-backed mistake-analysis payload."""
    return {
        "error_type": error_type,
        "error_type_label": _MISTAKE_ERROR_TYPE_LABELS.get(
            error_type, parsed.get("error_type", "未知")
        ),
        "analysis": parsed.get("analysis", ""),
        "suggestion": parsed.get("suggestion", ""),
        "tokens_used": tokens_used,
        "from_fallback": False,
    }


async def ai_analyze_mistake(
    db: AsyncSession,
    user_id: int,
    question_id: int,
    user_answer: str,
    correct_answer: str,
) -> dict:
    """AI 错因分析。"""

    q = await _load_active_question(db, question_id)
    messages = _build_mistake_messages(q, correct_answer, user_answer)
    reservation = await reserve_token_budget(db, user_id, estimate_chat_token_reservation(messages))
    if reservation is None:
        return _mistake_unavailable_payload(*_MISTAKE_LIMIT_PAYLOAD)

    result = await _call_ai_reserved(messages, db, reservation)
    if result is None:
        fallback = get_fallback_mistake_analysis()
        return _mistake_unavailable_payload(fallback["error_type"], fallback["error_type_label"], fallback["analysis"], fallback["suggestion"])

    parsed = _parse_json_response(result["content"])
    if parsed is None:
        parsed = {
            "error_type": "unknown",
            "analysis": result["content"],
            "suggestion": "",
        }

    error_type = parsed.get("error_type", "unknown")

    await record_token_usage(db, user_id, "mistake_analysis", f"question_id={question_id}", result["content"], result)
    await settle_token_reservation(reservation, result["tokens_used"])

    return _mistake_success_payload(error_type, parsed, result["tokens_used"])


def _build_mistake_messages(question, correct_answer: str, user_answer: str) -> list:
    """Build the mistake-analysis prompt from the loaded question."""
    return build_mistake_analysis_prompt(
        stem=_question_stem(question),
        options=question.options,
        correct_answer=correct_answer,
        user_answer=user_answer,
        analysis=question.analysis,
    )


# ============================================================
# 相似题推荐（规则推荐，非 AI）
# ============================================================


async def recommend_similar_questions(
    db: AsyncSession,
    user_id: int,
    question_id: int,
    count: int = 5,
) -> dict:
    """推荐相似题目（向量优先 + 规则兜底）。"""

    vector_payload = await _vector_recommendation_payload(
        db, user_id, question_id, count
    )
    if vector_payload is not None:
        return vector_payload

    # ── 规则推荐（原有逻辑） ──

    q = await _load_active_question(db, question_id)
    answered_ids = await _load_answered_question_ids(db, user_id, question_id)
    candidates = await _load_similar_candidates(db, q)

    kp_map = await load_question_kps(db, [q.id] + [c.id for c in candidates])
    source_kps = set(kp_map.get(q.id, []))
    scored = _score_similar_candidates(
        candidates, answered_ids, kp_map, source_kps, q.difficulty
    )
    top = _select_top_scored(scored, count)

    recommendations = [
        _similar_recommendation_payload(
            candidate, kp_map.get(candidate.id, []), source_kps, q.difficulty
        )
        for _, candidate in top
    ]
    return _rule_recommendation_payload(question_id, recommendations)


async def _vector_recommendation_payload(
    db: AsyncSession, user_id: int, question_id: int, count: int
) -> dict | None:
    """Return the vector result when it is enabled and non-empty."""
    try:
        from app.services import vector_retrieval_service

        vector_result = await vector_retrieval_service.search_similar_questions(
            db=db,
            user_id=user_id,
            question_id=question_id,
            count=count,
            exclude_answered=True,
        )
        if vector_result.get("enabled") and vector_result.get("recommendations"):
            return {
                "source_question_id": question_id,
                "recommendations": vector_result["recommendations"],
                "strategy": "vector_plus_rule",
                "tokens_used": 0,
            }
    except Exception:
        logger.warning("向量推荐异常，回退到规则推荐", exc_info=True)
    return None


async def _load_answered_question_ids(
    db: AsyncSession, user_id: int, question_id: int
) -> set:
    """Load answered IDs and always exclude the source question."""
    answered_result = await db.execute(
        select(PracticeRecord.question_id).where(PracticeRecord.user_id == user_id)
    )
    answered_ids = {row[0] for row in answered_result.all()}
    answered_ids.add(question_id)
    return answered_ids


async def _load_similar_candidates(db: AsyncSession, question) -> list:
    """Load approved, active questions in the resolved subject family."""
    candidates_result = await db.execute(
        select(Question).where(
            Question.subject_id.in_(await resolve_subject_ids(db, question.subject_id)),
            Question.is_active,
            Question.review_status == "approved",
        )
    )
    return candidates_result.scalars().all()


def _score_similar_candidates(
    candidates: list,
    answered_ids: set,
    kp_map: dict,
    source_kps: set,
    source_difficulty,
) -> list:
    """Score knowledge-point overlap twice as strongly as difficulty match."""
    scored = []
    for candidate in candidates:
        if candidate.id in answered_ids:
            continue
        candidate_kps = set(kp_map.get(candidate.id, []))
        kp_overlap = len(source_kps & candidate_kps)
        difficulty_match = 1 if candidate.difficulty == source_difficulty else 0
        score = kp_overlap * 2 + difficulty_match
        if score > 0:
            scored.append((score, candidate))
    return scored


def _select_top_scored(scored: list, count: int) -> list:
    """Keep the highest scores, then preserve the historical random order."""
    scored.sort(key=lambda item: item[0], reverse=True)
    top = scored[:count]
    random.shuffle(top)
    return top


def _similar_recommendation_payload(
    candidate, kps: list, source_kps: set, source_difficulty
) -> dict:
    """Project one rule-based recommendation and its match reasons."""
    match_reasons = []
    if set(kps) & source_kps:
        match_reasons.append("同知识点")
    if candidate.difficulty == source_difficulty:
        match_reasons.append("同难度")
    if not match_reasons:
        match_reasons.append("同科目")
    return {
        "question_id": candidate.id,
        "subject_id": candidate.subject_id,
        "subject_code": candidate.subject_ref.code if candidate.subject_ref else "",
        "subject_name": candidate.subject_ref.name if candidate.subject_ref else "",
        "question_type": candidate.question_type,
        "stem": _question_stem(candidate)[:200],
        "knowledge_points": kps,
        "match_reason": " + ".join(match_reasons),
    }


def _rule_recommendation_payload(question_id: int, recommendations: list) -> dict:
    """Return the historical rule-based recommendation envelope."""
    return {
        "source_question_id": question_id,
        "recommendations": recommendations,
        "strategy": "rule_based",
        "tokens_used": 0,
    }


# ============================================================
# AI 学习报告
# ============================================================


async def _load_learning_report_subject(db: AsyncSession, subject_id: int) -> tuple:
    """Load the subject header that is echoed in every learning report."""
    from app.models.admin import Subject

    subj = await db.get(Subject, subject_id)
    subject_code = subj.code if subj else ""
    subject_name = subj.name if subj else ""
    subject_payload = {
        "subject_id": subject_id,
        "subject_code": subject_code,
        "subject_name": subject_name,
    }
    return subject_code, subject_name, subject_payload


async def _load_learning_report_records(
    db: AsyncSession, user_id: int, subject_id: int, since
) -> list:
    """Load the per-answer projection used by the learning report.

    Read only the per-answer fields used by the report.  Full ORM hydration is
    intentionally avoided so retired PracticeRecord batch columns can never
    become an implicit dependency of this path.
    """
    records_result = await db.execute(
        select(
            PracticeRecord.question_id,
            PracticeRecord.is_correct,
        )
        .where(
            PracticeRecord.user_id == user_id,
            PracticeRecord.subject_id == subject_id,
            PracticeRecord.answered_at >= since,
        )
        .order_by(PracticeRecord.answered_at.desc())
    )
    return records_result.all()


def _empty_learning_report(subject_payload: dict, days: int) -> dict:
    """Return the no-practice-yet report payload."""
    return {
        **subject_payload,
        "period_days": days,
        "total_answered": 0,
        "accuracy": 0.0,
        "weak_points": [],
        "strong_points": [],
        "learning_suggestions": ["暂无做题记录，建议开始练习。"],
        "tokens_used": 0,
        "from_fallback": True,
    }


def _knowledge_point_accuracy_list(records: list, q_map: dict) -> list:
    """Aggregate per-answer rows into per-knowledge-point accuracy, weakest first."""
    kp_stats: dict[str, dict] = {}
    for r in records:
        kps = q_map.get(r.question_id) or []
        for kp in kps:
            if kp not in kp_stats:
                kp_stats[kp] = {"correct": 0, "total": 0}
            kp_stats[kp]["total"] += 1
            if r.is_correct:
                kp_stats[kp]["correct"] += 1

    kp_list = []
    for kp, stats in kp_stats.items():
        kp_list.append(
            {
                "knowledge_point": kp,
                "accuracy": stats["correct"] / stats["total"]
                if stats["total"] > 0
                else 0,
                "correct": stats["correct"],
                "total": stats["total"],
            }
        )
    kp_list.sort(key=lambda x: x["accuracy"])
    return kp_list


def _report_weak_points(kp_list: list, *, limit: int, suggestion: str) -> list:
    """Project sub-0.6 knowledge points into report weak points."""
    return [
        {
            "knowledge_point": kp["knowledge_point"],
            "accuracy": kp["accuracy"],
            "suggestion": suggestion,
        }
        for kp in [k for k in kp_list if k["accuracy"] < 0.6][:limit]
    ]


def _report_strong_points(kp_list: list, *, limit: int) -> list:
    """Project >=0.85 knowledge points into report strong points."""
    return [
        {
            "knowledge_point": kp["knowledge_point"],
            "accuracy": kp["accuracy"],
            "suggestion": "继续保持",
        }
        for kp in [k for k in kp_list if k["accuracy"] >= 0.85][:limit]
    ]


def _low_volume_learning_report(
    subject_id: int,
    subject_code: str,
    subject_name: str,
    days: int,
    total: int,
    accuracy: float,
    kp_list: list,
) -> dict:
    """Rule-based report used while there are fewer than five answers."""
    weak = _report_weak_points(
        kp_list, limit=3, suggestion="数据不足，继续练习以获取更准确的建议"
    )
    strong = _report_strong_points(kp_list, limit=3)
    return {
        "subject_id": subject_id,
        "subject_code": subject_code,
        "subject_name": subject_name,
        "period_days": days,
        "total_answered": total,
        "accuracy": accuracy,
        "weak_points": weak,
        "strong_points": strong,
        "learning_suggestions": ["数据较少，建议积累更多练习记录后再查看 AI 报告。"],
        "tokens_used": 0,
        "from_fallback": False,
    }


def _token_limited_learning_report(
    subject_id: int,
    subject_code: str,
    subject_name: str,
    days: int,
    total: int,
    accuracy: float,
    kp_list: list,
) -> dict:
    """Rule-based report used when the daily/monthly token quota is exhausted."""
    weak = _report_weak_points(kp_list, limit=5, suggestion="建议重点复习该知识点")
    strong = _report_strong_points(kp_list, limit=3)
    return {
        "subject_id": subject_id,
        "subject_code": subject_code,
        "subject_name": subject_name,
        "period_days": days,
        "total_answered": total,
        "accuracy": accuracy,
        "weak_points": weak,
        "strong_points": strong,
        "learning_suggestions": [
            f"薄弱知识点有 {len(weak)} 个，建议每天重点练习",
            "尝试做更多同类题目的变体练习",
        ],
        "tokens_used": 0,
        "from_fallback": True,
    }


def _ai_fallback_learning_report(
    subject_id: int,
    subject_code: str,
    subject_name: str,
    days: int,
    total: int,
    accuracy: float,
) -> dict:
    """Rule-based report reused when the configured model is unavailable."""
    fallback = get_fallback_report()
    return {
        "subject_id": subject_id,
        "subject_code": subject_code,
        "subject_name": subject_name,
        "period_days": days,
        "total_answered": total,
        "accuracy": accuracy,
        "weak_points": fallback.get("weak_points", []),
        "strong_points": fallback.get("strong_points", []),
        "learning_suggestions": fallback.get("learning_suggestions", []),
        "tokens_used": 0,
        "from_fallback": True,
    }


def _project_parsed_report_points(parsed: dict) -> tuple:
    """Normalize model-provided weak/strong points into the report shape."""
    weak_points = []
    for wp in parsed.get("weak_points", []):
        weak_points.append(
            {
                "knowledge_point": wp.get("knowledge_point", ""),
                "accuracy": float(wp.get("accuracy", 0)),
                "suggestion": wp.get("suggestion", ""),
            }
        )

    strong_points = []
    for sp in parsed.get("strong_points", []):
        strong_points.append(
            {
                "knowledge_point": sp.get("knowledge_point", ""),
                "accuracy": float(sp.get("accuracy", 0)),
                "suggestion": sp.get("suggestion", ""),
            }
        )
    return weak_points, strong_points


async def _ai_learning_report(
    db: AsyncSession,
    user_id: int,
    subject_id: int,
    subject_code: str,
    subject_name: str,
    days: int,
    total: int,
    accuracy: float,
    result: dict,
) -> dict:
    """Persist token usage and project a model answer into the report payload."""
    parsed = _parse_json_response(result["content"])
    if parsed is None:
        parsed = {
            "weak_points": [],
            "strong_points": [],
            "learning_suggestions": [result["content"]],
        }

    await record_token_usage(
        db,
        user_id,
        "learning_report",
        f"subject_id={subject_id} days={days}",
        result["content"],
        result,
    )

    weak_points, strong_points = _project_parsed_report_points(parsed)

    return {
        "subject_id": subject_id,
        "subject_code": subject_code,
        "subject_name": subject_name,
        "period_days": days,
        "total_answered": total,
        "accuracy": accuracy,
        "weak_points": weak_points,
        "strong_points": strong_points,
        "learning_suggestions": parsed.get("learning_suggestions", []),
        "tokens_used": result["tokens_used"],
        "from_fallback": False,
    }


async def _learning_report_metrics(
    db: AsyncSession, records: list, total: int
) -> tuple:
    """Return accuracy plus the weakest-first knowledge point list for the report."""
    correct = sum(1 for r in records if r.is_correct)
    accuracy = correct / total if total > 0 else 0.0

    # 获取涉及题目的知识点
    qids = list({r.question_id for r in records})
    q_map = await load_question_kps(db, qids)
    kp_list = _knowledge_point_accuracy_list(records, q_map)
    return accuracy, kp_list


async def generate_learning_report(
    db: AsyncSession,
    user_id: int,
    subject_id: int,
    days: int = 7,
) -> dict:
    """生成 AI 学习报告。"""
    subject_code, subject_name, subject_payload = await _load_learning_report_subject(
        db, subject_id
    )

    since = utcnow() - timedelta(days=days)
    records = await _load_learning_report_records(db, user_id, subject_id, since)

    total = len(records)
    if total == 0:
        return _empty_learning_report(subject_payload, days)

    accuracy, kp_list = await _learning_report_metrics(db, records, total)

    # 数据太少时不调用 AI
    if total < 5:
        return _low_volume_learning_report(subject_id, subject_code, subject_name, days, total, accuracy, kp_list)

    messages = build_report_prompt(subject_code, days, total, accuracy, kp_list)
    reservation = await reserve_token_budget(db, user_id, estimate_chat_token_reservation(messages))
    if reservation is None:
        return _token_limited_learning_report(subject_id, subject_code, subject_name, days, total, accuracy, kp_list)

    result = await _call_ai_reserved(messages, db, reservation)
    if result is None:
        return _ai_fallback_learning_report(subject_id, subject_code, subject_name, days, total, accuracy)

    return await _complete_learning_report(db, user_id, subject_id, subject_code, subject_name, days, total, accuracy, result, reservation)


async def _complete_learning_report(
    db: AsyncSession,
    user_id: int,
    subject_id: int,
    subject_code: str,
    subject_name: str,
    days: int,
    total: int,
    accuracy: float,
    result: dict,
    reservation: TokenReservation,
) -> dict:
    response = await _ai_learning_report(
        db,
        user_id,
        subject_id,
        subject_code,
        subject_name,
        days,
        total,
        accuracy,
        result,
    )
    await settle_token_reservation(reservation, result["tokens_used"])
    return response
