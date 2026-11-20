"""Self-service profile writes must never change identity or privileges."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import admin_auth
from app.core.admin_security import AdminPrincipal, get_current_admin
from app.core.database import get_db
from app.main import app
from app.models.admin import AdminUser, Role
from app.services import admin_auth_service


@pytest.fixture
def profile_client(monkeypatch):
    user = AdminUser(
        id=42, username="reviewer", display_name="Original", role_id=2,
        password_hash="not-a-real-hash", is_active=True,
    )
    role = Role(id=2, name="reviewer", display_name="审核员", is_system=True)
    principal = AdminPrincipal(user, {})
    db = MagicMock()
    db.commit = AsyncMock()

    async def current_admin():
        return principal

    async def database():
        yield db

    audit = AsyncMock()
    monkeypatch.setattr(admin_auth_service, "write_admin_audit", audit)
    monkeypatch.setattr(admin_auth_service, "get_admin_me_response", AsyncMock(
        side_effect=lambda _db, account: {"user": account, "role": role, "permissions": []}
    ))
    app.dependency_overrides[get_current_admin] = current_admin
    app.dependency_overrides[get_db] = database
    try:
        yield TestClient(app), user, db, audit
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
        app.dependency_overrides.pop(get_db, None)


def test_profile_updates_only_current_account_and_audits(profile_client):
    client, user, db, audit = profile_client
    response = client.patch("/api/admin/v1/auth/me", json={"display_name": "  小林  "})
    assert response.status_code == 200
    assert response.json()["user"]["display_name"] == "小林"
    assert user.id == 42
    assert user.username == "reviewer"
    assert user.role_id == 2
    assert user.is_active is True
    db.commit.assert_awaited_once()
    assert audit.await_args.args[4] == 42
    assert audit.await_args.kwargs["detail"]["old_display_name"] == "Original"


@pytest.mark.parametrize("field,value", [
    ("id", 1), ("role_id", 1), ("is_active", False), ("username", "admin"),
    ("email", "unverified@example.com"), ("email_verified", True),
    ("password_hash", "replacement"),
])
def test_profile_rejects_identity_and_privilege_fields(profile_client, field, value):
    client, user, db, _ = profile_client
    response = client.patch("/api/admin/v1/auth/me", json={"display_name": "New", field: value})
    assert response.status_code == 422
    assert user.display_name == "Original"
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("payload", [{}, {"display_name": None}, {"display_name": "x" * 65}])
def test_profile_validates_name(profile_client, payload):
    client, _, db, _ = profile_client
    assert client.patch("/api/admin/v1/auth/me", json=payload).status_code == 422
    db.commit.assert_not_awaited()


def test_profile_clears_optional_name(profile_client):
    client, user, _, _ = profile_client
    assert client.patch("/api/admin/v1/auth/me", json={"display_name": "  "}).status_code == 200
    assert user.display_name is None


def test_profile_requires_admin_authentication():
    assert TestClient(app).patch("/api/admin/v1/auth/me", json={"display_name": "New"}).status_code == 401


def test_profile_rejects_ordinary_user_token():
    from app.core.security import create_token

    response = TestClient(app).patch(
        "/api/admin/v1/auth/me", json={"display_name": "New"},
        headers={"Authorization": f"Bearer {create_token(1)}"},
    )
    assert response.status_code == 401


def test_profile_rejects_cross_site_write(profile_client, monkeypatch):
    client, _, db, _ = profile_client
    monkeypatch.setattr(admin_auth.settings, "ADMIN_WEB_BASE_URL", "https://admin.example.com")
    response = client.patch("/api/admin/v1/auth/me", json={"display_name": "New"}, headers={"Origin": "https://attacker.example"})
    assert response.status_code == 403
    db.commit.assert_not_awaited()
