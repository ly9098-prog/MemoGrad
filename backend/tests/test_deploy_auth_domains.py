"""The release gate verifies HTTPS and rejects routing across identity domains."""

import argparse
import importlib.util
import ssl
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "deploy/scripts/check-auth-domains.py"
SPEC = importlib.util.spec_from_file_location("auth_domain_check", SCRIPT)
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


@pytest.fixture()
def network(monkeypatch):
    responses = {
        ("example.com", "/login"): (200, None),
        ("admin.example.com", "/login"): (200, None),
        ("api.example.com", "/"): (404, None),
        ("www.example.com", "/login?from=domain-check"): (
            301,
            "https://example.com/login?from=domain-check",
        ),
        ("example.com", "/api/v1/users/me"): (401, None),
        ("admin.example.com", "/api/admin/v1/auth/me"): (401, None),
        ("api.example.com", "/api/v1/users/me"): (401, None),
        ("example.com", "/api/admin/v1/auth/me"): (404, None),
        ("admin.example.com", "/api/v1/users/me"): (404, None),
        ("api.example.com", "/api/admin/v1/auth/me"): (404, None),
        ("api.example.com", "/api/v1/health"): (200, None),
    }
    connections = []

    class Connection:
        def __init__(self, host, *, timeout, context):
            assert timeout > 0
            assert context.check_hostname
            assert context.verify_mode == ssl.CERT_REQUIRED
            self.host, self.path, self.closed = host, None, False
            connections.append(self)

        def request(self, method, path, *, headers):
            assert method == "GET"
            assert set(headers) == {"User-Agent"}
            self.path = path

        def getresponse(self):
            result = responses[self.host, self.path]
            if isinstance(result, Exception):
                raise result
            self.status, self.location = result
            return self

        def getheader(self, name):
            assert name == "Location"
            return self.location

        def close(self):
            self.closed = True

    monkeypatch.setattr(gate.http.client, "HTTPSConnection", Connection)
    return responses, connections


def test_gate_checks_tls_authentication_and_all_route_boundaries(network):
    _, connections = network
    result = gate.inspect_domains("example.com")
    assert result["ok"]
    assert len(result["checks"]) == len(connections) == 11
    assert all(item["tls_verified"] for item in result["checks"])
    assert all(connection.closed for connection in connections)


@pytest.mark.parametrize("status", [200, 307])
def test_gate_rejects_an_old_redirect_or_exposed_admin_api(network, status):
    responses, _ = network
    key = (
        ("www.example.com", "/login?from=domain-check")
        if status == 307
        else ("example.com", "/api/admin/v1/auth/me")
    )
    responses[key] = (status, None)
    assert not gate.inspect_domains("example.com")["ok"]


def test_gate_rejects_redirects_that_drop_the_path_or_query(network):
    responses, connections = network
    responses["www.example.com", "/login?from=domain-check"] = (
        301,
        "https://example.com/",
    )
    result = gate.inspect_domains("example.com")
    assert not result["ok"]
    assert sum(not item["ok"] for item in result["checks"]) == 1
    assert len(connections) == 11  # Redirects never cause a follow-up request.


@pytest.mark.parametrize(
    "error, expected",
    [
        (ssl.SSLCertVerificationError("mismatch"), "tls_verification_failed"),
        (TimeoutError(), "timeout"),
    ],
)
def test_tls_and_connection_failures_are_reported_without_succeeding(
    network, error, expected
):
    responses, connections = network
    responses["api.example.com", "/"] = error
    result = gate.inspect_domains("example.com")
    assert not result["ok"]
    failure = next(item for item in result["checks"] if not item["ok"])
    assert failure["error"] == expected
    assert all(connection.closed for connection in connections)


@pytest.mark.parametrize(
    "value", ["https://example.com", "example.com:443", "example.com/path"]
)
def test_cli_rejects_a_url_instead_of_a_domain(value):
    with pytest.raises(argparse.ArgumentTypeError):
        gate.domain_name(value)
