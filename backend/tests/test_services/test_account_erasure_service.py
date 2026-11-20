"""Account cancellation must anonymize the openid and purge user-scoped data."""
import asyncio
import tempfile
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.time_utils import utcnow
from app.models.ai_chat import AiChat
from app.models.export_task import ExportTask
from app.models.import_batch_job import (
    BatchJobTraceEvent,
    ImportBatchJob,
    ImportBatchJobItem,
)
from app.models.import_pipeline import ImportPipeline, ImportPipelineChunk
from app.models.question_import import QuestionImport
from app.models.refresh_token import RefreshToken
from app.models.task_outbox import TaskOutbox
from app.models.user import User


@pytest.fixture()
def factory():
    f = tempfile.NamedTemporaryFile(prefix="erasure_", suffix=".db", delete=False)
    f.close()
    import app.models  # noqa: F401

    engine = create_async_engine(
        f"sqlite+aiosqlite:///{f.name}", connect_args={"check_same_thread": False}
    )

    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())
    return sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _seed_user(db, openid, **kw):
    if kw.get("deleted_at") is not None and "lifecycle_status" not in kw:
        kw["lifecycle_status"] = "erasing"
    user = User(openid=openid, **kw)
    db.add(user)
    await db.flush()
    db.add(AiChat(user_id=user.id, session_type="x", user_message="m", ai_response="r",
                  tokens_used=1, model="m", duration_ms=1))
    db.add(RefreshToken(user_id=user.id, token_hash="h" + openid, expires_at=utcnow() + timedelta(days=1)))
    await db.commit()
    return user


async def _count(db, model, user_id):
    return (await db.execute(select(func.count()).select_from(model).where(model.user_id == user_id))).scalar_one()


def test_cancellation_tombstones_openid():
    from app.services import account_erasure_service as svc

    user = User(openid="wx-real-openid")
    svc.tombstone_cancelled_user(user)
    assert user.lifecycle_status == "erasing"


@pytest.mark.asyncio
async def test_sweep_purges_cancelled_user_data_and_marks_erased(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    storage = type("S", (), {"delete": AsyncMock(return_value=True), "exists": AsyncMock(return_value=False)})()
    monkeypatch.setattr(svc, "get_export_storage", lambda: storage)
    async with factory() as db:
        user = await _seed_user(db, "wx-cancelled", deleted_at=utcnow())
        other = await _seed_user(db, "wx-keep")
        db.add(ExportTask(user_id=user.id, status="completed", range_type="all", title="t", export_date="2026-01-01", file_name="a.docx", file_key="exports/a.docx"))
        await db.commit()

        result = await svc.run_account_lifecycle_sweep(db)
        assert result["purged"] == 1

        assert await _count(db, AiChat, user.id) == 0
        assert await _count(db, RefreshToken, user.id) == 0
        assert await _count(db, ExportTask, user.id) == 0
        assert await _count(db, AiChat, other.id) == 1
        storage.delete.assert_awaited_once_with("exports/a.docx")
        refreshed = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.lifecycle_status == "erased"
        assert refreshed.openid is None
        assert refreshed.nickname is None


@pytest.mark.asyncio
async def test_sweep_removes_import_children_staging_caches_and_outbox(
    factory, monkeypatch
):
    from app.services import account_erasure_service as svc

    storage = type(
        "S",
        (),
        {
            "delete": AsyncMock(return_value=True),
            "exists": AsyncMock(return_value=False),
        },
    )()
    monkeypatch.setattr(svc, "get_export_storage", lambda: storage)
    cache_delete = AsyncMock(return_value=1)
    monkeypatch.setattr(svc.cache, "delete", cache_delete)
    monkeypatch.setattr(svc.cache, "purge_expired_local", lambda: 0)
    purge_staging = AsyncMock(return_value=(1, 2))
    from app.services import staging_storage

    monkeypatch.setattr(staging_storage, "async_purge_owned_objects", purge_staging)
    purge_artifacts = AsyncMock()
    monkeypatch.setattr(svc, "_purge_import_artifacts", purge_artifacts)

    async with factory() as db:
        user = await _seed_user(db, "wx-cancelled", deleted_at=utcnow())
        owner = str(user.id)
        db.add(
            ImportPipeline(
                pipeline_id="pl_owned",
                source_type="pdf",
                source_file="private.pdf",
                created_by=owner,
            )
        )
        db.add(
            ImportPipelineChunk(
                pipeline_id="pl_owned",
                chunk_index=0,
                page_start=1,
                page_end=1,
                status="completed",
                batch_id="review-owned",
            )
        )
        db.add(
            ImportBatchJob(
                job_id="job_owned",
                created_by=owner,
                source_type="image",
                total=1,
                concurrency=1,
            )
        )
        db.add(
            ImportBatchJobItem(
                job_id="job_owned",
                seq=1,
                source_file="private.png",
                status="succeeded",
                pipeline_id="pl_owned",
                review_batch_id="review-owned",
                ocr_raw_text="private OCR",
            )
        )
        db.add(
            BatchJobTraceEvent(
                job_id="job_owned",
                seq=1,
                step="upload",
                status="success",
            )
        )
        db.add(
            QuestionImport(
                batch_id="review-owned",
                source_type="image",
                raw_data={"text": "private question"},
            )
        )
        db.add(
            TaskOutbox(
                task_id="answer_projection:42",
                task_type="answer_projection",
                owner_user_id=user.id,
                payload={"practice_record_id": 42},
                status="pending",
            )
        )
        await db.commit()

        result = await svc.run_account_lifecycle_sweep(db)

        assert result["purged"] == 1
        for model in (
            ImportPipeline,
            ImportPipelineChunk,
            ImportBatchJob,
            ImportBatchJobItem,
            BatchJobTraceEvent,
            QuestionImport,
            TaskOutbox,
        ):
            count = await db.scalar(select(func.count()).select_from(model))
            assert count == 0
        purge_staging.assert_awaited_once_with(user.id)
        purge_artifacts.assert_awaited_once_with(["pl_owned"])
        assert {call.args[0] for call in cache_delete.await_args_list} >= {
            f"stats:*:{user.id}*",
            f"practice:stats:{user.id}:*",
            f"review:*:{user.id}*",
            "import:*:pl_owned*",
            "import:recovery:context:pl_owned",
        }


@pytest.mark.asyncio
async def test_sweep_is_idempotent(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    monkeypatch.setattr(svc, "get_export_storage", lambda: type("S", (), {"delete": AsyncMock(return_value=True), "exists": AsyncMock(return_value=False)})())
    async with factory() as db:
        await _seed_user(db, "wx-cancelled", deleted_at=utcnow())
        assert (await svc.run_account_lifecycle_sweep(db))["purged"] == 1
        assert (await svc.run_account_lifecycle_sweep(db))["purged"] == 0


@pytest.mark.asyncio
async def test_storage_failure_keeps_user_pending_for_retry(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    storage = type("S", (), {"delete": AsyncMock(side_effect=RuntimeError("down"))})()
    monkeypatch.setattr(svc, "get_export_storage", lambda: storage)
    async with factory() as db:
        user = await _seed_user(db, "wx-cancelled", deleted_at=utcnow())
        uid = user.id
        db.add(ExportTask(user_id=uid, status="completed", range_type="all", title="t", export_date="2026-01-01", file_name="a.docx", file_key="exports/a.docx"))
        await db.commit()

        result = await svc.run_account_lifecycle_sweep(db)
        assert result["purged"] == 0 and result["failed"] == 1
        assert await _count(db, AiChat, uid) == 1
        refreshed = (await db.execute(select(User).where(User.id == uid))).scalar_one()
        assert refreshed.lifecycle_status == "erasing"


@pytest.mark.asyncio
async def test_inactive_accounts_get_login_identifier_anonymized(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    monkeypatch.setattr(svc, "get_export_storage", lambda: type("S", (), {"delete": AsyncMock(return_value=True), "exists": AsyncMock(return_value=False)})())
    old = utcnow() - timedelta(days=svc.INACTIVITY_DAYS + 30)
    async with factory() as db:
        stale = await _seed_user(db, "wx-stale")
        active = await _seed_user(db, "wx-active")
        for u, when in ((stale, old), (active, utcnow())):
            await db.execute(User.__table__.update().where(User.id == u.id).values(updated_at=when))
        await db.execute(RefreshToken.__table__.update().where(RefreshToken.user_id == stale.id).values(created_at=old))
        await db.commit()

        result = await svc.run_account_lifecycle_sweep(db)
        assert result["anonymized"] == 1
        s = (await db.execute(select(User).where(User.id == stale.id))).scalar_one()
        a = (await db.execute(select(User).where(User.id == active.id))).scalar_one()
        assert s.lifecycle_status == "anonymized"
        assert s.openid is None
        assert a.openid == "wx-active"
        assert await _count(db, RefreshToken, stale.id) == 0


@pytest.mark.asyncio
async def test_inactive_banned_account_keeps_login_identity(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    monkeypatch.setattr(
        svc,
        "get_export_storage",
        lambda: type(
            "S",
            (),
            {
                "delete": AsyncMock(return_value=True),
                "exists": AsyncMock(return_value=False),
            },
        )(),
    )
    old = utcnow() - timedelta(days=svc.INACTIVITY_DAYS + 30)
    async with factory() as db:
        banned = await _seed_user(db, "wx-banned-stale")
        banned.is_banned = True
        await db.execute(
            User.__table__.update()
            .where(User.id == banned.id)
            .values(updated_at=old)
        )
        await db.commit()

        result = await svc.run_account_lifecycle_sweep(db)
        assert result["anonymized"] == 0
        refreshed = (
            await db.execute(select(User).where(User.id == banned.id))
        ).scalar_one()
        assert refreshed.openid == "wx-banned-stale"


@pytest.mark.asyncio
async def test_deletion_request_tombstones_openid_and_revokes_sessions(factory, monkeypatch):
    from app.api.v1 import auth as auth_api

    monkeypatch.setattr(auth_api.user_service, "delete_user_avatar_file", AsyncMock())
    monkeypatch.setattr(auth_api, "set_user_nbf", AsyncMock())
    async with factory() as db:
        user = await _seed_user(db, "wx-real-openid", nickname="n", avatar_url="/a.jpg")
        uid = user.id

        response = await auth_api.request_deletion(db=db, current_user=user)

        assert response.deleted_at > 0
        row = (await db.execute(select(User).where(User.id == uid))).scalar_one()
        assert row.deleted_at is not None
        assert row.lifecycle_status == "erasing"
        assert row.openid == "wx-real-openid"
        assert row.nickname is None and row.avatar_url is None
        tokens = (await db.execute(select(RefreshToken).where(RefreshToken.user_id == uid))).scalars().all()
        assert tokens and all(t.revoked_at is not None for t in tokens)


@pytest.mark.asyncio
async def test_one_failing_user_does_not_block_the_rest(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    async def delete(key):
        if key == "exports/bad.docx":
            raise RuntimeError("down")
        return True

    storage = type("S", (), {"delete": staticmethod(delete), "exists": AsyncMock(return_value=False)})()
    monkeypatch.setattr(svc, "get_export_storage", lambda: storage)
    async with factory() as db:
        bad = await _seed_user(db, "wx-bad", deleted_at=utcnow())
        good = await _seed_user(db, "wx-good", deleted_at=utcnow())
        good_id = good.id
        db.add(ExportTask(user_id=bad.id, status="completed", range_type="all", title="t",
                          export_date="2026-01-01", file_name="b.docx", file_key="exports/bad.docx"))
        await db.commit()

        result = await svc.run_account_lifecycle_sweep(db)
        assert result["purged"] == 1 and result["failed"] == 1
        assert await _count(db, AiChat, good_id) == 0


@pytest.mark.asyncio
async def test_undeletable_export_file_keeps_user_pending(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    storage = type("S", (), {"delete": AsyncMock(return_value=False), "exists": AsyncMock(return_value=True)})()
    monkeypatch.setattr(svc, "get_export_storage", lambda: storage)
    async with factory() as db:
        user = await _seed_user(db, "wx-cancelled", deleted_at=utcnow())
        uid = user.id
        db.add(ExportTask(user_id=uid, status="completed", range_type="all", title="t",
                          export_date="2026-01-01", file_name="a.docx", file_key="exports/a.docx"))
        await db.commit()

        result = await svc.run_account_lifecycle_sweep(db)
        assert result["purged"] == 0 and result["failed"] == 1
        assert await _count(db, AiChat, uid) == 1


def test_banned_user_keeps_openid_so_cancelling_cannot_shed_a_ban():
    from app.services import account_erasure_service as svc

    user = User(openid="wx-banned", is_banned=True, nickname="n")
    svc.tombstone_cancelled_user(user)
    assert user.openid == "wx-banned"
    assert user.nickname is None


@pytest.mark.asyncio
async def test_sweep_skips_banned_cancelled_users(factory, monkeypatch):
    from app.services import account_erasure_service as svc

    monkeypatch.setattr(svc, "get_export_storage", lambda: type("S", (), {"delete": AsyncMock(return_value=True), "exists": AsyncMock(return_value=False)})())
    async with factory() as db:
        user = await _seed_user(db, "wx-banned", deleted_at=utcnow(), is_banned=True)
        uid = user.id
        result = await svc.run_account_lifecycle_sweep(db)
        assert result["purged"] == 0
        assert await _count(db, AiChat, uid) == 1
