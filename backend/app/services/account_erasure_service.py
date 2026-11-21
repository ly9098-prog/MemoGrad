"""Account lifecycle: cancelled-account erasure and inactive-account anonymization.

Cancellation tombstones every login identity immediately; the sweep then purges
every user-scoped row and export file and marks the user ``erased``. Accounts
inactive for ``INACTIVITY_DAYS`` have their login identities tombstoned and
become ``anonymized``. Every step is idempotent.
"""

import logging
from datetime import timedelta

from sqlalchemy import delete, exists, select

from app.core.cache import cache
from app.core.database import Base
from app.core.time_utils import utcnow
from app.models.import_batch_job import (
    BatchJobTraceEvent,
    ImportBatchJob,
    ImportBatchJobItem,
)
from app.models.import_pipeline import ImportPipeline, ImportPipelineChunk
from app.models.practice_record import PracticeRecord
from app.models.question_import import QuestionImport
from app.models.refresh_token import RefreshToken
from app.models.task_outbox import TaskOutbox
from app.models.user import User
from app.services import identity_service
from app.services.storage_backend import get_export_storage

logger = logging.getLogger(__name__)

ERASING_PREFIX = "erasing:"
ERASED_PREFIX = "erased:"
ANONYMIZED_PREFIX = "anonymized:"
INACTIVITY_DAYS = 365
_BATCH = 100

# Child rows of user-scoped tables that carry no user_id of their own; SQLite does
# not enforce the ON DELETE CASCADE that PostgreSQL applies to them.
_CHILD_TABLES = (
    ("pomodoro_pause_intervals", "session_id", "pomodoro_sessions"),
    ("pomodoro_subject_allocations", "session_id", "pomodoro_sessions"),
    ("study_plan_days", "plan_id", "study_plans"),
    ("exam_answers", "attempt_id", "exam_attempts"),
)


def tombstone_cancelled_user(user: User) -> None:
    """Clear profile fields and enter the cancellation lifecycle."""
    user.nickname = None
    user.avatar_url = None
    if not user.is_banned:
        user.lifecycle_status = "erasing"


async def _delete_export_files(db, user_id: int) -> None:
    from app.models.export_task import ExportTask

    keys = (
        (
            await db.execute(
                select(ExportTask.file_key).where(
                    ExportTask.user_id == user_id, ExportTask.file_key.isnot(None)
                )
            )
        )
        .scalars()
        .all()
    )
    if not keys:
        return
    storage = get_export_storage()
    for key in keys:
        if not await storage.delete(key) and await storage.exists(key):
            raise RuntimeError(
                f"export file could not be deleted for user_id={user_id}"
            )


def _task_type_for_id(task_id: str, source_type: str | None = None) -> str | None:
    prefix = task_id.split(":", 1)[0]
    mapping = {
        "import": "import_pipeline",
        "image": "image_pipeline",
        "excel": "excel_pipeline",
        "resume": "resume_pipeline",
        "admin_resume": "admin_resume",
        "batch_image": "batch_image",
        "answer_projection": "answer_projection",
        "answer_projection_repair": "answer_projection",
        "error_diagnosis": "error_diagnosis",
    }
    if prefix in mapping:
        return mapping[prefix]
    if source_type in {"pdf", "txt"}:
        return "import_pipeline"
    if source_type == "image":
        return "image_pipeline"
    if source_type == "excel":
        return "excel_pipeline"
    return None


async def _purge_import_registrations(db, user_id: int) -> tuple[list[str], list[str]]:
    """Delete app-import ownership rows and their associated review batches."""
    owner_values = (str(user_id), f"user:{user_id}")
    pipeline_rows = list(
        (
            await db.execute(
                select(
                    ImportPipeline.pipeline_id,
                    ImportPipeline.current_task_id,
                    ImportPipeline.source_type,
                ).where(ImportPipeline.created_by.in_(owner_values))
            )
        ).all()
    )
    job_rows = list(
        (
            await db.execute(
                select(ImportBatchJob.job_id, ImportBatchJob.current_task_id).where(
                    ImportBatchJob.created_by.in_(owner_values)
                )
            )
        ).all()
    )
    pipeline_ids = {str(row.pipeline_id) for row in pipeline_rows}
    job_ids = {str(row.job_id) for row in job_rows}

    if job_ids:
        pipeline_ids.update(
            value
            for value in (
                await db.execute(
                    select(ImportBatchJobItem.pipeline_id).where(
                        ImportBatchJobItem.job_id.in_(job_ids),
                        ImportBatchJobItem.pipeline_id.isnot(None),
                    )
                )
            ).scalars()
            if value
        )

    batch_ids: set[str] = set()
    if pipeline_ids:
        batch_ids.update(
            value
            for value in (
                await db.execute(
                    select(ImportPipelineChunk.batch_id).where(
                        ImportPipelineChunk.pipeline_id.in_(pipeline_ids),
                        ImportPipelineChunk.batch_id.isnot(None),
                    )
                )
            ).scalars()
            if value
        )
    if job_ids:
        for column in (
            ImportBatchJobItem.review_batch_id,
            ImportBatchJobItem.previous_review_batch_id,
        ):
            batch_ids.update(
                value
                for value in (
                    await db.execute(
                        select(column).where(
                            ImportBatchJobItem.job_id.in_(job_ids),
                            column.isnot(None),
                        )
                    )
                ).scalars()
                if value
            )

    task_specs: dict[str, str] = {}
    for pipeline_id, task_id, source_type in pipeline_rows:
        if task_id:
            task_type = _task_type_for_id(str(task_id), source_type)
            if task_type:
                task_specs.setdefault(str(task_id), task_type)
        task_type = _task_type_for_id(f"import:{pipeline_id}", source_type)
        if task_type:
            task_specs.setdefault(f"import:{pipeline_id}", task_type)
    for job_id, task_id in job_rows:
        if task_id:
            task_type = _task_type_for_id(str(task_id))
            if task_type:
                task_specs.setdefault(str(task_id), task_type)
        task_specs.setdefault(f"batch_image:{job_id}", "batch_image")

    outbox_rows = list(
        (
            await db.execute(
                select(TaskOutbox.task_id, TaskOutbox.task_type).where(
                    TaskOutbox.owner_user_id == user_id
                )
            )
        ).all()
    )
    for task_id, task_type in outbox_rows:
        task_specs[str(task_id)] = str(task_type)

    if task_specs:
        from app.services.task_queue_service import task_queue

        if task_queue.redis_enabled:
            for task_id, task_type in task_specs.items():
                await task_queue.purge_v2_task(task_id, task_type)

    if batch_ids:
        await db.execute(
            delete(QuestionImport).where(QuestionImport.batch_id.in_(batch_ids))
        )
    if job_ids:
        await db.execute(
            delete(BatchJobTraceEvent).where(BatchJobTraceEvent.job_id.in_(job_ids))
        )
        await db.execute(
            delete(ImportBatchJobItem).where(ImportBatchJobItem.job_id.in_(job_ids))
        )
        await db.execute(
            delete(ImportBatchJob).where(ImportBatchJob.job_id.in_(job_ids))
        )
    if pipeline_ids:
        await db.execute(
            delete(ImportPipelineChunk).where(
                ImportPipelineChunk.pipeline_id.in_(pipeline_ids)
            )
        )
        await db.execute(
            delete(ImportPipeline).where(ImportPipeline.pipeline_id.in_(pipeline_ids))
        )

    return sorted(pipeline_ids), sorted(job_ids)


async def _invalidate_user_caches(user_id: int, pipeline_ids: list[str]) -> None:
    # Revoke task ownership before deleting the result. Redis failure must
    # keep erasure retryable rather than permit a late analysis to reappear.
    await cache.delete_strict(f"ai_diagnosis_job_lease:v1:{user_id}")
    await cache.delete_strict(f"ai_diagnosis_job:v1:{user_id}")
    for pattern in (
        f"stats:*:{user_id}*",
        f"stats:dashboard*:{user_id}:*",
        f"stats:insights:{user_id}:*",
        f"practice:stats:{user_id}:*",
        f"review:*:{user_id}*",
        f"vector:*:{user_id}*",
    ):
        await cache.delete(pattern)
    for pipeline_id in pipeline_ids:
        await cache.delete(f"import:*:{pipeline_id}*")
        await cache.delete(f"import:recovery:context:{pipeline_id}")
    cache.purge_expired_local()

    # Runtime status caches must disappear immediately after erasure rather than
    # waiting for their 24h TTL, even when Redis is disabled.
    try:
        from app.features import pipeline_orchestrator
        from app.services import import_pipeline_service

        for pipeline_id in pipeline_ids:
            for store_name in (
                "_pipeline_store",
                "_pipeline_diagnostics_store",
                "_pipeline_stage_checkpoints",
                "_ocr_progress",
            ):
                getattr(pipeline_orchestrator, store_name, {}).pop(pipeline_id, None)
            import_pipeline_service._image_pipeline_store.pop(pipeline_id, None)
    except Exception:
        logger.warning("runtime pipeline cache cleanup failed for user_id=%s", user_id)


async def _purge_import_artifacts(pipeline_ids: list[str]) -> None:
    if not pipeline_ids:
        return
    from app.features.pipeline_artifacts import cleanup_artifacts

    for pipeline_id in pipeline_ids:
        cleanup_artifacts(pipeline_id, force=True)


async def _purge_owned_task_payloads(db, user_id: int) -> None:
    """Revoke durable tasks before deleting the business rows they reference."""
    task_specs = {
        str(task_id): str(task_type)
        for task_id, task_type in (
            await db.execute(
                select(TaskOutbox.task_id, TaskOutbox.task_type).where(
                    TaskOutbox.owner_user_id == user_id
                )
            )
        ).all()
    }
    if not task_specs:
        return
    from app.services.task_queue_service import task_queue

    if task_queue.redis_enabled:
        for task_id, task_type in task_specs.items():
            await task_queue.purge_v2_task(task_id, task_type)
    await db.execute(delete(TaskOutbox).where(TaskOutbox.owner_user_id == user_id))


async def _purge_user_rows(db, user_id: int) -> None:
    import app.models  # noqa: F401 - register every table before walking metadata

    tables = Base.metadata.tables
    for child, fk_column, parent in _CHILD_TABLES:
        if child in tables and parent in tables:
            parent_ids = select(tables[parent].c.id).where(
                tables[parent].c.user_id == user_id
            )
            await db.execute(
                delete(tables[child]).where(tables[child].c[fk_column].in_(parent_ids))
            )
    # Reverse dependency order so referencing rows go before the rows they point at.
    for table in reversed(Base.metadata.sorted_tables):
        if table.name == "users" or "user_id" not in table.columns:
            continue
        await db.execute(delete(table).where(table.c.user_id == user_id))


async def purge_cancelled_user(db, user: User) -> None:
    # Writers that can outlive their HTTP admission lock the same user row
    # before committing personal data. Re-read under that lock so erasure
    # cannot finish and then be followed by a late nickname/advice write.
    await db.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    await _delete_export_files(db, user.id)
    await _purge_owned_task_payloads(db, user.id)
    pipeline_ids, _job_ids = await _purge_import_registrations(db, user.id)
    await _purge_import_artifacts(pipeline_ids)
    from app.services.staging_storage import async_purge_owned_objects

    await async_purge_owned_objects(user.id)
    await _invalidate_user_caches(user.id, pipeline_ids)
    await _purge_user_rows(db, user.id)
    user.openid = None
    user.lifecycle_status = "erased"
    user.nickname = None
    user.avatar_url = None
    await db.commit()


async def _purge_pending(db) -> tuple[int, int]:
    user_ids = (
        (
            await db.execute(
                select(User.id)
                .where(
                    User.deleted_at.isnot(None),
                    User.is_banned.is_(False),
                    User.lifecycle_status == "erasing",
                )
                .order_by(User.id)
                .limit(_BATCH)
            )
        )
        .scalars()
        .all()
    )
    purged = failed = 0
    for user_id in user_ids:
        try:
            user = await db.get(User, user_id)
            await purge_cancelled_user(db, user)
            purged += 1
        except Exception:
            await db.rollback()
            failed += 1
            logger.exception(
                "Account erasure failed for user_id=%s; will retry", user_id
            )
    return purged, failed


async def _anonymize_inactive(db) -> int:
    cutoff = utcnow() - timedelta(days=INACTIVITY_DAYS)
    recent_token = exists().where(
        RefreshToken.user_id == User.id, RefreshToken.created_at >= cutoff
    )
    recent_practice = exists().where(
        PracticeRecord.user_id == User.id, PracticeRecord.created_at >= cutoff
    )
    users = (
        (
            await db.execute(
                select(User)
                .where(
                    User.deleted_at.is_(None),
                    User.is_banned.is_(False),
                    User.lifecycle_status == "active",
                    User.updated_at < cutoff,
                    ~recent_token,
                    ~recent_practice,
                )
                .limit(_BATCH)
            )
        )
        .scalars()
        .all()
    )
    for user in users:
        await identity_service.tombstone_user_identities(db, user.id)
        user.openid = None
        user.lifecycle_status = "anonymized"
        await db.execute(delete(RefreshToken).where(RefreshToken.user_id == user.id))
    if users:
        await db.commit()
    return len(users)


async def run_account_lifecycle_sweep(db) -> dict[str, int]:
    purged, failed = await _purge_pending(db)
    anonymized = await _anonymize_inactive(db)
    return {"purged": purged, "failed": failed, "anonymized": anonymized}
