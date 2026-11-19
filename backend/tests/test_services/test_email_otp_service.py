import asyncio
import json

import pytest
import pytest_asyncio

from app.core.cache import cache
from app.services import email_otp_service


@pytest_asyncio.fixture(autouse=True)
async def local_cache(monkeypatch):
    monkeypatch.setattr(cache, "_enabled", False)
    await cache.clear()
    yield
    await cache.clear()


@pytest.mark.asyncio
async def test_otp_is_hashed_verified_once_and_not_logged(monkeypatch):
    messages = []

    async def capture(*, to_email, subject, text):
        messages.append((to_email, subject, text))

    monkeypatch.setattr(email_otp_service, "send_auth_email", capture)
    monkeypatch.setattr(email_otp_service.secrets, "randbelow", lambda _limit: 123456)

    issued = await email_otp_service.issue_otp(
        domain="user",
        email="user@example.com",
        purpose="login",
        client_ip="127.0.0.1",
    )
    stored = await cache.get_strict(
        email_otp_service._challenge_key(issued.challenge_id)
    )
    assert "123456" not in json.dumps(stored)
    assert "123456" in messages[0][2]

    challenge = await email_otp_service.consume_otp(
        challenge_id=issued.challenge_id,
        code="123456",
        domain="user",
        purpose="login",
    )
    assert challenge["email"] == "user@example.com"
    with pytest.raises(email_otp_service.OtpError, match="无效或已过期"):
        await email_otp_service.consume_otp(
            challenge_id=issued.challenge_id,
            code="123456",
            domain="user",
            purpose="login",
        )


@pytest.mark.asyncio
async def test_otp_invalidates_after_three_wrong_attempts(monkeypatch):
    async def capture(**_kwargs):
        return None

    monkeypatch.setattr(email_otp_service, "send_auth_email", capture)
    monkeypatch.setattr(email_otp_service.secrets, "randbelow", lambda _limit: 654321)
    issued = await email_otp_service.issue_otp(
        domain="admin",
        email="admin@example.com",
        purpose="recover",
        client_ip="127.0.0.1",
    )
    for _ in range(3):
        with pytest.raises(email_otp_service.OtpError):
            await email_otp_service.consume_otp(
                challenge_id=issued.challenge_id,
                code="000000",
                domain="admin",
                purpose="recover",
            )
    with pytest.raises(email_otp_service.OtpError, match="无效或已过期"):
        await email_otp_service.consume_otp(
            challenge_id=issued.challenge_id,
            code="654321",
            domain="admin",
            purpose="recover",
        )


@pytest.mark.asyncio
async def test_resend_invalidates_the_previous_challenge(monkeypatch):
    async def capture(**_kwargs):
        return None

    monkeypatch.setattr(email_otp_service, "send_auth_email", capture)
    codes = iter((111111, 222222))
    monkeypatch.setattr(
        email_otp_service.secrets, "randbelow", lambda _limit: next(codes)
    )
    first = await email_otp_service.issue_otp(
        domain="user",
        email="resend@example.com",
        purpose="login",
        client_ip="127.0.0.1",
    )
    await cache.delete_strict(
        email_otp_service._resend_key("user", "login", "resend@example.com")
    )
    second = await email_otp_service.issue_otp(
        domain="user",
        email="resend@example.com",
        purpose="login",
        client_ip="127.0.0.1",
    )

    with pytest.raises(email_otp_service.OtpError, match="无效或已过期"):
        await email_otp_service.consume_otp(
            challenge_id=first.challenge_id,
            code="111111",
            domain="user",
            purpose="login",
        )
    challenge = await email_otp_service.consume_otp(
        challenge_id=second.challenge_id,
        code="222222",
        domain="user",
        purpose="login",
    )
    assert challenge["email"] == "resend@example.com"


@pytest.mark.asyncio
async def test_rejected_resends_do_not_exhaust_the_domain_budget(monkeypatch):
    async def deliver(**_kwargs):
        return None

    monkeypatch.setattr(email_otp_service, "send_auth_email", deliver)
    monkeypatch.setattr(email_otp_service.settings, "OTP_USER_DOMAIN_DAILY_LIMIT", 3)
    for _ in range(5):
        try:
            await email_otp_service.issue_otp(
                domain="user",
                email="first@example.com",
                purpose="login",
                client_ip="first",
            )
        except email_otp_service.OtpRateLimitError:
            pass
    issued = await email_otp_service.issue_otp(
        domain="user", email="other@example.com", purpose="login", client_ip="other"
    )
    assert issued.challenge_id
    total_key = email_otp_service._budget_keys(
        "user", "login", "first@example.com", "first"
    )[1]
    assert await cache.get_strict(total_key) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("limited_dimension", ["ip", "email"])
async def test_local_limit_rejections_do_not_charge_the_domain(
    monkeypatch, limited_dimension
):
    async def deliver(**_kwargs):
        return None

    monkeypatch.setattr(email_otp_service, "send_auth_email", deliver)
    monkeypatch.setattr(email_otp_service.settings, "OTP_USER_DOMAIN_DAILY_LIMIT", 3)
    monkeypatch.setattr(
        email_otp_service.settings,
        "OTP_IP_HOURLY_LIMIT",
        1 if limited_dimension == "ip" else 20,
    )
    monkeypatch.setattr(
        email_otp_service.settings,
        "OTP_EMAIL_HOURLY_LIMIT",
        1 if limited_dimension == "email" else 5,
    )
    for index in range(5):
        email = (
            f"reader{index}@example.com"
            if limited_dimension == "ip"
            else "same@example.com"
        )
        await cache.delete_strict(email_otp_service._resend_key("user", "login", email))
        try:
            await email_otp_service.issue_otp(
                domain="user", email=email, purpose="login", client_ip="first"
            )
        except email_otp_service.OtpRateLimitError:
            pass
    issued = await email_otp_service.issue_otp(
        domain="user", email="other@example.com", purpose="login", client_ip="other"
    )
    assert issued.challenge_id
    total_key = email_otp_service._budget_keys(
        "user", "login", "other@example.com", "other"
    )[1]
    assert await cache.get_strict(total_key) == 2


@pytest.mark.asyncio
async def test_parallel_sends_reserve_the_domain_budget_atomically(monkeypatch):
    messages = []

    async def deliver(**kwargs):
        messages.append(kwargs)

    monkeypatch.setattr(email_otp_service, "send_auth_email", deliver)
    monkeypatch.setattr(email_otp_service.settings, "OTP_USER_DOMAIN_DAILY_LIMIT", 3)
    results = await asyncio.gather(
        *(
            email_otp_service.issue_otp(
                domain="user",
                email=f"reader{index}@example.com",
                purpose="login",
                client_ip=str(index),
            )
            for index in range(12)
        ),
        return_exceptions=True,
    )
    assert (
        sum(isinstance(result, email_otp_service.IssuedOtp) for result in results) == 3
    )
    assert len(messages) == 3
    total_key = email_otp_service._budget_keys(
        "user", "login", "unused@example.com", "unused"
    )[1]
    assert await cache.get_strict(total_key) == 3
