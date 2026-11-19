"""App JWT callers cannot bypass the reviewed question publication workflow."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1 import knowledge_points, questions
from app.schemas.question import QuestionCreate
from app.schemas.tag import TagCreate


@pytest.mark.asyncio
async def test_app_question_create_is_rejected_before_database_write():
    db = SimpleNamespace(add=lambda *_args, **_kwargs: pytest.fail("must not write"))
    data = QuestionCreate(
        subject_id=1,
        content={"text": "synthetic"},
        answer="A",
    )

    with pytest.raises(HTTPException) as error:
        await questions.create_question(data=data, db=db, _=SimpleNamespace(id=1))

    assert error.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler", "args"),
    [
        (
            knowledge_points.create_knowledge_point,
            TagCreate(name="synthetic", subject_id=1),
        ),
        (knowledge_points.delete_knowledge_point, 1),
    ],
)
async def test_app_shared_knowledge_point_mutations_are_rejected(handler, args):
    db = SimpleNamespace(
        execute=lambda *_args, **_kwargs: pytest.fail("must not write")
    )

    with pytest.raises(HTTPException) as error:
        if handler is knowledge_points.create_knowledge_point:
            await handler(data=args, db=db, _=SimpleNamespace(id=1))
        else:
            await handler(tag_id=args, db=db, _=SimpleNamespace(id=1))

    assert error.value.status_code == 403
