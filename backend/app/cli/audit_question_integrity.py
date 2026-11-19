"""Read-only current-question consistency audit; returns exit code 1 on findings."""

import asyncio
import json

from sqlalchemy import text

from app.core.database import async_session, engine
from app.services.question_integrity_audit import audit_question_integrity


async def run() -> dict:
    try:
        async with async_session() as db:
            if db.get_bind().dialect.name == "postgresql":
                await db.execute(
                    text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
                )
                await db.execute(text("SET LOCAL statement_timeout='30s'"))
            try:
                return await audit_question_integrity(db)
            finally:
                await db.rollback()
    finally:
        await engine.dispose()


def main() -> None:
    result = asyncio.run(run())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["affected_questions"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
