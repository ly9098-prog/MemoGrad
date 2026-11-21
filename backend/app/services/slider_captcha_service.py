import base64
import hashlib
import io
import random
from dataclasses import dataclass
from uuid import uuid4

from PIL import Image, ImageDraw, ImageFilter
from starlette.concurrency import run_in_threadpool

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.services.auth_attempt_guard import (
    AuthAttempt,
    AuthAttemptBusyError,
    serialize_ip_attempts,
)

DOMAINS = {"user", "admin"}
IMAGE_WIDTH = 320
IMAGE_HEIGHT = 160
PIECE_SIZE = 48
PIECE_MARGIN = 14
MIN_PIECE_OFFSET = 64
TARGET_TOLERANCE = 6
_RNG = random.SystemRandom()


class SliderCaptchaError(ValueError):
    pass


class SliderCaptchaRateLimitError(SliderCaptchaError):
    pass


class SliderCaptchaUnavailableError(SliderCaptchaError):
    pass


@dataclass(frozen=True)
class IssuedSliderCaptcha:
    captcha_id: str
    background_image: str
    puzzle_image: str
    width: int
    height: int
    piece_size: int
    piece_y: int
    expires_in: int


@dataclass(frozen=True)
class IssuedCaptchaTicket:
    ticket: str
    expires_in: int


def _ip_digest(client_ip: str) -> str:
    return hashlib.sha256(client_ip.encode("utf-8")).hexdigest()


def _challenge_key(captcha_id: str) -> str:
    return f"auth:slider:challenge:{captcha_id}"


def _ticket_key(ticket: str) -> str:
    return f"auth:slider:ticket:{ticket}"


def _failure_key(domain: str, client_ip: str) -> str:
    return f"auth:slider:fail:{domain}:{_ip_digest(client_ip)}"


def _lock_key(domain: str, client_ip: str) -> str:
    return f"auth:slider:lock:{domain}:{_ip_digest(client_ip)}"


def _issue_rate_key(domain: str, client_ip: str) -> str:
    return f"auth:slider:issue:{domain}:{_ip_digest(client_ip)}"


async def _assert_ip_unlocked(domain: str, client_ip: str) -> None:
    try:
        locked = await cache.get_strict(_lock_key(domain, client_ip))
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试") from exc
    if locked:
        raise SliderCaptchaRateLimitError("操作过于频繁，请稍后再试")


def _random_color(low: int = 40, high: int = 225) -> tuple[int, int, int]:
    return tuple(_RNG.randrange(high - low + 1) + low for _ in range(3))


def _pick_target_x() -> int:
    max_target_x = IMAGE_WIDTH - PIECE_SIZE - PIECE_MARGIN
    return _RNG.randrange(PIECE_MARGIN + MIN_PIECE_OFFSET, max_target_x + 1)


def _build_background() -> tuple[Image.Image, int, int]:
    left = _random_color(30, 150)
    right = _random_color(90, 235)
    image = Image.new("RGB", (IMAGE_WIDTH, IMAGE_HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(IMAGE_HEIGHT):
        ratio = y / max(1, IMAGE_HEIGHT - 1)
        color = tuple(
            round(left[index] * (1 - ratio) + right[index] * ratio)
            for index in range(3)
        )
        draw.line((0, y, IMAGE_WIDTH, y), fill=color)

    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shapes = ImageDraw.Draw(overlay)
    for _ in range(16):
        x = _RNG.randrange(IMAGE_WIDTH + 80) - 40
        y = _RNG.randrange(IMAGE_HEIGHT + 60) - 30
        radius = _RNG.randrange(44) + 14
        color = (*_random_color(120, 255), _RNG.randrange(55) + 24)
        shapes.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
    for _ in range(7):
        points = [
            (
                _RNG.randrange(IMAGE_WIDTH),
                _RNG.randrange(IMAGE_HEIGHT),
            )
            for _ in range(4)
        ]
        shapes.line(points, fill=(*_random_color(180, 255), 110), width=2)
        arc_x = _RNG.randrange(IMAGE_WIDTH - 30)
        arc_y = _RNG.randrange(IMAGE_HEIGHT - 30)
        shapes.arc(
            (
                arc_x,
                arc_y,
                arc_x + 30 + _RNG.randrange(60),
                arc_y + 30 + _RNG.randrange(60),
            ),
            start=_RNG.randrange(360),
            end=_RNG.randrange(360),
            fill=(*_random_color(180, 255), 100),
            width=2,
        )
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    noise = Image.effect_noise(image.size, 22).convert("RGB")
    image = Image.blend(image, noise, 0.06).filter(ImageFilter.GaussianBlur(0.45))
    target_x = _pick_target_x()
    target_y = _RNG.randrange(IMAGE_HEIGHT - PIECE_SIZE - PIECE_MARGIN * 2) + PIECE_MARGIN
    return image, target_x, target_y


def _encode_png(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _render_puzzle(
    background: Image.Image, target_x: int, target_y: int
) -> tuple[Image.Image, Image.Image]:
    composed = background.copy()
    region = composed.crop(
        (target_x, target_y, target_x + PIECE_SIZE, target_y + PIECE_SIZE)
    )
    mask = Image.new("L", (PIECE_SIZE, PIECE_SIZE), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        (1, 1, PIECE_SIZE - 2, PIECE_SIZE - 2),
        radius=10,
        fill=255,
    )
    # Blend into the actual texture. A fixed RGB contour gave away the target
    # X by a simple exact-colour scan, even before attempting image matching.
    shade = Image.new("RGB", region.size, _random_color(10, 55))
    dimmed = Image.blend(region, shade, _RNG.uniform(0.45, 0.62))
    composed.paste(dimmed, (target_x, target_y), mask)
    puzzle = Image.new("RGBA", (PIECE_SIZE, PIECE_SIZE), (0, 0, 0, 0))
    puzzle.paste(region.convert("RGBA"), (0, 0), mask)
    return composed, puzzle


def _render_challenge() -> tuple[str, str, int, int]:
    background, target_x, target_y = _build_background()
    composed, puzzle = _render_puzzle(background, target_x, target_y)
    return _encode_png(composed), _encode_png(puzzle), target_x, target_y


def _trajectory_is_plausible(
    trajectory: list[dict[str, int]], *, offset: int
) -> bool:
    if len(trajectory) < 2:
        return False
    times = [point["t"] for point in trajectory]
    x_values = [point["x"] for point in trajectory]
    y_values = [point["y"] for point in trajectory]
    if any(current < previous for previous, current in zip(times, times[1:])):
        return False
    duration = times[-1] - times[0]
    if duration < 180 or duration > 120000:
        return False
    if abs(x_values[0]) > 8 or abs(x_values[-1] - offset) > 3:
        return False
    if max(x_values) > IMAGE_WIDTH or min(x_values) < 0:
        return False
    if max(y_values) - min(y_values) > 120:
        return False
    if offset >= 24 and len(set(x_values)) < 2:
        return False
    return True


async def issue_challenge(*, domain: str, client_ip: str) -> IssuedSliderCaptcha:
    if domain not in DOMAINS:
        raise SliderCaptchaError("安全验证域无效")
    await _assert_ip_unlocked(domain, client_ip)
    try:
        allowed = await cache.reserve_rate_limits_strict(
            [
                (
                    _issue_rate_key(domain, client_ip),
                    settings.SLIDER_CAPTCHA_IP_HOURLY_LIMIT,
                    3600,
                )
            ]
        )
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试") from exc
    if not allowed:
        raise SliderCaptchaRateLimitError("安全验证请求过于频繁，请稍后再试")

    background_image, puzzle_image, target_x, target_y = await run_in_threadpool(
        _render_challenge
    )
    captcha_id = uuid4().hex
    challenge = {
        "domain": domain,
        "ip_digest": _ip_digest(client_ip),
        "target_x": target_x,
    }
    try:
        await cache.set_strict(
            _challenge_key(captcha_id),
            challenge,
            ttl=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
        )
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试") from exc
    return IssuedSliderCaptcha(
        captcha_id=captcha_id,
        background_image=background_image,
        puzzle_image=puzzle_image,
        width=IMAGE_WIDTH,
        height=IMAGE_HEIGHT,
        piece_size=PIECE_SIZE,
        piece_y=target_y,
        expires_in=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
    )


async def verify_challenge(
    *,
    captcha_id: str,
    offset: int,
    trajectory: list[dict[str, int]],
    domain: str,
    client_ip: str,
) -> IssuedCaptchaTicket:
    try:
        async with serialize_ip_attempts(f"{_lock_key(domain, client_ip)}:attempt") as attempt:
            return await _verify_challenge(
                captcha_id=captcha_id,
                offset=offset,
                trajectory=trajectory,
                domain=domain,
                client_ip=client_ip,
                attempt=attempt,
            )
    except AuthAttemptBusyError as exc:
        raise SliderCaptchaRateLimitError(str(exc)) from exc
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试") from exc


async def _verify_challenge(
    *,
    captcha_id: str,
    offset: int,
    trajectory: list[dict[str, int]],
    domain: str,
    client_ip: str,
    attempt: AuthAttempt,
) -> IssuedCaptchaTicket:
    if domain not in DOMAINS:
        raise SliderCaptchaError("安全验证域无效")
    lock_key = f"{_challenge_key(captcha_id)}:lock"
    owner = uuid4().hex
    try:
        acquired = await cache.acquire_lock_strict(lock_key, owner, ttl=10)
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试") from exc
    if not acquired:
        raise SliderCaptchaRateLimitError("安全验证处理中，请稍后重试")
    attempt.locks.append((lock_key, owner))
    try:
        if await attempt.read(_lock_key(domain, client_ip)):
            raise SliderCaptchaRateLimitError("操作过于频繁，请稍后再试")
        key = _challenge_key(captcha_id)
        challenge = await attempt.read(key)
        if not isinstance(challenge, dict):
            raise SliderCaptchaError("安全验证已失效，请刷新后重试")
        if (
            challenge.get("domain") != domain
            or challenge.get("ip_digest") != _ip_digest(client_ip)
        ):
            raise SliderCaptchaError("安全验证已失效，请刷新后重试")
        valid = (
            abs(int(challenge.get("target_x", -100)) - offset) <= TARGET_TOLERANCE
            and _trajectory_is_plausible(trajectory, offset=offset)
        )
        if not valid:
            locked = await attempt.record_failure(
                challenge_key=key,
                failure_key=_failure_key(domain, client_ip),
                ip_lock_key=_lock_key(domain, client_ip),
                max_attempts=settings.SLIDER_CAPTCHA_MAX_ATTEMPTS,
                challenge_ttl=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
            )
            if locked:
                raise SliderCaptchaRateLimitError("验证失败次数过多，请稍后再试")
            raise SliderCaptchaError("滑块位置不正确，请重试")

        ticket = uuid4().hex
        await attempt.commit(
            deletes=[key, f"{key}:attempts", _failure_key(domain, client_ip)],
            values=[(
                _ticket_key(ticket),
                {"domain": domain, "ip_digest": _ip_digest(client_ip)},
                settings.SLIDER_CAPTCHA_EXPIRE_SEC,
            )],
        )
        return IssuedCaptchaTicket(
            ticket=ticket,
            expires_in=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
        )
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试") from exc
    finally:
        await cache.release_lock(lock_key, owner)


async def consume_ticket(*, ticket: str, domain: str, client_ip: str) -> None:
    if domain not in DOMAINS:
        raise SliderCaptchaError("安全验证域无效")
    key = _ticket_key(ticket)
    try:
        async with serialize_ip_attempts(f"{key}:lock") as attempt:
            if await attempt.read(_lock_key(domain, client_ip)):
                raise SliderCaptchaRateLimitError("操作过于频繁，请稍后再试")
            value = await attempt.read(key)
            if not isinstance(value, dict):
                raise SliderCaptchaError("安全验证已失效，请重新完成滑块验证")
            if (
                value.get("domain") != domain
                or value.get("ip_digest") != _ip_digest(client_ip)
            ):
                raise SliderCaptchaError("安全验证已失效，请重新完成滑块验证")
            await attempt.commit(deletes=[key])
    except AuthAttemptBusyError as exc:
        raise SliderCaptchaRateLimitError(str(exc)) from exc
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试") from exc
