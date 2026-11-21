import pytest

from app.services import wechat_miniprogram_code_service


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    def __init__(self, payload: dict):
        self._payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return None

    async def get(self, *_args, **_kwargs):
        return _FakeResponse(self._payload)


@pytest.mark.asyncio
async def test_access_token_cache_ttl_never_falls_back_to_default(monkeypatch):
    stored: dict[str, int] = {}

    async def fake_get(_key):
        return None

    async def fake_set(_key, _value, ttl=None):
        stored["ttl"] = ttl

    monkeypatch.setattr(wechat_miniprogram_code_service.cache, "get_strict", fake_get)
    monkeypatch.setattr(wechat_miniprogram_code_service.cache, "set_strict", fake_set)
    monkeypatch.setattr(
        wechat_miniprogram_code_service.httpx,
        "AsyncClient",
        lambda **_kwargs: _FakeClient({"access_token": "token", "expires_in": 60}),
    )
    monkeypatch.setattr(
        wechat_miniprogram_code_service.settings,
        "WECHAT_APP_ID",
        "wx-test",
    )
    monkeypatch.setattr(
        wechat_miniprogram_code_service.settings,
        "WECHAT_APP_SECRET",
        "secret",
    )

    assert await wechat_miniprogram_code_service._access_token() == "token"
    # A near-expired upstream token must not be cached for the 300s default.
    assert stored["ttl"] == 1
