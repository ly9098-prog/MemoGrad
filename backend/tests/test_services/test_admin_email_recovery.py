from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from app.core.cache import cache
from app.models.admin import AdminUser
from app.services import admin_email_auth_service as service


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["password", "email"])
async def test_outstanding_recovery_token_is_invalid_after_a_security_change(
    monkeypatch, change
):
    monkeypatch.setattr(cache, "_enabled", False)
    admin = AdminUser(
        id=1,
        username="test-admin",
        password_hash="old-hash",
        is_active=True,
        email_normalized="Admin@example.com",
        email_verified_at=datetime(2026, 11, 20),
        role_id=1,
    )
    token = await service.issue_admin_recovery_token(admin)
    if change == "password":
        admin.password_hash = "replaced-hash"
    else:
        admin.email_normalized = "other@example.com"
    database = AsyncMock()
    database.get.return_value = admin
    with pytest.raises(ValueError, match="不可用"):
        await service.reset_admin_password_with_token(
            database,
            reset_token=token,
            new_password="Local-Auth-Test42",
        )
    database.commit.assert_not_awaited()
