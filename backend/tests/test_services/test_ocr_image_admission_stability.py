"""Standard image admission follows the configured engine and unique ownership."""

from types import SimpleNamespace

from app.core import deployment_profile, ocr_isolation, ocr_runtime_config
from app.services import import_image_upload as images
from app.services.import_upload_request import UploadRequest


def prepare(monkeypatch):
    monkeypatch.setattr(images.settings, "OCR_ENABLED", True)
    monkeypatch.setattr(
        images.runtime, "_validate_image_path", lambda _path: (80, 60, "PNG")
    )
    monkeypatch.setattr(
        images.runtime, "_sha256_of_file", lambda _path: "abcdef0123456789"
    )
    monkeypatch.setattr(
        deployment_profile,
        "detect_deployment_profile",
        lambda: deployment_profile.DeploymentProfile.LOCAL_IMPORT,
    )
    monkeypatch.setattr(ocr_isolation, "local_paddleocr_available", lambda: False)
    monkeypatch.setattr(
        ocr_runtime_config,
        "get_runtime_config",
        lambda: SimpleNamespace(
            enabled=True,
            execution_backend="paddlex_http",
            remote_url="http://ocr.invalid/ocr",
        ),
    )
    return UploadRequest(
        file_path="synthetic.png", filename="synthetic.png", content_type="image/png"
    )


def test_http_backend_does_not_require_local_paddleocr(monkeypatch):
    request = prepare(monkeypatch)
    assert images._prepare_image(request)[0].startswith("img_")


def test_identical_images_in_same_second_have_distinct_pipeline_owners(monkeypatch):
    request = prepare(monkeypatch)
    monkeypatch.setattr(ocr_isolation, "local_paddleocr_available", lambda: True)
    fixed = SimpleNamespace(strftime=lambda _fmt: "20261118_120000")
    monkeypatch.setattr(images, "datetime", SimpleNamespace(now=lambda: fixed))
    first = images._prepare_image(request)
    second = images._prepare_image(request)
    assert first[0] != second[0]
    assert first[1:] == second[1:]
