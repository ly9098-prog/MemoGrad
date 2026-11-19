"""Resolve durable task ownership from persisted business records and envelopes."""

from typing import Any

PIPELINE_OWNER_TASK_TYPES = frozenset({
    "import_pipeline", "image_pipeline", "excel_pipeline", "resume_pipeline", "admin_resume",
})
BUSINESS_OWNER_TASK_TYPES = PIPELINE_OWNER_TASK_TYPES | {"answer_projection"}


def app_owner_user_id(payload: dict[str, Any]) -> int | None:
    for key in ("owner_user_id", "user_id", "created_by"):
        value = payload.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str):
            value = value.removeprefix("user:")
            if value.isascii() and value.isdigit() and len(value) <= 19:
                user_id = int(value)
                if user_id > 0:
                    return user_id
    return None


async def resolve_app_owner_user_id(
    db: Any,
    task_type: str,
    payload: dict[str, Any],
    *,
    task_id: str | None = None,
) -> int | None:
    """Prefer persisted business ownership over a queued envelope's metadata."""
    if task_type == "answer_projection":
        from app.models.practice_record import PracticeRecord
        from app.services.db_fencing import FencingRejectedError
        from app.services.practice.answer_projection_contract import (
            parse_answer_projection_payload,
        )

        record_id = parse_answer_projection_payload(payload).practice_record_id
        record = await db.get(PracticeRecord, record_id)
        owner_user_id = (
            app_owner_user_id({"user_id": record.user_id}) if record is not None else None
        )
        if owner_user_id is None:
            raise FencingRejectedError(
                f"Task business owner is missing: practice_record_id={record_id}"
            )
        return owner_user_id
    if task_type in PIPELINE_OWNER_TASK_TYPES:
        return await _resolve_pipeline_owner(db, payload, task_id)
    return app_owner_user_id(payload)


async def _resolve_pipeline_owner(
    db: Any, payload: dict[str, Any], task_id: str | None,
) -> int | None:
    from app.models.import_pipeline import ImportPipeline
    from app.services.db_fencing import FencingRejectedError

    pipeline_id = payload.get("pipeline_id", task_id)
    record = await db.get(ImportPipeline, pipeline_id) if pipeline_id else None
    if record is None:
        raise FencingRejectedError(
            f"Task business owner is missing: pipeline_id={pipeline_id}"
        )
    if record.created_by is None:
        return app_owner_user_id(payload)
    return app_owner_user_id({"created_by": record.created_by})
