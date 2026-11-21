import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1 import auth_identity_bind
from app.core import security
from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import get_current_user
from app.main import app
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.services import identity_service, token_service, wechat_bind_challenge_service

client = TestClient(app)


class _Db:
    def __init__(self):
        self.execute = AsyncMock()
        self.flush = AsyncMock()
        self.commit = AsyncMock()
        self.rollback = AsyncMock()

    async def get(self, _model, _id):
        return _user()

    async def scalar(self, _statement):
        return None


async def _override_db():
    yield _Db()


def _user() -> User:
    return User(
        id=7,
        nickname="Reader",
        is_banned=False,
        deleted_at=None,
        lifecycle_status="active",
    )


async def _override_user():
    return _user()


def _origin():
    return {"Origin": settings.USER_WEB_BASE_URL}


def _poll_headers(poll_token: str) -> dict[str, str]:
    return {**_origin(), "X-Wechat-Bind-Token": poll_token}


def _start(monkeypatch):
    monkeypatch.setattr(
        auth_identity_bind,
        "read_user_nbf",
        AsyncMock(return_value=0),
    )
    monkeypatch.setattr(
        auth_identity_bind.wechat_miniprogram_code_service,
        "generate_bind_code",
        AsyncMock(return_value="data:image/png;base64,ZmFrZQ=="),
    )
    app.dependency_overrides[get_current_user] = _override_user
    response = client.post(
        "/api/v1/users/me/identities/wechat/bind/start",
        headers=_origin(),
    )
    app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 200
    return response.json()


def test_web_wechat_bind_challenge_is_pending_and_poll_secret_bound(monkeypatch):
    start = _start(monkeypatch)

    assert start["challenge_id"]
    assert start["poll_token"]
    assert start["miniprogram_path"] == "pages/wechat-bind/confirm"
    assert start["qrcode_data_url"].startswith("data:image/png;base64,")

    pending = client.get(
        f"/api/v1/users/me/identities/wechat/bind/status/{start['challenge_id']}",
        headers=_poll_headers(start["poll_token"]),
    )
    wrong_poll = client.get(
        f"/api/v1/users/me/identities/wechat/bind/status/{start['challenge_id']}",
        headers=_poll_headers("x" * 43),
    )

    assert pending.status_code == 200
    assert pending.json()["status"] == "pending"
    assert wrong_poll.status_code == 404


def test_wechat_challenge_id_rejects_unexpected_characters(monkeypatch):
    _start(monkeypatch)
    response = client.post(
        "/api/v1/auth/wechat/bind/confirm",
        json={
            "challenge_id": "bad:key\nwith-control",
            "code": "wx-code",
        },
    )

    assert response.status_code == 422


def test_miniprogram_confirmation_binds_once_and_never_auto_registers(monkeypatch):
    start = _start(monkeypatch)
    monkeypatch.setattr(
        auth_identity_bind,
        "read_user_nbf",
        AsyncMock(return_value=0),
    )
    monkeypatch.setattr(
        auth_identity_bind.user_service,
        "resolve_wechat_subject",
        AsyncMock(return_value="openid-reader"),
    )
    monkeypatch.setattr(
        auth_identity_bind.identity_service,
        "find_identity_user",
        AsyncMock(return_value=(None, None)),
    )
    monkeypatch.setattr(
        auth_identity_bind.identity_service,
        "bind_identity",
        AsyncMock(return_value=SimpleNamespace(id=41)),
    )
    set_nbf = AsyncMock()
    monkeypatch.setattr(
        auth_identity_bind,
        "set_user_nbf",
        set_nbf,
    )
    app.dependency_overrides[get_db] = _override_db
    try:
        confirmed = client.post(
            "/api/v1/auth/wechat/bind/confirm",
            json={
                "challenge_id": start["challenge_id"],
                "code": "wx-code",
            },
        )
        replay = client.post(
            "/api/v1/auth/wechat/bind/confirm",
            json={
                "challenge_id": start["challenge_id"],
                "code": "wx-code",
            },
        )
        status = client.get(
            f"/api/v1/users/me/identities/wechat/bind/status/{start['challenge_id']}",
            headers=_poll_headers(start["poll_token"]),
        )
    finally:
        app.dependency_overrides.clear()

    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "completed"
    assert replay.status_code == 404
    assert status.status_code == 200
    assert status.json()["status"] == "completed"
    set_nbf.assert_awaited_once_with(7)


def test_wechat_identity_owned_by_another_user_marks_conflict(monkeypatch):
    start = _start(monkeypatch)
    monkeypatch.setattr(
        auth_identity_bind,
        "read_user_nbf",
        AsyncMock(return_value=0),
    )
    monkeypatch.setattr(
        auth_identity_bind.user_service,
        "resolve_wechat_subject",
        AsyncMock(return_value="openid-owned"),
    )
    monkeypatch.setattr(
        auth_identity_bind.identity_service,
        "find_identity_user",
        AsyncMock(return_value=(SimpleNamespace(id=9), SimpleNamespace(id=8))),
    )
    app.dependency_overrides[get_db] = _override_db
    try:
        confirmed = client.post(
            "/api/v1/auth/wechat/bind/confirm",
            json={
                "challenge_id": start["challenge_id"],
                "code": "wx-owned",
            },
        )
        status = client.get(
            f"/api/v1/users/me/identities/wechat/bind/status/{start['challenge_id']}",
            headers=_poll_headers(start["poll_token"]),
        )
    finally:
        app.dependency_overrides.clear()

    assert confirmed.status_code == 409
    assert status.json()["status"] == "conflict"


def test_cancel_requires_the_poll_secret_and_prevents_confirmation(monkeypatch):
    start = _start(monkeypatch)
    wrong_cancel = client.post(
        f"/api/v1/users/me/identities/wechat/bind/{start['challenge_id']}/cancel",
        headers=_poll_headers("x" * 43),
    )
    cancelled = client.post(
        f"/api/v1/users/me/identities/wechat/bind/{start['challenge_id']}/cancel",
        headers=_poll_headers(start["poll_token"]),
    )
    app.dependency_overrides[get_db] = _override_db
    try:
        confirmed = client.post(
            "/api/v1/auth/wechat/bind/confirm",
            json={"challenge_id": start["challenge_id"], "code": "wx-code"},
        )
    finally:
        app.dependency_overrides.clear()

    assert wrong_cancel.status_code == 404
    assert cancelled.status_code == 200
    assert cancelled.json() == {"status": "cancelled"}
    assert confirmed.status_code == 404


def test_session_change_expires_challenge_before_wechat_exchange(monkeypatch):
    start = _start(monkeypatch)
    monkeypatch.setattr(
        auth_identity_bind,
        "read_user_nbf",
        AsyncMock(return_value=99),
    )
    resolve = AsyncMock(return_value="openid-reader")
    monkeypatch.setattr(
        auth_identity_bind.user_service,
        "resolve_wechat_subject",
        resolve,
    )
    app.dependency_overrides[get_db] = _override_db
    try:
        confirmed = client.post(
            "/api/v1/auth/wechat/bind/confirm",
            json={"challenge_id": start["challenge_id"], "code": "wx-code"},
        )
        status = client.get(
            f"/api/v1/users/me/identities/wechat/bind/status/{start['challenge_id']}",
            headers=_poll_headers(start["poll_token"]),
        )
    finally:
        app.dependency_overrides.clear()

    assert confirmed.status_code == 401
    assert status.json()["status"] == "expired"
    resolve.assert_not_awaited()


def test_challenge_consumption_is_atomic_under_concurrency():
    async def scenario():
        record, _ = await wechat_bind_challenge_service.start_challenge(7, nbf=0)
        results = await asyncio.gather(
            wechat_bind_challenge_service.consume_challenge(record["challenge_id"]),
            wechat_bind_challenge_service.consume_challenge(record["challenge_id"]),
            return_exceptions=True,
        )
        return results

    results = asyncio.run(scenario())

    assert sum(isinstance(result, dict) for result in results) == 1
    assert sum(
        isinstance(result, wechat_bind_challenge_service.WechatBindNotFoundError)
        for result in results
    ) == 1


@pytest.mark.asyncio
async def test_cancel_returns_409_after_consume_claims_and_reads_record(monkeypatch):
    record, poll_token = await wechat_bind_challenge_service.start_challenge(7, nbf=0)
    challenge_id = record["challenge_id"]
    record_read = asyncio.Barrier(2)
    resume_consume = asyncio.Event()
    get_challenge = wechat_bind_challenge_service.get_challenge
    consume_task = None

    async def pause_after_read(challenge_id):
        result = await get_challenge(challenge_id)
        if asyncio.current_task() is consume_task:
            await record_read.wait()
            await resume_consume.wait()
        return result

    monkeypatch.setattr(
        wechat_bind_challenge_service, "get_challenge", pause_after_read
    )
    consume_task = asyncio.create_task(
        wechat_bind_challenge_service.consume_challenge(challenge_id)
    )
    try:
        await asyncio.wait_for(record_read.wait(), timeout=5)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as http_client:
            cancelled = await http_client.post(
                f"/api/v1/users/me/identities/wechat/bind/{challenge_id}/cancel",
                headers=_poll_headers(poll_token),
            )
    finally:
        resume_consume.set()
        consumed = await asyncio.wait_for(consume_task, timeout=5)

    assert consumed["user_id"] == 7
    assert cancelled.status_code == 409
    assert (
        await wechat_bind_challenge_service.get_status(challenge_id, poll_token)
    )["status"] == "pending"


@pytest.mark.asyncio
async def test_cancel_claim_blocks_consume_before_cancelled_status_is_written(monkeypatch):
    record, poll_token = await wechat_bind_challenge_service.start_challenge(7, nbf=0)
    challenge_id = record["challenge_id"]
    cancel_claimed = asyncio.Barrier(2)
    resume_cancel = asyncio.Event()
    set_status = wechat_bind_challenge_service.set_status

    async def pause_before_status(challenge_id, **kwargs):
        if kwargs["status"] == "cancelled":
            await cancel_claimed.wait()
            await resume_cancel.wait()
        await set_status(challenge_id, **kwargs)

    monkeypatch.setattr(
        wechat_bind_challenge_service, "set_status", pause_before_status
    )
    cancel_task = asyncio.create_task(
        wechat_bind_challenge_service.cancel_challenge(challenge_id, poll_token)
    )
    try:
        await asyncio.wait_for(cancel_claimed.wait(), timeout=5)
        with pytest.raises(wechat_bind_challenge_service.WechatBindNotFoundError):
            await wechat_bind_challenge_service.consume_challenge(challenge_id)
    finally:
        resume_cancel.set()
        await asyncio.wait_for(cancel_task, timeout=5)

    assert (
        await wechat_bind_challenge_service.get_status(challenge_id, poll_token)
    )["status"] == "cancelled"


@pytest.mark.asyncio
async def test_consumed_challenge_poll_remains_pending_and_verifies_secret():
    record, poll_token = await wechat_bind_challenge_service.start_challenge(7, nbf=0)
    challenge_id = record["challenge_id"]
    consumed = await wechat_bind_challenge_service.consume_challenge(challenge_id)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as http_client:
        pending = await http_client.get(
            f"/api/v1/users/me/identities/wechat/bind/status/{challenge_id}",
            headers=_poll_headers(poll_token),
        )
        wrong_poll = await http_client.get(
            f"/api/v1/users/me/identities/wechat/bind/status/{challenge_id}",
            headers=_poll_headers("x" * 43),
        )
        await wechat_bind_challenge_service.set_status(
            challenge_id,
            user_id=7,
            status="completed",
            poll_digest=consumed["poll_digest"],
            identity_id=41,
        )
        completed = await http_client.get(
            f"/api/v1/users/me/identities/wechat/bind/status/{challenge_id}",
            headers=_poll_headers(poll_token),
        )

    assert pending.status_code == 200
    assert pending.json()["status"] == "pending"
    assert wrong_poll.status_code == 404
    assert completed.json()["status"] == "completed"
    assert completed.json()["identity_id"] == 41


@pytest_asyncio.fixture
async def binding_flow(monkeypatch):
    monkeypatch.setattr(cache, "_enabled", False)
    monkeypatch.setattr(
        auth_identity_bind.user_service,
        "resolve_wechat_subject",
        AsyncMock(return_value="openid-reader"),
    )
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as setup_db:
            user = _user()
            setup_db.add(user)
            await setup_db.flush()
            await identity_service.bind_identity(
                setup_db,
                user=user,
                provider="email",
                namespace="user",
                subject="reader@example.com",
            )
            await token_service.create_refresh_token(setup_db, user.id)
        access_token, _ = security.create_token(7)
        record, poll_token = await wechat_bind_challenge_service.start_challenge(7, nbf=0)
        test_app = FastAPI()
        test_app.include_router(auth_identity_bind.router, prefix="/api/v1")
        async with factory() as db:
            async def database():
                yield db

            test_app.dependency_overrides[get_db] = database
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=test_app), base_url="http://testserver"
            ) as http_client:
                yield SimpleNamespace(
                    client=http_client,
                    factory=factory,
                    db=db,
                    challenge_id=record["challenge_id"],
                    poll_token=poll_token,
                    access_token=access_token,
                )
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_nbf_failure_rolls_back_identity_and_refresh_revocation(binding_flow, monkeypatch):
    flow = binding_flow
    commits = AsyncMock(wraps=flow.db.commit)
    monkeypatch.setattr(flow.db, "commit", commits)
    observed = {}

    async def fail_nbf(*_args, **_kwargs):
        observed["commits"] = commits.await_count
        observed["identity"] = await flow.db.scalar(
            select(UserAuthIdentity.id).where(UserAuthIdentity.provider == "wechat")
        )
        observed["revoked_at"] = await flow.db.scalar(select(RefreshToken.revoked_at))
        raise CacheUnavailableError("NBF write unavailable")

    monkeypatch.setattr(cache, "advance_integer_marker_strict", fail_nbf)
    response = await flow.client.post(
        "/api/v1/auth/wechat/bind/confirm",
        json={"challenge_id": flow.challenge_id, "code": "wx-code"},
    )

    assert response.status_code == 503
    async with flow.factory() as verify_db:
        assert await verify_db.scalar(
            select(UserAuthIdentity.id).where(UserAuthIdentity.provider == "wechat")
        ) is None
        assert await verify_db.scalar(select(RefreshToken.revoked_at)) is None
        user, _ = await security.authenticate_user_token(flow.access_token, verify_db)
        assert user.id == 7
    assert observed["commits"] == 0
    assert observed["identity"] is not None
    assert observed["revoked_at"] is not None
    commits.assert_not_awaited()
    status = await wechat_bind_challenge_service.get_status(flow.challenge_id, flow.poll_token)
    assert status["status"] == "expired"
    assert status["message"]
    assert status["identity_id"] is None
    replay = await flow.client.post(
        "/api/v1/auth/wechat/bind/confirm",
        json={"challenge_id": flow.challenge_id, "code": "wx-replay"},
    )
    assert replay.status_code == 404


@pytest.mark.asyncio
async def test_success_commits_binding_and_refresh_revocation_after_nbf(binding_flow, monkeypatch):
    flow = binding_flow
    commits = AsyncMock(wraps=flow.db.commit)
    monkeypatch.setattr(flow.db, "commit", commits)
    advance_nbf = cache.advance_integer_marker_strict
    observed = {}

    async def check_nbf_order(*args, **kwargs):
        observed["commits"] = commits.await_count
        observed["identity"] = await flow.db.scalar(
            select(UserAuthIdentity.id).where(UserAuthIdentity.provider == "wechat")
        )
        observed["revoked_at"] = await flow.db.scalar(select(RefreshToken.revoked_at))
        return await advance_nbf(*args, **kwargs)

    monkeypatch.setattr(cache, "advance_integer_marker_strict", check_nbf_order)
    response = await flow.client.post(
        "/api/v1/auth/wechat/bind/confirm",
        json={"challenge_id": flow.challenge_id, "code": "wx-code"},
    )

    assert response.status_code == 200
    assert observed["commits"] == 0
    assert observed["identity"] is not None
    assert observed["revoked_at"] is not None
    commits.assert_awaited_once()
    async with flow.factory() as verify_db:
        assert await verify_db.scalar(
            select(UserAuthIdentity.id).where(UserAuthIdentity.provider == "wechat")
        ) == response.json()["identity_id"]
        assert await verify_db.scalar(select(RefreshToken.revoked_at)) is not None
        with pytest.raises(HTTPException) as rejected:
            await security.authenticate_user_token(flow.access_token, verify_db)
        assert rejected.value.status_code == 401
    await flow.client.post(
        "/api/v1/auth/wechat/bind/confirm",
        json={"challenge_id": flow.challenge_id, "code": "wx-replay"},
    )
    status = await wechat_bind_challenge_service.get_status(flow.challenge_id, flow.poll_token)
    assert status["status"] == "completed"


def test_confirm_rate_limit_rejects_after_bounded_attempts(monkeypatch):
    start = _start(monkeypatch)
    calls = 0

    async def limited(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return calls <= 10

    monkeypatch.setattr(
        wechat_bind_challenge_service.cache,
        "reserve_rate_limits_strict",
        limited,
    )
    monkeypatch.setattr(
        auth_identity_bind.user_service,
        "resolve_wechat_subject",
        AsyncMock(side_effect=ValueError("微信登录失败")),
    )
    statuses = [
        client.post(
            "/api/v1/auth/wechat/bind/confirm",
            json={"challenge_id": start["challenge_id"], "code": "wx-code"},
        ).status_code
        for _ in range(11)
    ]

    assert statuses[:10] == [401] * 10
    assert statuses[-1] == 429
