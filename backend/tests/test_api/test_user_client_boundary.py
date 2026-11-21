from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import admin_app_users
from app.core import admin_security
from app.core.admin_security import AdminPrincipal, get_current_admin
from app.core.database import Base, get_db
from app.main import app
from app.models.admin import AdminUser
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.services import identity_service
from app.services.admin_app_user_service import list_app_users, mask_identity_subject

client = TestClient(app)


class _Db:
    def __init__(self):
        self.commit = AsyncMock()
        self.rollback = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, _statement):
        class _Result:
            def scalars(self):
                class _Scalars:
                    def all(self):
                        return ["app-user:read"]

                return _Scalars()

        return _Result()


class _EmptyDb(_Db):
    async def execute(self, _statement):
        class _Result:
            def scalars(self):
                return []

        return _Result()


async def _override_db():
    yield _EmptyDb()


def _principal():
    admin = AdminUser(id=1, username="admin", password_hash="hash", is_active=True, role_id=1)
    return AdminPrincipal(admin, {})


def _user(user_id=1, registration_source=None, last_active_client=None, last_active_at=None):
    now = datetime(2026, 11, 22)
    return User(
        id=user_id,
        openid=f"openid-{user_id}",
        nickname="用户",
        is_banned=False,
        created_at=now,
        updated_at=now,
        lifecycle_status="active",
        registration_source=registration_source,
        last_active_client=last_active_client,
        last_active_at=last_active_at,
    )


async def _allow_read():
    return _principal()


def test_list_app_users_exposes_client_boundary(monkeypatch):
    user = _user(
        registration_source="miniprogram",
        last_active_client="web",
        last_active_at=datetime(2026, 11, 22, 10),
    )
    monkeypatch.setattr(admin_security, "_get_permission_names", AsyncMock(return_value={"app-user:read"}))
    monkeypatch.setattr(admin_app_users, "list_app_users", AsyncMock(return_value=([user], 1)))
    identity = UserAuthIdentity(
        id=1,
        user_id=1,
        provider="email",
        namespace="user",
        subject="alice@example.com",
        verified_at=datetime(2026, 11, 22),
        created_at=datetime(2026, 11, 22),
        updated_at=datetime(2026, 11, 22),
    )
    monkeypatch.setattr(
        admin_app_users,
        "load_user_identities_by_user",
        AsyncMock(return_value={1: [identity]}),
    )
    app.dependency_overrides[get_current_admin] = _allow_read
    app.dependency_overrides[get_db] = _override_db
    try:
        response = client.get("/api/admin/v1/app-users?user_type=web")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["registration_source"] == "miniprogram"
    assert item["last_active_client"] == "web"
    assert item["user_type"] == "web"
    assert item["identities"] == [
        {
            "provider": "email",
            "masked_subject": "al***@example.com",
            "verified": True,
            "created_at": "2026-11-22T00:00:00Z",
        }
    ]
    assert item["last_active_at"] == "2026-11-22T10:00:00Z"


def test_list_app_users_rejects_invalid_type_without_calling_service(monkeypatch):
    service = AsyncMock(return_value=([], 0))
    monkeypatch.setattr(admin_security, "_get_permission_names", AsyncMock(return_value={"app-user:read"}))
    monkeypatch.setattr(admin_app_users, "list_app_users", service)
    app.dependency_overrides[get_current_admin] = _allow_read
    app.dependency_overrides[get_db] = _override_db
    try:
        response = client.get("/api/admin/v1/app-users?user_type=legacy")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    service.assert_not_awaited()


@pytest.mark.asyncio
async def test_user_type_filters_are_exclusive_and_keep_unknown_out(tmp_path):
    import app.models  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'boundary.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as db:
        users = {
            name: User(nickname=name, lifecycle_status="active")
            for name in ("wechat", "email", "github", "both", "unknown", "password")
        }
        db.add_all(users.values())
        await db.flush()
        db.add_all(
            [
                UserAuthIdentity(
                    user_id=users["wechat"].id,
                    provider="wechat",
                    namespace="wechat",
                    subject="wx-1",
                ),
                UserAuthIdentity(
                    user_id=users["email"].id,
                    provider="email",
                    namespace="user",
                    subject="email@example.com",
                ),
                UserAuthIdentity(
                    user_id=users["github"].id,
                    provider="github",
                    namespace="github.com",
                    subject="42",
                ),
                UserAuthIdentity(
                    user_id=users["both"].id,
                    provider="wechat",
                    namespace="wechat",
                    subject="wx-2",
                ),
                UserAuthIdentity(
                    user_id=users["both"].id,
                    provider="email",
                    namespace="user",
                    subject="both@example.com",
                ),
                UserAuthIdentity(
                    user_id=users["password"].id,
                    provider="password",
                    namespace="user",
                    subject="account",
                ),
            ]
        )
        await db.commit()

        expected = {
            "web": {"email", "github", "password"},
            "miniprogram": {"wechat"},
            "both": {"both"},
        }
        for user_type, names in expected.items():
            items, total = await list_app_users(
                db, 1, 20, user_type=user_type
            )
            assert {item.nickname for item in items} == names
            assert total == len(names)

        paged_web_ids = []
        for page in (1, 2):
            items, total = await list_app_users(db, page, 2, user_type="web")
            paged_web_ids.extend(item.id for item in items)
        assert len(paged_web_ids) == len(set(paged_web_ids)) == 3

        all_items, all_total = await list_app_users(db, 1, 20)
        assert all_total == 6
        assert {item.nickname for item in all_items} == set(users)

    await engine.dispose()


def test_password_identity_subject_is_always_masked():
    identity = UserAuthIdentity(
        user_id=1,
        provider="password",
        namespace="user",
        subject="alice",
    )

    assert mask_identity_subject(identity) == "password:***"


@pytest.mark.asyncio
async def test_registration_source_is_written_only_on_first_create(tmp_path):
    import app.models  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'source.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with factory() as db:
        first, _ = await identity_service.authenticate_identity(
            db,
            provider="wechat",
            namespace="wechat",
            subject="openid-source",
            allow_register=True,
            registration_source="miniprogram",
        )
        second, _ = await identity_service.authenticate_identity(
            db,
            provider="wechat",
            namespace="wechat",
            subject="openid-source",
            allow_register=True,
            registration_source="web",
        )

        assert second.id == first.id
        assert second.registration_source == "miniprogram"

    await engine.dispose()
