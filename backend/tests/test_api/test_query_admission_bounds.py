"""Reject oversized legacy filters before executing resource queries."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.v1 import formulas, practice, questions
from app.core.database import get_db
from app.core.security import get_current_user, get_optional_current_user


@pytest_asyncio.fixture
async def bounded_client():
    app = FastAPI()
    for router in (formulas.router, practice.router, questions.router):
        app.include_router(router)
    db = SimpleNamespace(execute=AsyncMock(), scalar=AsyncMock())

    async def database():
        yield db

    async def user():
        return SimpleNamespace(id=41)

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    app.dependency_overrides[get_optional_current_user] = lambda: None
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, db


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/api/v1/formulas", {"q": "q" * 201}),
        ("/api/v1/formulas", {"tags": ",".join(f"tag{i}" for i in range(21))}),
        ("/api/v1/formulas", {"tags": "a" * 1025}),
        ("/api/v1/formulas", {"chapter_id": 1, "tags": ",".join(["a"] * 21)}),
        ("/api/v1/formulas/favorites/list", {"tags": ",".join(["a"] * 21)}),
        ("/api/v1/formulas/favorites/list", {"q": "q" * 201}),
        ("/api/v1/formulas/random/next", {"tags": ",".join(["a"] * 21)}),
        ("/api/v1/formulas/random/next", {"exclude_ids": ",".join(["1"] * 201)}),
        ("/api/v1/formulas/random/next", {"exclude_ids": "," * 4097}),
        ("/api/v1/questions/random", {"exclude_ids": ",".join(["1"] * 201)}),
        ("/api/v1/questions/random", {"exclude_ids": "1" * 4097}),
        ("/api/v1/practice/questions", {
            "subject_id": 7, "knowledge_point": ",".join(["topic"] * 21),
        }),
        ("/api/v1/practice/questions", {
            "subject_id": 7, "knowledge_point": "x" * 2049,
        }),
    ],
)
async def test_oversized_filters_fail_before_sql(bounded_client, path, params):
    client, db = bounded_client
    response = await client.get(path, params=params)
    assert response.status_code == 422, response.text
    db.execute.assert_not_awaited()
    db.scalar.assert_not_awaited()


@pytest.mark.asyncio
async def test_formula_admission_preserves_a_normal_filter(bounded_client, monkeypatch):
    client, _db = bounded_client
    read = AsyncMock(return_value={"items": []})
    monkeypatch.setattr(formulas, "library_list_formulas", read)
    response = await client.get(
        "/api/v1/formulas", params={"q": "sin(x)", "tags": "math,trigonometry"}
    )
    assert response.status_code == 200
    assert read.await_args.args[3:5] == ("math,trigonometry", "sin(x)")
