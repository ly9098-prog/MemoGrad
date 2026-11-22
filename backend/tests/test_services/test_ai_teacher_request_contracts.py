"""Teacher request ordering and truthful fallbacks without external providers."""

import asyncio
import json
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import ai_teacher_408_service as svc
from app.services.ai import analysis_availability


@pytest.fixture
def real_teacher_gateway(prepared_teacher, monkeypatch):
    """Keep the gateway/client/slot real; isolate network and billing storage."""
    from app.ai import client as client_module
    from app.ai import gateway
    from app.core.ai_runtime_guard import AIRuntimeGuard

    state = prepared_teacher
    state.guard = AIRuntimeGuard()
    monkeypatch.setattr(state.guard, "enforce_rate_limit", state.quota)
    monkeypatch.setattr(client_module.settings, "AI_MAX_CONCURRENCY", 1)
    monkeypatch.setattr(client_module.settings, "AI_QUEUE_WAIT_TIMEOUT_SEC", 1)
    monkeypatch.setattr(client_module, "ai_runtime_guard", state.guard)
    monkeypatch.setattr(gateway, "llm", client_module.OpenAICompatibleClient())
    monkeypatch.setattr(svc, "chat_with_db_model", gateway.chat_with_db_model)
    state.runtime = gateway.LLMRuntimeConfig(
        api_key="synthetic-test-key",
        base_url="https://provider.example/v1",
        model_name="test-model",
        provider="openai_compatible",
    )
    return state


@pytest.fixture
def prepared_teacher(monkeypatch):
    state = SimpleNamespace(
        db=object(),
        question=SimpleNamespace(
            id=7, subject_id=2, question_type="single_choice", difficulty=3
        ),
        revision=SimpleNamespace(
            id=11,
            subject_id=2,
            question_type="single_choice",
            difficulty=3,
            content={"text": "server stem"},
            options={"A": "one", "B": "two"},
            answer="A",
            analysis="server explanation",
        ),
        knowledge={
            "knowledge_points": [
                {
                    "name": "queues",
                    "mastery_score": 60,
                    "confidence": 0.7,
                    "attempt_count": 4,
                }
            ],
            "weak_points": [{"name": "stacks", "mastery_score": 30, "wrong_count": 2}],
            "recent_same_kp_errors": [],
            "knowledge_graph_neighbors": [],
        },
        trace=[],
        contexts=[],
    )
    state.exam = AsyncMock(return_value={})
    state.resolve = AsyncMock(return_value=(state.question, state.revision, None))
    state.load = AsyncMock(return_value=state.knowledge)
    state.practice = AsyncMock(return_value={"user_answer": "B", "is_correct": False})
    for name, callback in [
        ("_resolve_exam_context", state.exam),
        ("_resolve_revision_and_diagnosis", state.resolve),
        ("_load_knowledge_context", state.load),
        ("_latest_practice_context", state.practice),
    ]:
        monkeypatch.setattr(svc, name, callback)
    original_prompt = svc.build_408_teacher_prompt

    def prompt(**kwargs):
        state.contexts.append(kwargs["context"])
        return original_prompt(**kwargs)

    async def quota(*args):
        state.trace.append("quota")
        return True

    async def reserve(*args):
        state.trace.append("quota")
        from app.services.ai_learning_service import TokenReservation

        return TokenReservation(3, 1, "day-key", "month-key")

    async def settle(*args):
        state.trace.append("settle")

    async def cancel(*args):
        state.trace.append("cancel")

    async def provider(*args, **kwargs):
        state.trace.append("provider")
        return {
            "content": json.dumps(
                {
                    "title": "lesson",
                    "summary": "summary",
                    "sections": [{"heading": "判断依据", "points": ["满足必要条件。"]}],
                }
            ),
            "tokens_used": 17,
        }

    async def usage(*args):
        state.trace.append("usage")

    state.quota = AsyncMock(side_effect=quota)
    state.reserve = AsyncMock(side_effect=reserve)
    state.settle = AsyncMock(side_effect=settle)
    state.cancel = AsyncMock(side_effect=cancel)
    state.provider = AsyncMock(side_effect=provider)
    state.usage = AsyncMock(side_effect=usage)
    state.runtime = object()
    monkeypatch.setattr(svc, "build_408_teacher_prompt", prompt)
    monkeypatch.setattr(svc, "reserve_token_budget", state.reserve)
    monkeypatch.setattr(svc, "settle_token_reservation", state.settle)
    monkeypatch.setattr(svc, "cancel_token_reservation", state.cancel)
    monkeypatch.setattr(svc, "chat_with_db_model", state.provider)
    monkeypatch.setattr(svc, "record_token_usage", state.usage)
    monkeypatch.setattr(
        svc,
        "require_available_runtime",
        AsyncMock(return_value=state.runtime),
    )
    monkeypatch.setattr(svc, "note_failure", AsyncMock())
    monkeypatch.setattr(svc, "note_success", AsyncMock())
    return state


@pytest.mark.asyncio
async def test_teacher_uses_server_fact_and_records_usage_before_parsing(
    prepared_teacher, monkeypatch
):
    state = prepared_teacher
    started = svc.time.monotonic()
    original_parse = svc._parse_json_object

    def parse(value, **kwargs):
        state.trace.append("parse")
        return original_parse(value, **kwargs)

    monkeypatch.setattr(svc, "_parse_json_object", parse)
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="core_concept", user_answer="client"
    )
    assert state.trace[:5] == ["quota", "provider", "usage", "settle", "parse"]
    state.reserve.assert_awaited_once()
    assert state.reserve.await_args.args[:2] == (state.db, 3)
    assert state.reserve.await_args.args[2] >= 900
    svc.note_success.assert_awaited_once()
    kwargs = state.provider.await_args.kwargs
    assert kwargs == {
        "feature": "analysis",
        "temperature": 0.2,
        "timeout": pytest.approx(45, abs=0.05),
        "max_tokens": 2400,
        "response_format": {"type": "json_object"},
        "prefer_direct_answer": True,
        "runtime": state.runtime,
        "deadline": pytest.approx(started + 45, abs=0.05),
    }
    assert state.reserve.await_args.args[2] == svc.estimate_chat_token_reservation(
        state.provider.await_args.args[1], max_output_tokens=kwargs["max_tokens"]
    )
    context = state.contexts[0]
    assert context["question"]["question_version_id"] == 11
    assert context["question"]["stem"] == "server stem"
    assert context["question"]["correct_answer"] == "A"
    assert context["learner_answer"] == {
        "answer": "B",
        "is_correct": False,
        "source": "practice",
    }
    point = context["knowledge"]["本题知识点"][0]
    assert point["学习状态"] == "基本掌握"
    assert "confidence" not in point and "mastery_score" not in point
    assert result["tokens_used"] == 17 and result["from_fallback"] is False
    assert state.usage.await_args.args[2] == "408_teacher:core_concept"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "scenario", ["quota", "unavailable", "exception", "malformed", "invalid_question"]
)
async def test_teacher_fallbacks_preserve_usage_and_action_boundaries(
    prepared_teacher, scenario
):
    state = prepared_teacher
    action = (
        "similar_question" if scenario == "invalid_question" else "high_frequency_traps"
    )
    if scenario == "quota":
        state.reserve.side_effect = None
        state.reserve.return_value = None
    elif scenario == "unavailable":
        state.provider.side_effect = None
        state.provider.return_value = None
    elif scenario == "exception":
        state.provider.side_effect = RuntimeError("synthetic provider failure")
    elif scenario == "malformed":
        state.provider.side_effect = None
        state.provider.return_value = {"content": "not JSON", "tokens_used": 19}
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action=action
    )
    assert result["from_fallback"] is True
    assert result["sections"] == [] and result["practice_question"] is None
    assert result["knowledge_points"] == []
    assert result["question_version_id"] == 11
    if scenario == "quota":
        state.provider.assert_not_awaited()
    else:
        state.provider.assert_awaited_once()
    if scenario in {"malformed", "invalid_question"}:
        state.usage.assert_awaited_once()
        assert result["tokens_used"] == (19 if scenario == "malformed" else 17)
    else:
        state.usage.assert_not_awaited()
        assert result["tokens_used"] == 0
    if scenario in {"unavailable", "exception"}:
        state.cancel.assert_awaited_once()
    elif scenario == "quota":
        state.cancel.assert_not_awaited()
    assert svc.note_failure.await_count == (1 if scenario == "exception" else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["checking", "quota", "configuration"])
async def test_teacher_unavailable_blocks_before_provider_call(
    prepared_teacher, reason
):
    state = prepared_teacher
    unavailable = {
        "status": "unavailable",
        "enabled": False,
        "reason": reason,
        "message": "AI service quota exhausted",
        "retry_after_ms": 300000,
    }
    svc.require_available_runtime.side_effect = (
        analysis_availability.AnalysisUnavailableError(unavailable)
    )

    with pytest.raises(analysis_availability.AnalysisUnavailableError):
        await svc.run_teacher_action(
            state.db, user_id=3, question_id=7, action="core_concept"
        )

    state.provider.assert_not_awaited()
    state.usage.assert_not_awaited()
    state.cancel.assert_awaited_once()


@pytest.mark.asyncio
async def test_teacher_releases_reservation_if_health_lookup_is_cancelled(
    prepared_teacher,
):
    state = prepared_teacher
    svc.require_available_runtime.side_effect = asyncio.CancelledError
    with pytest.raises(asyncio.CancelledError):
        await svc.run_teacher_action(
            state.db, user_id=3, question_id=7, action="core_concept"
        )
    state.provider.assert_not_awaited()
    state.cancel.assert_awaited_once()
    state.settle.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [asyncio.CancelledError, RuntimeError])
async def test_teacher_cancellation_and_usage_failure_propagate(
    prepared_teacher, failure
):
    state = prepared_teacher
    callback = state.provider if failure is asyncio.CancelledError else state.usage
    callback.side_effect = failure("synthetic stop")
    with pytest.raises(failure):
        await svc.run_teacher_action(
            state.db, user_id=3, question_id=7, action="core_concept"
        )
    if failure is asyncio.CancelledError:
        state.usage.assert_not_awaited()
        state.cancel.assert_awaited_once()
    else:
        state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "source", ["exam", "diagnosis", "practice", "client_context", "none"]
)
async def test_teacher_answer_precedence_and_diagnosis_metadata(
    prepared_teacher, monkeypatch, source
):
    state = prepared_teacher
    diagnosis = SimpleNamespace(user_answer="diagnosis answer", source_context="review")
    if source == "exam":
        state.exam.return_value = {
            "answer": SimpleNamespace(selected_answer="exam answer", is_correct=True)
        }
    if source in {"exam", "diagnosis"}:
        state.resolve.return_value = (state.question, state.revision, diagnosis)
    if source in {"client_context", "none"}:
        state.practice.return_value = {}
    monkeypatch.setattr(
        svc.error_diagnosis_service,
        "serialize_diagnosis",
        lambda _: {
            "primary_type": "concept",
            "primary_label": "concept",
            "model": "private",
        },
    )
    state.quota.side_effect = None
    state.quota.return_value = False
    await svc.run_teacher_action(
        state.db,
        user_id=3,
        question_id=7,
        action="connect_knowledge",
        user_answer=None if source == "none" else "client answer",
    )
    context = state.contexts[0]
    expected = {
        "exam": ("exam answer", True, "exam"),
        "diagnosis": ("diagnosis answer", False, "review"),
        "practice": ("B", False, "practice"),
        "client_context": ("client answer", None, "client_context"),
        "none": ("", None, "none"),
    }[source]
    assert context["learner_answer"] == dict(
        zip(("answer", "is_correct", "source"), expected)
    )
    if context["error_diagnosis"] is not None:
        assert "model" not in context["error_diagnosis"]
        assert set(context["error_diagnosis"]) == {
            "primary_type",
            "primary_label",
            "secondary_labels",
            "effective_source",
            "user_confirmed",
        }


@pytest.mark.asyncio
async def test_teacher_rejects_unknown_action_before_queries(prepared_teacher):
    state = prepared_teacher
    with pytest.raises(svc.AITeacher408AccessError, match="不支持"):
        await svc.run_teacher_action(
            state.db, user_id=3, question_id=7, action="free_prompt"
        )
    state.exam.assert_not_awaited()
    state.quota.assert_not_awaited()
    state.provider.assert_not_awaited()


@pytest.mark.asyncio
async def test_option_fallback_does_not_relabel_generic_analysis_as_option_explanations(
    prepared_teacher,
):
    state = prepared_teacher
    state.revision.analysis = "本题属于“总线与 I/O”的典型辨析。注意概念与边界。"
    state.provider.side_effect = None
    state.provider.return_value = None
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_options"
    )
    assert result["from_fallback"] is True
    assert result["title"] == "逐项讲解暂不可用"
    assert state.revision.analysis not in result["summary"]
    assert result["fallback_reason"] == "service_unavailable"
    assert result["summary"] == "AI 老师暂不可用，可先查看题库解析。"
    assert result["sections"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "defect", ["missing", "duplicate", "wrong_verdict", "empty", "generic"]
)
async def test_option_action_rejects_incomplete_or_answer_conflicting_output(
    prepared_teacher, defect
):
    state = prepared_teacher
    rows = [
        {"option": "A", "is_correct": True, "reason": "符合题目条件。"},
        {"option": "B", "is_correct": False, "reason": "遗漏必要条件。"},
    ]
    if defect == "missing":
        rows.pop()
    elif defect == "duplicate":
        rows[1]["option"] = "A"
    elif defect == "wrong_verdict":
        rows[0]["is_correct"] = False
    elif defect == "empty":
        rows[1]["reason"] = ""
    payload = {"summary": "注意审题", "option_explanations": rows}
    if defect == "generic":
        payload.pop("option_explanations")
    state.provider.side_effect = None
    state.provider.return_value = {"content": json.dumps(payload), "tokens_used": 21}
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_options"
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []
    assert result["tokens_used"] == 21
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("answer", ["A", "A,B"])
@pytest.mark.parametrize("shape", ["object", "array", "fenced_array"])
async def test_option_action_projects_validated_rows_in_question_order(
    prepared_teacher, answer, shape
):
    state = prepared_teacher
    state.revision.answer = answer
    rows = [
        {"option": "B", "is_correct": "B" in answer, "reason": "B 项判断依据。"},
        {"option": "A", "is_correct": True, "reason": "A 项判断依据。"},
    ]
    content = json.dumps(
        {"summary": "untrusted generic conclusion", "option_explanations": rows}
        if shape == "object"
        else rows
    )
    if shape == "fenced_array":
        content = f"```json\n{content}\n```"
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": content,
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_options"
    )
    assert result["from_fallback"] is False
    assert result["summary"].startswith("正确答案：")
    assert [section["heading"][0] for section in result["sections"]] == ["A", "B"]
    assert result["sections"][0]["points"] == ["A 项判断依据。"]
    assert result["sections"][1]["points"] == ["B 项判断依据。"]
    state.provider.assert_awaited_once()
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "defect",
    [
        "missing",
        "duplicate",
        "wrong_verdict",
        "string_verdict",
        "empty",
        "legacy",
        "truncated",
    ],
)
async def test_option_array_still_requires_complete_authoritative_rows(
    prepared_teacher, defect
):
    state = prepared_teacher
    rows = [
        {"option": "A", "is_correct": True, "reason": "符合题干条件。"},
        {"option": "B", "is_correct": False, "reason": "遗漏必要条件。"},
    ]
    if defect == "missing":
        rows.pop()
    elif defect == "duplicate":
        rows[1]["option"] = "A"
    elif defect == "wrong_verdict":
        rows[0]["is_correct"] = False
    elif defect == "string_verdict":
        rows[0]["is_correct"] = "true"
    elif defect == "empty":
        rows[1]["reason"] = ""
    elif defect == "legacy":
        rows = [{"heading": "A 项分析", "points": ["旧版自由段落"]}]
    content = json.dumps(rows)
    if defect == "truncated":
        # Even a complete first row must not be salvaged from a partial array.
        content = content[: content.index("},") + 1]
    state.provider.side_effect = None
    state.provider.return_value = {"content": content, "tokens_used": 21}
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_options"
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []
    state.provider.assert_awaited_once()
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


def test_option_prompt_requests_one_minimal_json_envelope():
    from app.ai.prompts_408_teacher import PROMPT_VERSION, build_408_teacher_prompt

    system = build_408_teacher_prompt(action="explain_options", context={})[0][
        "content"
    ]
    schema, _ = json.JSONDecoder().raw_decode(system[system.index("{") :])
    assert set(schema) == {"option_explanations"}
    assert set(schema["option_explanations"][0]) == {"option", "is_correct", "reason"}
    assert "不要直接返回数组" in system
    assert PROMPT_VERSION == "408-teacher-v9-compact-action-output"


@pytest.mark.asyncio
@pytest.mark.parametrize("action", list(svc.ACTION_DEFINITIONS))
@pytest.mark.parametrize("shape", ["object", "singleton", "fenced_singleton"])
async def test_teacher_accepts_complete_single_lesson_envelopes(
    prepared_teacher, action, shape
):
    state = prepared_teacher
    payload = {
        "title": "专项讲解",
        "summary": "结合题干条件说明判断依据。",
        "sections": [{"heading": "判断依据", "points": ["首先检查必要条件。"]}],
        "knowledge_points": [{"name": "同步", "relation": "前置知识"}],
        "practice_question": {
            "stem": "下列说法哪项正确？",
            "options": {"A": "满足条件", "B": "缺少条件"},
            "answer": "A",
            "analysis": "A 满足条件。",
        },
        "option_explanations": [
            {"option": "A", "is_correct": True, "reason": "满足题干条件。"},
            {"option": "B", "is_correct": False, "reason": "缺少必要条件。"},
        ],
    }
    content = json.dumps(payload if shape == "object" else [payload])
    if shape == "fenced_singleton":
        content = f"```json\n{content}\n```"
    state.provider.side_effect = None
    state.provider.return_value = {"content": content, "tokens_used": 21}
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action=action
    )
    assert result["from_fallback"] is False
    assert result["sections"]
    assert result["tokens_used"] == 21
    state.provider.assert_awaited_once()
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action",
    ["explain_correct", "core_concept", "connect_knowledge", "high_frequency_traps"],
)
async def test_teacher_rejects_summary_without_action_body(prepared_teacher, action):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps(
            [{"title": "编码能力判定", "summary": "先求最小海明距离，再由公式"}]
        ),
        "tokens_used": 21,
        "finish_reason": "stop",
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action=action
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []
    assert result["fallback_reason"] == "missing_body"
    assert "再由公式" not in result["summary"]
    attempts = 1 if action == "connect_knowledge" else 2
    assert state.provider.await_count == attempts
    assert state.usage.await_count == attempts
    assert state.settle.await_count == attempts
    assert result["tokens_used"] == 21 * attempts


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "action",
    ["explain_correct", "core_concept", "connect_knowledge", "high_frequency_traps"],
)
async def test_teacher_rejects_opening_fragment_despite_long_summary(
    prepared_teacher, action
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps(
            {
                "title": "完整推理链",
                "summary": "无噪声信道适用奈奎斯特定理，代入条件得到48kb/s。" * 5,
                "sections": [
                    {"heading": "第一步：确定适用公式", "points": ["题干明确"]}
                ],
            }
        ),
        "tokens_used": 21,
        "finish_reason": "stop",
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action=action
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []
    assert result["fallback_reason"] == "missing_body"
    state.provider.assert_awaited_once()
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "points",
    [
        ["R=2Wlog₂V=48kb/s"],
        ["检错能力为最小距离减一。"],
        ["无噪声信道", "R=2Wlog₂V"],
        ["栈是后进先出。"],
        ["O(n)"],
        ["t=2"],
        ["互斥", "同步"],
        ["题干明确无噪声"],
        ["必须满足全部条件"],
        ["n<=1"],
        ["n>=1"],
        ["n==1"],
        ["n!=1"],
    ],
)
async def test_teacher_retains_concise_complete_points(prepared_teacher, points):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps({"sections": [{"heading": "依据", "points": points}]}),
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is False
    assert result["sections"][0]["points"] == points


@pytest.mark.asyncio
@pytest.mark.parametrize("encoded", [False, True])
async def test_teacher_rejects_metadata_only_structured_summary(
    prepared_teacher, encoded
):
    state = prepared_teacher
    summary = {
        "title": "仅标题但并无独立教学正文",
        "summary": "仅摘要也并无独立教学正文",
    }
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps({"summary": json.dumps(summary) if encoded else summary}),
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()

    payload = {
        "summary": json.dumps(summary) if encoded else summary,
        "sections": [{"heading": "依据", "points": ["栈是后进先出。"]}],
    }
    state.provider.return_value = {"content": json.dumps(payload), "tokens_used": 21}
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is False
    assert result["summary"] == "栈是后进先出。"


@pytest.mark.asyncio
@pytest.mark.parametrize("points", [["题干明确", "题干明确"], ["t="]])
async def test_teacher_rejects_repeated_or_unfinished_openings(
    prepared_teacher, points
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps({"sections": [{"heading": "依据", "points": points}]}),
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("finish_reason", ["length", "max_tokens", "content_filter"])
async def test_teacher_rejects_unfinished_provider_response(
    prepared_teacher, finish_reason
):
    state = prepared_teacher
    raw = await state.provider()
    raw["content"] = json.dumps(
        {
            "summary": "先求最小距离。",
            "sections": [{"heading": "推导", "points": ["最小距离为四，再由公式"]}],
        }
    )
    raw["finish_reason"] = finish_reason
    state.provider.side_effect = None
    state.provider.return_value = raw
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ["object", "singleton"])
@pytest.mark.parametrize(
    "action",
    ["explain_correct", "core_concept", "connect_knowledge", "high_frequency_traps"],
)
@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"title": "只有标题"},
        {"stem": "题干", "correct_answer": "A", "official_analysis": "原解析"},
        {"sections": 1, "knowledge_points": True},
        {"sections": [{"heading": "无内容", "points": 1}]},
    ],
)
async def test_teacher_rejects_empty_or_echoed_lessons(
    prepared_teacher, action, payload, shape
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps(payload if shape == "object" else [payload]),
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action=action
    )
    assert result["from_fallback"] is True
    assert result["fallback_reason"] == "missing_body"
    assert state.revision.analysis not in result["summary"]
    assert not result["sections"]
    assert not result["knowledge_points"]
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["explain_correct", "core_concept"])
@pytest.mark.parametrize(
    "scenario", ["quota", "unavailable", "malformed", "multiple", "truncated"]
)
async def test_explanation_failure_preserves_reason_instead_of_bank_analysis(
    prepared_teacher, action, scenario
):
    state = prepared_teacher
    reason = "AI 返回格式异常"
    state.provider.side_effect = None
    if scenario == "quota":
        state.reserve.side_effect = None
        state.reserve.return_value = None
        reason = "AI 调用额度不足"
    elif scenario == "unavailable":
        state.provider.return_value = None
        reason = "AI 老师暂不可用"
    else:
        content = {
            "malformed": "invalid",
            "multiple": '[{"summary":"one"},{"summary":"two"}]',
            "truncated": '[{"summary":"complete inner object"}',
        }[scenario]
        state.provider.return_value = {"content": content, "tokens_used": 21}
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action=action
    )
    assert result["from_fallback"] is True
    assert reason in result["summary"]
    assert result["fallback_reason"] == {
        "quota": "budget_exhausted",
        "unavailable": "service_unavailable",
    }.get(scenario, "invalid_format")
    assert state.revision.analysis not in result["summary"]
    assert result["sections"] == []


@pytest.mark.parametrize("action", list(svc.ACTION_DEFINITIONS))
def test_all_teacher_prompts_require_a_single_root_object(action):
    system = svc.build_408_teacher_prompt(action=action, context={})[0]["content"]
    assert "不要直接返回数组" in system


@pytest.mark.asyncio
@pytest.mark.parametrize("shape", ["string", "text_object", "content_object"])
async def test_teacher_preserves_text_body_in_compatible_points_shapes(
    prepared_teacher, shape
):
    state = prepared_teacher
    body = "无噪声信道使用奈奎斯特公式，代入带宽和电平数可得传输速率。"
    points = body if shape == "string" else [{shape.removesuffix("_object"): body}]
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps({"sections": [{"heading": "推导", "points": points}]}),
        "finish_reason": "stop",
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is False
    assert result["sections"] == [{"heading": "推导", "points": [body]}]


@pytest.mark.asyncio
async def test_teacher_does_not_silently_cut_long_points_or_final_steps(
    prepared_teacher,
):
    state = prepared_teacher
    points = ["具体推导过程。" * 80 + "最终结论为选项 A。"]
    points.extend(f"第 {i} 步：核对必要条件。" for i in range(1, 7))
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps({"sections": [{"heading": "推导", "points": points}]}),
        "finish_reason": "stop",
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is False
    assert result["sections"] == [{"heading": "推导", "points": points}]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("finish_reason", "code", "message"),
    [
        ("length", "output_truncated", "输出长度上限"),
        ("max_tokens", "output_truncated", "输出长度上限"),
        ("content_filter", "content_filtered", "安全策略"),
        ("tool_calls", "invalid_format", "工具调用"),
        ("function_call", "invalid_format", "工具调用"),
    ],
)
async def test_teacher_fallback_reports_actual_provider_stop_reason(
    prepared_teacher, finish_reason, code, message
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": "{",
        "finish_reason": finish_reason,
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["fallback_reason"] == code
    assert message in result["summary"]
    assert result["summary"].count("请稍后重试") <= 1
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("summary_only", [False, True])
async def test_teacher_does_not_promote_nested_metadata_to_body(
    prepared_teacher, summary_only
):
    state = prepared_teacher
    metadata = {"title": "看似完整的标题", "summary": "仅有概括而没有独立推导依据。"}
    if not summary_only:
        metadata = {"unexpected": "任意元数据字段不应被当成讲解。"}
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps(
            {"sections": [{"heading": "推导", "points": [metadata]}]}
        ),
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["sections"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("analysis", [None, "", "   ", {}, ["摘要"]])
async def test_teacher_generated_question_requires_explanation(
    prepared_teacher, analysis
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps(
            {
                "practice_question": {
                    "stem": "问题？",
                    "options": {"A": "一", "B": "二"},
                    "answer": "A",
                    "analysis": analysis,
                }
            }
        ),
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="similar_question"
    )
    assert result["from_fallback"] is True
    assert result["practice_question"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["", "  \n  ", " " * 32001])
async def test_teacher_rejects_empty_response_even_after_normal_stop(
    prepared_teacher, content
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": content,
        "finish_reason": "stop",
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["fallback_reason"] == "missing_body"
    assert result["summary"] == "AI 未返回讲解内容，请重新尝试。"
    state.provider.assert_awaited_once()
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()


@pytest.mark.asyncio
async def test_teacher_rejects_oversized_output_without_showing_partial_body(
    prepared_teacher,
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": json.dumps({"sections": [{"points": ["x" * 32001]}]}),
        "finish_reason": "stop",
        "tokens_used": 21,
    }
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["fallback_reason"] == "invalid_format"
    assert result["sections"] == []
    assert "超出可处理范围" in result["summary"]
    state.provider.assert_awaited_once()
    state.usage.assert_awaited_once()


@pytest.mark.parametrize("action", list(svc.ACTION_DEFINITIONS))
def test_teacher_prompt_only_requests_fields_used_by_selected_action(action):
    system = svc.build_408_teacher_prompt(action=action, context={})[0]["content"]
    schema, _ = json.JSONDecoder().raw_decode(system[system.index("{") :])
    if action == "explain_options":
        expected = {"option_explanations"}
    elif action in {"similar_question", "harder_question"}:
        expected = {"title", "practice_question"}
    elif action == "connect_knowledge":
        expected = {"title", "knowledge_points"}
    else:
        expected = {"title", "summary", "sections"}
    assert set(schema) == expected


@pytest.mark.asyncio
async def test_teacher_repairs_summary_only_once_and_bills_each_response(
    prepared_teacher,
):
    state = prepared_teacher
    state.provider.side_effect = [
        {
            "content": '{"title":"编码能力","summary":"先求最小距离。"}',
            "tokens_used": 21,
        },
        {
            "content": json.dumps(
                {
                    "sections": [
                        {
                            "heading": "推导",
                            "points": ["最小距离为四，能检出三位错误。"],
                        }
                    ]
                }
            ),
            "tokens_used": 34,
        },
    ]
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is False
    assert result["tokens_used"] == 55
    assert (
        state.provider.await_count
        == state.usage.await_count
        == state.settle.await_count
        == 2
    )
    assert [call.args[0].reserved_tokens for call in state.settle.await_args_list] == [
        1,
        1,
    ]
    assert [call.args[1] for call in state.settle.await_args_list] == [21, 34]
    assert [call.kwargs["max_tokens"] for call in state.provider.await_args_list] == [
        2400,
        1200,
    ]
    first, second = state.provider.await_args_list
    assert 0 < second.kwargs["timeout"] <= first.kwargs["timeout"] <= 45
    system = second.args[1][0]["content"]
    schema, _ = json.JSONDecoder().raw_decode(system[system.index("{") :])
    assert set(schema) == {"sections"}
    assert "server stem" in second.args[1][1]["content"]
    for reserve_call, provider_call in zip(
        state.reserve.await_args_list, state.provider.await_args_list
    ):
        assert reserve_call.args[2] == svc.estimate_chat_token_reservation(
            provider_call.args[1], max_output_tokens=provider_call.kwargs["max_tokens"]
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("stop", ["time", "budget", "time_after_reserve"])
async def test_teacher_skips_repair_when_time_or_budget_is_insufficient(
    prepared_teacher, monkeypatch, stop
):
    state = prepared_teacher
    state.provider.side_effect = None
    state.provider.return_value = {
        "content": '{"title":"标题","summary":"只有摘要。"}',
        "tokens_used": 21,
    }
    if stop == "budget":
        reservation = await state.reserve()
        state.reserve.reset_mock()
        state.reserve.side_effect = [reservation, None]
    else:
        clock = iter([0, 0, 41] if stop == "time" else [0, 0, 0, 44])
        monkeypatch.setattr(
            svc, "time", SimpleNamespace(time=lambda: 0, monotonic=lambda: next(clock))
        )
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="explain_correct"
    )
    assert result["from_fallback"] is True
    assert result["fallback_reason"] == (
        "budget_exhausted" if stop == "budget" else "missing_body"
    )
    assert result["tokens_used"] == 21
    state.provider.assert_awaited_once()
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()
    assert state.reserve.await_count == (1 if stop == "time" else 2)
    assert state.cancel.await_count == (1 if stop == "time_after_reserve" else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("second", ["failure", "invalid", "filtered"])
async def test_teacher_repair_failure_keeps_first_attempt_usage(
    prepared_teacher, second
):
    state = prepared_teacher
    response = {
        "failure": RuntimeError("synthetic provider failure"),
        "invalid": {"content": "invalid", "tokens_used": 12},
        "filtered": {
            "content": "",
            "finish_reason": "content_filter",
            "tokens_used": 12,
        },
    }[second]
    state.provider.side_effect = [
        {"content": '{"summary":"只有摘要。"}', "tokens_used": 21},
        response,
    ]
    result = await svc.run_teacher_action(
        state.db, user_id=3, question_id=7, action="core_concept"
    )
    assert result["from_fallback"] is True
    assert (
        result["fallback_reason"]
        == {
            "failure": "service_unavailable",
            "invalid": "invalid_format",
            "filtered": "content_filtered",
        }[second]
    )
    assert result["tokens_used"] == (21 if second == "failure" else 33)
    assert (
        state.usage.await_count
        == state.settle.await_count
        == (1 if second == "failure" else 2)
    )
    assert state.provider.await_count == state.reserve.await_count == 2


@pytest.mark.asyncio
async def test_teacher_deadline_expires_in_queue_without_dispatch_and_releases_hold(
    real_teacher_gateway,
    monkeypatch,
):
    from unittest.mock import Mock

    from app.ai import client as client_module

    state = real_teacher_gateway
    transport = Mock(side_effect=AssertionError("queued request must not dispatch"))
    monkeypatch.setattr(client_module, "request_remote_bytes", transport)
    sem, _ = await state.guard.acquire_slot()
    try:
        result = await svc._call_teacher_with_usage(
            state.db,
            user_id=3,
            question_id=7,
            question_version_id=11,
            action="core_concept",
            messages=[],
            runtime=state.runtime,
            reservation=object(),
            timeout=0.01,
            max_tokens=1200,
        )
    finally:
        state.guard.release_slot(sem)
    assert result is None
    transport.assert_not_called()
    state.cancel.assert_awaited_once()
    state.usage.assert_not_awaited()
    state.settle.assert_not_awaited()


@pytest.mark.asyncio
async def test_teacher_repair_cancellation_preserves_first_charge(prepared_teacher):
    state = prepared_teacher
    state.provider.side_effect = [
        {"content": '{"summary":"只有摘要。"}', "tokens_used": 21},
        asyncio.CancelledError(),
    ]
    with pytest.raises(asyncio.CancelledError):
        await svc.run_teacher_action(
            state.db, user_id=3, question_id=7, action="explain_correct"
        )
    assert state.provider.await_count == state.reserve.await_count == 2
    state.usage.assert_awaited_once()
    state.settle.assert_awaited_once()
    assert state.settle.await_args.args[1] == 21
    state.cancel.assert_awaited_once()


@pytest.mark.asyncio
async def test_inflight_teacher_cancellation_joins_transport_and_bills_real_usage(
    real_teacher_gateway, monkeypatch, tmp_path
):
    from sqlalchemy import select

    from app.ai import client as client_module
    from app.models.ai_chat import AiChat
    from app.models.user import User
    from app.services import ai_token_budget
    from app.services.safe_remote_fetch import RemoteResponse
    from tests.test_services.test_exam_attempt_semantics import _make_database

    state = real_teacher_gateway
    loop = asyncio.get_running_loop()
    started = asyncio.Event()
    release = threading.Event()
    requests = []

    def transport(*_args, **_kwargs):
        requests.append(1)
        loop.call_soon_threadsafe(started.set)
        assert release.wait(2)
        return RemoteResponse(
            status=200,
            data=json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": '{"title":"标题","summary":"只有摘要。"}'
                            },
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"total_tokens": 37},
                }
            ).encode(),
            content_type="application/json",
            final_url="https://provider.example/v1",
        )

    monkeypatch.setattr(client_module, "request_remote_bytes", transport)
    engine, factory = await _make_database(tmp_path)
    reservation = ai_token_budget.TokenReservation(3, 100, "test-day", "test-month")
    state.reserve.side_effect = None
    state.reserve.return_value = reservation
    monkeypatch.setattr(
        svc, "require_available_runtime", AsyncMock(return_value=state.runtime)
    )
    state.usage.side_effect = ai_token_budget.record_token_usage
    state.settle.side_effect = ai_token_budget.settle_token_reservation
    release_budget = AsyncMock()
    monkeypatch.setattr(
        ai_token_budget.cache, "release_token_budget_strict", release_budget
    )
    try:
        async with factory() as db:
            db.add(User(id=3, openid="cancelled-teacher-test"))
            await db.commit()
            task = asyncio.create_task(
                svc.run_teacher_action(
                    db, user_id=3, question_id=7, action="explain_correct"
                )
            )
            try:
                await asyncio.wait_for(started.wait(), 1)
                for _ in range(2):
                    task.cancel()
                    await asyncio.sleep(0)
                    await asyncio.sleep(0)
                refunded_before_response = state.cancel.await_count
                completed_before_response = task.done()
                slot_free_before_response = state.guard._semaphore().locked() is False
            finally:
                release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
        async with factory() as db:
            rows = (await db.scalars(select(AiChat))).all()
            assert len(rows) == 1
            assert rows[0].user_id == 3
            assert rows[0].tokens_used == 37
            assert rows[0].session_type == "408_teacher:explain_correct"
    finally:
        release.set()
        await engine.dispose()
    assert refunded_before_response == 0
    assert completed_before_response is False
    assert slot_free_before_response is False
    assert len(requests) == 1
    state.reserve.assert_awaited_once()
    state.cancel.assert_not_awaited()
    state.usage.assert_awaited_once()
    assert state.usage.await_args.args[-1]["tokens_used"] == 37
    state.settle.assert_awaited_once()
    assert state.settle.await_args.args[1] == 37
    assert reservation.active is False
    release_budget.assert_awaited_once_with(
        day_key="test-day", month_key="test-month", tokens=100, actual_tokens=37
    )
    assert state.guard._semaphore().locked() is False


@pytest.mark.asyncio
async def test_teacher_queue_wait_consumes_same_transport_deadline(
    real_teacher_gateway, monkeypatch
):
    from app.ai import client as client_module
    from app.services.safe_remote_fetch import RemoteResponse

    state = real_teacher_gateway
    sem, _ = await state.guard.acquire_slot()
    timeouts = []

    def transport(*_args, **kwargs):
        timeouts.append(kwargs["timeout"])
        return RemoteResponse(
            status=200,
            data=b'{"choices":[{"message":{"content":"ok"}}],"usage":{"total_tokens":37}}',
            content_type="application/json",
            final_url="https://provider.example/v1",
        )

    monkeypatch.setattr(client_module, "request_remote_bytes", transport)
    release = asyncio.get_running_loop().call_later(0.04, state.guard.release_slot, sem)
    try:
        result = await svc._call_teacher_with_usage(
            state.db,
            user_id=3,
            question_id=7,
            question_version_id=11,
            action="explain_correct",
            messages=[],
            runtime=state.runtime,
            reservation=object(),
            timeout=0.15,
            max_tokens=1200,
        )
    finally:
        release.cancel()
    assert result["tokens_used"] == 37
    assert 0 < timeouts[0] < 0.13


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["usage", "settle"])
async def test_teacher_billing_joins_repeated_cancellation_until_commit_and_settle(
    prepared_teacher, monkeypatch, tmp_path, phase
):
    from sqlalchemy import select

    from app.ai.client import ChatCompletionCancelled
    from app.models.ai_chat import AiChat
    from app.models.user import User
    from app.services import ai_token_budget
    from tests.test_services.test_exam_attempt_semantics import _make_database

    state = prepared_teacher
    result = {"content": "received response", "tokens_used": 37}
    state.provider.side_effect = ChatCompletionCancelled(result)
    state.usage.side_effect = ai_token_budget.record_token_usage
    state.settle.side_effect = ai_token_budget.settle_token_reservation
    reservation = ai_token_budget.TokenReservation(3, 100, "test-day", "test-month")
    entered = asyncio.Event()
    release = asyncio.Event()
    settled = asyncio.Event()

    async def release_budget(**_kwargs):
        if phase == "settle":
            entered.set()
            await release.wait()
        settled.set()

    ledger = AsyncMock(side_effect=release_budget)
    monkeypatch.setattr(ai_token_budget.cache, "release_token_budget_strict", ledger)
    engine, factory = await _make_database(tmp_path)
    try:
        async with factory() as db:
            db.add(User(id=3, openid="billing-cancellation-test"))
            await db.commit()
            commit = db.commit

            async def delayed_commit():
                if phase == "usage":
                    entered.set()
                    await release.wait()
                await commit()

            monkeypatch.setattr(db, "commit", delayed_commit)
            task = asyncio.create_task(
                svc._call_teacher_with_usage(
                    db,
                    user_id=3,
                    question_id=7,
                    question_version_id=11,
                    action="explain_correct",
                    messages=[],
                    runtime=state.runtime,
                    reservation=reservation,
                    timeout=0.5,
                    max_tokens=1200,
                )
            )
            try:
                await asyncio.wait_for(entered.wait(), 1)
                for _ in range(2):
                    task.cancel()
                    await asyncio.sleep(0)
                    await asyncio.sleep(0)
                finished_before_release = task.done()
            finally:
                release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
        assert not finished_before_release
        async with factory() as db:
            rows = (await db.scalars(select(AiChat))).all()
            assert len(rows) == 1
            assert rows[0].tokens_used == 37
        assert settled.is_set()
        ledger.assert_awaited_once_with(
            day_key="test-day", month_key="test-month", tokens=100, actual_tokens=37
        )
        state.cancel.assert_not_awaited()
        state.usage.assert_awaited_once()
        state.settle.assert_awaited_once()
    finally:
        release.set()
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "usage",
    [None, {}, {"total_tokens": 0}, {"prompt_tokens": 0, "completion_tokens": 0}],
)
async def test_cancelled_teacher_distinguishes_missing_usage_from_known_zero(
    real_teacher_gateway, monkeypatch, usage
):
    from app.ai import client as client_module
    from app.services import ai_token_budget
    from app.services.safe_remote_fetch import RemoteResponse

    state = real_teacher_gateway
    loop = asyncio.get_running_loop()
    entered = asyncio.Event()
    release = threading.Event()
    reservation = ai_token_budget.TokenReservation(3, 100, "test-day", "test-month")
    state.settle.side_effect = ai_token_budget.settle_token_reservation
    ledger = AsyncMock()
    monkeypatch.setattr(ai_token_budget.cache, "release_token_budget_strict", ledger)

    def transport(*_args, **_kwargs):
        loop.call_soon_threadsafe(entered.set)
        assert release.wait(2)
        body = {"choices": [{"message": {"content": "received response"}}]}
        if usage is not None:
            body["usage"] = usage
        return RemoteResponse(
            status=200,
            data=json.dumps(body).encode(),
            content_type="application/json",
            final_url="https://provider.example/v1",
        )

    monkeypatch.setattr(client_module, "request_remote_bytes", transport)
    task = asyncio.create_task(
        svc._call_teacher_with_usage(
            state.db,
            user_id=3,
            question_id=7,
            question_version_id=11,
            action="explain_correct",
            messages=[],
            runtime=state.runtime,
            reservation=reservation,
            timeout=0.5,
            max_tokens=1200,
        )
    )
    try:
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    state.cancel.assert_not_awaited()
    if not usage:
        assert reservation.active is True
        state.usage.assert_not_awaited()
        state.settle.assert_not_awaited()
        ledger.assert_not_awaited()
    else:
        state.usage.assert_awaited_once()
        assert state.usage.await_args.args[-1]["tokens_used"] == 0
        ledger.assert_awaited_once_with(
            day_key="test-day", month_key="test-month", tokens=100, actual_tokens=0
        )
        assert reservation.active is False
