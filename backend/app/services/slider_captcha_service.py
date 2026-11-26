"""Slide CAPTCHA challenges compatible with the go-captcha frontend.

The image pipeline mirrors ``github.com/wenlng/go-captcha`` v2 ``slide`` mode
(Apache-2.0) and ships the same puzzle-tile assets, so the official
``go-captcha-react`` component can render the challenge unchanged. Only the
target X stays on the server; the browser receives the master image, the
puzzle tile and the tile's starting position. The tile's starting Y equals the
target Y, so the vertical coordinate is deliberately public.
"""

import base64
import hashlib
import io
import logging
import random
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import NoReturn
from uuid import uuid4

from PIL import Image
from starlette.concurrency import run_in_threadpool

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.email_address import normalize_email
from app.services.auth_attempt_guard import (
    AuthAttempt,
    AuthAttemptBusyError,
    serialize_ip_attempts,
)

logger = logging.getLogger(__name__)

DOMAINS = {"user", "admin"}
DOMAIN_PURPOSES: dict[str, frozenset[str]] = {
    "user": frozenset({"login", "register"}),
    "admin": frozenset({"login", "activate", "recover"}),
}

IMAGE_WIDTH = 300
IMAGE_HEIGHT = 220
PIECE_MIN_SIZE = 60
PIECE_MAX_SIZE = 70
PIECE_MARGIN = 5
MIN_THUMB_X = 5
TARGET_PADDING = 5
MIN_DURATION_MS = 180
MAX_DURATION_MS = 120_000
MAX_TRAJECTORY_Y_SPAN = 120
MAX_START_DRIFT = 8
MAX_END_DRIFT = 3
MIN_DISTINCT_MOVE = 24

_ASSET_ROOT = Path(__file__).resolve().parent.parent / "assets" / "go_captcha"
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
    image: str
    thumb: str
    width: int
    height: int
    thumb_width: int
    thumb_height: int
    thumb_x: int
    thumb_y: int
    expires_in: int


@dataclass(frozen=True)
class IssuedCaptchaTicket:
    ticket: str
    expires_in: int


@dataclass(frozen=True)
class _RenderedChallenge:
    image: str
    thumb: str
    target_x: int
    target_y: int
    thumb_x: int
    thumb_y: int
    piece_size: int


def _ip_digest(client_ip: str) -> str:
    return hashlib.sha256(client_ip.encode("utf-8")).hexdigest()


def _email_digest(email: str) -> str:
    return hashlib.sha256(email.encode("utf-8")).hexdigest()


def _assert_purpose(domain: str, purpose: str) -> None:
    if purpose not in DOMAIN_PURPOSES[domain]:
        raise SliderCaptchaError("安全验证用途无效")


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


def _verify_rate_key(domain: str, client_ip: str) -> str:
    return f"auth:slider:verify:{domain}:{_ip_digest(client_ip)}"


async def _assert_ip_unlocked(domain: str, client_ip: str) -> None:
    try:
        locked = await cache.get_strict(_lock_key(domain, client_ip))
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc
    if locked:
        raise SliderCaptchaRateLimitError("操作过于频繁，请稍后再试")


async def _reserve_issue_slot(domain: str, client_ip: str) -> None:
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
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc
    if not allowed:
        raise SliderCaptchaRateLimitError("安全验证请求过于频繁，请稍后再试")


async def _reserve_verify_slot(domain: str, client_ip: str) -> None:
    try:
        allowed = await cache.reserve_rate_limits_strict(
            [
                (
                    _verify_rate_key(domain, client_ip),
                    settings.SLIDER_CAPTCHA_VERIFY_IP_HOURLY_LIMIT,
                    3600,
                )
            ]
        )
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc
    if not allowed:
        raise SliderCaptchaRateLimitError("验证请求过于频繁，请稍后再试")


@lru_cache(maxsize=1)
def _load_backgrounds() -> tuple[Image.Image, ...]:
    images: list[Image.Image] = []
    for path in sorted((_ASSET_ROOT / "backgrounds").glob("*.jpg")):
        with Image.open(path) as image:
            images.append(image.convert("RGBA"))
    if not images:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试")
    return tuple(images)


@lru_cache(maxsize=1)
def _load_tiles() -> tuple[tuple[Image.Image, Image.Image, Image.Image], ...]:
    tiles: list[tuple[Image.Image, Image.Image, Image.Image]] = []
    for mask_path in sorted((_ASSET_ROOT / "tiles").glob("*_mask.png")):
        prefix = mask_path.name.removesuffix("_mask.png")
        shadow_path = _ASSET_ROOT / "tiles" / f"{prefix}_shadow.png"
        overlay_path = _ASSET_ROOT / "tiles" / f"{prefix}_overlay.png"
        with (
            Image.open(mask_path) as mask,
            Image.open(shadow_path) as shadow,
            Image.open(overlay_path) as overlay,
        ):
            tiles.append(
                (
                    mask.convert("RGBA"),
                    shadow.convert("RGBA"),
                    overlay.convert("RGBA"),
                )
            )
    if not tiles:
        raise SliderCaptchaUnavailableError("安全验证服务暂时不可用，请稍后重试")
    return tuple(tiles)


def _encode_data_uri(image: Image.Image, *, image_format: str) -> str:
    buffer = io.BytesIO()
    if image_format == "JPEG":
        image.convert("RGB").save(buffer, format="JPEG", quality=90, optimize=True)
        mime = "jpeg"
    else:
        image.save(buffer, format="PNG", optimize=True)
        mime = "png"
    payload = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/{mime};base64,{payload}"


def _pick_target_x(piece_size: int) -> int:
    """Mirror go-captcha's left dead-zone placement for basic slide mode."""
    half = piece_size // 2
    block_width = IMAGE_WIDTH - piece_size - 20
    start = max(half + PIECE_MARGIN + piece_size, half + PIECE_MARGIN)
    end = block_width - half + piece_size
    candidate = _RNG.randint(start + 20, end + 20) - half
    return max(0, min(IMAGE_WIDTH - piece_size, candidate))


def _render_challenge() -> _RenderedChallenge:
    background = _RNG.choice(_load_backgrounds())
    mask, shadow, overlay = _RNG.choice(_load_tiles())
    piece_size = _RNG.randint(PIECE_MIN_SIZE, PIECE_MAX_SIZE)

    max_crop_x = max(0, background.width - IMAGE_WIDTH)
    max_crop_y = max(0, background.height - IMAGE_HEIGHT)
    crop_x = _RNG.randint(0, max_crop_x)
    crop_y = _RNG.randint(0, max_crop_y)
    canvas = background.crop(
        (crop_x, crop_y, crop_x + IMAGE_WIDTH, crop_y + IMAGE_HEIGHT)
    )

    target_x = _pick_target_x(piece_size)
    target_y = _RNG.randint(PIECE_MARGIN, IMAGE_HEIGHT - piece_size - PIECE_MARGIN)
    thumb_x = _RNG.randint(MIN_THUMB_X, max(MIN_THUMB_X, piece_size // 2))

    shadow_piece = shadow.resize((piece_size, piece_size), Image.Resampling.BILINEAR)
    master = canvas.copy()
    master.alpha_composite(shadow_piece, (target_x, target_y))

    source = canvas.crop(
        (
            target_x,
            target_y,
            target_x + piece_size,
            target_y + piece_size,
        )
    )
    mask_piece = mask.resize((piece_size, piece_size), Image.Resampling.BILINEAR)
    overlay_piece = overlay.resize((piece_size, piece_size), Image.Resampling.BILINEAR)
    thumb = Image.new("RGBA", (piece_size, piece_size), (0, 0, 0, 0))
    thumb.paste(source, (0, 0), mask_piece.getchannel("A"))
    thumb.alpha_composite(overlay_piece)

    return _RenderedChallenge(
        image=_encode_data_uri(master, image_format="JPEG"),
        thumb=_encode_data_uri(thumb, image_format="PNG"),
        target_x=target_x,
        target_y=target_y,
        thumb_x=thumb_x,
        thumb_y=target_y,
        piece_size=piece_size,
    )


def _point_matches(target_x: int, target_y: int, x: int, y: int) -> bool:
    """Equivalent to go-captcha slide.Validate with a fixed padding."""
    return (
        target_x - TARGET_PADDING <= x <= target_x + TARGET_PADDING
        and target_y - TARGET_PADDING <= y <= target_y + TARGET_PADDING
    )


def _trajectory_is_plausible(
    trajectory: list[dict[str, int]],
    *,
    start_x: int,
    end_x: int,
) -> bool:
    if len(trajectory) < 2:
        return False
    times = [point["t"] for point in trajectory]
    x_values = [point["x"] for point in trajectory]
    y_values = [point["y"] for point in trajectory]
    if any(current < previous for previous, current in zip(times, times[1:])):
        return False
    duration = times[-1] - times[0]
    if duration < MIN_DURATION_MS or duration > MAX_DURATION_MS:
        return False
    if abs(x_values[0] - start_x) > MAX_START_DRIFT:
        return False
    if abs(x_values[-1] - end_x) > MAX_END_DRIFT:
        return False
    if max(x_values) > IMAGE_WIDTH or min(x_values) < 0:
        return False
    if max(y_values) - min(y_values) > MAX_TRAJECTORY_Y_SPAN:
        return False
    if abs(end_x - start_x) >= MIN_DISTINCT_MOVE and len(set(x_values)) < 2:
        return False
    return True


async def issue_challenge(
    *, domain: str, purpose: str, email: str, client_ip: str
) -> IssuedSliderCaptcha:
    if domain not in DOMAINS:
        raise SliderCaptchaError("安全验证域无效")
    _assert_purpose(domain, purpose)
    try:
        normalized_email = normalize_email(email)
    except ValueError as exc:
        raise SliderCaptchaError("邮箱格式无效") from exc
    await _assert_ip_unlocked(domain, client_ip)
    await _reserve_issue_slot(domain, client_ip)

    try:
        rendered = await run_in_threadpool(_render_challenge)
    except SliderCaptchaError:
        raise
    except Exception as exc:
        logger.exception(
            "go-captcha image generation failed domain=%s ip_digest=%s",
            domain,
            _ip_digest(client_ip)[:12],
        )
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc

    captcha_id = uuid4().hex
    challenge = {
        "domain": domain,
        "purpose": purpose,
        "email_digest": _email_digest(normalized_email),
        "ip_digest": _ip_digest(client_ip),
        "target_x": rendered.target_x,
        "target_y": rendered.target_y,
        "thumb_x": rendered.thumb_x,
        "thumb_y": rendered.thumb_y,
    }
    try:
        await cache.set_strict(
            _challenge_key(captcha_id),
            challenge,
            ttl=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
        )
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc
    return IssuedSliderCaptcha(
        captcha_id=captcha_id,
        image=rendered.image,
        thumb=rendered.thumb,
        width=IMAGE_WIDTH,
        height=IMAGE_HEIGHT,
        thumb_width=rendered.piece_size,
        thumb_height=rendered.piece_size,
        thumb_x=rendered.thumb_x,
        thumb_y=rendered.thumb_y,
        expires_in=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
    )


async def verify_challenge(
    *,
    captcha_id: str,
    x: int,
    y: int,
    trajectory: list[dict[str, int]],
    domain: str,
    client_ip: str,
) -> IssuedCaptchaTicket:
    if domain not in DOMAINS:
        raise SliderCaptchaError("安全验证域无效")
    await _reserve_verify_slot(domain, client_ip)
    try:
        async with serialize_ip_attempts(
            f"{_lock_key(domain, client_ip)}:attempt"
        ) as attempt:
            return await _verify_challenge(
                captcha_id=captcha_id,
                x=x,
                y=y,
                trajectory=trajectory,
                domain=domain,
                client_ip=client_ip,
                attempt=attempt,
            )
    except AuthAttemptBusyError as exc:
        raise SliderCaptchaRateLimitError(str(exc)) from exc
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc


async def _load_challenge(
    *, attempt: AuthAttempt, key: str, domain: str, client_ip: str
) -> dict:
    challenge = await attempt.read(key)
    if not isinstance(challenge, dict):
        raise SliderCaptchaError("安全验证已失效，请刷新后重试")
    if challenge.get("domain") != domain or challenge.get(
        "ip_digest"
    ) != _ip_digest(client_ip):
        raise SliderCaptchaError("安全验证已失效，请刷新后重试")
    if (
        not isinstance(challenge.get("purpose"), str)
        or challenge["purpose"] not in DOMAIN_PURPOSES[domain]
        or not isinstance(challenge.get("email_digest"), str)
    ):
        raise SliderCaptchaError("安全验证已失效，请刷新后重试")
    return challenge


async def _raise_for_invalid_position(
    *, attempt: AuthAttempt, key: str, domain: str, client_ip: str
) -> NoReturn:
    locked = await attempt.record_failure(
        challenge_key=key,
        failure_key=_failure_key(domain, client_ip),
        ip_lock_key=_lock_key(domain, client_ip),
        max_attempts=settings.SLIDER_CAPTCHA_MAX_ATTEMPTS,
        challenge_ttl=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
        ip_lock_max_failures=settings.SLIDER_CAPTCHA_IP_LOCK_MAX_FAILURES,
        ip_lock_sec=settings.SLIDER_CAPTCHA_IP_LOCK_SEC,
    )
    if locked:
        raise SliderCaptchaRateLimitError("验证失败次数过多，请稍后再试")
    raise SliderCaptchaError("滑块位置不正确，请重试")


async def _verify_challenge(
    *,
    captcha_id: str,
    x: int,
    y: int,
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
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc
    if not acquired:
        raise SliderCaptchaRateLimitError("安全验证处理中，请稍后重试")
    attempt.locks.append((lock_key, owner))
    try:
        if await attempt.read(_lock_key(domain, client_ip)):
            raise SliderCaptchaRateLimitError("操作过于频繁，请稍后再试")
        key = _challenge_key(captcha_id)
        challenge = await _load_challenge(
            attempt=attempt, key=key, domain=domain, client_ip=client_ip
        )
        valid = _point_matches(
            int(challenge.get("target_x", -10_000)),
            int(challenge.get("target_y", -10_000)),
            x,
            y,
        ) and _trajectory_is_plausible(
            trajectory,
            start_x=int(challenge.get("thumb_x", 0)),
            end_x=x,
        )
        if not valid:
            await _raise_for_invalid_position(
                attempt=attempt, key=key, domain=domain, client_ip=client_ip
            )

        ticket = uuid4().hex
        await attempt.commit(
            deletes=[key, f"{key}:attempts", _failure_key(domain, client_ip)],
            values=[
                (
                    _ticket_key(ticket),
                    {
                        "domain": domain,
                        "purpose": challenge["purpose"],
                        "email_digest": challenge["email_digest"],
                        "ip_digest": _ip_digest(client_ip),
                    },
                    settings.SLIDER_CAPTCHA_EXPIRE_SEC,
                )
            ],
        )
        return IssuedCaptchaTicket(
            ticket=ticket,
            expires_in=settings.SLIDER_CAPTCHA_EXPIRE_SEC,
        )
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc
    finally:
        await cache.release_lock(lock_key, owner)


async def consume_ticket(
    *, ticket: str, domain: str, purpose: str, email: str, client_ip: str
) -> None:
    if domain not in DOMAINS:
        raise SliderCaptchaError("安全验证域无效")
    _assert_purpose(domain, purpose)
    try:
        normalized_email = normalize_email(email)
    except ValueError as exc:
        raise SliderCaptchaError("邮箱格式无效") from exc
    email_digest = _email_digest(normalized_email)
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
                or value.get("purpose") != purpose
                or value.get("email_digest") != email_digest
                or value.get("ip_digest") != _ip_digest(client_ip)
            ):
                raise SliderCaptchaError("安全验证已失效，请重新完成滑块验证")
            await attempt.commit(deletes=[key])
    except AuthAttemptBusyError as exc:
        raise SliderCaptchaRateLimitError(str(exc)) from exc
    except CacheUnavailableError as exc:
        raise SliderCaptchaUnavailableError(
            "安全验证服务暂时不可用，请稍后重试"
        ) from exc
