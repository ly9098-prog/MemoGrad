"""Export existing OCR caches, including partial results, without rerunning a model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_batch_job import ImportBatchJob, ImportBatchJobItem

TextVariant = Literal["raw", "cleaned"]
MAX_EXPORT_BYTES = 10 * 1024 * 1024


class OcrTextExportError(ValueError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class OcrTextExport:
    filename: str
    content: str


def _render_export(job_id: str, variant: TextVariant, rows: list) -> OcrTextExport:
    cached = sum(bool(row.text) for row in rows)
    if not cached:
        raise OcrTextExportError(
            "尚无可导出的 OCR 文本，请等待识别完成或检查失败原因", 409
        )
    parts = [
        f"OCR text export\njob_id: {job_id}\nvariant: {variant}\ncached: {cached}/{len(rows)}\n"
    ]
    size = len(parts[0].encode("utf-8"))
    for row in rows:
        filename = "".join(
            char if char.isprintable() else " " for char in (row.source_file or "")
        )
        text = row.text if row.text else "[未保留 OCR 文本 / OCR text unavailable]"
        part = f"\n--- image {row.seq}: {filename} [{row.status}] ---\n{text}\n"
        size += len(part.encode("utf-8")) + 1  # form-feed between parts
        if size > MAX_EXPORT_BYTES:
            raise OcrTextExportError("OCR 文本超过导出大小限制，请逐张导出", 413)
        parts.append(part)
    return OcrTextExport(f"ocr-{job_id}-{variant}.txt", "\f".join(parts))


async def _export(
    db: AsyncSession,
    job_id: str,
    variant: TextVariant,
    item_id: int | None = None,
) -> OcrTextExport:
    column = (
        ImportBatchJobItem.ocr_raw_text
        if variant == "raw"
        else ImportBatchJobItem.ocr_cleaned_text
    )
    filters = [ImportBatchJobItem.job_id == job_id]
    if item_id is not None:
        filters.append(ImportBatchJobItem.id == item_id)
    length = await db.scalar(select(func.sum(func.length(column))).where(*filters))
    if length and length > MAX_EXPORT_BYTES:
        raise OcrTextExportError("OCR 文本超过导出大小限制，请逐张导出", 413)
    rows = (
        await db.execute(
            select(
                ImportBatchJobItem.seq,
                ImportBatchJobItem.source_file,
                ImportBatchJobItem.status,
                column.label("text"),
            )
            .where(*filters)
            .order_by(ImportBatchJobItem.seq)
        )
    ).all()
    return _render_export(job_id, variant, rows)


async def export_batch_ocr_text(
    db: AsyncSession,
    job_id: str,
    variant: TextVariant,
) -> OcrTextExport:
    if await db.get(ImportBatchJob, job_id) is None:
        raise OcrTextExportError("批量导题任务不存在", 404)
    return await _export(db, job_id, variant)


async def export_item_ocr_text(
    db: AsyncSession,
    item_id: int,
    variant: TextVariant,
) -> OcrTextExport:
    item = await db.get(ImportBatchJobItem, item_id)
    if item is None:
        raise OcrTextExportError("批量导题条目不存在", 404)
    return await _export(db, item.job_id, variant, item_id)
