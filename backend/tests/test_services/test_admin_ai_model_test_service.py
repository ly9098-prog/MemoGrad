from types import SimpleNamespace

import pytest

from app.services import admin_ai_model_test_service as service


class _Db:
    def __init__(self, model):
        self.model = model

    async def get(self, _model_type, _model_id):
        return self.model


@pytest.mark.asyncio
async def test_saved_api_key_is_not_reused_for_a_different_base_url(monkeypatch):
    model = SimpleNamespace(
        id=7,
        deleted_at=None,
        api_base_url="https://saved.example.com/v1",
        api_key_encrypted="encrypted-key",
        provider="openai",
        feature="completion",
        features=["completion"],
    )
    decrypt_calls: list[str] = []
    monkeypatch.setattr(
        service,
        "decrypt_secret",
        lambda value: decrypt_calls.append(value) or "saved-secret",
    )
    monkeypatch.setattr(
        service,
        "validated_api_base_url",
        lambda value: value.rstrip("/"),
    )

    target, error = await service._build_target(
        api_base_url="https://changed.example.com/v1",
        api_key=None,
        model_name="gpt-test",
        model_id=7,
        db=_Db(model),
        provider=None,
        feature=None,
        features=None,
    )

    assert target.api_key == ""
    assert error is not None
    assert error["status"] == "auth_error"
    assert "重新输入 API Key" in error["message"]
    assert decrypt_calls == []


@pytest.mark.asyncio
async def test_saved_api_key_can_be_reused_for_the_same_base_url(monkeypatch):
    model = SimpleNamespace(
        id=7,
        deleted_at=None,
        api_base_url="https://saved.example.com/v1/",
        api_key_encrypted="encrypted-key",
        provider="openai",
        feature="completion",
        features=["completion"],
    )
    monkeypatch.setattr(service, "decrypt_secret", lambda _value: "saved-secret")
    monkeypatch.setattr(
        service,
        "validated_api_base_url",
        lambda value: value.rstrip("/"),
    )

    target, error = await service._build_target(
        api_base_url="https://saved.example.com/v1",
        api_key=None,
        model_name="gpt-test",
        model_id=7,
        db=_Db(model),
        provider=None,
        feature=None,
        features=None,
    )

    assert error is None
    assert target.api_key == "saved-secret"
