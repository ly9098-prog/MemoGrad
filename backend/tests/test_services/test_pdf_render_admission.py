"""PDF pixel and memory limits must precede native raster allocation."""

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from app.services import pdf_renderer_service as service

fitz = pytest.importorskip("fitz")


def pdf_bytes(*, width=360, height=240, rotation=0):
    with fitz.open() as doc:
        page = doc.new_page(width=width, height=height)
        page.set_rotation(rotation)
        return doc.tobytes()


@pytest.mark.parametrize("budget", ["pixels", "memory"])
def test_native_pixmap_is_not_allocated_past_budget(monkeypatch, budget):
    source = pdf_bytes()
    raster = Mock(side_effect=AssertionError("must reject before allocation"))
    monkeypatch.setattr(fitz.Page, "get_pixmap", raster)
    if budget == "pixels":
        monkeypatch.setattr(service, "_MAX_PAGE_PIXELS", 100)
    else:
        monkeypatch.setattr(service.settings, "PDF_MAX_DECODED_BYTES", 100)
    with pytest.raises(service.PdfResourceLimitError) as caught:
        service._render_one_page(source, False, 1, 1200, 72)
    assert caught.value.code == (
        "page_pixel_limit" if budget == "pixels" else "decoded_memory_limit"
    )
    raster.assert_not_called()


@pytest.mark.parametrize("rotation", [0, 90])
def test_normal_pdf_rotation_and_raster_dimensions_are_preserved(rotation):
    source = pdf_bytes(rotation=rotation)
    result = service._render_one_page(source, False, 1, 1200, 72)
    with Image.open(BytesIO(result)) as image:
        assert image.size == ((360, 240) if rotation == 0 else (240, 360))


@pytest.mark.parametrize(
    ("width", "height", "dpi"),
    [(float("nan"), 100, 72), (100, float("inf"), 72), (0, 100, 72),
     (100, 100, 0), (100, 100, float("inf")), (100, 100, -1)],
)
def test_invalid_render_dimensions_fail_closed(width, height, dpi):
    page = SimpleNamespace(rect=SimpleNamespace(width=width, height=height))
    with pytest.raises(service.PdfResourceLimitError):
        service._enforce_page_pixel_budget(page, 1, dpi)
