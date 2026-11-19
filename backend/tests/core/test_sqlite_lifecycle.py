"""Exercise SQLite transaction and connection cleanup at the driver boundary."""

import asyncio
import threading

import aiosqlite
import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import _async_database_url


@pytest.mark.asyncio
async def test_driver_commit_rollback_and_repeated_close(tmp_path):
    path = tmp_path / "driver.db"
    connection = await aiosqlite.connect(path)
    try:
        await connection.execute("CREATE TABLE entries (value INTEGER NOT NULL)")
        await connection.execute("INSERT INTO entries VALUES (1)")
        await connection.commit()
        await connection.execute("INSERT INTO entries VALUES (2)")
        await connection.rollback()
    finally:
        await connection.close()
    await connection.close()
    with pytest.raises(ValueError):
        await connection.execute("SELECT 1")
    async with aiosqlite.connect(path) as reopened:
        async with reopened.execute("SELECT value FROM entries") as cursor:
            assert await cursor.fetchall() == [(1,)]


@pytest.mark.asyncio
async def test_cancelled_query_drains_worker_before_connection_closes():
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def blocked_query():
        started.set()
        try:
            if not release.wait(timeout=5):
                raise TimeoutError("query was not released")
            return 1
        finally:
            finished.set()

    connection = await aiosqlite.connect(":memory:")
    query = None
    try:
        await connection.create_function("blocked_query", 0, blocked_query)
        query = asyncio.create_task(connection.execute("SELECT blocked_query()"))
        assert await asyncio.to_thread(started.wait, 5)
        query.cancel()
        with pytest.raises(asyncio.CancelledError):
            await query
    finally:
        release.set()
        if query is not None and not query.done():
            query.cancel()
            await asyncio.gather(query, return_exceptions=True)
        await asyncio.wait_for(connection.close(), timeout=5)
    assert finished.is_set()


@pytest.mark.asyncio
async def test_session_rollback_savepoint_and_foreign_keys(tmp_path):
    engine = create_async_engine(_async_database_url(f"sqlite:///{tmp_path / 'session.db'}"))

    @event.listens_for(engine.sync_engine, "connect")
    def enable_foreign_keys(connection, _record):
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("CREATE TABLE parents (id INTEGER PRIMARY KEY)"))
            await connection.execute(
                text("CREATE TABLE children (parent_id INTEGER REFERENCES parents(id))")
            )
        async with sessions.begin() as session:
            await session.execute(text("INSERT INTO parents VALUES (1)"))
            with pytest.raises(IntegrityError):
                async with session.begin_nested():
                    await session.execute(text("INSERT INTO children VALUES (999)"))
            await session.execute(text("INSERT INTO children VALUES (1)"))
        async with sessions() as session:
            await session.execute(text("INSERT INTO parents VALUES (2)"))
        async with sessions() as session:
            assert (await session.execute(text("SELECT id FROM parents"))).all() == [(1,)]
            assert (await session.execute(text("SELECT parent_id FROM children"))).all() == [(1,)]
    finally:
        await engine.dispose()
    # A disposed file-backed engine must be reusable, with FK enforcement on its new connection.
    try:
        async with engine.connect() as connection:
            assert (await connection.execute(text("PRAGMA foreign_keys"))).scalar_one() == 1
            assert (await connection.execute(text("SELECT COUNT(*) FROM children"))).scalar_one() == 1
    finally:
        await engine.dispose()
