"""Queued work must fail closed after its app account is no longer active."""

from types import SimpleNamespace

import pytest

from app.services.db_fencing import FencingRejectedError
from app.services.worker_v2_execution import verify_active_account_owner


class _Session:
    def __init__(self, user):
        self.user = user

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, _model, _user_id):
        return self.user


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "user",
    [
        None,
        SimpleNamespace(deleted_at=object(), is_banned=False),
        SimpleNamespace(deleted_at=None, is_banned=True),
    ],
)
async def test_inactive_task_owner_is_fenced(monkeypatch, user):
    import app.core.database as database

    monkeypatch.setattr(database, "async_session", lambda: _Session(user))
    task = SimpleNamespace(payload={"owner_user_id": 9})

    with pytest.raises(FencingRejectedError):
        await verify_active_account_owner(task)


@pytest.mark.asyncio
async def test_active_numeric_created_by_owner_passes(monkeypatch):
    import app.core.database as database

    owner = SimpleNamespace(deleted_at=None, is_banned=False)
    monkeypatch.setattr(database, "async_session", lambda: _Session(owner))

    await verify_active_account_owner(SimpleNamespace(payload={"created_by": "9"}))


@pytest.mark.asyncio
async def test_admin_task_owner_is_not_treated_as_app_user(monkeypatch):
    task = SimpleNamespace(payload={"created_by": "admin:9"})
    await verify_active_account_owner(task)
