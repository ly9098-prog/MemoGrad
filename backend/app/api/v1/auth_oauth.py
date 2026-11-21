import hmac
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.browser_origin import enforce_trusted_browser_origin
from app.core.config import settings
from app.core.database import get_db
from app.core.runtime_paths import API_V1_PREFIX
from app.core.security import (
    decode_user_step_up_token,
    get_current_user,
    issue_user_token,
    read_user_nbf,
)
from app.core.user_web_auth import (
    USER_REFRESH_COOKIE_KEY,
    _secure,
    delete_user_refresh_cookie,
)
from app.models.user import User
from app.schemas.user import (
    GithubLinkStartRequest,
    GithubStartRequest,
    GithubStartResponse,
)
from app.services import (
    github_identity_service,
    github_oauth_service,
    identity_service,
    token_service,
    user_auth_service,
    user_service,
)

router = APIRouter(prefix=API_V1_PREFIX)
_STATE_COOKIE = "github_oauth_state"
_STEP_UP_COOKIE = "github_step_up"
_STEP_UP_PATH = "/api/v1/users/me/identities/github/step-up/result"


def _set_state_cookie(response: Response, state: str, request: Request) -> None:
    response.set_cookie(
        _STATE_COOKIE,
        state,
        httponly=True,
        secure=_secure(request),
        samesite="lax",
        path="/api/v1/auth/github",
        max_age=settings.GITHUB_OAUTH_STATE_TTL_SEC,
    )


def _safe_return_to(value: str) -> str:
    candidate = str(value or "/").strip()
    if (
        not candidate.startswith("/")
        or candidate.startswith("//")
        or "\\" in candidate
        or any(ord(char) < 0x20 or ord(char) == 0x7F for char in candidate)
    ):
        return "/"
    return candidate[:512]


def _with_verified_flag(target: str) -> str:
    parts = urlsplit(target)
    query = [
        (key, item)
        for key, item in parse_qsl(parts.query, keep_blank_values=True)
        if key != "verified"
    ]
    query.append(("verified", "github"))
    return urlunsplit(("", "", parts.path, urlencode(query), parts.fragment))


def _redirect_error(code: str) -> RedirectResponse:
    return RedirectResponse(
        f"{settings.USER_WEB_BASE_URL}/account/login?auth_error={quote(code)}",
        status_code=303,
    )


@router.post("/auth/github/start", response_model=GithubStartResponse)
async def start_github_login(
    data: GithubStartRequest, request: Request, response: Response
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    try:
        consent = user_auth_service.validate_registration_consent(
            accepted_terms=data.accepted_terms,
            agreement_version=data.agreement_version,
            privacy_version=data.privacy_version,
        )
        url, state = await github_oauth_service.start_github_oauth(
            mode="login",
            user_id=None,
            return_to=_safe_return_to(data.return_to),
            extra={"consent": consent},
        )
    except (ValueError, github_oauth_service.GithubOAuthError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _set_state_cookie(response, state, request)
    return GithubStartResponse(authorization_url=url, state=state)


@router.post("/users/me/identities/github/start", response_model=GithubStartResponse)
async def start_github_link(
    request: Request,
    response: Response,
    data: GithubLinkStartRequest | None = None,
    current_user: User = Depends(get_current_user),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    return_to = _safe_return_to(data.return_to if data else "/settings")
    try:
        url, state = await github_oauth_service.start_github_oauth(
            mode="link",
            user_id=current_user.id,
            return_to=return_to,
            extra={"nbf": await read_user_nbf(current_user.id)},
        )
    except github_oauth_service.GithubOAuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    _set_state_cookie(response, state, request)
    return GithubStartResponse(authorization_url=url, state=state)


@router.post(
    "/users/me/identities/github/step-up/start", response_model=GithubStartResponse
)
async def start_github_step_up(
    request: Request,
    response: Response,
    return_to: str | None = None,
    current_user: User = Depends(get_current_user),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    target = _safe_return_to(return_to or "/settings")
    try:
        url, state = await github_oauth_service.start_github_oauth(
            mode="step_up",
            user_id=current_user.id,
            return_to=target,
            extra={"nbf": await read_user_nbf(current_user.id)},
        )
    except github_oauth_service.GithubOAuthError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    _set_state_cookie(response, state, request)
    return GithubStartResponse(authorization_url=url, state=state)


@router.post("/users/me/identities/github/step-up/result")
async def github_step_up_result(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    token = request.cookies.get(_STEP_UP_COOKIE, "")
    decode_user_step_up_token(token, user_id=current_user.id)
    response.delete_cookie(_STEP_UP_COOKIE, path=_STEP_UP_PATH)
    return {"step_up_token": token}


@router.get("/auth/github/callback")
async def github_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if not state or not hmac.compare_digest(
        state, request.cookies.get(_STATE_COOKIE, "")
    ):
        return _redirect_error("github_failed")
    if not code:
        return _redirect_error("github_cancelled")
    try:
        context = await github_oauth_service.consume_oauth_state(state)
        data = await github_oauth_service.exchange_github_code(
            code, code_verifier=str(context["code_verifier"])
        )
    except github_oauth_service.GithubOAuthError:
        return _redirect_error("github_failed")
    try:
        user, identity = await github_identity_service.resolve_github_identity(
            db, context, data
        )
    except github_identity_service.GithubIdentityError as exc:
        return _redirect_error(str(exc))
    step_up = context.get("mode") == "step_up"
    target = _safe_return_to(str(context.get("return_to") or "/"))
    if step_up:
        target = _with_verified_flag(target)
    response = RedirectResponse(
        f"{settings.USER_WEB_BASE_URL}{target}", status_code=303
    )
    response.delete_cookie(_STATE_COOKIE, path="/api/v1/auth/github")
    if step_up:
        response.set_cookie(
            _STEP_UP_COOKIE,
            await user_auth_service.issue_step_up_token(user.id, identity.id),
            httponly=True,
            secure=_secure(request),
            samesite="lax",
            path=_STEP_UP_PATH,
            max_age=300,
        )
    else:
        await user_auth_service.issue_web_session(db, user, response, request)
    return response


@router.post("/auth/web/refresh")
async def refresh_web_session(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    raw = request.cookies.get(USER_REFRESH_COOKIE_KEY)
    if not raw:
        raise HTTPException(status_code=401, detail="登录状态已失效")
    token_record = await token_service.verify_refresh_token(db, raw)
    if token_record is None:
        delete_user_refresh_cookie(response, request)
        raise HTTPException(status_code=401, detail="登录状态已失效")
    user = await db.get(User, token_record.user_id)
    if user is None:
        delete_user_refresh_cookie(response, request)
        raise HTTPException(status_code=401, detail="登录状态已失效")
    try:
        await identity_service.validate_identity_user(user)
    except identity_service.IdentityUnavailableError as exc:
        await token_service.revoke_all_user_tokens(db, user.id)
        delete_user_refresh_cookie(response, request)
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    nbf_before = await read_user_nbf(user.id)
    try:
        new_refresh_token = await token_service.rotate_refresh_token(db, token_record)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="登录状态已失效") from exc
    if await read_user_nbf(user.id) != nbf_before:
        await token_service.revoke_all_user_tokens(db, user.id)
        delete_user_refresh_cookie(response, request)
        raise HTTPException(status_code=401, detail="会话已失效，请重新登录")
    access_token, expires_at = await issue_user_token(user.id, expected_nbf=nbf_before)
    from app.core.user_web_auth import set_user_refresh_cookie

    set_user_refresh_cookie(response, new_refresh_token, request)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_at": expires_at,
        "user": await user_service.get_user_response(db, user),
    }


@router.post("/auth/web/logout")
async def logout_web_session(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    enforce_trusted_browser_origin(request, settings.USER_WEB_BASE_URL)
    raw = request.cookies.get(USER_REFRESH_COOKIE_KEY)
    if raw:
        token_record = await token_service.verify_refresh_token(db, raw)
        if token_record:
            await user_auth_service.invalidate_user_sessions(db, token_record.user_id)
    delete_user_refresh_cookie(response, request)
    return {"status": "ok"}
