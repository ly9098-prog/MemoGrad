"""Audit follow-up: auth session, logout, deletion, AI feedback endpoint tests.

Covers scenarios from the pre-launch audit:
- POST /auth/logout (revoke refresh token)
- POST /users/me/deletion-request (soft-delete + reject after)
- POST /ai/feedback (record feedback)

Uses unique login codes per test to avoid conflicts with soft-deleted users
from previous test runs.
"""
import asyncio
import uuid
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.v1 import auth as auth_api
from app.core.database import Base, get_db
from app.core.security import decode_token
from app.main import app
from app.models.user import User

client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def isolated_database(tmp_path_factory):
    from app import models  # noqa: F401

    database = tmp_path_factory.mktemp("auth-session") / "session.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}", poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def create_schema():
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

    async def override_db():
        async with factory() as session:
            yield session

    asyncio.run(create_schema())
    app.dependency_overrides[get_db] = override_db
    yield factory
    app.dependency_overrides.pop(get_db, None)
    asyncio.run(engine.dispose())


def _login(code=None):
    if code is None:
        code = f"test_code_{uuid.uuid4().hex[:12]}"
    resp = client.post(
        "/api/v1/auth/login",
        json={
            "code": code,
            "accepted_terms": True,
            "agreement_version": "2026-11-20",
            "privacy_version": "2026-11-20",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    return data["access_token"], data["refresh_token"]


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def test_login_and_refresh_record_miniprogram_activity(isolated_database):
    token, refresh_token = _login()
    user_id = decode_token(token)
    old_time = datetime(2026, 11, 21, 8, 0)

    async def mark_stale():
        async with isolated_database() as db:
            user = await db.get(User, user_id)
            user.last_active_client = "web"
            user.last_active_at = old_time
            await db.commit()

    asyncio.run(mark_stale())
    response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert response.status_code == 200

    async def read_activity():
        async with isolated_database() as db:
            user = await db.get(User, user_id)
            return user.last_active_client, user.last_active_at

    active_client, active_at = asyncio.run(read_activity())
    assert active_client == "miniprogram"
    assert active_at > old_time


def test_login_and_refresh_survive_activity_write_failure(monkeypatch):
    async def fail_activity(db, user, client):
        await db.rollback()

    monkeypatch.setattr(auth_api, "record_user_activity", fail_activity)
    token, refresh_token = _login()
    retried = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )

    assert retried.status_code == 200
    assert retried.json()["user"]["id"] == decode_token(token)


def test_wechat_login_requires_current_consent_versions():
    resp = client.post("/api/v1/auth/login", json={"code": "consent-required"})
    assert resp.status_code == 422


def test_logout_revokes_token():
    """POST /auth/logout should succeed and revoke refresh tokens."""
    token, refresh_token = _login()

    # Logout
    resp = client.post("/api/v1/auth/logout", headers=_auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["message"] == "已退出登录"

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert response.status_code == 401


def test_deletion_soft_deletes_user():
    """POST /users/me/deletion-request should soft-delete and reject subsequent requests."""
    token, _ = _login()

    # Request deletion
    resp = client.post("/api/v1/users/me/deletion-request", headers=_auth_header(token))
    assert resp.status_code == 200
    data = resp.json()
    assert "deleted_at" in data
    assert data["deleted_at"] > 0

    # Subsequent requests with same token should be rejected
    resp = client.get("/api/v1/users/me", headers=_auth_header(token))
    assert resp.status_code == 401


def test_deletion_idempotent():
    """Second deletion request should return 401 (user already soft-deleted)."""
    code = f"test_code_{uuid.uuid4().hex[:12]}"
    token, _ = _login(code)
    resp = client.post("/api/v1/users/me/deletion-request", headers=_auth_header(token))
    assert resp.status_code == 200

    resp = client.post("/api/v1/users/me/deletion-request", headers=_auth_header(token))
    assert resp.status_code == 401


def test_ai_feedback_records():
    """POST /ai/feedback should record feedback without error."""
    token, _ = _login()

    resp = client.post(
        "/api/v1/ai/feedback",
        headers=_auth_header(token),
        json={"source": "dashboard", "feedback_type": "内容有误"},
    )
    assert resp.status_code == 200
    assert resp.json()["message"] == "反馈已提交，感谢您的帮助"
