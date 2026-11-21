import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/v1/users/me/identities/wechat/bind"),
        ("POST", "/api/v1/users/me/identities/wechat/bind/start"),
        ("GET", "/api/v1/users/me/identities/wechat/bind/status/retired-challenge"),
        ("POST", "/api/v1/users/me/identities/wechat/bind/retired-challenge/cancel"),
        ("POST", "/api/v1/auth/wechat/bind/confirm"),
    ],
)
def test_undecided_wechat_binding_has_no_active_route(method, path):
    response = TestClient(app).request(method, path)

    assert response.status_code == 404


def test_wechat_login_and_web_identity_management_remain_registered():
    paths = app.openapi()["paths"]

    assert "post" in paths["/api/v1/auth/login"]
    assert "post" in paths["/api/v1/users/me/identities/email/bind/start"]
    assert "post" in paths["/api/v1/users/me/identities/email/bind/verify"]
    assert "post" in paths["/api/v1/users/me/identities/github/start"]
    assert all("/wechat/bind" not in path for path in paths)
