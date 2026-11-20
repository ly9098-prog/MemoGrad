"""Local SMTP sockets and private Redis; no external credentials or inboxes."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import queue
import socketserver
import ssl
import subprocess
import threading
import time
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest
from redis.asyncio import Redis

from app.core.cache import cache
from app.core.config import settings
from app.services import email_delivery, email_otp_service, github_oauth_service
from tests.integration.owned_redis import OwnedRedis

pytestmark = pytest.mark.integration


class SmtpHandler(socketserver.StreamRequestHandler):
    def start_tls(self):
        self.rfile.close()
        self.wfile.close()
        self.request = self.server.tls.wrap_socket(self.connection, server_side=True)
        self.setup()
        self.server.events.append("tls")

    def authenticate(self, line):
        credentials = base64.b64decode(line.split()[2]).decode().split("\0")[1:]
        accepted = (
            isinstance(self.request, ssl.SSLSocket)
            and tuple(credentials) == self.server.credentials
            and self.server.failure != "auth"
        )
        self.server.events.append("auth" if accepted else "auth_rejected")
        return accepted

    def handle(self):
        def send(line):
            self.wfile.write(line + b"\r\n")
            self.wfile.flush()

        authenticated = False
        try:
            if self.server.transport == "ssl":
                self.start_tls()
            send(b"220 localhost auth acceptance")
            while line := self.rfile.readline():
                command = line.split(b" ", 1)[0].strip().upper()
                if command == b"EHLO":
                    if self.server.failure == "timeout":
                        time.sleep(0.25)
                    send(b"250-localhost")
                    send(
                        b"250 AUTH PLAIN"
                        if isinstance(self.request, ssl.SSLSocket)
                        else b"250 STARTTLS"
                    )
                elif command == b"STARTTLS":
                    send(b"220 Ready for TLS")
                    self.start_tls()
                elif command == b"AUTH":
                    authenticated = self.authenticate(line)
                    send(
                        b"235 Authenticated"
                        if authenticated
                        else b"535 Authentication failed"
                    )
                elif command == b"DATA":
                    if self.server.auth_required and not authenticated:
                        send(b"530 Authentication required")
                        continue
                    if self.server.failure == "reject":
                        send(b"550 Delivery refused")
                        continue
                    send(b"354 End with a dot")
                    parts = []
                    while (part := self.rfile.readline()) not in (b".\r\n", b""):
                        parts.append(part)
                    self.server.messages.put(b"".join(parts))
                    self.server.events.append("data")
                    send(b"250 Accepted")
                elif command == b"QUIT":
                    send(b"221 Bye")
                    break
                else:
                    send(b"250 OK")
        except OSError:
            pass  # A timeout deliberately closes the client side first.


@pytest.fixture()
def smtp(tmp_path, monkeypatch):
    certificate, key = tmp_path / "smtp.pem", tmp_path / "smtp.key"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=IP:127.0.0.1,DNS:localhost",
            "-keyout",
            str(key),
            "-out",
            str(certificate),
        ],
        check=True,
        capture_output=True,
        timeout=10,
    )
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(certificate, key)
    trust = ssl.create_default_context(cafile=str(certificate))
    monkeypatch.setattr(email_delivery.ssl, "create_default_context", lambda: trust)
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), SmtpHandler)
    server.daemon_threads = True
    server.transport, server.failure, server.tls = "plain", "", tls
    server.auth_required = False
    server.credentials = ("smtp-test-user", "smtp-test-secret")
    server.events = []
    server.messages = queue.Queue()
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
    )
    thread.start()
    for name, value in {
        "AUTH_EMAIL_ENABLED": True,
        "SMTP_HOST": "127.0.0.1",
        "SMTP_PORT": server.server_address[1],
        "SMTP_USERNAME": "",
        "SMTP_PASSWORD": "",
        "SMTP_FROM_EMAIL": "auth@example.com",
        "SMTP_USE_SSL": False,
        "SMTP_USE_STARTTLS": False,
        "SMTP_TIMEOUT_SEC": 2,
    }.items():
        monkeypatch.setattr(settings, name, value)
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.mark.parametrize("transport", ["plain", "ssl", "starttls"])
def test_smtp_otp_delivery_through_a_real_socket(smtp, transport, monkeypatch):
    smtp.transport = transport
    monkeypatch.setattr(settings, "SMTP_USE_SSL", transport == "ssl")
    monkeypatch.setattr(settings, "SMTP_USE_STARTTLS", transport == "starttls")
    subject, text = email_delivery.build_otp_email("user", "login", "654321")
    asyncio.run(
        email_delivery.send_auth_email(
            to_email="reader@example.com", subject=subject, text=text
        )
    )
    message = BytesParser(policy=policy.default).parsebytes(
        smtp.messages.get(timeout=2)
    )
    assert message["To"] == "reader@example.com"
    assert message["Subject"] == subject
    assert "654321" in message.get_content()


@pytest.mark.parametrize("failure", ["reject", "timeout"])
def test_smtp_failure_is_reported_without_exposing_transport_details(
    smtp, failure, monkeypatch
):
    smtp.failure = failure
    if failure == "timeout":
        monkeypatch.setattr(settings, "SMTP_TIMEOUT_SEC", 0.05)
    with pytest.raises(email_delivery.EmailDeliveryError, match="邮件发送失败"):
        asyncio.run(
            email_delivery.send_auth_email(
                to_email="reader@example.com",
                subject="Test",
                text="Synthetic content",
            )
        )
    assert smtp.messages.empty()


@pytest.mark.parametrize("transport", ["ssl", "starttls"])
@pytest.mark.parametrize("reject", [False, True])
def test_smtp_account_authentication_happens_inside_tls(
    smtp, transport, reject, monkeypatch
):
    smtp.transport, smtp.auth_required = transport, True
    smtp.failure = "auth" if reject else ""
    monkeypatch.setattr(settings, "SMTP_USE_SSL", transport == "ssl")
    monkeypatch.setattr(settings, "SMTP_USE_STARTTLS", transport == "starttls")
    monkeypatch.setattr(settings, "SMTP_USERNAME", smtp.credentials[0])
    monkeypatch.setattr(settings, "SMTP_PASSWORD", smtp.credentials[1])

    async def deliver():
        await email_delivery.send_auth_email(
            to_email="reader@example.com", subject="Test", text="Synthetic content"
        )

    if reject:
        with pytest.raises(email_delivery.EmailDeliveryError, match="邮件发送失败"):
            asyncio.run(deliver())
        assert smtp.events == ["tls", "auth_rejected"]
        assert smtp.messages.empty()
    else:
        asyncio.run(deliver())
        assert smtp.events == ["tls", "auth", "data"]
        assert not smtp.messages.empty()


@pytest.mark.parametrize("transport", ["ssl", "starttls"])
def test_smtp_rejects_an_untrusted_certificate(smtp, transport, monkeypatch):
    smtp.transport = transport
    monkeypatch.setattr(settings, "SMTP_USE_SSL", transport == "ssl")
    monkeypatch.setattr(settings, "SMTP_USE_STARTTLS", transport == "starttls")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.load_default_certs()
    monkeypatch.setattr(email_delivery.ssl, "create_default_context", lambda: context)
    with pytest.raises(email_delivery.EmailDeliveryError, match="邮件发送失败"):
        asyncio.run(
            email_delivery.send_auth_email(
                to_email="reader@example.com", subject="Test", text="Synthetic content"
            )
        )
    assert smtp.messages.empty()


def test_real_redis_budget_denials_do_not_block_other_users(monkeypatch):
    server = OwnedRedis()
    client = Redis.from_url(server.url)
    monkeypatch.setattr(cache, "_enabled", True)
    monkeypatch.setattr(cache, "_client", client)
    monkeypatch.setattr(settings, "REDIS_URL", server.url)
    monkeypatch.setattr(settings, "OTP_USER_DOMAIN_DAILY_LIMIT", 3)

    async def deliver(**_kwargs):
        pass

    monkeypatch.setattr(email_otp_service, "send_auth_email", deliver)

    async def run():
        async def issue(index):
            return await email_otp_service.issue_otp(
                domain="user",
                email=f"reader{index}@example.com",
                purpose="login",
                client_ip=str(index),
            )

        try:
            await issue(0)
            for _ in range(100):
                with pytest.raises(email_otp_service.OtpRateLimitError):
                    await issue(0)
            results = await asyncio.gather(
                *(issue(index) for index in range(1, 13)), return_exceptions=True
            )
            assert (
                sum(
                    isinstance(result, email_otp_service.IssuedOtp)
                    for result in results
                )
                == 2
            )
            key = email_otp_service._budget_keys(
                "user", "login", "reader0@example.com", "0"
            )[1]
            assert await cache.get_strict(key) == 3
            assert await client.ttl(key) > 0
        finally:
            await client.aclose()

    try:
        server.start()
        asyncio.run(run())
    finally:
        server.stop()


class GithubHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        form = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
        self.server.requests.append({"method": "POST", "path": self.path, "form": form})
        self.respond(*self.server.token_response)

    def do_GET(self):
        self.server.requests.append(
            {
                "method": "GET",
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "version": self.headers.get("X-GitHub-Api-Version"),
            }
        )
        self.respond(200, self.server.user)


@pytest.fixture()
def github(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), GithubHandler)
    server.daemon_threads = True
    server.requests = []
    server.token_response = (200, {"access_token": "provider-test-token"})
    server.user = {"id": 424242, "login": "synthetic-reader"}
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
    )
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    monkeypatch.setattr(github_oauth_service, "_TOKEN_URL", f"{base}/token")
    monkeypatch.setattr(github_oauth_service, "_USER_URL", f"{base}/user")
    monkeypatch.setattr(cache, "_enabled", False)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "transport-test-client")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "transport-test-secret")
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_github_code_exchange_uses_pkce_and_the_provider_http_contract(github):
    async def exchange():
        url, state = await github_oauth_service.start_github_oauth(
            mode="login", user_id=None, return_to="/"
        )
        context = await github_oauth_service.consume_oauth_state(state)
        query = parse_qs(urlsplit(url).query)
        expected = (
            base64.urlsafe_b64encode(
                hashlib.sha256(context["code_verifier"].encode()).digest()
            )
            .rstrip(b"=")
            .decode()
        )
        assert query["code_challenge"] == [expected]
        assert "client_secret" not in query
        user = await github_oauth_service.exchange_github_code(
            "transport-code", code_verifier=context["code_verifier"]
        )
        assert user["id"] == 424242
        form = github.requests[0]["form"]
        assert form["code_verifier"] == [context["code_verifier"]]
        assert form["code"] == ["transport-code"]
        assert form["client_id"] == ["transport-test-client"]
        assert form["client_secret"] == ["transport-test-secret"]
        assert form["redirect_uri"] == [settings.GITHUB_OAUTH_CALLBACK_URL]
        assert github.requests[1] == {
            "method": "GET",
            "path": "/user",
            "authorization": "Bearer provider-test-token",
            "version": "2022-11-28",
        }

    asyncio.run(exchange())


@pytest.mark.parametrize("status, payload", [(401, {}), (200, {"error": "bad_code"})])
def test_github_token_rejection_never_fetches_a_profile(github, status, payload):
    github.token_response = (status, payload)
    with pytest.raises(github_oauth_service.GithubOAuthError):
        asyncio.run(
            github_oauth_service.exchange_github_code("code", code_verifier="proof")
        )
    assert len(github.requests) == 1


def test_github_rejects_a_profile_without_a_stable_id(github):
    github.user = {"login": "synthetic-reader"}
    with pytest.raises(github_oauth_service.GithubOAuthError, match="账号信息无效"):
        asyncio.run(
            github_oauth_service.exchange_github_code("code", code_verifier="proof")
        )
