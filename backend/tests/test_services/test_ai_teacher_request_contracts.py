"""Teacher request ordering and truthful fallbacks without external providers."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import ai_teacher_408_service as svc
from app.services.ai import analysis_availability


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
            "content": json.dumps({"title": "lesson", "summary": "summary"}),
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
        "timeout": 45,
        "max_tokens": 1400,
        "response_format": {"type": "json_object"},
        "prefer_direct_answer": True,
        "runtime": state.runtime,
    }
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
    if scenario == "unavailable":
        state.cancel.assert_awaited_once()
    elif scenario in {"quota", "exception"}:
        state.cancel.assert_not_awaited()
    assert svc.note_failure.await_count == (1 if scenario == "exception" else 0)


@pytest.mark.asyncio
async def test_teacher_unavailable_blocks_before_provider_call(prepared_teacher):
    state = prepared_teacher
    unavailable = {
        "status": "unavailable",
        "enabled": False,
        "reason": "quota",
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
    assert "未生成逐项讲解" in result["summary"]
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
    assert PROMPT_VERSION == "408-teacher-v6-single-lesson-envelope"


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
    assert "未生成 AI 讲解" in result["summary"]
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
        reason = "今日 AI 调用额度已用尽"
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
    assert "未生成 AI 讲解" in result["summary"]
    assert state.revision.analysis not in result["summary"]
    assert result["sections"] == []


@pytest.mark.parametrize("action", list(svc.ACTION_DEFINITIONS))
def test_all_teacher_prompts_require_a_single_root_object(action):
    system = svc.build_408_teacher_prompt(action=action, context={})[0]["content"]
    assert "不要直接返回数组" in system
