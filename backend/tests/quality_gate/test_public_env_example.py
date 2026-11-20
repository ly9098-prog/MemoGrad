"""Public configuration templates cannot carry authentication credentials."""

from pathlib import Path

import pytest
from dotenv import dotenv_values


@pytest.mark.parametrize("key", [
    "USER_JWT_SECRET", "ADMIN_JWT_SECRET", "OBSERVABILITY_TOKEN",
    "GITHUB_CLIENT_SECRET", "SMTP_PASSWORD",
])
def test_auth_credentials_are_empty_in_public_env_template(key):
    template = Path(__file__).resolve().parents[2] / ".env.example"
    assert not dotenv_values(template).get(key), f"{key} must be configured privately"
