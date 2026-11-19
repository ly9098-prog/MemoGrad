"""Rebuild a reviewed UUID/content/model manifest; defaults to a read-only plan."""

import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy import text

from app.core.database import async_session, engine
from app.services.vector_integrity_repair import repair_vectors


async def run(manifest: Path, apply: bool) -> dict:
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    async with async_session() as db:
        if not apply and db.get_bind().dialect.name == "postgresql":
            await db.execute(text("SET TRANSACTION READ ONLY"))
        try:
            result = await repair_vectors(db, payload, apply=apply)
            if apply:
                await db.commit()
            else:
                await db.rollback()
            return result
        except Exception:
            await db.rollback()
            raise


async def _execute(args: argparse.Namespace) -> dict:
    try:
        return await run(args.manifest, args.apply)
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    result = asyncio.run(_execute(args))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
