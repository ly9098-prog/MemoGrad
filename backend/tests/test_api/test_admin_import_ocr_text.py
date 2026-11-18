"""OCR cache downloads keep Admin authentication and parameter validation."""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import admin_import_ocr_text as routes
from app.core.database import get_db
from app.services.batch_ocr_text_export import OcrTextExport, OcrTextExportError


@pytest.fixture
def download_client(monkeypatch):
    app = FastAPI()
    app.include_router(routes.router, prefix="/imports")

    async def fake_db():
        yield object()

    app.dependency_overrides[get_db] = fake_db
    exported = AsyncMock(return_value=OcrTextExport("ocr-测试-raw.txt", "原文\n第二行"))
    monkeypatch.setattr(routes, "export_batch_ocr_text", exported)
    monkeypatch.setattr(routes, "export_item_ocr_text", exported)
    with TestClient(app) as client:
        yield client, exported


def authenticate(client):
    for handler in (routes.download_batch_ocr_text, routes.download_item_ocr_text):
        guard = inspect.signature(handler).parameters["_admin"].default.dependency
        client.app.dependency_overrides[guard] = lambda: object()


@pytest.mark.parametrize(
    "path",
    ["/imports/batch-image/job/ocr-text", "/imports/batch-image/items/1/ocr-text"],
)
def test_download_requires_admin_authentication(download_client, path):
    client, exported = download_client
    assert client.get(path).status_code == 401
    exported.assert_not_called()


@pytest.mark.parametrize(
    "path",
    ["/imports/batch-image/job/ocr-text", "/imports/batch-image/items/1/ocr-text"],
)
def test_download_is_utf8_attachment_without_cache(download_client, path):
    client, exported = download_client
    authenticate(client)
    response = client.get(path, params={"variant": "raw"})
    assert response.status_code == 200 and response.text == "原文\n第二行"
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    assert response.headers["cache-control"] == "no-store"
    assert (
        "filename*=UTF-8''ocr-%E6%B5%8B%E8%AF%95-raw.txt"
        in response.headers["content-disposition"]
    )
    assert exported.await_args.args[-1] == "raw"


def test_unknown_variant_and_invalid_item_id_are_rejected(download_client):
    client, exported = download_client
    authenticate(client)
    assert (
        client.get("/imports/batch-image/job/ocr-text?variant=corrected").status_code
        == 422
    )
    assert client.get("/imports/batch-image/items/no-id/ocr-text").status_code == 422
    exported.assert_not_called()


@pytest.mark.parametrize("code", [404, 409, 413])
def test_service_failures_keep_their_status_code(download_client, code):
    client, exported = download_client
    authenticate(client)
    exported.side_effect = OcrTextExportError("synthetic unavailable text", code)
    response = client.get("/imports/batch-image/job/ocr-text")
    assert response.status_code == code
    assert response.json()["detail"] == "synthetic unavailable text"
