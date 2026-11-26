import base64
import io

import pytest
import pytest_asyncio
from PIL import Image

from app.core.cache import cache
from app.core.config import settings
from app.services import slider_captcha_service as captcha


@pytest_asyncio.fixture(autouse=True)
async def local_cache(monkeypatch):
    monkeypatch.setattr(cache, "_enabled", False)
    await cache.clear()
    yield
    await cache.clear()


@pytest.fixture
def fixed_render(monkeypatch):
    rendered = captcha._RenderedChallenge(
        image="data:image/png;base64,AA==",
        thumb="data:image/png;base64,AA==",
        target_x=150,
        target_y=90,
        thumb_x=24,
        thumb_y=90,
        piece_size=64,
    )
    monkeypatch.setattr(captcha, "_render_challenge", lambda: rendered)
    return rendered


def trajectory(start_x: int, end_x: int, y: int = 90) -> list[dict[str, int]]:
    middle = (start_x + end_x) // 2
    return [
        {"x": start_x, "y": y, "t": 0},
        {"x": middle, "y": y, "t": 280},
        {"x": end_x, "y": y, "t": 620},
    ]


@pytest.mark.asyncio
async def test_issue_challenge_renders_go_captcha_images():
    issued = await captcha.issue_challenge(
        domain="user", purpose="login", email="user@example.com", client_ip="render-ip"
    )

    assert issued.image.startswith("data:image/jpeg;base64,")
    assert issued.thumb.startswith("data:image/png;base64,")
    master = Image.open(io.BytesIO(base64.b64decode(issued.image.split(",", 1)[1])))
    assert master.size == (captcha.IMAGE_WIDTH, captcha.IMAGE_HEIGHT)
    thumb = Image.open(io.BytesIO(base64.b64decode(issued.thumb.split(",", 1)[1])))
    assert thumb.format == "PNG"
    assert thumb.size == (issued.thumb_width, issued.thumb_height)
    assert issued.thumb_width == issued.thumb_height
    assert captcha.PIECE_MIN_SIZE <= issued.thumb_width <= captcha.PIECE_MAX_SIZE

    stored = await cache.get_strict(captcha._challenge_key(issued.captcha_id))
    assert 0 <= stored["target_x"] <= captcha.IMAGE_WIDTH - issued.thumb_width
    assert (
        captcha.PIECE_MARGIN
        <= stored["target_y"]
        <= captcha.IMAGE_HEIGHT - issued.thumb_width - captcha.PIECE_MARGIN
    )
    assert captcha.MIN_THUMB_X <= stored["thumb_x"] <= issued.thumb_width // 2
    assert stored["thumb_y"] == stored["target_y"]
    assert stored["purpose"] == "login"
    assert stored["email_digest"] == captcha._email_digest("user@example.com")
    assert "target_x" not in issued.__dataclass_fields__


@pytest.mark.asyncio
async def test_slider_challenge_verifies_once_and_returns_ticket(fixed_render):
    issued = await captcha.issue_challenge(
        domain="user", purpose="login", email="user@example.com", client_ip="user-ip"
    )

    ticket = await captcha.verify_challenge(
        captcha_id=issued.captcha_id,
        x=fixed_render.target_x + captcha.TARGET_PADDING,
        y=fixed_render.target_y - captcha.TARGET_PADDING,
        trajectory=trajectory(
            fixed_render.thumb_x,
            fixed_render.target_x + captcha.TARGET_PADDING,
            fixed_render.target_y - captcha.TARGET_PADDING,
        ),
        domain="user",
        client_ip="user-ip",
    )
    await captcha.consume_ticket(
        ticket=ticket.ticket,
        domain="user",
        purpose="login",
        email="user@example.com",
        client_ip="user-ip",
    )
    with pytest.raises(captcha.SliderCaptchaError, match="重新完成"):
        await captcha.consume_ticket(
            ticket=ticket.ticket,
            domain="user",
            purpose="login",
            email="user@example.com",
            client_ip="user-ip",
        )


@pytest.mark.asyncio
async def test_slider_wrong_position_does_not_issue_ticket(fixed_render):
    issued = await captcha.issue_challenge(
        domain="admin", purpose="login", email="admin@example.com", client_ip="admin-ip"
    )
    wrong_x = fixed_render.target_x + captcha.TARGET_PADDING + 1
    with pytest.raises(captcha.SliderCaptchaError, match="位置不正确"):
        await captcha.verify_challenge(
            captcha_id=issued.captcha_id,
            x=wrong_x,
            y=fixed_render.target_y,
            trajectory=trajectory(fixed_render.thumb_x, wrong_x),
            domain="admin",
            client_ip="admin-ip",
        )
    assert await cache.get_strict(captcha._failure_key("admin", "admin-ip")) == 1


@pytest.mark.asyncio
async def test_slider_wrong_vertical_position_does_not_issue_ticket(fixed_render):
    issued = await captcha.issue_challenge(
        domain="admin",
        purpose="login",
        email="admin@example.com",
        client_ip="admin-y-ip",
    )
    wrong_y = fixed_render.target_y + captcha.TARGET_PADDING + 1
    with pytest.raises(captcha.SliderCaptchaError, match="位置不正确"):
        await captcha.verify_challenge(
            captcha_id=issued.captcha_id,
            x=fixed_render.target_x,
            y=wrong_y,
            trajectory=trajectory(fixed_render.thumb_x, fixed_render.target_x, wrong_y),
            domain="admin",
            client_ip="admin-y-ip",
        )
    assert await cache.get_strict(captcha._failure_key("admin", "admin-y-ip")) == 1


@pytest.mark.parametrize("kind", ["short-duration", "out-of-bounds", "end-drift"])
@pytest.mark.asyncio
async def test_slider_rejects_implausible_trajectory(fixed_render, kind):
    start_x = fixed_render.thumb_x
    end_x = fixed_render.target_x
    y = fixed_render.target_y
    if kind == "short-duration":
        points = [
            {"x": start_x, "y": y, "t": 0},
            {"x": end_x, "y": y, "t": 100},
        ]
    elif kind == "out-of-bounds":
        points = [
            {"x": start_x, "y": y, "t": 0},
            {"x": captcha.IMAGE_WIDTH + 1, "y": y, "t": 300},
            {"x": end_x, "y": y, "t": 620},
        ]
    else:
        points = [
            {"x": start_x, "y": y, "t": 0},
            {"x": end_x - 10, "y": y, "t": 620},
        ]

    client_ip = f"trajectory-{kind}"
    issued = await captcha.issue_challenge(
        domain="user", purpose="login", email="user@example.com", client_ip=client_ip
    )
    with pytest.raises(captcha.SliderCaptchaError, match="位置不正确"):
        await captcha.verify_challenge(
            captcha_id=issued.captcha_id,
            x=end_x,
            y=y,
            trajectory=points,
            domain="user",
            client_ip=client_ip,
        )
    assert await cache.get_strict(captcha._failure_key("user", client_ip)) == 1


@pytest.mark.asyncio
async def test_slider_rejects_trajectory_not_starting_at_published_thumb(fixed_render):
    issued = await captcha.issue_challenge(
        domain="user", purpose="login", email="user@example.com", client_ip="forged-ip"
    )
    with pytest.raises(captcha.SliderCaptchaError, match="位置不正确"):
        await captcha.verify_challenge(
            captcha_id=issued.captcha_id,
            x=fixed_render.target_x,
            y=fixed_render.target_y,
            trajectory=trajectory(0, fixed_render.target_x),
            domain="user",
            client_ip="forged-ip",
        )
    assert await cache.get_strict(captcha._failure_key("user", "forged-ip")) == 1


@pytest.mark.asyncio
async def test_slider_ip_lock_applies_across_challenges(fixed_render, monkeypatch):
    monkeypatch.setattr(settings, "SLIDER_CAPTCHA_IP_LOCK_MAX_FAILURES", 2)
    issued = await captcha.issue_challenge(
        domain="user", purpose="login", email="user@example.com", client_ip="locked-ip"
    )
    for _ in range(2):
        with pytest.raises(captcha.SliderCaptchaError):
            await captcha.verify_challenge(
                captcha_id=issued.captcha_id,
                x=0,
                y=fixed_render.target_y,
                trajectory=trajectory(fixed_render.thumb_x, 0),
                domain="user",
                client_ip="locked-ip",
            )
    with pytest.raises(captcha.SliderCaptchaRateLimitError, match="频繁"):
        await captcha.issue_challenge(
            domain="user",
            purpose="login",
            email="user@example.com",
            client_ip="locked-ip",
        )


@pytest.mark.asyncio
async def test_slider_ticket_is_bound_to_domain_ip_purpose_and_email(fixed_render):
    issued = await captcha.issue_challenge(
        domain="admin", purpose="login", email="admin@example.com", client_ip="admin-ip"
    )
    ticket = await captcha.verify_challenge(
        captcha_id=issued.captcha_id,
        x=fixed_render.target_x,
        y=fixed_render.target_y,
        trajectory=trajectory(
            fixed_render.thumb_x, fixed_render.target_x, fixed_render.target_y
        ),
        domain="admin",
        client_ip="admin-ip",
    )
    with pytest.raises(captcha.SliderCaptchaError, match="重新完成"):
        await captcha.consume_ticket(
            ticket=ticket.ticket,
            domain="user",
            purpose="login",
            email="admin@example.com",
            client_ip="admin-ip",
        )
    with pytest.raises(captcha.SliderCaptchaError, match="重新完成"):
        await captcha.consume_ticket(
            ticket=ticket.ticket,
            domain="admin",
            purpose="login",
            email="admin@example.com",
            client_ip="other-ip",
        )
    with pytest.raises(captcha.SliderCaptchaError, match="重新完成"):
        await captcha.consume_ticket(
            ticket=ticket.ticket,
            domain="admin",
            purpose="activate",
            email="admin@example.com",
            client_ip="admin-ip",
        )
    with pytest.raises(captcha.SliderCaptchaError, match="重新完成"):
        await captcha.consume_ticket(
            ticket=ticket.ticket,
            domain="admin",
            purpose="login",
            email="other@example.com",
            client_ip="admin-ip",
        )
    await captcha.consume_ticket(
        ticket=ticket.ticket,
        domain="admin",
        purpose="login",
        email="admin@example.com",
        client_ip="admin-ip",
    )


@pytest.mark.asyncio
async def test_slider_rejects_invalid_purpose_and_email():
    with pytest.raises(captcha.SliderCaptchaError, match="用途"):
        await captcha.issue_challenge(
            domain="user",
            purpose="activate",
            email="user@example.com",
            client_ip="purpose-ip",
        )
    with pytest.raises(captcha.SliderCaptchaError, match="邮箱"):
        await captcha.issue_challenge(
            domain="user",
            purpose="login",
            email="not-an-email",
            client_ip="email-ip",
        )


@pytest.mark.asyncio
async def test_slider_verify_rate_limit_is_per_ip(fixed_render, monkeypatch):
    monkeypatch.setattr(settings, "SLIDER_CAPTCHA_VERIFY_IP_HOURLY_LIMIT", 1)
    first = await captcha.issue_challenge(
        domain="user",
        purpose="login",
        email="user@example.com",
        client_ip="verify-rate-ip",
    )
    second = await captcha.issue_challenge(
        domain="user",
        purpose="login",
        email="user@example.com",
        client_ip="verify-rate-ip",
    )
    with pytest.raises(captcha.SliderCaptchaError):
        await captcha.verify_challenge(
            captcha_id=first.captcha_id,
            x=0,
            y=fixed_render.target_y,
            trajectory=trajectory(fixed_render.thumb_x, 0),
            domain="user",
            client_ip="verify-rate-ip",
        )
    with pytest.raises(captcha.SliderCaptchaRateLimitError, match="频繁"):
        await captcha.verify_challenge(
            captcha_id=second.captcha_id,
            x=fixed_render.target_x,
            y=fixed_render.target_y,
            trajectory=trajectory(fixed_render.thumb_x, fixed_render.target_x),
            domain="user",
            client_ip="verify-rate-ip",
        )
