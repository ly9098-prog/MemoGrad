from datetime import datetime
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.admin_knowledge import _visible_graph_payload, get_knowledge_graph
from app.core import admin_read_access, admin_security, security
from app.core.admin_read_access import require_admin_or_public_reader
from app.core.admin_security import AdminPrincipal
from app.core.database import Base, get_db
from app.main import app
from app.models.admin import AdminUser, Subject
from app.models.knowledge_point import KnowledgePoint
from app.models.question import Question
from app.models.question_knowledge_point import QuestionKnowledgePoint
from app.models.user import User
from app.services.admin_subject_service import list_subject_tree

client = TestClient(app)


class _Db:
    pass


async def _override_db():
    yield _Db()


def _user() -> User:
    return User(
        id=7,
        nickname="Reader",
        is_banned=False,
        deleted_at=None,
        lifecycle_status="active",
    )


def _admin() -> AdminPrincipal:
    return AdminPrincipal(
        AdminUser(
            id=2,
            username="editor",
            display_name="Editor",
            role_id=3,
            is_active=True,
            must_change_password=False,
        ),
        {"sub": "2", "jti": "admin-jti", "iat": 1, "exp": 4102444800},
    )


def _question() -> Question:
    return Question(
        id=3,
        subject_id=1,
        question_type="single_choice",
        content={
            "stem": "公开题干",
            "source_snapshot_url": "https://internal.example/snapshot.png",
            "source_snapshot_full_page": True,
            "visual_regions": [{"x": 1, "y": 2}],
        },
        options={"A": "甲"},
        answer="A",
        analysis="公开解析",
        difficulty=2,
        source="真题",
        source_type="manual",
        source_file="/secret/import.pdf",
        import_batch_id="batch-secret",
        raw_content="内部 OCR 原文",
        image_url=[],
        year=2020,
        review_status="approved",
        is_active=True,
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
    )


async def _reject_admin(*_args, **_kwargs):
    raise HTTPException(status_code=401, detail="Invalid or expired token")


async def _authenticate_user(*_args, **_kwargs):
    return _user(), {"sub": "7", "jti": "user-jti", "iat": 1}


def _wire_user_token(monkeypatch):
    monkeypatch.setattr(
        admin_read_access,
        "resolve_admin_token",
        AsyncMock(side_effect=_reject_admin),
    )
    monkeypatch.setattr(
        admin_read_access,
        "authenticate_user_token",
        AsyncMock(side_effect=_authenticate_user),
    )
    monkeypatch.setattr(
        admin_security,
        "resolve_admin_token",
        AsyncMock(side_effect=_reject_admin),
    )
    monkeypatch.setattr(
        security,
        "authenticate_user_token",
        AsyncMock(side_effect=_authenticate_user),
    )


@pytest.fixture(autouse=True)
def _clean_overrides():
    app.dependency_overrides.clear()
    client.cookies.clear()
    yield
    app.dependency_overrides.clear()
    client.cookies.clear()


def test_user_token_reads_question_list_with_visibility_and_safe_projection(
    monkeypatch,
):
    _wire_user_token(monkeypatch)
    list_questions = AsyncMock(return_value=([_question()], 1))
    monkeypatch.setattr(
        "app.api.v1.admin_questions.list_admin_questions",
        list_questions,
    )
    monkeypatch.setattr(
        "app.api.v1.admin_questions.load_question_kps",
        AsyncMock(return_value={3: ["函数"]}),
    )
    app.dependency_overrides[get_db] = _override_db

    response = client.get(
        "/api/admin/v1/questions",
        params={
            "review_status": "rejected",
            "is_active": "false",
            "import_batch_id": "internal-batch",
        },
        headers={"Authorization": "Bearer ordinary-user-token"},
    )

    assert response.status_code == 200
    assert list_questions.await_args.kwargs["review_status"] == "approved"
    assert list_questions.await_args.kwargs["is_active"] is True
    assert list_questions.await_args.kwargs["import_batch_id"] is None
    assert list_questions.await_args.kwargs["include_internal_search_fields"] is False
    assert list_questions.await_args.kwargs["visible_subjects_only"] is True
    item = response.json()["items"][0]
    assert item["knowledge_points"] == ["函数"]
    assert item["content"]["stem"] == "公开题干"
    assert item["source"] is None
    for field in (
        "source_snapshot_url",
        "source_snapshot_full_page",
        "visual_regions",
    ):
        assert field not in item["content"]
    for field in (
        "raw_content",
        "source_file",
        "source_type",
        "import_batch_id",
        "review_status",
        "created_at",
        "updated_at",
    ):
        assert field not in item


def test_admin_token_keeps_existing_question_response_shape(monkeypatch):
    monkeypatch.setattr(
        admin_read_access,
        "resolve_admin_token",
        AsyncMock(return_value=_admin()),
    )
    monkeypatch.setattr(
        admin_read_access,
        "_get_permission_names",
        AsyncMock(return_value={"question:read"}),
    )
    monkeypatch.setattr(
        "app.api.v1.admin_questions.list_admin_questions",
        AsyncMock(return_value=([_question()], 1)),
    )
    monkeypatch.setattr(
        "app.api.v1.admin_questions.load_question_kps",
        AsyncMock(return_value={3: ["函数"]}),
    )
    app.dependency_overrides[get_db] = _override_db

    response = client.get(
        "/api/admin/v1/questions",
        headers={"Authorization": "Bearer admin-token"},
    )

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["raw_content"] == "内部 OCR 原文"
    assert item["source_file"] == "/secret/import.pdf"
    assert item["import_batch_id"] == "batch-secret"
    assert item["review_status"] == "approved"


def test_user_token_is_forbidden_on_unlisted_read_and_write_routes(monkeypatch):
    _wire_user_token(monkeypatch)
    app.dependency_overrides[get_db] = _override_db

    read_response = client.get(
        "/api/admin/v1/knowledge/status",
        headers={"Authorization": "Bearer ordinary-user-token"},
    )
    write_response = client.post(
        "/api/admin/v1/questions/export",
        json={"format": "csv"},
        headers={"Authorization": "Bearer ordinary-user-token"},
    )
    versions_response = client.get(
        "/api/admin/v1/questions/3/versions",
        headers={"Authorization": "Bearer ordinary-user-token"},
    )
    trailing_slash_response = client.get(
        "/api/admin/v1/questions/",
        headers={"Authorization": "Bearer ordinary-user-token"},
        follow_redirects=False,
    )

    assert read_response.status_code == 403
    assert write_response.status_code == 403
    assert versions_response.status_code == 403
    # A trailing slash may only redirect to the whitelisted collection path;
    # it must never be treated as an unlisted endpoint on its own.
    assert trailing_slash_response.status_code in {307, 308}
    assert trailing_slash_response.headers["location"].endswith(
        "/api/admin/v1/questions"
    )


def test_user_token_is_forbidden_on_ocr_text_and_audit_routes(monkeypatch):
    _wire_user_token(monkeypatch)
    app.dependency_overrides[get_db] = _override_db

    for path in (
        "/api/admin/v1/questions/3/versions/1",
        "/api/admin/v1/knowledge/edges/status",
        "/api/admin/v1/imports/tasks",
    ):
        response = client.get(
            path,
            headers={"Authorization": "Bearer ordinary-user-token"},
        )
        assert response.status_code == 403, path


def test_user_token_detail_hides_unapproved_questions(monkeypatch):
    _wire_user_token(monkeypatch)
    app.dependency_overrides[get_db] = _override_db
    monkeypatch.setattr(
        "app.api.v1.admin_questions.get_publicly_visible_question",
        AsyncMock(side_effect=ValueError("题目不存在")),
    )

    response = client.get(
        "/api/admin/v1/questions/99",
        headers={"Authorization": "Bearer ordinary-user-token"},
    )

    assert response.status_code == 404


def test_visible_graph_projection_removes_internal_diagnostics():
    payload = {
        "subject": {"id": 1, "code": "408", "name": "408"},
        "summary": {
            "total_nodes": 1,
            "total_edges": 1,
            "visible_nodes": 1,
            "visible_edges": 1,
            "isolated_nodes": 0,
            "relation_counts": {"parent": 1},
            "avg_confidence": 0.91,
            "source_counts": {"ai": 1},
            "relation_confidence": {"parent": 0.91},
        },
        "nodes": [
            {
                "id": 1,
                "name": "函数",
                "normalized_name": "函数",
                "aliases": ["function"],
                "description": "定义",
                "difficulty_level": 3,
                "subject_id": 1,
                "question_count": 2,
                "in_degree": 0,
                "out_degree": 1,
                "degree": 1,
                "relation_counts": {"parent": 1},
                "is_chapter_root": True,
                "chapter_id": 4,
                "chapter_order": 1,
            }
        ],
        "edges": [
            {
                "id": 9,
                "source": 1,
                "target": 1,
                "relation_type": "parent",
                "weight": 1.0,
                "confidence": 0.91,
                "source_type": "ai",
            }
        ],
        "hot_nodes": [{"id": 1, "name": "函数", "degree": 1}],
        "overview_topics": [
            {
                "id": 1,
                "name": "函数",
                "direct_child_count": 0,
                "question_count": 2,
            }
        ],
        "focus_id": 1,
    }

    body = _visible_graph_payload(payload).model_dump()

    assert body["edges"][0] == {
        "id": 9,
        "source": 1,
        "target": 1,
        "relation_type": "parent",
        "weight": 1.0,
    }
    assert "normalized_name" not in body["nodes"][0]
    assert "avg_confidence" not in body["summary"]
    assert "source_counts" not in body["summary"]
    assert "relation_confidence" not in body["summary"]


def test_public_reader_dependency_rejects_unwhitelisted_path(monkeypatch):
    _wire_user_token(monkeypatch)
    dependency = require_admin_or_public_reader("knowledge:read")
    request = type(
        "Request",
        (),
        {"url": type("Url", (), {"path": "/api/admin/v1/knowledge/status"})(), "method": "GET"},
    )()
    credentials = type("Credentials", (), {"credentials": "ordinary-user-token"})()

    import asyncio

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            dependency(
                request=request,
                credentials=credentials,
                db=_Db(),
            )
        )
    assert exc.value.status_code == 403


def test_public_reader_dependency_rejects_head(monkeypatch):
    _wire_user_token(monkeypatch)
    dependency = require_admin_or_public_reader("question:read")
    request = type(
        "Request",
        (),
        {
            "url": type("Url", (), {"path": "/api/admin/v1/questions"})(),
            "method": "HEAD",
        },
    )()
    credentials = type("Credentials", (), {"credentials": "ordinary-user-token"})()

    import asyncio

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            dependency(
                request=request,
                credentials=credentials,
                db=_Db(),
            )
        )
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_learner_graph_counts_only_approved_active_questions():
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            db.add(Subject(id=1, code="ds", name="数据结构", path="ds", is_active=True))
            await db.flush()
            db.add(
                KnowledgePoint(
                    id=1,
                    subject_id=1,
                    name="线性表",
                    normalized_name="线性表",
                    is_active=True,
                )
            )
            await db.flush()
            db.add_all(
                [
                    Question(
                        id=1,
                        subject_id=1,
                        question_type="single_choice",
                        content={"stem": "approved"},
                        answer="A",
                        difficulty=2,
                        review_status="approved",
                        is_active=True,
                    ),
                    Question(
                        id=2,
                        subject_id=1,
                        question_type="single_choice",
                        content={"stem": "rejected"},
                        answer="A",
                        difficulty=2,
                        review_status="rejected",
                        is_active=True,
                    ),
                    Question(
                        id=3,
                        subject_id=1,
                        question_type="single_choice",
                        content={"stem": "disabled"},
                        answer="A",
                        difficulty=2,
                        review_status="approved",
                        is_active=False,
                    ),
                ]
            )
            await db.flush()
            db.add_all(
                [
                    QuestionKnowledgePoint(question_id=1, knowledge_point_id=1),
                    QuestionKnowledgePoint(question_id=2, knowledge_point_id=1),
                    QuestionKnowledgePoint(question_id=3, knowledge_point_id=1),
                ]
            )
            await db.commit()

            result = await get_knowledge_graph(
                subject_id=1,
                relation_type=None,
                knowledge_point_id=None,
                search=None,
                depth=2,
                max_nodes=10,
                principal=type("Principal", (), {"identity_kind": "user"})(),
                db=db,
            )

        body = result.model_dump()
        assert body["nodes"][0]["question_count"] == 1
        assert "avg_confidence" not in body["summary"]
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_disabled_subject_questions_are_hidden_from_learners_but_visible_to_admins(
    monkeypatch,
):
    _wire_user_token(monkeypatch)
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            db.add_all(
                [
                    Subject(id=1, code="advanced_math", name="高等数学", path="advanced_math", is_active=True),
                    Subject(id=2, code="english", name="英语", path="english", is_active=False),
                ]
            )
            await db.flush()
            for question_id, subject_id, review_status, is_active in (
                (1, 1, "approved", True),
                (2, 2, "approved", True),
                (3, 1, "rejected", True),
                (4, 1, "approved", False),
            ):
                db.add(
                    Question(
                        id=question_id,
                        subject_id=subject_id,
                        question_type="single_choice",
                        content={"stem": f"题目 {question_id}"},
                        answer="A",
                        difficulty=2,
                        review_status=review_status,
                        is_active=is_active,
                    )
                )
            await db.commit()

            async def database():
                yield db

            app.dependency_overrides[get_db] = database
            assert [node["id"] for node in await list_subject_tree(db)] == [1]
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as http_client:
                headers = {"Authorization": "Bearer ordinary-user-token"}
                listed = await http_client.get("/api/admin/v1/questions", headers=headers)
                assert listed.status_code == 200
                assert listed.json()["total"] == 1
                assert [item["id"] for item in listed.json()["items"]] == [1]
                for params in ({"subject_id": 2}, {"subject_codes": "english"}):
                    filtered = await http_client.get(
                        "/api/admin/v1/questions", params=params, headers=headers
                    )
                    assert filtered.status_code == 200
                    assert filtered.json()["total"] == 0
                    assert filtered.json()["items"] == []
                for question_id in (2, 3, 4):
                    detail = await http_client.get(
                        f"/api/admin/v1/questions/{question_id}", headers=headers
                    )
                    assert detail.status_code == 404
                visible_detail = await http_client.get(
                    "/api/admin/v1/questions/1", headers=headers
                )
                assert visible_detail.status_code == 200

                monkeypatch.setattr(
                    admin_read_access, "resolve_admin_token", AsyncMock(return_value=_admin())
                )
                monkeypatch.setattr(
                    admin_read_access, "_get_permission_names", AsyncMock(return_value={"question:read"})
                )
                admin_headers = {"Authorization": "Bearer admin-token"}
                admin_list = await http_client.get(
                    "/api/admin/v1/questions", headers=admin_headers
                )
                assert admin_list.status_code == 200
                assert admin_list.json()["total"] == 4
                admin_detail = await http_client.get(
                    "/api/admin/v1/questions/2", headers=admin_headers
                )
                assert admin_detail.status_code == 200
                assert admin_detail.json()["subject_id"] == 2
    finally:
        await engine.dispose()
