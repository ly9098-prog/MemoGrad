"""Exercise browser callbacks and identity changes through their actual routes."""

import asyncio
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import auth_email, auth_oauth
from app.core.cache import cache
from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import create_token
from app.models.user_auth import UserAuthIdentity
from app.services import (
    email_otp_service,
    github_oauth_service,
    identity_service,
    slider_captcha_service,
    user_auth_service,
)


@pytest_asyncio.fixture()
async def flow(tmp_path, monkeypatch):
    import app.models  # noqa: F401

    monkeypatch.setattr(cache, "_enabled", False)
    monkeypatch.setattr(settings, "USER_WEB_BASE_URL", "http://user.test")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-secret")
    monkeypatch.setattr(
        settings,
        "GITHUB_OAUTH_CALLBACK_URL",
        "http://user.test/api/v1/auth/github/callback",
    )
    monkeypatch.setattr(email_otp_service.secrets, "randbelow", lambda _: 123456)

    async def deliver(**kwargs):
        return None

    monkeypatch.setattr(email_otp_service, "send_auth_email", deliver)
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'flow.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def database():
        async with factory() as session:
            yield session

    app = FastAPI()
    app.include_router(auth_email.router)
    app.include_router(auth_oauth.router)
    app.dependency_overrides[get_db] = database
    async with factory() as db:
        user, email = await identity_service.authenticate_identity(
            db,
            provider="email",
            namespace="user",
            subject="old@example.com",
            allow_register=True,
        )
        github = await identity_service.bind_identity(
            db,
            user=user,
            provider="github",
            namespace="github.com",
            subject="42",
        )
    token, _ = create_token(user.id)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://user.test",
        headers={"Authorization": f"Bearer {token}"},
    ) as client:
        yield client, factory, user, email, github
    await engine.dispose()


@pytest.mark.asyncio
async def test_github_start_binds_browser_and_uses_pkce(flow):
    client, *_ = flow
    response = await client.post(
        "/api/v1/auth/github/start",
        json={
            "accepted_terms": True,
            "agreement_version": "2026-11-20",
            "privacy_version": "2026-11-20",
        },
    )
    assert response.status_code == 200
    params = parse_qs(urlsplit(response.json()["authorization_url"]).query)
    assert params["code_challenge_method"] == ["S256"]
    assert len(params["code_challenge"][0]) == 43
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "Domain=" not in response.headers["set-cookie"]


@pytest.mark.asyncio
async def test_github_callback_rejects_another_browser_before_exchange(
    flow, monkeypatch
):
    client, *_ = flow
    response = await client.post(
        "/api/v1/auth/github/start",
        json={
            "accepted_terms": True,
            "agreement_version": "2026-11-20",
            "privacy_version": "2026-11-20",
        },
    )
    state = response.json()["state"]
    client.cookies.clear()
    calls = []

    async def exchange(*args, **kwargs):
        calls.append(True)
        return {"id": 42}

    monkeypatch.setattr(github_oauth_service, "exchange_github_code", exchange)
    callback = await client.get(
        "/api/v1/auth/github/callback",
        params={
            "state": state,
            "code": "test-code",
        },
    )
    assert callback.status_code == 303
    assert "auth_error=" in callback.headers["location"]
    assert calls == []


@pytest.mark.asyncio
async def test_oauth_state_can_only_be_consumed_once(flow):
    _, state = await github_oauth_service.start_github_oauth(
        mode="login",
        user_id=None,
        return_to="/",
    )
    results = await asyncio.gather(
        github_oauth_service.consume_oauth_state(state),
        github_oauth_service.consume_oauth_state(state),
        return_exceptions=True,
    )
    assert sum(isinstance(item, dict) for item in results) == 1


@pytest.mark.asyncio
async def test_change_challenge_cannot_be_used_to_add_a_second_email(flow):
    client, factory, user, *_ = flow
    challenge = await email_otp_service.issue_otp(
        domain="user",
        email="new@example.com",
        purpose="bind",
        client_ip="test",
        user_id=user.id,
        metadata={"operation": "change_email"},
    )
    response = await client.post(
        "/api/v1/users/me/identities/email/bind/verify",
        json={
            "challenge_id": challenge.challenge_id,
            "code": "123456",
        },
    )
    assert response.status_code == 400
    async with factory() as db:
        emails = (
            await db.scalars(
                select(UserAuthIdentity).where(
                    UserAuthIdentity.user_id == user.id,
                    UserAuthIdentity.provider == "email",
                )
            )
        ).all()
        assert [item.subject for item in emails] == ["old@example.com"]


@pytest.mark.asyncio
async def test_binding_a_second_email_requires_the_change_flow(flow):
    _, factory, user, *_ = flow
    async with factory() as db:
        with pytest.raises(identity_service.IdentityConflictError):
            await identity_service.bind_identity(
                db,
                user=user,
                provider="email",
                namespace="user",
                subject="second@example.com",
            )


@pytest.mark.asyncio
async def test_expired_refresh_race_returns_unauthorized(flow, monkeypatch):
    client, *_ = flow
    from app.services import token_service

    async def consumed(*args, **kwargs):
        raise ValueError("refresh token has already been consumed")

    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    monkeypatch.setattr(
        token_service,
        "verify_refresh_token",
        AsyncMock(
            return_value=SimpleNamespace(user_id=flow[2].id),
        ),
    )
    monkeypatch.setattr(token_service, "rotate_refresh_token", consumed)
    client.cookies.set(
        "user_refresh_token", "test", domain="user.test", path="/api/v1/auth"
    )
    response = await client.post("/api/v1/auth/web/refresh")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_github_callback_creates_cookie_for_the_user_web(flow, monkeypatch):
    client, *_ = flow

    async def exchange(code, *, code_verifier):
        assert code == "code" and len(code_verifier) >= 43
        return {"id": 42}

    monkeypatch.setattr(github_oauth_service, "exchange_github_code", exchange)
    start = await client.post(
        "/api/v1/auth/github/start",
        json={
            "accepted_terms": True,
            "agreement_version": "2026-11-20",
            "privacy_version": "2026-11-20",
        },
    )
    callback = await client.get(
        "/api/v1/auth/github/callback",
        params={
            "state": start.json()["state"],
            "code": "code",
        },
    )
    assert callback.status_code == 303
    assert callback.headers["location"] == "http://user.test/"
    restored = await client.post("/api/v1/auth/web/refresh")
    assert restored.status_code == 200
    assert restored.json()["user"]["id"] == flow[2].id
    assert "Domain=" not in callback.headers["set-cookie"]


@pytest.mark.asyncio
async def test_github_step_up_proves_the_retained_identity_for_email_unlink(
    flow, monkeypatch
):
    client, factory, user, email, github = flow

    async def exchange(code, *, code_verifier):
        return {"id": 42}

    monkeypatch.setattr(github_oauth_service, "exchange_github_code", exchange)
    start = await client.post("/api/v1/users/me/identities/github/step-up/start")
    assert start.status_code == 200
    callback = await client.get(
        "/api/v1/auth/github/callback",
        params={
            "state": start.json()["state"],
            "code": "code",
        },
    )
    assert callback.headers["location"] == "http://user.test/settings?verified=github"
    proof = await client.post("/api/v1/users/me/identities/github/step-up/result")
    assert proof.status_code == 200
    unlinked = await client.request(
        "DELETE",
        f"/api/v1/users/me/identities/{email.id}",
        json={"step_up_token": proof.json()["step_up_token"]},
    )
    assert unlinked.status_code == 200
    async with factory() as db:
        retained = await identity_service.list_user_identities(db, user.id)
        assert [identity.id for identity in retained] == [github.id]


@pytest.mark.asyncio
async def test_unlink_requires_verification_of_an_identity_that_remains(flow):
    client, _, user, email, _ = flow
    token = await user_auth_service.issue_step_up_token(user.id, email.id)
    response = await client.request(
        "DELETE",
        f"/api/v1/users/me/identities/{email.id}",
        json={
            "step_up_token": token,
        },
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_concurrent_unlinks_keep_a_login_identity(flow):
    _, factory, user, email, github = flow

    async def unlink(identity_id):
        async with factory() as db:
            await identity_service.unbind_identity(
                db, user_id=user.id, identity_id=identity_id
            )

    results = await asyncio.gather(
        unlink(email.id), unlink(github.id), return_exceptions=True
    )
    assert sum(result is None for result in results) == 1
    assert any(
        isinstance(result, identity_service.IdentityConflictError) for result in results
    )
    async with factory() as db:
        assert (
            len(
                (
                    await db.scalars(
                        select(UserAuthIdentity).where(
                            UserAuthIdentity.user_id == user.id,
                        )
                    )
                ).all()
            )
            == 1
        )


@pytest.mark.asyncio
async def test_unlink_wechat_clears_the_legacy_login_alias(flow):
    _, factory, user, *_ = flow
    from app.models.user import User

    async with factory() as db:
        owner = await db.get(User, user.id)
        owner.openid = "legacy-wechat"
        await db.commit()
        identity = await identity_service.bind_identity(
            db,
            user=owner,
            provider="wechat",
            namespace="test",
            subject="legacy-wechat",
        )
        await identity_service.unbind_identity(
            db, user_id=owner.id, identity_id=identity.id
        )
        assert (await db.get(User, owner.id)).openid is None


@pytest.mark.asyncio
async def test_github_link_rejects_sessions_revoked_during_authorization(
    flow, monkeypatch
):
    client, _, user, *_ = flow
    from app.core.security import set_user_nbf

    start = await client.post("/api/v1/users/me/identities/github/start", json={})
    await set_user_nbf(user.id)

    async def exchange(*args, **kwargs):
        return {"id": 99}

    monkeypatch.setattr(github_oauth_service, "exchange_github_code", exchange)
    callback = await client.get(
        "/api/v1/auth/github/callback",
        params={
            "state": start.json()["state"],
            "code": "code",
        },
    )
    assert "account_unavailable" in callback.headers["location"]


@pytest.mark.asyncio
async def test_email_change_can_resend_after_single_use_step_up(flow):
    client, _, user, email, *_ = flow
    token = await user_auth_service.issue_step_up_token(user.id, email.id)
    start = await client.post(
        "/api/v1/users/me/identities/email/change/start",
        json={
            "email": "new@example.com",
            "step_up_token": token,
        },
    )
    assert start.status_code == 200
    await cache.delete_strict(
        email_otp_service._resend_key("user", "bind", "new@example.com")
    )
    resent = await client.post(
        "/api/v1/users/me/identities/email/change/start",
        json={
            "email": "new@example.com",
            "challenge_id": start.json()["challenge_id"],
        },
    )
    assert resent.status_code == 200
    assert start.json()["challenge_id"] != resent.json()["challenge_id"]


@pytest.mark.asyncio
async def test_browser_email_login_rejects_admin_origin(flow):
    client, *_ = flow
    response = await client.post(
        "/api/v1/auth/email/start",
        headers={
            "Origin": "https://admin.example.com",
        },
        json={
            "email": "reader@example.com",
            "captcha_ticket": "a" * 32,
        },
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_browser_email_login_requires_a_slider_ticket(flow):
    client, *_ = flow
    missing = await client.post(
        "/api/v1/auth/email/start",
        headers={"Origin": "http://user.test"},
        json={"email": "reader@example.com"},
    )
    assert missing.status_code == 422

    challenge_response = await client.post(
        "/api/v1/auth/captcha/slider/start",
        headers={"Origin": "http://user.test"},
    )
    assert challenge_response.status_code == 200
    challenge_id = challenge_response.json()["captcha_id"]
    stored = await cache.get_strict(
        slider_captcha_service._challenge_key(challenge_id)
    )
    target_x = int(stored["target_x"])
    verification = await client.post(
        "/api/v1/auth/captcha/slider/verify",
        headers={"Origin": "http://user.test"},
        json={
            "captcha_id": challenge_id,
            "offset": target_x,
            "trajectory": [
                {"x": 0, "y": 16, "t": 0},
                {"x": target_x // 2, "y": 18, "t": 250},
                {"x": target_x, "y": 16, "t": 610},
            ],
        },
    )
    assert verification.status_code == 200, verification.json()
    ticket = verification.json()["ticket"]

    started = await client.post(
        "/api/v1/auth/email/start",
        headers={"Origin": "http://user.test"},
        json={
            "email": "reader@example.com",
            "captcha_ticket": ticket,
            "accepted_terms": True,
            "agreement_version": "2026-11-20",
            "privacy_version": "2026-11-20",
        },
    )
    assert started.status_code == 200
    assert len(started.json()["challenge_id"]) == 32
