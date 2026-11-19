"""Resolve the App principal retained by durable task producers."""

from typing import Any


def app_owner_user_id(payload: dict[str, Any]) -> int | None:
    for key in ("owner_user_id", "user_id", "created_by"):
        value = payload.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str):
            value = value.removeprefix("user:")
            if value.isascii() and value.isdigit() and len(value) <= 19:
                user_id = int(value)
                if user_id > 0:
                    return user_id
    return None
