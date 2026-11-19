"""Exercise v24 and identity constraints in a private, disposable PostgreSQL cluster."""

from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

import asyncpg
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.cache import cache
from app.models.user_auth import UserAuthIdentity
from app.services import identity_service
from tests.integration.owned_postgres import OwnedPostgres
from tests.integration.owned_process import private_environment

pytestmark = pytest.mark.integration
BACKEND = Path(__file__).resolve().parents[2]


async def _connect(server, database="postgres"):
    return await asyncpg.connect(
        host=str(server.socket), user="owned_worker", database=database
    )


@pytest.fixture()
def postgres():
    server = OwnedPostgres()
    try:
        server.start()

        async def ready():
            for _ in range(100):
                try:
                    connection = await _connect(server)
                    await connection.close()
                    return
                except (OSError, asyncpg.PostgresError):
                    await asyncio.sleep(0.1)
            raise RuntimeError(
                f"Private PostgreSQL failed to start: {server.directory}"
            )

        asyncio.run(ready())
        yield server
    finally:
        server.stop()


def _alembic(server, *args, database="postgres"):
    environment = private_environment()
    environment.update(
        APP_ENV="test",
        DEPLOYMENT_PROFILE="local_import",
        DATABASE_URL=server.url.replace("/postgres?", f"/{database}?"),
        STAGING_STORAGE_DIR=str(server.directory / "staging"),
        WECHAT_APP_ID="wx-auth-acceptance",
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )
    name = "-".join([database, *args]).replace("/", "_")
    (server.directory / f"{name}.log").write_text(result.stdout + result.stderr)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


async def _seed(server):
    connection = await _connect(server)
    try:
        await connection.execute("""
            INSERT INTO roles (id, name, display_name, is_system)
            VALUES (101, 'super_admin', 'Super Admin', true);
            INSERT INTO users (id, openid, nickname)
            VALUES (101, 'wx-auth-history', 'history'),
                   (102, 'erasing:auth-history', 'erasing');
            INSERT INTO admin_users
                (id, username, password_hash, email, is_active, role_id)
            VALUES (101, 'auth-test-root', 'test-only-hash', 'Root@Example.COM', true, 101);
            INSERT INTO user_pomodoro_settings (user_id, day_start_minute)
            VALUES (101, 300);
        """)
    finally:
        await connection.close()


async def _assert_history(server, *, database="postgres", migrated):
    connection = await _connect(server, database)
    try:
        assert [
            tuple(row)
            for row in await connection.fetch(
                "SELECT id, openid, nickname FROM users WHERE id IN (101, 102) ORDER BY id"
            )
        ] == [
            (101, "wx-auth-history", "history"),
            (102, "erasing:auth-history", "erasing"),
        ]
        assert [
            tuple(row)
            for row in await connection.fetch(
                "SELECT user_id, day_start_minute FROM user_pomodoro_settings"
            )
        ] == [(101, 300)]
        if not migrated:
            assert (
                await connection.fetchval("SELECT version_num FROM alembic_version")
                == "v23_database_consistency"
            )
            return
        assert [
            tuple(row)
            for row in await connection.fetch(
                "SELECT user_id, provider, namespace, subject FROM user_auth_identities"
            )
        ] == [(101, "wechat", "wx-auth-acceptance", "wx-auth-history")]
        assert tuple(
            await connection.fetchrow(
                "SELECT email_normalized, email_verified_at, must_change_password "
                "FROM admin_users WHERE id = 101"
            )
        ) == ("Root@example.com", None, False)
    finally:
        await connection.close()


def test_v24_migration_check_and_backup_restore(postgres):
    _alembic(postgres, "upgrade", "v23_database_consistency")
    asyncio.run(_seed(postgres))
    backup = postgres.directory / "v23-backup.dump"
    common = ["-h", str(postgres.socket), "-U", "owned_worker"]
    subprocess.run(
        [
            str(postgres.binaries / "pg_dump"),
            *common,
            "-d",
            "postgres",
            "-Fc",
            "-f",
            str(backup),
        ],
        check=True,
        capture_output=True,
        timeout=30,
        env=private_environment(),
    )
    _alembic(postgres, "upgrade", "head")
    assert "v24_multi_identity_auth" in _alembic(postgres, "current")
    assert "v24_multi_identity_auth" in _alembic(postgres, "heads")
    assert "No new upgrade operations" in _alembic(postgres, "check")
    asyncio.run(_assert_history(postgres, migrated=True))

    async def create_restore_database():
        connection = await _connect(postgres)
        try:
            await connection.execute("CREATE DATABASE auth_restore")
        finally:
            await connection.close()

    asyncio.run(create_restore_database())
    subprocess.run(
        [
            str(postgres.binaries / "pg_restore"),
            *common,
            "-d",
            "auth_restore",
            "--exit-on-error",
            str(backup),
        ],
        check=True,
        capture_output=True,
        timeout=30,
        env=private_environment(),
    )
    asyncio.run(_assert_history(postgres, database="auth_restore", migrated=False))
    _alembic(postgres, "upgrade", "head", database="auth_restore")
    _alembic(postgres, "check", database="auth_restore")
    asyncio.run(_assert_history(postgres, database="auth_restore", migrated=True))


def test_postgres_concurrent_unlinks_preserve_a_verified_identity(
    postgres, monkeypatch
):
    monkeypatch.setattr(cache, "_enabled", False)
    _alembic(postgres, "upgrade", "head")

    async def run():
        engine = create_async_engine(postgres.url)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with factory() as db:
                user, email = await identity_service.authenticate_identity(
                    db,
                    provider="email",
                    namespace="user",
                    subject="concurrent@example.com",
                    allow_register=True,
                )
                github = await identity_service.bind_identity(
                    db,
                    user=user,
                    provider="github",
                    namespace="github.com",
                    subject="909090",
                )

            async def unlink(identity_id, retained_id):
                async with factory() as db:
                    await identity_service.unbind_identity(
                        db,
                        user_id=user.id,
                        identity_id=identity_id,
                        retained_identity_id=retained_id,
                    )

            results = await asyncio.gather(
                unlink(email.id, github.id),
                unlink(github.id, email.id),
                return_exceptions=True,
            )
            assert sum(result is None for result in results) == 1
            assert (
                sum(
                    isinstance(result, identity_service.IdentityConflictError)
                    for result in results
                )
                == 1
            )
            async with factory() as db:
                identities = list(
                    await db.scalars(
                        select(UserAuthIdentity).where(
                            UserAuthIdentity.user_id == user.id,
                        )
                    )
                )
                assert len(identities) == 1
                assert identities[0].verified_at is not None
        finally:
            await engine.dispose()

    asyncio.run(run())
