from urllib.parse import urlsplit

from fastapi import HTTPException, Request, status


def normalize_origin(value: str) -> str | None:
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError:
        return None
    return f"{parsed.scheme.lower()}://{parsed.hostname.lower()}:{port}"


def enforce_trusted_browser_origin(request: Request, expected_base_url: str) -> None:
    """Reject browser requests whose Origin is outside the owning Web domain.

    Non-browser clients commonly omit Origin and are left to authentication and
    rate-limit checks. Cross-site browser requests are rejected even when the
    header is absent, so cookie-bearing endpoints fail closed.
    """

    origin = request.headers.get("origin")
    fetch_site = request.headers.get("sec-fetch-site", "").lower()
    expected = normalize_origin(expected_base_url)
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service temporarily unavailable",
        )
    if not origin:
        if fetch_site == "cross-site":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid request origin",
            )
        return
    if normalize_origin(origin) != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid request origin",
        )
