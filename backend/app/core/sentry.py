"""Sentry 异常监控集成 — 初始化配置。

支持 environment-aware 配置：
- production: 低采样率 (0.1 trace, 0.05 profile)
- test/staging: 中等采样率 (0.5 trace, 0.1 profile)
- development: 禁用 Sentry，不初始化，不上报
"""

import logging

from app.core.config import settings

logger = logging.getLogger("postgraduate-ai.sentry")


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
    if settings.APP_ENV == "development":
        logger.info("Sentry disabled: APP_ENV=development")
        return

    dsn = settings.SENTRY_DSN
    if not dsn:
        logger.info("Sentry disabled: SENTRY_DSN not configured")
        return

    env = settings.SENTRY_ENV or settings.APP_ENV or "development"

    # 按环境设置不同的采样率
    env_lower = env.lower()
    if env_lower in ("production", "prod"):
        traces_sample_rate = 0.1
        profiles_sample_rate = 0.05
    elif env_lower in ("staging", "test", "testing"):
        traces_sample_rate = 0.5
        profiles_sample_rate = 0.1
    else:
        # development: 全量 trace 方便调试，不开启 profile
        traces_sample_rate = 1.0
        profiles_sample_rate = 0.0

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.httpx import HttpxIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=dsn,
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
