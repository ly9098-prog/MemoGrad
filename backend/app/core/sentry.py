"""Sentry 异常监控集成 — 初始化配置。

支持 environment-aware 配置：
- production: 低采样率 (0.1 trace, 0.05 profile)
- staging: 中等采样率 (0.5 trace, 0.1 profile)
- development/test: 禁用 Sentry，不初始化，不上报
"""

import logging

from app.core.config import settings

logger = logging.getLogger("postgraduate-ai.sentry")
_DISABLED_APP_ENVS = frozenset({"development", "dev", "local", "test", "testing"})
_STAGING_ENVS = frozenset({"staging", "stage"})
_PRODUCTION_ENVS = frozenset({"production", "prod"})


def resolve_sentry_options(
    app_env: str,
    sentry_env: str,
    dsn: str,
) -> tuple[str, float, float] | None:
    """Return (environment, trace rate, profile rate), or None when disabled."""
    normalized_app_env = (app_env or "").strip().lower()
    if normalized_app_env in _DISABLED_APP_ENVS:
        return None
    if not dsn:
        return None

    environment = (sentry_env or app_env or "development").strip()
    normalized_env = environment.lower()
    if normalized_env in _PRODUCTION_ENVS:
        return environment, 0.1, 0.05
    if normalized_env in _STAGING_ENVS:
        return environment, 0.5, 0.1
    return environment, 1.0, 0.0


def _redact_sentry_event(event, _hint):
    """Remove request and log-context fields that can carry learner data."""
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("cookies", None)
        request.pop("data", None)
        request.pop("query_string", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            for name in (
                "authorization",
                "cookie",
                "x-wechat-code",
                "x-refresh-token",
            ):
                headers.pop(name, None)
                headers.pop(name.title(), None)
    tags = event.get("tags")
    if isinstance(tags, dict):
        for key in ("log.user_id", "user_id", "log.source_file", "source_file", "upload.filename"):
            tags.pop(key, None)
    event.pop("user", None)
    return event


def _redact_sentry_breadcrumb(breadcrumb, _hint):
    data = breadcrumb.get("data")
    if isinstance(data, dict):
        for key in list(data):
            if str(key).lower() in {
                "authorization",
                "cookie",
                "filename",
                "openid",
                "prompt",
                "source_file",
                "token",
                "user_id",
            }:
                data[key] = "[REDACTED]"
    return breadcrumb


def init_sentry():
    options = resolve_sentry_options(
        settings.APP_ENV,
        settings.SENTRY_ENV,
        settings.SENTRY_DSN,
    )
    if options is None:
        normalized_app_env = (settings.APP_ENV or "").strip().lower()
        if normalized_app_env in _DISABLED_APP_ENVS:
            logger.info(
                "Sentry disabled: APP_ENV=%s",
                normalized_app_env,
            )
        else:
            logger.info("Sentry disabled: SENTRY_DSN not configured")
        return

    env, traces_sample_rate, profiles_sample_rate = options

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.httpx import HttpxIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=settings.SENTRY_DSN,
            environment=env,
            traces_sample_rate=traces_sample_rate,
            profiles_sample_rate=profiles_sample_rate,
            send_default_pii=False,
            before_send=_redact_sentry_event,
            before_breadcrumb=_redact_sentry_breadcrumb,
            integrations=[
                FastApiIntegration(),
                SqlalchemyIntegration(),
                HttpxIntegration(),
            ],
        )
        logger.info(
            "Sentry initialized: env=%s, traces_sample_rate=%s, profiles_sample_rate=%s",
            env,
            traces_sample_rate,
            profiles_sample_rate,
        )
    except ImportError:
        logger.warning("Sentry skipped: sentry-sdk not installed")
    except Exception as e:
        logger.error("Sentry init failed: %s", e)
