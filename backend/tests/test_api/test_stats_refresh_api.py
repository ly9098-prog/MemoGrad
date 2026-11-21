"""Explicit stats refreshes must bypass the public snapshot cache."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import stats

DASHBOARD_CACHE = {
    "overview": {"due_review_count": 99},
    "subject_stats": [],
    "recent_trend": [],
    "behavior": {},
    "forgetting": {},
}

GROWTH_CACHE = {
    "total_exp": 9,
    "level": 1,
    "level_title": "旧快照",
    "level_progress_pct": 9,
    "exp_current": 9,
    "exp_to_next": 100,
    "streak_days": 0,
    "streak_title": "",
    "daily_boost": "",
    "badges": [],
}

FRESH_GROWTH = {
    **GROWTH_CACHE,
    "total_exp": 0,
    "level_title": "新快照",
}


@pytest.fixture
def api(monkeypatch):
    app = FastAPI()
    app.include_router(stats.router)
    db = object()
    app.dependency_overrides[stats.get_db] = lambda: db
    app.dependency_overrides[stats.get_current_user] = lambda: SimpleNamespace(id=17)

    async def cache_get(key):
        return GROWTH_CACHE if key.startswith("stats:growth:") else DASHBOARD_CACHE

    cache_get = AsyncMock(side_effect=cache_get)
    cache_set = AsyncMock()
    monkeypatch.setattr(stats.cache, "get", cache_get)
    monkeypatch.setattr(stats.cache, "set", cache_set)

    services = {
        "get_overview": AsyncMock(return_value={"due_review_count": 0}),
        "get_subject_stats": AsyncMock(return_value=[]),
        "get_trends": AsyncMock(return_value=[]),
        "get_behavior_stats": AsyncMock(return_value={}),
        "get_forgetting_trends": AsyncMock(return_value={}),
        "get_growth_profile": AsyncMock(return_value=FRESH_GROWTH),
    }
    for name, service in services.items():
        monkeypatch.setattr(stats.svc, name, service)

    with TestClient(app) as client:
        yield client, db, cache_get, cache_set, services


def test_dashboard_uses_cache_by_default(api):
    client, _, cache_get, _, services = api

    response = client.get("/api/v1/stats/dashboard")

    assert response.status_code == 200
    assert response.json()["overview"]["due_review_count"] == 99
    cache_get.assert_awaited_once_with("stats:dashboard:17")
    services["get_overview"].assert_not_awaited()


def test_dashboard_refresh_bypasses_and_replaces_cache(api):
    client, db, cache_get, cache_set, services = api

    response = client.get("/api/v1/stats/dashboard?refresh=true")

    assert response.status_code == 200
    assert response.json()["overview"]["due_review_count"] == 0
    cache_get.assert_not_awaited()
    services["get_overview"].assert_awaited_once_with(db, 17)
    cache_set.assert_awaited_once()
    assert cache_set.await_args.args[0] == "stats:dashboard:17"
    assert cache_set.await_args.kwargs == {"ttl": 120}


def test_growth_refresh_bypasses_and_replaces_cache(api):
    client, db, cache_get, cache_set, services = api

    response = client.get("/api/v1/stats/growth?refresh=true")

    assert response.status_code == 200
    assert response.json()["level_title"] == "新快照"
    cache_get.assert_not_awaited()
    services["get_growth_profile"].assert_awaited_once_with(db, 17)
    cache_set.assert_awaited_once()
    assert cache_set.await_args.args[0] == "stats:growth:17"
    assert cache_set.await_args.kwargs == {"ttl": 120}
