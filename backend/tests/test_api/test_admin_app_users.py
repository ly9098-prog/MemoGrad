from datetime import datetime
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.api.v1 import admin_app_users
from app.core import admin_security
from app.core.admin_security import AdminPrincipal, get_current_admin
from app.core.database import get_db
from app.main import app
from app.models.admin import AdminUser
from app.models.user import User
from app.models.user_auth import UserAuthIdentity

client = TestClient(app)


class _Db:
    def __init__(self):
        self.commit = AsyncMock()
        self.rollback = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, _statement):
        class _Scalars:
            def __iter__(self):
                return iter([])
        class _Result:
            def scalars(self):
                return _Scalars()

        return _Result()


class _IdentityDb(_Db):
    async def execute(self, _statement):
        class _Result:
            def scalars(self):
                return []

        return _Result()


class _PolicyDb(_Db):
    async def execute(self, _statement):
        class _Result:
            def scalar_one_or_none(self):
                return "super_admin"

        return _Result()


async def _policy_db():
    yield _PolicyDb()


async def _override_db():
    yield _IdentityDb()


def _principal():
    user = AdminUser(id=1, username="admin", password_hash="hash", is_active=True, role_id=1)
    return AdminPrincipal(user, {"jti": "token-id", "exp": 4102444800})


def _app_user(user_id=1, banned=False):
    now = datetime(2026, 5, 29)
    return User(
        id=user_id,
        openid=f"openid-{user_id}",
        nickname="用户",
        avatar_url=None,
        is_banned=banned,
        banned_reason="违规" if banned else None,
        banned_at=now if banned else None,
        banned_by=1 if banned else None,
        created_at=now,
        updated_at=now,
        lifecycle_status="active",
    )


async def _allow_read():
    return _principal()


async def _allow_write():
    return _principal()


async def _allow_ban():
    return _principal()


def test_list_app_users(monkeypatch):
    monkeypatch.setattr(admin_security, "_get_permission_names", AsyncMock(return_value={"app-user:read"}))
    monkeypatch.setattr(admin_app_users, "list_app_users", AsyncMock(return_value=([_app_user()], 1)))
    app.dependency_overrides[get_current_admin] = _allow_read
    app.dependency_overrides[get_db] = _override_db
    try:
        resp = client.get("/api/admin/v1/app-users")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["total"] == 1
    assert resp.json()["items"][0]["openid"] == "openid-1"


def test_get_app_user_detail(monkeypatch):
    detail = _app_user().__dict__ | {"practice_count": 3, "wrong_count": 1, "recent_active_at": None}
    monkeypatch.setattr(admin_security, "_get_permission_names", AsyncMock(return_value={"app-user:read"}))
    monkeypatch.setattr(admin_app_users, "get_app_user_detail", AsyncMock(return_value=detail))
    app.dependency_overrides[get_current_admin] = _allow_read
    app.dependency_overrides[get_db] = _override_db
    try:
        resp = client.get("/api/admin/v1/app-users/1")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["practice_count"] == 3


def test_patch_app_user(monkeypatch):
    patch_user = AsyncMock(return_value=_app_user())
    password_identity = UserAuthIdentity(
        user_id=1,
        provider="password",
        namespace="user",
        subject="alice",
        verified_at=datetime(2026, 5, 29),
        created_at=datetime(2026, 5, 29),
    )
    monkeypatch.setattr(admin_security, "_get_permission_names", AsyncMock(return_value={"app-user:write"}))
    monkeypatch.setattr(admin_app_users, "update_app_user", patch_user)
    monkeypatch.setattr(
        admin_app_users,
        "load_user_identities",
        AsyncMock(return_value=[password_identity]),
    )
    app.dependency_overrides[get_current_admin] = _allow_write
    app.dependency_overrides[get_db] = _override_db
    try:
        resp = client.patch("/api/admin/v1/app-users/1", json={"nickname": "新昵称"})
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["user_type"] == "web"
    assert resp.json()["identities"][0]["masked_subject"] == "password:***"
    patch_user.assert_awaited_once()


def test_ban_and_unban_app_user(monkeypatch):
    monkeypatch.setattr(admin_app_users, "ban_app_user", AsyncMock(return_value=_app_user(banned=True)))
    monkeypatch.setattr(admin_app_users, "unban_app_user", AsyncMock(return_value=_app_user(banned=False)))
    monkeypatch.setattr(admin_security, "_get_permission_names", AsyncMock(return_value={"app-user:ban"}))
    app.dependency_overrides[get_current_admin] = _allow_ban
    app.dependency_overrides[get_db] = _override_db
    try:
        ban_resp = client.post("/api/admin/v1/app-users/1/ban", json={"reason": "违规"})
        unban_resp = client.post("/api/admin/v1/app-users/1/unban")
    finally:
        app.dependency_overrides.clear()

    assert ban_resp.status_code == 200
    assert ban_resp.json()["is_banned"] is True
    assert unban_resp.status_code == 200
    assert unban_resp.json()["is_banned"] is False


def test_list_app_users_requires_permission():
    resp = client.get("/api/admin/v1/app-users")

    assert resp.status_code in {401, 403}


def test_user_ai_policy_routes_are_not_captured_by_user_id(monkeypatch):
    from app.schemas.user_ai_policy import (
        AdminUserAIPolicyDefaultResponse,
        UserAIPolicyValues,
    )

    default = AdminUserAIPolicyDefaultResponse(
        version=1,
        values=UserAIPolicyValues(
            regeneration_cooldown_seconds=60,
            regeneration_question_24h_limit=3,
            regeneration_account_24h_limit=20,
            daily_token_limit=50000,
            monthly_token_limit=500000,
            rpm_limit=12,
        ),
    )
    read_default = AsyncMock(return_value=default)
    monkeypatch.setattr(admin_app_users, "get_default_policy", read_default)
    monkeypatch.setattr(
        admin_security,
        "_get_permission_names",
        AsyncMock(return_value={"ai_setting:read"}),
    )
    app.dependency_overrides[get_current_admin] = _allow_read
    app.dependency_overrides[get_db] = _policy_db
    try:
        resp = client.get("/api/admin/v1/app-users/ai-policy")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["scope"] == "default"
    read_default.assert_awaited_once()


def test_unlimited_policy_contract_uses_patch():
    path = app.openapi()["paths"][
        "/api/admin/v1/app-users/{user_id}/ai-policy/unlimited"
    ]
    assert "patch" in path
    assert "post" not in path


def test_patch_user_ai_policy_accepts_null_for_inherited_fields(monkeypatch):
    from app.schemas.user_ai_policy import (
        AdminUserAIPolicyDetailResponse,
        UserAIPolicyEffectiveValues,
        UserAIPolicySources,
        UserAIPolicyValues,
    )

    defaults = UserAIPolicyValues(
        regeneration_cooldown_seconds=60,
        regeneration_question_24h_limit=3,
        regeneration_account_24h_limit=20,
        daily_token_limit=50000,
        monthly_token_limit=500000,
        rpm_limit=12,
    )
    detail = AdminUserAIPolicyDetailResponse(
        user_id=1,
        version=1,
        defaults=defaults,
        overrides={
            "regeneration_cooldown_seconds": None,
            "regeneration_question_24h_limit": -1,
            "regeneration_account_24h_limit": 20,
            "daily_token_limit": None,
            "monthly_token_limit": 600000,
            "rpm_limit": None,
        },
        effective=UserAIPolicyEffectiveValues(
            regeneration_cooldown_seconds=60,
            regeneration_question_24h_limit=-1,
            regeneration_account_24h_limit=20,
            daily_token_limit=50000,
            monthly_token_limit=600000,
            rpm_limit=12,
        ),
        sources=UserAIPolicySources(
            regeneration_question_24h_limit="user",
            regeneration_account_24h_limit="user",
            monthly_token_limit="user",
        ),
        unlimited=False,
    )
    update_user_policy = AsyncMock(return_value=detail)
    monkeypatch.setattr(admin_app_users, "update_user_policy", update_user_policy)
    monkeypatch.setattr(
        admin_security,
        "_get_permission_names",
        AsyncMock(
            return_value={"app-user:read", "ai_setting:write"}
        ),
    )
    app.dependency_overrides[get_current_admin] = _allow_write
    app.dependency_overrides[get_db] = _policy_db
    try:
        resp = client.patch(
            "/api/admin/v1/app-users/1/ai-policy",
            json={
                "version": 0,
                "reason": "逐项覆盖",
                "values": {
                    "regeneration_cooldown_seconds": None,
                    "regeneration_question_24h_limit": -1,
                    "regeneration_account_24h_limit": 20,
                    "daily_token_limit": None,
                    "monthly_token_limit": 600000,
                    "rpm_limit": None,
                },
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert resp.json()["sources"]["monthly_token_limit"] == "user"
    update_user_policy.assert_awaited_once()
