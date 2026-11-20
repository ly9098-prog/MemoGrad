import tempfile

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.user import User
from app.models.user_auth import UserAuthIdentity, UserIdentityTombstone
from app.services import identity_service, user_auth_service


@pytest_asyncio.fixture()
async def session():
    db_file = tempfile.NamedTemporaryFile(
        prefix="identity_", suffix=".db", delete=False
    )
    db_file.close()
    import app.models  # noqa: F401

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_file.name}")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        yield db
    await engine.dispose()


@pytest.mark.asyncio
async def test_email_identity_keeps_same_user_and_rejects_cross_account_bind(session):
    user, identity = await identity_service.authenticate_identity(
        session,
        provider="email",
        namespace="user",
        subject="one@example.com",
        allow_register=True,
    )
    returned, returned_identity = await identity_service.authenticate_identity(
        session,
        provider="email",
        namespace="user",
        subject="one@example.com",
        allow_register=False,
    )

    assert returned.id == user.id
    assert returned_identity.id == identity.id
    other = User(nickname="other", lifecycle_status="active")
    session.add(other)
    await session.commit()
    with pytest.raises(identity_service.IdentityConflictError):
        await identity_service.bind_identity(
            session,
            user=other,
            provider="email",
            namespace="user",
            subject="one@example.com",
        )


@pytest.mark.asyncio
async def test_last_identity_cannot_be_removed_and_tombstone_blocks_reregistration(
    session,
):
    user, identity = await identity_service.authenticate_identity(
        session,
        provider="github",
        namespace="github.com",
        subject="12345",
        allow_register=True,
    )
    with pytest.raises(identity_service.IdentityConflictError, match="至少需要保留"):
        await identity_service.unbind_identity(
            session, user_id=user.id, identity_id=identity.id
        )

    await identity_service.tombstone_user_identities(session, user.id)
    await session.commit()
    assert await session.scalar(select(UserIdentityTombstone.id)) is not None
    with pytest.raises(identity_service.IdentityUnavailableError, match="已注销"):
        await identity_service.authenticate_identity(
            session,
            provider="github",
            namespace="github.com",
            subject="12345",
            allow_register=True,
        )
    other = User(nickname="other", lifecycle_status="active")
    session.add(other)
    await session.commit()
    with pytest.raises(identity_service.IdentityUnavailableError, match="已注销"):
        await identity_service.bind_identity(
            session,
            user=other,
            provider="github",
            namespace="github.com",
            subject="12345",
        )
    assert await session.scalar(select(UserAuthIdentity.id)) is None


@pytest.mark.asyncio
async def test_email_replacement_is_unique_and_updates_verification(session):
    user, _identity = await identity_service.authenticate_identity(
        session,
        provider="email",
        namespace="user",
        subject="old@example.com",
        allow_register=True,
    )
    replaced = await identity_service.replace_email_identity(
        session,
        user_id=user.id,
        old_email="old@example.com",
        new_email="new@example.com",
    )
    assert replaced.subject == "new@example.com"
    assert replaced.verified_at is not None


def test_email_normalization_has_conservative_case_rules():
    from app.core.email_address import normalize_email

    assert normalize_email(" User+Tag@Example.COM ") == "User+Tag@example.com"
    with pytest.raises(ValueError):
        normalize_email("not-an-email")
    for value in ("a,b@example.com", "<a>@example.com", "a..b@example.com"):
        with pytest.raises(ValueError):
            normalize_email(value)


def test_registration_consent_requires_current_document_versions():
    with pytest.raises(ValueError, match="请先阅读并同意"):
        user_auth_service.validate_registration_consent(
            accepted_terms=False,
            agreement_version="2026-11-20",
            privacy_version="2026-11-20",
        )
    with pytest.raises(ValueError, match="用户协议版本"):
        user_auth_service.validate_registration_consent(
            accepted_terms=True,
            agreement_version="old",
            privacy_version="2026-11-20",
        )
