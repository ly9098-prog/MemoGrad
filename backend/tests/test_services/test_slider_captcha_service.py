import base64
import io

import pytest
import pytest_asyncio
from PIL import Image

from app.core.cache import cache
from app.core.config import settings
from app.services import slider_captcha_service


@pytest_asyncio.fixture(autouse=True)
async def local_cache(monkeypatch):
    monkeypatch.setattr(cache, "_enabled", False)
    await cache.clear()
    yield
    await cache.clear()


@pytest.fixture(autouse=True)
def deterministic_background(monkeypatch):
    image = Image.new("RGB", (320, 160), (42, 91, 120))
    monkeypatch.setattr(
        slider_captcha_service,
        "_build_background",
        lambda: (image.copy(), 120, 42),
    )


def trajectory(offset: int) -> list[dict[str, int]]:
    return [
        {"x": 0, "y": 20, "t": 0},
        {"x": offset // 2, "y": 24, "t": 280},
        {"x": offset, "y": 21, "t": 620},
    ]


@pytest.mark.asyncio
async def test_slider_challenge_verifies_once_and_returns_png_images():
    issued = await slider_captcha_service.issue_challenge(
        domain="user", client_ip="user-ip"
    )
    assert issued.captcha_id
    assert issued.background_image.startswith("data:image/png;base64,")
    assert issued.puzzle_image.startswith("data:image/png;base64,")
    for image in (issued.background_image, issued.puzzle_image):
        Image.open(
            io.BytesIO(base64.b64decode(image.split(",", 1)[1]))
        ).verify()

    ticket = await slider_captcha_service.verify_challenge(
        captcha_id=issued.captcha_id,
        offset=120,
        trajectory=trajectory(120),
        domain="user",
        client_ip="user-ip",
    )
    await slider_captcha_service.consume_ticket(
        ticket=ticket.ticket,
        domain="user",
        client_ip="user-ip",
    )
    with pytest.raises(
        slider_captcha_service.SliderCaptchaError, match="重新完成"
    ):
        await slider_captcha_service.consume_ticket(
            ticket=ticket.ticket,
            domain="user",
            client_ip="user-ip",
        )


@pytest.mark.asyncio
async def test_slider_wrong_position_does_not_issue_ticket():
    issued = await slider_captcha_service.issue_challenge(
        domain="admin", client_ip="admin-ip"
    )
    with pytest.raises(
        slider_captcha_service.SliderCaptchaError, match="位置不正确"
    ):
        await slider_captcha_service.verify_challenge(
            captcha_id=issued.captcha_id,
            offset=40,
            trajectory=trajectory(40),
            domain="admin",
            client_ip="admin-ip",
        )
    assert await cache.get_strict(
        slider_captcha_service._failure_key("admin", "admin-ip")
    ) == 1


@pytest.mark.asyncio
async def test_slider_ip_lock_applies_across_challenges(monkeypatch):
    monkeypatch.setattr(settings, "OTP_IP_LOCK_MAX_FAILURES", 2)
    issued = await slider_captcha_service.issue_challenge(
        domain="user", client_ip="locked-ip"
    )
    for _ in range(2):
        with pytest.raises(slider_captcha_service.SliderCaptchaError):
            await slider_captcha_service.verify_challenge(
                captcha_id=issued.captcha_id,
                offset=0,
                trajectory=trajectory(0),
                domain="user",
                client_ip="locked-ip",
            )
    with pytest.raises(
        slider_captcha_service.SliderCaptchaRateLimitError, match="频繁"
    ):
        await slider_captcha_service.issue_challenge(
            domain="user", client_ip="locked-ip"
        )


@pytest.mark.asyncio
async def test_slider_ticket_is_bound_to_domain_and_ip():
    issued = await slider_captcha_service.issue_challenge(
        domain="admin", client_ip="admin-ip"
    )
    ticket = await slider_captcha_service.verify_challenge(
        captcha_id=issued.captcha_id,
        offset=120,
        trajectory=trajectory(120),
        domain="admin",
        client_ip="admin-ip",
    )
    with pytest.raises(
        slider_captcha_service.SliderCaptchaError, match="重新完成"
    ):
        await slider_captcha_service.consume_ticket(
            ticket=ticket.ticket,
            domain="user",
            client_ip="admin-ip",
        )
    with pytest.raises(
        slider_captcha_service.SliderCaptchaError, match="重新完成"
    ):
        await slider_captcha_service.consume_ticket(
            ticket=ticket.ticket,
            domain="admin",
            client_ip="other-ip",
        )
