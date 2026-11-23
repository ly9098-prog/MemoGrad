from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from app.core.ai_runtime_guard import AIResourceRejectedError
from app.features import ai_repair
from app.features import llm_text_structurer
from app.features.pipeline_stages import code_structure_stage


@pytest.mark.asyncio
async def test_ai_repair_passes_admin_owner_to_shared_quota_boundary(monkeypatch):
    chat = AsyncMock(
        return_value={
            "content": json.dumps(
                {
                    "stem": "题干",
                    "options": [
                        {"key": "A", "text": "甲"},
                        {"key": "B", "text": "乙"},
                    ],
                    "answer": "A",
                },
                ensure_ascii=False,
            ),
            "tokens_used": 12,
        }
    )
    monkeypatch.setattr(ai_repair, "check_token_limit", AsyncMock(return_value=True))
    monkeypatch.setattr(ai_repair, "record_token_usage", AsyncMock())
    monkeypatch.setattr("app.ai.client.llm.chat", chat)

    await ai_repair._call_ai_for_repair(
        "题干\nA. 甲\nB. 乙\n答案：A",
        {},
        {"daily_token_limit": 1000, "monthly_token_limit": 10000},
        api_key="key",
        base_url="https://provider.example/v1",
        model_name="model",
        provider="openai_compatible",
        admin_quota_admin_id=7,
    )

    assert chat.await_args.kwargs["admin_quota_scope"] == "admin_import_ai"
    assert chat.await_args.kwargs["admin_quota_admin_id"] == 7


@pytest.mark.asyncio
async def test_code_structure_and_text_structure_share_admin_quota(monkeypatch):
    gateway_chat = AsyncMock(return_value=None)
    monkeypatch.setattr(
        code_structure_stage,
        "check_token_limit",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr("app.ai.gateway.chat_with_db_model", gateway_chat)

    await code_structure_stage._call_llm_for_structure_reconstruct(
        "for(i=0;i<n;i++){",
        {"daily_token_limit": 1000, "monthly_token_limit": 10000},
        object(),
        admin_quota_admin_id=8,
    )
    assert gateway_chat.await_args.kwargs["admin_quota_scope"] == "admin_import_ai"
    assert gateway_chat.await_args.kwargs["admin_quota_admin_id"] == 8

    gateway_chat.reset_mock()
    monkeypatch.setattr(
        llm_text_structurer,
        "check_token_limit",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(llm_text_structurer.settings, "TEXT_IMPORT_LLM_ENABLED", True)
    await llm_text_structurer.structure_text_block(
        "题干",
        db=object(),
        admin_quota_admin_id=9,
    )
    assert gateway_chat.await_args.kwargs["admin_quota_scope"] == "admin_import_ai"
    assert gateway_chat.await_args.kwargs["admin_quota_admin_id"] == 9


@pytest.mark.asyncio
async def test_ai_admission_rejection_propagates_from_import_stages(monkeypatch):
    rejected = AIResourceRejectedError("ai_admin_quota_exhausted")

    async def reject(*_args, **_kwargs):
        raise rejected

    monkeypatch.setattr(
        ai_repair,
        "check_token_limit",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr("app.ai.client.llm.chat", reject)
    with pytest.raises(AIResourceRejectedError) as repair_error:
        await ai_repair._call_ai_for_repair(
            "题干\nA. 甲\nB. 乙\n答案：A",
            {},
            {"daily_token_limit": 1000, "monthly_token_limit": 10000},
            api_key="key",
            base_url="https://provider.example/v1",
            model_name="model",
            provider="openai_compatible",
            admin_quota_admin_id=7,
        )
    assert repair_error.value is rejected

    monkeypatch.setattr(
        code_structure_stage,
        "check_token_limit",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr("app.ai.gateway.chat_with_db_model", reject)
    with pytest.raises(AIResourceRejectedError) as structure_error:
        await code_structure_stage._call_llm_for_structure_reconstruct(
            "for(i=0;i<n;i++){",
            {"daily_token_limit": 1000, "monthly_token_limit": 10000},
            object(),
            admin_quota_admin_id=8,
        )
    assert structure_error.value is rejected

    monkeypatch.setattr(
        llm_text_structurer,
        "check_token_limit",
        AsyncMock(return_value=True),
    )
    monkeypatch.setattr(llm_text_structurer.settings, "TEXT_IMPORT_LLM_ENABLED", True)
    with pytest.raises(AIResourceRejectedError) as text_error:
        await llm_text_structurer.structure_text_block(
            "题干",
            db=object(),
            admin_quota_admin_id=9,
        )
    assert text_error.value is rejected
