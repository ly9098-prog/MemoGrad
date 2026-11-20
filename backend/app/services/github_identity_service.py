"""Resolve verified GitHub profiles within an explicit user-auth operation."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import read_user_nbf
from app.models.user import User
from app.models.user_auth import UserAuthIdentity
from app.services import identity_service, user_auth_service


class GithubIdentityError(ValueError):
    """A public redirect code, without credentials or provider details."""


async def _existing_user(db: AsyncSession, context: dict[str, Any]) -> User:
    user_id = int(context.get("user_id") or 0)
    user = await db.get(User, user_id)
    if not identity_service.user_is_usable(user):
        raise GithubIdentityError("account_unavailable")
    if await read_user_nbf(user_id) != context.get("nbf"):
        raise GithubIdentityError("account_unavailable")
    return user


async def resolve_github_identity(
    db: AsyncSession, context: dict[str, Any], profile: dict[str, Any]
) -> tuple[User, UserAuthIdentity]:
    mode = context.get("mode")
    subject = str(profile["id"])
    try:
        if mode in {"link", "step_up"}:
            user = await _existing_user(db, context)
            if mode == "step_up":
                identity = await identity_service.find_identity(
                    db, provider="github", namespace="github.com", subject=subject
                )
                if identity is None or identity.user_id != user.id:
                    raise GithubIdentityError("github_verification_failed")
                return user, identity
            identity = await identity_service.bind_identity(
                db,
                user=user,
                provider="github",
                namespace="github.com",
                subject=subject,
            )
            await user_auth_service.invalidate_user_sessions(db, user.id)
            return user, identity
        user, identity = await identity_service.authenticate_identity(
            db,
            provider="github",
            namespace="github.com",
            subject=subject,
            allow_register=True,
            display_name=str(profile.get("name") or profile.get("login") or "")[:64]
            or None,
        )
        consent = context.get("consent")
        if isinstance(consent, dict) and consent:
            await user_auth_service.record_consents(db, user.id, consent)
        return user, identity
    except identity_service.IdentityUnavailableError as exc:
        raise GithubIdentityError("account_unavailable") from exc
    except identity_service.IdentityConflictError as exc:
        code = "identity_already_exists" if mode == "link" else "github_failed"
        raise GithubIdentityError(code) from exc
