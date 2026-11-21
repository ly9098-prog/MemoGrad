from unittest.mock import Mock

import pytest

from app.core import sentry
from app.core.sentry import (
    _redact_sentry_breadcrumb,
    _redact_sentry_event,
    resolve_sentry_options,
)


def test_sentry_event_redacts_request_and_log_context():
    event = {
        "request": {
            "cookies": "session=secret",
            "data": {"prompt": "private"},
            "query_string": "token=secret",
            "headers": {
                "Authorization": "Bearer secret",
                "Cookie": "session=secret",
                "X-Request-ID": "req-1",
            },
        },
        "tags": {
            "log.user_id": "42",
            "log.source_file": "private.pdf",
            "upload.filename": "private.pdf",
            "request_id": "req-1",
        },
        "user": {"id": "42"},
    }

    redacted = _redact_sentry_event(event, {})

    assert redacted is event
    assert event["request"] == {"headers": {"X-Request-ID": "req-1"}}
    assert event["tags"] == {"request_id": "req-1"}
    assert "user" not in event


def test_sentry_breadcrumb_redacts_sensitive_data():
    breadcrumb = {
        "message": "request",
        "data": {
            "user_id": 42,
            "source_file": "private.pdf",
            "method": "POST",
        },
    }

    redacted = _redact_sentry_breadcrumb(breadcrumb, {})

    assert redacted["data"] == {
        "user_id": "[REDACTED]",
        "source_file": "[REDACTED]",
        "method": "POST",
    }


@pytest.mark.parametrize(
    "app_env",
    ["development", "dev", "local", "test", "testing", "TEST", " test "],
)
def test_sentry_is_disabled_for_local_and_test_runs(app_env):
    assert resolve_sentry_options(
        app_env,
        "development",
        "https://example.invalid/1",
    ) is None


def test_sentry_requires_a_dsn():
    assert resolve_sentry_options("staging", "staging", "") is None


def test_sentry_keeps_staging_sampling():
    assert resolve_sentry_options(
        "staging",
        "",
        "https://example.invalid/1",
    ) == ("staging", 0.5, 0.1)


def test_sentry_disables_test_even_if_sentry_env_is_staging():
    assert resolve_sentry_options(
        "test",
        "staging",
        "https://example.invalid/1",
    ) is None


def test_sentry_keeps_production_sampling():
    assert resolve_sentry_options(
        "production",
        "",
        "https://example.invalid/1",
    ) == ("production", 0.1, 0.05)


def test_init_sentry_does_not_call_sdk_during_tests(monkeypatch):
    import sentry_sdk

    monkeypatch.setattr(sentry.settings, "APP_ENV", "test")
    monkeypatch.setattr(sentry.settings, "SENTRY_DSN", "https://example.invalid/1")
    monkeypatch.setattr(sentry.settings, "SENTRY_ENV", "development")
    init = Mock()
    monkeypatch.setattr(sentry_sdk, "init", init)

    sentry.init_sentry()

    init.assert_not_called()
