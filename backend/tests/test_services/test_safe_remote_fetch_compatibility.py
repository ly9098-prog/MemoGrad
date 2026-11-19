"""Real compatibility baseline for safe remote URL validation."""

from __future__ import annotations

import pytest

from app.services.safe_remote_fetch import (
    RemoteFetchTimeoutError,
    UnsafeRemoteURLError,
    is_safe_remote_url,
    request_remote_bytes,
    validate_remote_url,
)


@pytest.fixture(autouse=True)
def _public_dns(monkeypatch):
    monkeypatch.setattr(
        "app.services.safe_remote_fetch.socket.getaddrinfo",
        lambda *args, **kwargs: [
            (2, 1, 6, "", ("93.184.216.34", 443))
        ],
    )


class TestValidateRemoteUrl:
    def test_https_url_accepted(self):
        parsed, _ = validate_remote_url("https://example.com/path")
        assert parsed.scheme == "https"
        assert parsed.hostname == "example.com"

    def test_http_rejected_by_default(self):
        with pytest.raises(UnsafeRemoteURLError, match="HTTPS"):
            validate_remote_url("http://example.com/path")

    def test_http_allowed_with_flag(self):
        parsed, _ = validate_remote_url("http://example.com/path", allow_http=True)
        assert parsed.scheme == "http"

    def test_credentials_rejected(self):
        with pytest.raises(UnsafeRemoteURLError, match="credentials"):
            validate_remote_url("https://user:pass@example.com/path")

    def test_no_hostname_rejected(self):
        with pytest.raises(UnsafeRemoteURLError, match="hostname"):
            validate_remote_url("https:///path")

    def test_returns_parsed_and_addresses(self):
        parsed, addresses = validate_remote_url("https://example.com")
        assert parsed is not None
        assert isinstance(addresses, list)


class TestIsSafeRemoteUrl:
    def test_https_returns_true(self):
        assert is_safe_remote_url("https://example.com") is True

    def test_http_returns_false(self):
        assert is_safe_remote_url("http://example.com") is False

    def test_http_allowed_with_flag(self):
        assert is_safe_remote_url("http://example.com", allow_http=True) is True

    def test_credentials_returns_false(self):
        assert is_safe_remote_url("https://user:pass@example.com") is False

    def test_garbage_returns_false(self):
        assert is_safe_remote_url("not a url") is False

    def test_empty_returns_false(self):
        assert is_safe_remote_url("") is False


def test_many_short_reads_cannot_extend_shared_deadline(monkeypatch):
    now = {"value": 100.0}
    reads = []

    class FakeSocket:
        def settimeout(self, _timeout):
            return None

    class FakeResponse:
        status = 200

        def getheader(self, name, default=""):
            return default

        def read(self, _size):
            reads.append(now["value"])
            now["value"] += 0.04
            return b"x"

    class FakeConnection:
        def __init__(self, *args, **kwargs):
            self.sock = FakeSocket()

        def connect(self):
            return None

        def request(self, *args, **kwargs):
            return None

        def getresponse(self):
            return FakeResponse()

        def close(self):
            return None

    monkeypatch.setattr(
        "app.services.safe_remote_fetch.time.monotonic",
        lambda: now["value"],
    )
    monkeypatch.setattr(
        "app.services.safe_remote_fetch._PinnedHTTPSConnection",
        FakeConnection,
    )

    with pytest.raises(RemoteFetchTimeoutError, match="timed out"):
        request_remote_bytes(
            "https://example.com/stream",
            max_bytes=1024,
            timeout=0.1,
        )

    assert len(reads) <= 3
