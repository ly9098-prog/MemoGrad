from fastapi import Request, Response

from app.core.config import settings

USER_REFRESH_COOKIE_KEY = "user_refresh_token"
_COOKIE_PATH = "/api/v1/auth"


def _secure(request: Request | None) -> bool:
    if settings.APP_ENV.lower() == "production":
        return True
    if request is None:
        return False
    return (
        request.url.scheme == "https"
        or request.headers.get("x-forwarded-proto") == "https"
    )


def set_user_refresh_cookie(
    response: Response, value: str, request: Request | None = None
) -> None:
    secure = _secure(request)
    response.set_cookie(
        USER_REFRESH_COOKIE_KEY,
        value,
        httponly=True,
        secure=secure,
        samesite="lax",
        path=_COOKIE_PATH,
        max_age=90 * 24 * 60 * 60,
    )


def delete_user_refresh_cookie(
    response: Response, request: Request | None = None
) -> None:
    response.set_cookie(
        USER_REFRESH_COOKIE_KEY,
        "",
        httponly=True,
        secure=_secure(request),
        samesite="lax",
        path=_COOKIE_PATH,
        max_age=0,
    )
