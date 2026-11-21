from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import stats as stats_api
from app.api.v1.stats import router
from app.core.database import get_db
from app.core.security import get_current_user


def test_background_diagnosis_returns_pending_data_without_waiting_for_provider(
    monkeypatch,
):
    app = FastAPI()
    app.include_router(router)
    db = object()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=17)
    job = AsyncMock(
        return_value={"summary": "即时洞察", "generated": False, "status": "pending"}
    )
    monkeypatch.setattr(stats_api, "get_diagnosis", job)

    with TestClient(app) as client:
        response = client.get("/api/v1/stats/ai-diagnosis?background=true&refresh=true")

    assert response.status_code == 200
    assert response.json()["status"] == "pending"
    assert response.json()["summary"] == "即时洞察"
    job.assert_awaited_once_with(db, 17, refresh=True, poll_only=False)


def test_poll_only_reads_the_existing_job_without_starting_a_second_one(monkeypatch):
    app = FastAPI()
    app.include_router(router)
    db = object()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=17)
    job = AsyncMock(return_value={"summary": "完整洞察", "generated": True})
    monkeypatch.setattr(stats_api, "get_diagnosis", job)

    with TestClient(app) as client:
        response = client.get("/api/v1/stats/ai-diagnosis?poll_only=true")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert response.json()["generated"] is True
    job.assert_awaited_once_with(db, 17, refresh=False, poll_only=True)
