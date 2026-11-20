from app.core.config import settings
from app.services.production_config_validator import (
    _check_auth_delivery,
    _check_browser_auth_endpoints,
)


def _configure_domains(monkeypatch) -> None:
    monkeypatch.setattr(settings, "USER_WEB_BASE_URL", "https://xzshub.top")
    monkeypatch.setattr(settings, "ADMIN_WEB_BASE_URL", "https://admin.xzshub.top")
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://api.xzshub.top")
    monkeypatch.setattr(
        settings,
        "CORS_ORIGINS",
        ["https://xzshub.top", "https://admin.xzshub.top"],
    )
    monkeypatch.setattr(
        settings,
        "ALLOWED_HOSTS",
        [
            "xzshub.top",
            "www.xzshub.top",
            "admin.xzshub.top",
            "api.xzshub.top",
        ],
    )


def test_browser_auth_endpoints_require_exact_https_origins(monkeypatch):
    _configure_domains(monkeypatch)
    errors: list[str] = []

    _check_browser_auth_endpoints(errors)

    assert errors == []


def test_browser_auth_endpoints_reject_missing_origins_and_hosts(monkeypatch):
    _configure_domains(monkeypatch)
    monkeypatch.setattr(settings, "CORS_ORIGINS", ["https://xzshub.top"])
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", ["xzshub.top"])
    errors: list[str] = []

    _check_browser_auth_endpoints(errors)

    assert any(
        "ADMIN_WEB_BASE_URL" in item and "ALLOWED_HOSTS" in item for item in errors
    )
    assert any("PUBLIC_BASE_URL" in item and "ALLOWED_HOSTS" in item for item in errors)
    assert any(
        "ADMIN_WEB_BASE_URL" in item and "CORS_ORIGINS" in item for item in errors
    )


def test_browser_auth_endpoints_reject_shared_user_and_admin_domain(monkeypatch):
    _configure_domains(monkeypatch)
    monkeypatch.setattr(settings, "ADMIN_WEB_BASE_URL", "https://xzshub.top")
    errors: list[str] = []

    _check_browser_auth_endpoints(errors)

    assert any("必须使用不同站点" in item for item in errors)


def test_auth_delivery_validates_github_and_smtp_configuration(monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://api.xzshub.top")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "")
    monkeypatch.setattr(settings, "AUTH_EMAIL_ENABLED", True)
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "")
    errors: list[str] = []

    _check_auth_delivery(errors)

    assert any("GITHUB_CLIENT_ID" in item for item in errors)
    assert any("SMTP_HOST" in item for item in errors)
    assert any("SMTP_FROM_EMAIL" in item for item in errors)


def test_github_callback_uses_the_cookie_owning_web_origin(monkeypatch):
    _configure_domains(monkeypatch)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "test-client")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "test-secret")
    monkeypatch.setattr(settings, "AUTH_EMAIL_ENABLED", False)
    monkeypatch.setattr(
        settings,
        "GITHUB_OAUTH_CALLBACK_URL",
        "https://api.xzshub.top/api/v1/auth/github/callback",
    )
    errors = []
    _check_auth_delivery(errors)
    assert any("USER_WEB_BASE_URL" in item for item in errors)
    monkeypatch.setattr(
        settings,
        "GITHUB_OAUTH_CALLBACK_URL",
        "https://xzshub.top/api/v1/auth/github/callback",
    )
    errors = []
    _check_auth_delivery(errors)
    assert errors == []


def test_every_backend_role_receives_the_required_browser_origins():
    from pathlib import Path

    import yaml

    root = Path(__file__).resolve().parents[3]
    services = yaml.safe_load((root / "deploy/docker-compose.prod.yml").read_text())[
        "services"
    ]
    for role in ("app", "worker", "scheduler"):
        environment = services[role]["environment"]
        assert (
            environment["USER_WEB_BASE_URL"]
            == services["app"]["environment"]["USER_WEB_BASE_URL"]
        )
        assert (
            environment["ADMIN_WEB_BASE_URL"]
            == services["app"]["environment"]["ADMIN_WEB_BASE_URL"]
        )
