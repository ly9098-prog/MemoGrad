"""Queued work must fail closed after its app account is no longer active."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.orm_base import Base
from app.models.import_pipeline import ImportPipeline
from app.models.practice_record import PracticeRecord
from app.models.user import User
from app.services.db_fencing import FencingRejectedError
from app.services.task_owner import BUSINESS_OWNER_TASK_TYPES, PIPELINE_OWNER_TASK_TYPES
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


@pytest_asyncio.fixture
async def owner_db(monkeypatch):
    import app.core.database as database

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(lambda sync_connection: Base.metadata.create_all(
                sync_connection,
                tables=[User.__table__, PracticeRecord.__table__, ImportPipeline.__table__],
            ))
        monkeypatch.setattr(database, "async_session", factory)
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


async def seed_business_task(db, task_type, *, created_by="9"):
    db.add_all([User(id=9, openid="owner"), User(id=10, openid="other")])
    if task_type == "answer_projection":
        record = PracticeRecord(
            id=21, user_id=9, question_id=1, question_version_id=1,
            subject_id=1, user_answer="A", is_correct=True,
        )
        payload = {"practice_record_id": 21, "request_id": "legacy-request"}
    else:
        record = ImportPipeline(
            pipeline_id="owned-pipeline", source_type="pdf", created_by=created_by,
        )
        payload = {"pipeline_id": "owned-pipeline"}
    db.add(record)
    await db.commit()
    return SimpleNamespace(
        task_type=task_type, task_id="queued-task", payload=payload, generation=1,
    ), record


@pytest.mark.asyncio
@pytest.mark.parametrize("task_type", sorted(BUSINESS_OWNER_TASK_TYPES))
@pytest.mark.parametrize(
    "owner_state", ["active", "banned", "soft_deleted", "hard_deleted", "missing_record"],
)
async def test_ownerless_queued_work_checks_persisted_app_account(
    owner_db, task_type, owner_state,
):
    task, record = await seed_business_task(owner_db, task_type)
    owner = await owner_db.get(User, 9)
    if owner_state == "banned":
        owner.is_banned = True
    elif owner_state == "soft_deleted":
        owner.deleted_at = datetime(2026, 1, 1)
    elif owner_state == "hard_deleted":
        await owner_db.delete(owner)
    elif owner_state == "missing_record":
        await owner_db.delete(record)
    await owner_db.commit()

    if owner_state == "active":
        await verify_active_account_owner(task)
    else:
        with pytest.raises(FencingRejectedError):
            await verify_active_account_owner(task)
    assert "owner_user_id" not in task.payload


@pytest.mark.asyncio
@pytest.mark.parametrize("task_type", sorted(BUSINESS_OWNER_TASK_TYPES))
@pytest.mark.parametrize("metadata", [
    {"owner_user_id": 10}, {"user_id": 10}, {"created_by": "admin:10"},
])
async def test_envelope_metadata_cannot_replace_persisted_app_owner(
    owner_db, task_type, metadata,
):
    task, _record = await seed_business_task(owner_db, task_type)
    task.payload.update(metadata)
    owner = await owner_db.get(User, 9)
    owner.is_banned = True
    await owner_db.commit()

    with pytest.raises(FencingRejectedError, match="user_id=9"):
        await verify_active_account_owner(task)


@pytest.mark.asyncio
@pytest.mark.parametrize("task_type", sorted(PIPELINE_OWNER_TASK_TYPES))
async def test_persisted_admin_pipeline_does_not_use_same_number_app_account(
    owner_db, task_type,
):
    task, _record = await seed_business_task(owner_db, task_type, created_by="admin:9")
    owner = await owner_db.get(User, 9)
    owner.is_banned = True
    await owner_db.commit()

    await verify_active_account_owner(task)


@pytest.mark.asyncio
@pytest.mark.parametrize("created_by", ["9", "user:9"])
async def test_ownerless_resume_recognizes_both_app_principal_formats(owner_db, created_by):
    task, _record = await seed_business_task(owner_db, "resume_pipeline", created_by=created_by)
    owner = await owner_db.get(User, 9)
    owner.is_banned = True
    await owner_db.commit()

    with pytest.raises(FencingRejectedError, match="user_id=9"):
        await verify_active_account_owner(task)


@pytest.mark.asyncio
async def test_legacy_null_pipeline_owner_preserves_existing_contract(owner_db):
    task, _record = await seed_business_task(owner_db, "resume_pipeline", created_by=None)
    await verify_active_account_owner(task)

    task.payload["owner_user_id"] = 9
    owner = await owner_db.get(User, 9)
    owner.is_banned = True
    await owner_db.commit()
    with pytest.raises(FencingRejectedError, match="user_id=9"):
        await verify_active_account_owner(task)


@pytest.mark.asyncio
@pytest.mark.parametrize("task_type", ["answer_projection", "resume_pipeline"])
async def test_deleted_business_record_is_fenced_even_with_explicit_owner(owner_db, task_type):
    task, record = await seed_business_task(owner_db, task_type)
    task.payload["owner_user_id"] = 9
    await owner_db.delete(record)
    await owner_db.commit()

    with pytest.raises(FencingRejectedError, match="business owner is missing"):
        await verify_active_account_owner(task)


@pytest.mark.asyncio
@pytest.mark.parametrize("task_type", ["answer_projection", "resume_pipeline"])
async def test_owner_guard_rejects_before_fencing_staging_or_dispatch(
    owner_db, monkeypatch, task_type,
):
    from app.services import task_queue_worker as worker
    from app.services import worker_v2_execution as execution

    task, _record = await seed_business_task(owner_db, task_type)
    owner = await owner_db.get(User, 9)
    owner.is_banned = True
    await owner_db.commit()
    version = AsyncMock()
    initialize = AsyncMock()
    resolve_staging = AsyncMock()
    dispatch = AsyncMock()
    set_context = Mock()
    monkeypatch.setattr(execution, "dispatch_v2_task", dispatch)
    namespace = dict(vars(worker), _check_worker_version_compatibility=version,
                     _init_fencing_for_task=initialize, _resolve_staging_path=resolve_staging)

    with pytest.raises(FencingRejectedError):
        await execution.run_v2_task(
            task, namespace=namespace, set_context=set_context, clear_context=Mock(),
        )
    version.assert_awaited_once_with(task)
    initialize.assert_not_awaited()
    resolve_staging.assert_not_awaited()
    dispatch.assert_not_awaited()
    set_context.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("created_by", ["9", "user:9", "admin:9", None])
async def test_resume_producer_adds_only_trusted_app_owner(owner_db, monkeypatch, created_by):
    from app.services import task_queue_worker as worker
    from app.services.task_queue_contract import EnqueueResult

    await seed_business_task(owner_db, "resume_pipeline", created_by=created_by)
    result = EnqueueResult(accepted=True, task_id="resume:retry-token")
    enqueue = AsyncMock(return_value=result)
    monkeypatch.setattr(worker, "_enqueue_v2_with_local_fallback", enqueue)

    assert await worker.enqueue_resume_pipeline(
        "owned-pipeline", "staging-object", "DS", 3, {"split": False}, "retry-token",
    ) is result
    expected_payload = {
        "pipeline_id": "owned-pipeline", "staging_object_id": "staging-object",
        "subject": "DS", "subject_id": 3, "options": {"split": False},
    }
    if created_by in {"9", "user:9"}:
        expected_payload["owner_user_id"] = 9
    enqueue.assert_awaited_once_with(
        "resume_pipeline", expected_payload, task_id="resume:retry-token", max_retries=2,
    )


@pytest.mark.asyncio
async def test_resume_producer_rejects_missing_pipeline_before_enqueue(owner_db, monkeypatch):
    from app.services import task_queue_worker as worker

    enqueue = AsyncMock()
    monkeypatch.setattr(worker, "_enqueue_v2_with_local_fallback", enqueue)
    with pytest.raises(FencingRejectedError, match="business owner is missing"):
        await worker.enqueue_resume_pipeline("deleted-pipeline", "staging-object", None, None, {})
    enqueue.assert_not_awaited()
