"""Bound legacy comma-separated filters before expanding SQL predicates."""

from fastapi import HTTPException


def require_bounded_csv(
    raw: str | None, *, field: str, max_items: int, max_length: int
) -> None:
    if not isinstance(raw, str):
        return
    if len(raw) > max_length:
        raise HTTPException(status_code=422, detail=f"{field} 参数过长")
    if sum(bool(item.strip()) for item in raw.split(",")) > max_items:
        raise HTTPException(
            status_code=422, detail=f"{field} 最多允许 {max_items} 项"
        )
