"""Exercise login security state using a Redis process owned by these tests."""

import asyncio
from unittest.mock import AsyncMock

import pytest
from redis.asyncio import Redis

from app.core.cache import cache
from app.core.config import settings
from app.services import email_otp_service as otp
from app.services import slider_captcha_service as slider
from tests.integration.owned_redis import OwnedRedis

pytestmark = pytest.mark.integration


@pytest.fixture
def owned_redis(monkeypatch):
    server = OwnedRedis()
    server.start()
    monkeypatch.setattr(cache, "_enabled", True)
    monkeypatch.setattr(settings, "REDIS_URL", server.url)
    monkeypatch.setattr(settings, "OTP_IP_LOCK_MAX_FAILURES", 2)
    monkeypatch.setattr(otp, "send_auth_email", AsyncMock())
    monkeypatch.setattr(otp.secrets, "randbelow", lambda _: 654321)
    try:
        yield server
    finally:
        server.stop()


@pytest.mark.parametrize("kind", ["otp", "slider"])
def test_ip_attempt_limit_is_shared_across_concurrent_challenges(
    kind, owned_redis, monkeypatch
):
    async def run():
        async with Redis.from_url(owned_redis.url) as client:
            monkeypatch.setattr(cache, "_client", client)
            if kind == "otp":
                issued = [
                    await otp.issue_otp(
                        domain="user",
                        purpose="login",
                        email=f"reader{i}@example.com",
                        client_ip="192.0.2.1",
                    )
                    for i in range(4)
                ]

                async def wrong(challenge):
                    return await otp.consume_otp(
                        domain="user",
                        purpose="login",
                        client_ip="192.0.2.1",
                        challenge_id=challenge.challenge_id,
                        code="000000",
                    )

                failure_key = otp._ip_failure_key("user", "login", "192.0.2.1")
                lock_key = otp._ip_lock_key("user", "login", "192.0.2.1")
            else:
                issued = [
                    await slider.issue_challenge(domain="user", client_ip="192.0.2.1")
                    for _ in range(4)
                ]

                async def wrong(challenge):
                    return await slider.verify_challenge(
                        domain="user",
                        client_ip="192.0.2.1",
                        captcha_id=challenge.captcha_id,
                        offset=0,
                        trajectory=[
                            {"x": 0, "y": 0, "t": 0},
                            {"x": 0, "y": 0, "t": 400},
                        ],
                    )

                failure_key = slider._failure_key("user", "192.0.2.1")
                lock_key = slider._lock_key("user", "192.0.2.1")

            # Only one more failed decision is allowed before the IP is locked.
            await cache.set_strict(failure_key, 1, ttl=900)
            results = await asyncio.gather(
                *(wrong(item) for item in issued), return_exceptions=True
            )
            assert all(isinstance(result, ValueError) for result in results)
            assert await cache.get_strict(failure_key) == 2
            assert await cache.get_strict(lock_key) == "1"
            assert 0 < await client.ttl(lock_key) <= settings.OTP_IP_LOCK_SEC
            delivery_count = otp.send_auth_email.await_count
            if kind == "otp":
                with pytest.raises(otp.OtpIpLockedError):
                    await otp.issue_otp(
                        domain="user",
                        purpose="login",
                        email="denied@example.com",
                        client_ip="192.0.2.1",
                    )
                assert otp.send_auth_email.await_count == delivery_count
            else:
                with pytest.raises(slider.SliderCaptchaRateLimitError):
                    await slider.issue_challenge(domain="user", client_ip="192.0.2.1")

    asyncio.run(run())


def test_real_redis_ticket_single_use_expiry_and_outage(owned_redis, monkeypatch):
    async def run():
        async with Redis.from_url(owned_redis.url) as client:
            monkeypatch.setattr(cache, "_client", client)
            issued = await slider.issue_challenge(domain="admin", client_ip="192.0.2.2")
            stored = await cache.get_strict(slider._challenge_key(issued.captcha_id))
            target = stored["target_x"]
            ticket = await slider.verify_challenge(
                domain="admin",
                client_ip="192.0.2.2",
                captcha_id=issued.captcha_id,
                offset=target,
                trajectory=[{"x": 0, "y": 0, "t": 0}, {"x": target, "y": 0, "t": 400}],
            )
            results = await asyncio.gather(
                *(
                    slider.consume_ticket(
                        ticket=ticket.ticket, domain="admin", client_ip="192.0.2.2"
                    )
                    for _ in range(12)
                ),
                return_exceptions=True,
            )
            assert sum(item is None for item in results) == 1
            assert (
                sum(isinstance(item, slider.SliderCaptchaError) for item in results)
                == 11
            )

            expiring = await slider.issue_challenge(
                domain="admin", client_ip="192.0.2.2"
            )
            await client.pexpire(slider._challenge_key(expiring.captcha_id), 1)
            await asyncio.sleep(0.02)
            with pytest.raises(slider.SliderCaptchaError, match="已失效"):
                await slider.verify_challenge(
                    domain="admin",
                    client_ip="192.0.2.2",
                    captcha_id=expiring.captcha_id,
                    offset=target,
                    trajectory=[
                        {"x": 0, "y": 0, "t": 0},
                        {"x": target, "y": 0, "t": 400},
                    ],
                )

            pending = await slider.issue_challenge(
                domain="admin", client_ip="192.0.2.2"
            )
            target = (
                await cache.get_strict(slider._challenge_key(pending.captcha_id))
            )["target_x"]
            expiring_ticket = await slider.verify_challenge(
                domain="admin",
                client_ip="192.0.2.2",
                captcha_id=pending.captcha_id,
                offset=target,
                trajectory=[{"x": 0, "y": 0, "t": 0}, {"x": target, "y": 0, "t": 400}],
            )
            await client.pexpire(slider._ticket_key(expiring_ticket.ticket), 1)
            await asyncio.sleep(0.02)
            with pytest.raises(slider.SliderCaptchaError, match="已失效"):
                await slider.consume_ticket(
                    ticket=expiring_ticket.ticket, domain="admin", client_ip="192.0.2.2"
                )

            owned_redis.stop()
            with pytest.raises(slider.SliderCaptchaUnavailableError):
                await slider.issue_challenge(domain="user", client_ip="192.0.2.3")
            with pytest.raises(otp.OtpUnavailableError):
                await otp.issue_otp(
                    domain="user",
                    purpose="login",
                    email="outage@example.com",
                    client_ip="192.0.2.3",
                )
            with pytest.raises(slider.SliderCaptchaUnavailableError):
                await slider.verify_challenge(
                    domain="admin",
                    client_ip="192.0.2.2",
                    captcha_id=pending.captcha_id,
                    offset=target,
                    trajectory=[
                        {"x": 0, "y": 0, "t": 0},
                        {"x": target, "y": 0, "t": 400},
                    ],
                )
            with pytest.raises(slider.SliderCaptchaUnavailableError):
                await slider.consume_ticket(
                    ticket=expiring_ticket.ticket, domain="admin", client_ip="192.0.2.2"
                )
            with pytest.raises(otp.OtpUnavailableError):
                await otp.consume_otp(
                    domain="user",
                    purpose="login",
                    client_ip="192.0.2.3",
                    challenge_id="outage-challenge",
                    code="654321",
                )

    asyncio.run(run())


@pytest.mark.parametrize("kind", ["otp", "slider"])
@pytest.mark.parametrize("correct", [False, True])
@pytest.mark.parametrize("expired_lock", ["ip", "challenge"])
def test_expired_lease_cannot_commit_after_a_successor_acquires_it(
    kind, correct, expired_lock, owned_redis, monkeypatch
):
    async def run():
        async with Redis.from_url(owned_redis.url) as client:
            monkeypatch.setattr(cache, "_client", client)
            address = "192.0.2.20"
            if kind == "otp":
                issued = await otp.issue_otp(
                    domain="user",
                    purpose="login",
                    email="lease@example.com",
                    client_ip=address,
                )
                challenge_key = otp._challenge_key(issued.challenge_id)
                failure_key = otp._ip_failure_key("user", "login", address)

                async def verify():
                    return await otp.consume_otp(
                        domain="user",
                        purpose="login",
                        client_ip=address,
                        challenge_id=issued.challenge_id,
                        code="654321" if correct else "000000",
                    )

                error_type = otp.OtpRateLimitError
            else:
                issued = await slider.issue_challenge(domain="user", client_ip=address)
                challenge_key = slider._challenge_key(issued.captcha_id)
                failure_key = slider._failure_key("user", address)
                target = (
                    (await cache.get_strict(challenge_key))["target_x"]
                    if correct
                    else 0
                )

                async def verify():
                    return await slider.verify_challenge(
                        domain="user",
                        client_ip=address,
                        captcha_id=issued.captcha_id,
                        offset=target,
                        trajectory=[
                            {"x": 0, "y": 0, "t": 0},
                            {"x": target, "y": 0, "t": 400},
                        ],
                    )

                error_type = slider.SliderCaptchaRateLimitError

            await cache.set_strict(failure_key, 1, ttl=900)
            commit = cache.commit_guarded_strict
            paused = asyncio.Event()
            resume = asyncio.Event()
            decision_locks = []

            async def pause_before_commit(**changes):
                decision_locks.extend(changes["locks"])
                paused.set()
                await resume.wait()
                return await commit(**changes)

            monkeypatch.setattr(cache, "commit_guarded_strict", pause_before_commit)
            stale = asyncio.create_task(verify())
            try:
                await asyncio.wait_for(paused.wait(), timeout=3)
                lock_key, _owner = decision_locks[0 if expired_lock == "ip" else 1]
                await client.pexpire(lock_key, 1)
                await asyncio.sleep(0.02)
                assert await cache.acquire_lock_strict(lock_key, "successor", ttl=10)
                resume.set()
                with pytest.raises(error_type, match="状态已变化"):
                    await asyncio.wait_for(stale, timeout=3)
                assert await client.get(lock_key) == b"successor"
                assert await cache.get_strict(challenge_key) is not None
                assert await cache.get_strict(failure_key) == 1
                assert await cache.get_strict(f"{challenge_key}:attempts") is None
                assert not await client.keys("auth:slider:ticket:*")
            finally:
                resume.set()
                if not stale.done():
                    stale.cancel()
                await asyncio.gather(stale, return_exceptions=True)

    asyncio.run(run())
