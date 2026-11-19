"""Stable digests and lookups for retired authentication identities."""

import hashlib
import hmac

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user_auth import UserIdentityTombstone


def identity_subject_digest(provider: str, namespace: str, subject: str) -> str:
    payload = "\0".join(("identity-tombstone", provider, namespace, subject)).encode()
    return hmac.new(
        settings.APP_SECRET.encode("utf-8"), payload, hashlib.sha256
    ).hexdigest()


async def is_tombstoned(
    db: AsyncSession, provider: str, namespace: str, subject: str
) -> bool:
    digest = identity_subject_digest(provider, namespace, subject)
    tombstone = await db.scalar(
        select(UserIdentityTombstone.id).where(
            UserIdentityTombstone.provider == provider,
            UserIdentityTombstone.namespace == namespace,
            UserIdentityTombstone.subject_digest == digest,
        )
    )
    return tombstone is not None
