import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.cache import CacheUnavailableError, cache
from app.core.config import settings

_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
_TOKEN_URL = "https://github.com/login/oauth/access_token"
_USER_URL = "https://api.github.com/user"


class GithubOAuthError(ValueError):
    pass


def _state_key(state: str) -> str:
    return f"auth:github:state:{state}"


async def start_github_oauth(
    *,
    mode: str,
    user_id: int | None,
    return_to: str,
    extra: dict[str, Any] | None = None,
) -> tuple[str, str]:
    if not settings.GITHUB_CLIENT_ID or not settings.GITHUB_CLIENT_SECRET:
        raise GithubOAuthError("GitHub 登录暂未配置")
    state = secrets.token_urlsafe(32)
    context = {
        "mode": mode,
        "user_id": user_id,
        "return_to": return_to,
        **(extra or {}),
        "code_verifier": secrets.token_urlsafe(48),
    }
    try:
        await cache.set_strict(
            _state_key(state), context, ttl=settings.GITHUB_OAUTH_STATE_TTL_SEC
        )
    except CacheUnavailableError as exc:
        raise GithubOAuthError("登录服务暂时不可用，请稍后重试") from exc
    query = urlencode(
        {
            "client_id": settings.GITHUB_CLIENT_ID,
            "redirect_uri": settings.GITHUB_OAUTH_CALLBACK_URL,
            "scope": "read:user",
            "state": state,
            "code_challenge": base64.urlsafe_b64encode(
                hashlib.sha256(context["code_verifier"].encode()).digest()
            )
            .rstrip(b"=")
            .decode(),
            "code_challenge_method": "S256",
        }
    )
    return f"{_AUTHORIZE_URL}?{query}", state


async def consume_oauth_state(state: str) -> dict[str, Any]:
    try:
        context = await cache.get_strict(_state_key(state))
        if not isinstance(context, dict):
            raise GithubOAuthError("GitHub 登录状态已失效，请重试")
        if await cache.delete_strict(_state_key(state)) != 1:
            raise GithubOAuthError("GitHub 登录状态已失效，请重试")
        return context
    except CacheUnavailableError as exc:
        raise GithubOAuthError("登录服务暂时不可用，请稍后重试") from exc


async def exchange_github_code(code: str, *, code_verifier: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            token_response = await client.post(
                _TOKEN_URL,
                headers={"Accept": "application/json"},
                data={
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "client_secret": settings.GITHUB_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": settings.GITHUB_OAUTH_CALLBACK_URL,
                    "code_verifier": code_verifier,
                },
            )
            token_response.raise_for_status()
            access_token = str(token_response.json().get("access_token") or "")
            if not access_token:
                raise GithubOAuthError("GitHub 授权失败，请重试")
            user_response = await client.get(
                _USER_URL,
                headers={
                    "Accept": "application/vnd.github+json",
                    "Authorization": f"Bearer {access_token}",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
            user_response.raise_for_status()
            data = user_response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GithubOAuthError("GitHub 登录服务暂时不可用") from exc
    if not isinstance(data, dict) or not data.get("id"):
        raise GithubOAuthError("GitHub 账号信息无效")
    return data
