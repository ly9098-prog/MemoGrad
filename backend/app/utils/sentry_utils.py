"""Sentry 统一工具类 — 封装 Sentry SDK，业务代码统一调用此模块。

所有函数均安全：Sentry 未初始化或 sentry-sdk 未安装时静默降级。
"""

import logging
from typing import Any

logger = logging.getLogger("postgraduate-ai.sentry_utils")

_SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "detail",
    "filename",
    "openid",
    "password",
    "prompt",
    "refresh_token",
    "source_file",
    "token",
    "user_id",
}


def _safe_tag_value(value: Any) -> str:
    text = str(value)
    return text[:200]


def _safe_context(value: dict[str, Any]) -> dict[str, Any]:
    return {
        str(key): "[REDACTED]" if str(key).lower() in _SENSITIVE_KEYS else value
        for key, value in value.items()
    }


def _is_sentry_available() -> bool:
    try:
        import sentry_sdk  # noqa: F401

        return sentry_sdk.is_initialized()  # type: ignore[no-any-return]
    except ImportError:
        return False


def capture_exception(exc: BaseException, tags: dict[str, Any] | None = None) -> None:
    """上报异常到 Sentry，可选附带标签。"""
    if not _is_sentry_available():
        return
    import sentry_sdk

    with sentry_sdk.push_scope() as scope:
        if tags:
            for k, v in tags.items():
                if str(k).lower() in _SENSITIVE_KEYS:
                    continue
                scope.set_tag(str(k), _safe_tag_value(v))
        sentry_sdk.capture_exception(exc)


def capture_message(
    msg: str, level: str = "info", tags: dict[str, Any] | None = None
) -> None:
    """上报消息到 Sentry，可选指定级别和标签。"""
    if not _is_sentry_available():
        return
    import sentry_sdk

    with sentry_sdk.push_scope() as scope:
        scope.set_level(level)
        if tags:
            for k, v in tags.items():
                if str(k).lower() in _SENSITIVE_KEYS:
                    continue
                scope.set_tag(str(k), _safe_tag_value(v))
        sentry_sdk.capture_message(msg)


def set_tag(key: str, value: Any) -> None:
    """设置当前 Scope 的 Tag（贯穿请求生命周期）。"""
    if not _is_sentry_available():
        return
    import sentry_sdk

    if str(key).lower() not in _SENSITIVE_KEYS:
        sentry_sdk.set_tag(key, _safe_tag_value(value))


def set_context(key: str, value: dict[str, Any]) -> None:
    """设置当前 Scope 的 Context 数据。"""
    if not _is_sentry_available():
        return
    import sentry_sdk

    sentry_sdk.set_context(key, _safe_context(value))


def start_span(op: str, description: str = ""):
    """启动 Sentry 子 Span，未初始化时返回 NoopSpan。"""
    if not _is_sentry_available():
        return _NoopSpan()
    import sentry_sdk

    return sentry_sdk.start_span(op=op, description=description)


def start_transaction(op: str, description: str = ""):
    """启动 Sentry 事务（用于独立流程，非 HTTP 请求）。"""
    if not _is_sentry_available():
        return _NoopSpan()
    import sentry_sdk

    return sentry_sdk.start_transaction(op=op, description=description)


class _NoopSpan:
    """Sentry 未初始化时的空操作 Span。"""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def set_tag(self, key, value):
        pass

    def set_context(self, key, value):
        pass

    def set_data(self, key, value):
        pass

    def finish(self):
        pass
