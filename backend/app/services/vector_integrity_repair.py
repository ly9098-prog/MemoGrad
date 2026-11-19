"""Rebuild only explicitly reviewed, existing vectors by question sync UUID."""

import hashlib
import json
import re
from uuid import UUID

from sqlalchemy import bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question
from app.services import vector_retrieval_service as vectors
from app.services.vector_config_service import EmbeddingConfig
from app.services.vector_freshness import load_embedding_identities


def model_fingerprint(config: EmbeddingConfig) -> str:
    identity = {
        "model_id": config.model_config_id,
        "dimension": config.dim,
        "model": config.model,
        "base_url": config.base_url,
    }
    return hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _validate_manifest(payload: dict) -> dict[str, str]:
    entries = payload.get("vectors", [])
    if not isinstance(entries, list) or not 1 <= len(entries) <= 1000:
        raise ValueError("vector manifest must contain 1..1000 reviewed entries")
    targets = {}
    for entry in entries:
        if set(entry) != {"sync_uuid", "target_hash"}:
            raise ValueError("vector repair accepts sync_uuid and target_hash only")
        identity = str(UUID(entry["sync_uuid"]))
        if identity in targets or not re.fullmatch(
            r"[0-9a-f]{64}", entry["target_hash"]
        ):
            raise ValueError("duplicate vector identity or invalid content fingerprint")
        targets[identity] = entry["target_hash"]
    return targets


async def _plan(db: AsyncSession, payload: dict) -> list[dict]:
    if db.get_bind().dialect.name != "postgresql":
        raise ValueError("vector repair requires PostgreSQL/pgvector")
    targets = _validate_manifest(payload)
    await vectors._vs.refresh_async(db)
    config = vectors._vs.emb
    if config.model_config_id is None or model_fingerprint(config) != payload.get(
        "model_fingerprint"
    ):
        raise ValueError("embedding model changed since review")
    questions = (
        await db.scalars(select(Question).where(Question.sync_uuid.in_(targets)))
    ).all()
    if {q.sync_uuid for q in questions} != set(targets):
        raise ValueError("vector question identity not found")
    identities = await load_embedding_identities(db, [q.id for q in questions])
    rows = (
        await db.execute(
            text(
                "SELECT question_id, content_hash, subject_id, question_type FROM question_embeddings "
                "WHERE model_id=:model_id AND question_id IN :ids"
            ).bindparams(bindparam("ids", expanding=True)),
            {"model_id": config.model_config_id, "ids": [q.id for q in questions]},
        )
    ).all()
    existing = {row[0]: row for row in rows}
    plans = []
    for question in sorted(questions, key=lambda q: q.sync_uuid):
        identity = identities.get(question.id)
        if not identity or identity["hash"] != targets[question.sync_uuid]:
            raise ValueError(
                "question content changed; apply reviewed question repairs first"
            )
        row = existing.get(question.id)
        if row is None:
            raise ValueError(
                "reviewed vector is missing; no unreviewed vector will be generated"
            )
        fresh = (row[1], row[2], row[3]) == (
            identity["hash"],
            identity["subject_id"],
            identity["question_type"],
        )
        plans.append({"question": question, "hash": identity["hash"], "fresh": fresh})
    return plans


async def repair_vectors(
    db: AsyncSession, payload: dict, *, apply: bool = False
) -> dict:
    """Preflight every identity; isolate each provider/write failure in a savepoint."""
    plans = await _plan(db, payload)
    results = []
    for plan in plans:
        status = "already_applied" if plan["fresh"] else "planned"
        if apply and not plan["fresh"]:
            try:
                async with db.begin_nested():
                    await vectors._vs.refresh_async(db)
                    if (
                        model_fingerprint(vectors._vs.emb)
                        != payload["model_fingerprint"]
                    ):
                        raise ValueError("embedding model changed during repair")
                    status = await _rebuild_one(db, plan)
            except Exception:
                status = "failed"
        results.append({"sync_uuid": plan["question"].sync_uuid, "status": status})
    return {
        "apply": apply,
        "vectors": results,
        "failed": sum(item["status"] == "failed" for item in results),
    }


async def _rebuild_one(db: AsyncSession, plan: dict) -> str:
    question = plan["question"]
    identity = (await load_embedding_identities(db, [question.id])).get(question.id)
    if not identity or identity["hash"] != plan["hash"]:
        raise ValueError("question changed during vector repair")
    result = await vectors.upsert_question_embedding(db, question)
    if result["status"] not in ("updated", "created", "skipped"):
        raise ValueError("embedding provider or persistence failed")
    refreshed = (await load_embedding_identities(db, [question.id])).get(question.id)
    if refreshed != identity:
        raise ValueError("question changed while generating vector")
    return "applied"
