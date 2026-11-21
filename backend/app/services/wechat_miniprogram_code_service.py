"""Generate a WeChat Mini Program code for a Web-initiated bind challenge."""

import base64

import httpx

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings
from app.core.log_context import get_trace_headers

_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"
_CODE_URL = "https://api.weixin.qq.com/wxa/getwxacodeunlimit"
_BIND_PAGE = "pages/wechat-bind/confirm"
_LOCAL_APP_ENVS = {"development", "local", "test", "testing"}


class WechatMiniProgramCodeError(ValueError):
    pass


def _credentials_configured() -> bool:
    return bool(
        settings.WECHAT_APP_ID
        and settings.WECHAT_APP_ID != "your-app-id-here"
        and settings.WECHAT_APP_SECRET
        and settings.WECHAT_APP_SECRET != "your-app-secret-here"
    )


async def _access_token(force_refresh: bool = False) -> str:
    key = f"wechat:miniprogram:access-token:{settings.WECHAT_APP_ID}"
    if not force_refresh:
        try:
            cached = await cache.get_strict(key)
        except CacheUnavailableError as exc:
            raise WechatMiniProgramCodeError("小程序码缓存服务暂时不可用") from exc
        if isinstance(cached, str) and cached:
            return cached

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                _TOKEN_URL,
                headers=get_trace_headers(),
                params={
                    "grant_type": "client_credential",
                    "appid": settings.WECHAT_APP_ID,
                    "secret": settings.WECHAT_APP_SECRET,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise WechatMiniProgramCodeError("小程序码服务暂时不可用") from exc

    token = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token:
        raise WechatMiniProgramCodeError("小程序码服务未返回有效凭证")
    expires_in = max(int(payload.get("expires_in") or 7200), 60)
    try:
        await cache.set_strict(key, token, ttl=min(max(expires_in - 60, 1), 7000))
    except CacheUnavailableError as exc:
        raise WechatMiniProgramCodeError("小程序码缓存服务暂时不可用") from exc
    return token


async def generate_bind_code(challenge_id: str) -> str:
    if not _credentials_configured():
        raise WechatMiniProgramCodeError("小程序码服务未配置")

    last_error = "小程序码生成失败"
    for attempt in range(2):
        token = await _access_token(force_refresh=attempt > 0)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    _CODE_URL,
                    headers=get_trace_headers(),
                    params={"access_token": token},
                    json={
                        "scene": challenge_id,
                        "page": _BIND_PAGE,
                        "check_path": settings.APP_ENV.lower() not in _LOCAL_APP_ENVS,
                    },
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise WechatMiniProgramCodeError("小程序码服务暂时不可用") from exc

        content_type = response.headers.get("content-type", "").lower()
        if content_type.startswith("image/"):
            encoded = base64.b64encode(response.content).decode("ascii")
            return f"data:{content_type.split(';', 1)[0]};base64,{encoded}"

        try:
            payload = response.json()
        except ValueError as exc:
            raise WechatMiniProgramCodeError("小程序码服务返回了无法识别的结果") from exc
        errcode = int(payload.get("errcode") or 0) if isinstance(payload, dict) else 0
        if errcode in {40001, 42001} and attempt == 0:
            try:
                await cache.delete_strict(
                    f"wechat:miniprogram:access-token:{settings.WECHAT_APP_ID}"
                )
            except CacheUnavailableError:
                pass
            last_error = "小程序凭证已刷新"
            continue
        message = payload.get("errmsg") if isinstance(payload, dict) else None
        last_error = (
            str(message).strip()[:120]
            if isinstance(message, str) and message.strip()
            else "小程序码生成失败"
        )
        break

    raise WechatMiniProgramCodeError(last_error)


def bind_page_path() -> str:
    return _BIND_PAGE
