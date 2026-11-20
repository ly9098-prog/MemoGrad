import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _run_alembic(database_path: Path, revision: str) -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "DEPLOYMENT_PROFILE": "local_import",
            "DATABASE_URL": f"sqlite+aiosqlite:///{database_path}",
            "STAGING_STORAGE_DIR": tempfile.mkdtemp(prefix="auth-migration-staging-"),
            "WECHAT_APP_ID": "wx-test-app",
        }
    )
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=BACKEND_ROOT,
        env=env,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr


def test_v24_preserves_user_ids_learning_rows_and_admin_email_state():
    database_path = Path(
        tempfile.mkstemp(prefix="multi-identity-migration-", suffix=".db")[1]
    )
    _run_alembic(database_path, "v23_database_consistency")

    conn = sqlite3.connect(database_path)
    conn.executescript(
        """
        INSERT INTO roles (id, name, display_name, is_system)
        VALUES (1, 'super_admin', 'Super Admin', 1);
        INSERT INTO users (id, openid, nickname)
        VALUES
          (101, 'wx-real-user', 'real'),
          (102, 'erasing:old-user', 'erasing'),
          (103, 'dev_local_fixture', 'local');
        INSERT INTO admin_users
          (id, username, password_hash, email, is_active, role_id)
        VALUES
          (201, 'root', 'hash', 'Admin@Example.COM', 1, 1);
        INSERT INTO user_pomodoro_settings (user_id, day_start_minute)
        VALUES (101, 300);
        """
    )
    conn.commit()
    conn.close()

    _run_alembic(database_path, "head")
    conn = sqlite3.connect(database_path)
    try:
        users = conn.execute(
            "SELECT id, openid, lifecycle_status FROM users ORDER BY id"
        ).fetchall()
        assert users == [
            (101, "wx-real-user", "active"),
            (102, "erasing:old-user", "erasing"),
            (103, "dev_local_fixture", "active"),
        ]
        identities = conn.execute(
            "SELECT user_id, provider, namespace, subject "
            "FROM user_auth_identities ORDER BY user_id"
        ).fetchall()
        assert identities == [(101, "wechat", "wx-test-app", "wx-real-user")]
        assert conn.execute(
            "SELECT user_id, day_start_minute FROM user_pomodoro_settings"
        ).fetchall() == [(101, 300)]
        admin = conn.execute(
            "SELECT email, email_normalized, email_verified_at, "
            "must_change_password FROM admin_users WHERE id = 201"
        ).fetchone()
        assert admin == ("Admin@Example.COM", "Admin@example.com", None, 0)
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()
