"""Question-detail answer disclosure requires current ownership and revision."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1 import questions


class _Result:
    def __init__(self, *, scalar=None, one=None):
        self._scalar = scalar
        self._one = one

    def scalar_one_or_none(self):
        return self._scalar

    def one_or_none(self):
        return self._one


@pytest.mark.asyncio
async def test_historical_practice_with_active_exam_is_blocked_before_answer(
    monkeypatch,
):
    db = SimpleNamespace(
        execute=__import__("unittest.mock", fromlist=["AsyncMock"]).AsyncMock(
            return_value=_Result(scalar=1)
        ),
        get=__import__("unittest.mock", fromlist=["AsyncMock"]).AsyncMock(),
    )
    from app.services import ai_teacher_408_service

    guard = __import__("unittest.mock", fromlist=["AsyncMock"]).AsyncMock(
        side_effect=ai_teacher_408_service.AIExamInProgressError("active")
    )
    monkeypatch.setattr(
        ai_teacher_408_service, "assert_ai_answer_access_allowed", guard
    )

    with pytest.raises(HTTPException) as error:
        await questions.get_question_detail(
            9, db=db, current_user=SimpleNamespace(id=3)
        )

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "exam_in_progress_answer_blocked"
    db.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_withdrawn_latest_revision_is_not_used_for_answer(monkeypatch):
    from unittest.mock import AsyncMock

    from app.services import ai_teacher_408_service

    db = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                _Result(scalar=1),
                _Result(scalar=SimpleNamespace(id=2, version=2)),
            ]
        ),
        get=AsyncMock(
            return_value=SimpleNamespace(
                id=1,
                question_id=9,
                is_active=True,
                subject_id=1,
                question_type="single_choice",
            )
        ),
    )
    monkeypatch.setattr(
        ai_teacher_408_service,
        "assert_ai_answer_access_allowed",
        AsyncMock(),
    )
    monkeypatch.setattr(
        questions.svc,
        "get_by_id",
        AsyncMock(
            return_value=SimpleNamespace(
                id=9,
                subject_id=1,
                question_type="single_choice",
                content={"text": "withdrawn"},
                options={},
                answer="A",
                analysis="hidden",
                subject_ref=None,
            )
        ),
    )

    with pytest.raises(HTTPException) as error:
        await questions.get_question_detail(
            9, db=db, current_user=SimpleNamespace(id=3)
        )

    assert error.value.status_code == 409
    assert error.value.detail == "题目已更新，请重新作答后查看解析"
