from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.core import admin_security
from app.core.admin_security import AdminPrincipal, get_current_admin
from app.core.database import get_db
from app.main import app
from app.models.admin import AdminUser

client = TestClient(app)


class _Db:
    async def execute(self, _statement):
        class _Result:
            def scalar_one_or_none(self):
                return "admin"

        return _Result()


async def _database():
    yield _Db()


def _principal():
    user = AdminUser(
        id=2,
        username="operator",
        password_hash="hash",
        is_active=True,
        role_id=2,
    )
    return AdminPrincipal(user, {"jti": "token-id", "exp": 4102444800})


async def _allow():
    return _principal()


def test_ai_settings_api_requires_super_admin_even_with_permissions(monkeypatch):
    monkeypatch.setattr(
        admin_security,
        "_get_permission_names",
        AsyncMock(return_value={"ai_setting:read", "ai_setting:write"}),
    )
    app.dependency_overrides[get_current_admin] = _allow
    app.dependency_overrides[get_db] = _database
    try:
        read_response = client.get("/api/admin/v1/ai-settings")
        write_response = client.patch(
            "/api/admin/v1/ai-settings",
            json={"ai_parse_enabled": False},
        )
    finally:
        app.dependency_overrides.clear()

    assert read_response.status_code == 403
    assert write_response.status_code == 403
