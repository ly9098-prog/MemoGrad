from app.core.sentry import _redact_sentry_breadcrumb, _redact_sentry_event


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
