"""Local SMTP sockets and private Redis; no external credentials or inboxes."""

from __future__ import annotations

import asyncio
import queue
import socketserver
import ssl
import subprocess
import threading
import time
from email import policy
from email.parser import BytesParser

import pytest
from redis.asyncio import Redis

from app.core.cache import cache
from app.core.config import settings
from app.services import email_delivery, email_otp_service
from tests.integration.owned_redis import OwnedRedis

pytestmark = pytest.mark.integration


class SmtpHandler(socketserver.StreamRequestHandler):
    def start_tls(self):
        self.rfile.close()
        self.wfile.close()
        self.request = self.server.tls.wrap_socket(self.connection, server_side=True)
        self.setup()

    def handle(self):
        def send(line):
            self.wfile.write(line + b"\r\n")
            self.wfile.flush()

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
                    send(b"250 STARTTLS")
                elif command == b"STARTTLS":
                    send(b"220 Ready for TLS")
                    self.start_tls()
                elif command == b"DATA":
                    if self.server.failure == "reject":
                        send(b"550 Delivery refused")
                        continue
                    send(b"354 End with a dot")
                    parts = []
                    while (part := self.rfile.readline()) not in (b".\r\n", b""):
                        parts.append(part)
                    self.server.messages.put(b"".join(parts))
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
