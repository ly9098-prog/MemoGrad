"""Read-only OCR sidecar downloads for the import workspaces."""

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.admin_security import require_permissions
from app.core.database import get_db
from app.services.batch_ocr_text_export import (
    OcrTextExport,
    OcrTextExportError,
    TextVariant,
    export_batch_ocr_text,
    export_item_ocr_text,
)

router = APIRouter()


def _download(result: OcrTextExport) -> PlainTextResponse:
    return PlainTextResponse(
        result.content,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(result.filename, safe='')}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/batch-image/{job_id}/ocr-text", response_class=PlainTextResponse)
async def download_batch_ocr_text(
    job_id: str,
    variant: TextVariant = "cleaned",
    _admin=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    """Download cached raw/cleaned text in image order, marking missing images."""
    try:
        return _download(await export_batch_ocr_text(db, job_id, variant))
    except OcrTextExportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/batch-image/items/{item_id}/ocr-text", response_class=PlainTextResponse)
async def download_item_ocr_text(
    item_id: int,
    variant: TextVariant = "cleaned",
    _admin=Depends(require_permissions("import:read")),
    db: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    """Download one image's text, including cached text from failed parsing."""
    try:
        return _download(await export_item_ocr_text(db, item_id, variant))
    except OcrTextExportError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
