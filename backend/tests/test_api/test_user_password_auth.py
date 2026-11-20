import asyncio
import json

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import auth_password
from app.core.cache import cache
from app.core.config import settings
from app.core.database import Base, get_db
from app.services import (
    email_otp_service,
    slider_captcha_service,
    user_password_service,
)

TEST_PASSWORD = "MemoGrad" + "2026#Test"


@pytest_asyncio.fixture()
async def password_client(tmp_path, monkeypatch):
    import app.models  # noqa: F401

    monkeypatch.setattr(cache, "_enabled", False)
    cache._local.clear()
    monkeypatch.setattr(settings, "USER_WEB_BASE_URL", "http://user.test")
    monkeypatch.setattr(email_otp_service.secrets, "randbelow", lambda _: 123456)

    async def deliver(**kwargs):
        return None

    async def consume_ticket(**kwargs):
        return None

    monkeypatch.setattr(email_otp_service, "send_auth_email", deliver)
    monkeypatch.setattr(slider_captcha_service, "consume_ticket", consume_ticket)

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'password.db'}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def database():
        async with factory() as session:
            yield session

    app = FastAPI()
    app.include_router(auth_password.router)
    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://user.test",
        headers={"Origin": "http://user.test"},
    ) as client:
        yield client, factory
    await engine.dispose()
    cache._local.clear()


def registration_payload(
    *,
    username: str = "study-user",
    email: str = "study@example.com",
) -> dict:
    return {
        "username": username,
        "email": email,
        "password": TEST_PASSWORD,
        "captcha_ticket": "a" * 32,
        "accepted_terms": True,
        "agreement_version": "2026-11-20",
        "privacy_version": "2026-11-20",
    }


@pytest.mark.asyncio
async def test_password_registration_verifies_email_and_logs_in(password_client):
    client, _factory = password_client
    started = await client.post(
        "/api/v1/auth/password/register/start",
        json=registration_payload(),
    )
    assert started.status_code == 200, started.json()

    challenge = await cache.get_strict(
        email_otp_service._challenge_key(started.json()["challenge_id"])
    )
    assert challenge["metadata"]["username"] == "study-user"
    serialized = json.dumps(challenge)
    assert TEST_PASSWORD not in serialized
    assert challenge["metadata"]["password_hash"].startswith("$2")

    verified = await client.post(
        "/api/v1/auth/password/register/verify",
        json={
            "challenge_id": started.json()["challenge_id"],
            "code": "123456",
            "client": "web",
        },
    )
    assert verified.status_code == 200, verified.json()
    assert verified.json()["user"]["nickname"] == "study-user"
    assert {
        identity["provider"] for identity in verified.json()["user"]["identities"]
    } == {"email", "password"}
    assert client.cookies.get("user_refresh_token")

    logged_in = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "STUDY-USER",
            "password": TEST_PASSWORD,
            "client": "web",
        },
    )
    assert logged_in.status_code == 200, logged_in.json()
    assert logged_in.json()["user"]["id"] == verified.json()["user"]["id"]

    email_login = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "study@example.com",
            "password": TEST_PASSWORD,
            "client": "web",
        },
    )
    assert email_login.status_code == 200


@pytest.mark.asyncio
async def test_password_login_rejects_wrong_password_without_exposing_account_state(
    password_client,
):
    client, _factory = password_client
    started = await client.post(
        "/api/v1/auth/password/register/start",
        json=registration_payload(),
    )
    verified = await client.post(
        "/api/v1/auth/password/register/verify",
        json={
            "challenge_id": started.json()["challenge_id"],
            "code": "123456",
            "client": "web",
        },
    )
    assert verified.status_code == 200

    wrong = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "study-user",
            "password": "WrongPassword9!",
            "client": "web",
        },
    )
    unknown = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "missing-user",
            "password": "WrongPassword9!",
            "client": "web",
        },
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"] == "账号或密码错误"


@pytest.mark.asyncio
async def test_registration_rejects_an_existing_username(password_client):
    client, _factory = password_client
    first = await client.post(
        "/api/v1/auth/password/register/start",
        json=registration_payload(),
    )
    verified = await client.post(
        "/api/v1/auth/password/register/verify",
        json={
            "challenge_id": first.json()["challenge_id"],
            "code": "123456",
            "client": "web",
        },
    )
    assert verified.status_code == 200

    duplicate = await client.post(
        "/api/v1/auth/password/register/start",
        json=registration_payload(email="another@example.com"),
    )
    assert duplicate.status_code == 409
    assert "账号名称" in duplicate.json()["detail"]


@pytest.mark.asyncio
async def test_password_login_rate_limits_repeated_failures(password_client):
    client, _factory = password_client
    started = await client.post(
        "/api/v1/auth/password/register/start",
        json=registration_payload(),
    )
    verified = await client.post(
        "/api/v1/auth/password/register/verify",
        json={
            "challenge_id": started.json()["challenge_id"],
            "code": "123456",
            "client": "web",
        },
    )
    assert verified.status_code == 200

    for _attempt in range(5):
        response = await client.post(
            "/api/v1/auth/password/login",
            json={
                "account": "study-user",
                "password": "WrongPassword9!",
                "client": "web",
            },
        )
        assert response.status_code == 401

    locked = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "STUDY-USER",
            "password": TEST_PASSWORD,
            "client": "web",
        },
    )
    assert locked.status_code == 429
    assert locked.headers["retry-after"] == str(settings.USER_LOGIN_WINDOW_SEC)


@pytest.mark.asyncio
async def test_password_login_shares_one_limit_across_username_and_email_aliases(
    password_client,
    monkeypatch,
):
    client, _factory = password_client

    async def skip_simulated_hash(_password):
        return None

    monkeypatch.setattr(
        user_password_service,
        "simulate_password_verify",
        skip_simulated_hash,
    )
    started = await client.post(
        "/api/v1/auth/password/register/start",
        json=registration_payload(),
    )
    verified = await client.post(
        "/api/v1/auth/password/register/verify",
        json={
            "challenge_id": started.json()["challenge_id"],
            "code": "123456",
            "client": "web",
        },
    )
    assert verified.status_code == 200

    for account in (
        "study-user",
        "study@example.com",
        "STUDY-USER",
        "study@example.com",
        "study-user",
    ):
        response = await client.post(
            "/api/v1/auth/password/login",
            json={
                "account": account,
                "password": "WrongPassword9!",
                "client": "web",
            },
        )
        assert response.status_code == 401

    alias_rejected = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "study@example.com",
            "password": TEST_PASSWORD,
            "client": "web",
        },
    )
    assert alias_rejected.status_code == 401
    assert alias_rejected.json()["detail"] == "账号或密码错误"

    for index in range(6):
        missing = await client.post(
            "/api/v1/auth/password/login",
            json={
                "account": f"unknown-{index}",
                "password": "WrongPassword9!",
                "client": "web",
            },
        )
        assert missing.status_code == 401
        assert missing.json()["detail"] == "账号或密码错误"


@pytest.mark.asyncio
async def test_password_login_success_clears_all_identity_alias_failures(
    password_client,
):
    client, _factory = password_client
    started = await client.post(
        "/api/v1/auth/password/register/start",
        json=registration_payload(),
    )
    verified = await client.post(
        "/api/v1/auth/password/register/verify",
        json={
            "challenge_id": started.json()["challenge_id"],
            "code": "123456",
            "client": "web",
        },
    )
    assert verified.status_code == 200

    for _attempt in range(4):
        response = await client.post(
            "/api/v1/auth/password/login",
            json={
                "account": "study-user",
                "password": "WrongPassword9!",
                "client": "web",
            },
        )
        assert response.status_code == 401

    email_success = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "study@example.com",
            "password": TEST_PASSWORD,
            "client": "web",
        },
    )
    assert email_success.status_code == 200

    one_more_failure = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "study-user",
            "password": "WrongPassword9!",
            "client": "web",
        },
    )
    assert one_more_failure.status_code == 401
    recovered = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "study-user",
            "password": TEST_PASSWORD,
            "client": "web",
        },
    )
    assert recovered.status_code == 200


@pytest.mark.asyncio
async def test_password_login_rate_limits_account_spraying_from_one_ip(
    password_client,
    monkeypatch,
):
    client, _factory = password_client

    async def skip_simulated_hash(_password):
        return None

    monkeypatch.setattr(
        user_password_service,
        "simulate_password_verify",
        skip_simulated_hash,
    )
    for index in range(settings.USER_LOGIN_MAX_FAILURES):
        response = await client.post(
            "/api/v1/auth/password/login",
            json={
                "account": f"missing-{index}",
                "password": "WrongPassword9!",
                "client": "web",
            },
        )
        assert response.status_code == 401

    blocked = await client.post(
        "/api/v1/auth/password/login",
        json={
            "account": "missing-final",
            "password": "WrongPassword9!",
            "client": "web",
        },
    )
    assert blocked.status_code == 429
    assert blocked.headers["retry-after"] == str(settings.USER_LOGIN_WINDOW_SEC)


@pytest.mark.asyncio
async def test_password_login_reserves_rate_limit_before_concurrent_verification(
    password_client,
):
    client, _factory = password_client
    payload = registration_payload(
        username="parallel-user",
        email="parallel@example.com",
    )
    started = await client.post(
        "/api/v1/auth/password/register/start",
        json=payload,
    )
    verified = await client.post(
        "/api/v1/auth/password/register/verify",
        json={
            "challenge_id": started.json()["challenge_id"],
            "code": "123456",
            "client": "web",
        },
    )
    assert verified.status_code == 200

    responses = await asyncio.gather(
        *[
            client.post(
                "/api/v1/auth/password/login",
                json={
                    "account": "parallel-user",
                    "password": "wrong-password",
                    "client": "web",
                },
            )
            for _attempt in range(12)
        ]
    )
    statuses = [response.status_code for response in responses]
    assert statuses.count(401) == 5
    assert statuses.count(429) == 7
