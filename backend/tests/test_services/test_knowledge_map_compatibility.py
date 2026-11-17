"""Real SQLite compatibility baseline for the 408 knowledge map."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.models  # noqa: F401 - register all relationships before create_all
from app.core.database import Base
from app.core.subject_scope import EXAM408_CORE_CODES
from app.models.admin import QuestionVersion, QuestionVersionKnowledgePoint, Subject
from app.models.knowledge_edge import KnowledgeEdge
from app.models.knowledge_point import KnowledgePoint
from app.models.practice_record import PracticeRecord
from app.models.question import Question
from app.models.question_knowledge_point import QuestionKnowledgePoint
from app.models.syllabus import SyllabusKnowledgePoint, SyllabusVersion
from app.models.user import User
from app.models.user_knowledge_state import UserKnowledgeState
from app.schemas.coverage import CoverageReportResponse
from app.schemas.syllabus import SyllabusCatalogResponse
from app.services import coverage_service, knowledge_map_service, syllabus_service


async def _make_database(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'knowledge-map.db'}",
        connect_args={"timeout": 30},
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed(session_factory) -> dict[str, int]:
    async with session_factory() as db:
        root = Subject(
            id=1,
            code="exam408",
            name="408",
            path="exam408",
            sort_order=0,
            is_active=True,
        )
        core_ids = {code: 10 + index for index, code in enumerate(EXAM408_CORE_CODES)}
        db.add_all(
            [
                root,
                *(
                    Subject(
                        id=subject_id,
                        parent_id=1,
                        code=code,
                        name=code,
                        path=f"exam408/{code}",
                        sort_order=10 + index,
                        is_active=True,
                    )
                    for index, (code, subject_id) in enumerate(core_ids.items())
                ),
            ]
        )
        await db.flush()

        version = SyllabusVersion(
            code="active-2026",
            name="2026 408",
            root_subject_id=1,
            effective_year=2026,
            status="active",
            activated_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
        db.add(version)
        await db.flush()

        ds_id = core_ids["data_structure"]
        kp_root = KnowledgePoint(
            id=1,
            subject_id=ds_id,
            name="线性表",
            normalized_name="线性表",
            aliases=[],
            is_active=True,
        )
        kp_child = KnowledgePoint(
            id=2,
            subject_id=ds_id,
            name="链表",
            normalized_name="链表",
            aliases=[],
            is_active=True,
        )
        kp_outside = KnowledgePoint(
            id=3,
            subject_id=core_ids["operating_system"],
            name="进程",
            normalized_name="进程",
            aliases=[],
            is_active=True,
        )
        db.add_all([kp_root, kp_child, kp_outside])
        await db.flush()

        db.add_all(
            [
                SyllabusKnowledgePoint(
                    syllabus_version_id=version.id,
                    knowledge_point_id=1,
                    subject_id=ds_id,
                    name_snapshot="线性表",
                    normalized_name_snapshot="线性表",
                    sort_order=10,
                ),
                SyllabusKnowledgePoint(
                    syllabus_version_id=version.id,
                    knowledge_point_id=2,
                    subject_id=ds_id,
                    name_snapshot="链表",
                    normalized_name_snapshot="链表",
                    sort_order=20,
                ),
                SyllabusKnowledgePoint(
                    syllabus_version_id=version.id,
                    knowledge_point_id=3,
                    subject_id=core_ids["operating_system"],
                    name_snapshot="进程",
                    normalized_name_snapshot="进程",
                    sort_order=10,
                ),
            ]
        )
        await db.flush()

        question = Question(
            subject_id=ds_id,
            question_type="single_choice",
            content={"text": "链表题"},
            options={"A": "A", "B": "B"},
            answer="A",
            difficulty=3,
            review_status="approved",
            is_active=True,
        )
        db.add(question)
        await db.flush()
        version_row = QuestionVersion(
            question_id=question.id,
            version=1,
            subject_id=ds_id,
            question_type="single_choice",
            content={"text": "链表题"},
            options={"A": "A", "B": "B"},
            answer="A",
            difficulty=3,
            is_active=True,
        )
        db.add(version_row)
        await db.flush()
        question.current_version_id = version_row.id
        db.add(
            QuestionKnowledgePoint(
                question_id=question.id,
                knowledge_point_id=2,
                position=0,
            )
        )
        db.add(
            QuestionVersionKnowledgePoint(
                question_version_id=version_row.id,
                knowledge_point_id=2,
                position=0,
            )
        )
        db.add(
            KnowledgeEdge(
                subject_id=ds_id,
                source_knowledge_point_id=1,
                target_knowledge_point_id=2,
                relation_type="parent",
                weight=0.8,
                confidence=0.7,
                source="manual",
                is_active=True,
            )
        )
        db.add(User(id=9, openid="knowledge-map-user"))
        await db.commit()
        return {
            "version": version.id,
            "ds": ds_id,
            "os": core_ids["operating_system"],
            "question": question.id,
            "question_version": version_row.id,
        }


@pytest.mark.asyncio
async def test_overview_is_fail_closed_without_active_syllabus(tmp_path):
    engine, session_factory = await _make_database(tmp_path)
    try:
        async with session_factory() as db:
            result = await knowledge_map_service.get_overview(db, 9)
        assert result == {
            "scope": "exam408",
            "syllabus_version": None,
            "scope_ready": False,
            "subjects": [],
        }
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_admin_catalog_and_coverage_share_authoritative_outline(tmp_path):
    engine, session_factory = await _make_database(tmp_path)
    try:
        ids = await _seed(session_factory)
        async with session_factory() as db:
            catalog = SyllabusCatalogResponse.model_validate(
                await syllabus_service.get_catalog(db, ids["version"])
            )
            coverage = CoverageReportResponse.model_validate(
                await coverage_service.build_coverage_report(
                    db, syllabus_version_id=ids["version"]
                )
            )
        child = next(item for item in catalog.items if item.knowledge_point_id == 2)
        covered = next(item for item in coverage.items if item.knowledge_point_id == 2)
        assert child.parent_knowledge_point_id == covered.parent_knowledge_point_id == 1
        assert child.chapter_id == covered.chapter_id == 1
        assert child.outline_depth == covered.outline_depth == 1
        assert len(catalog.items) >= len(coverage.items) > 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_overview_only_uses_active_canonical_408_scope(tmp_path):
    engine, session_factory = await _make_database(tmp_path)
    try:
        ids = await _seed(session_factory)
        async with session_factory() as db:
            result = await knowledge_map_service.get_overview(db, 9)

        assert result["scope_ready"] is True
        assert result["syllabus_version"]["code"] == "active-2026"
        assert [subject["subject_code"] for subject in result["subjects"]] == list(
            EXAM408_CORE_CODES
        )
        ds_summary = result["subjects"][0]
        assert ds_summary["subject_id"] == ids["ds"]
        assert ds_summary["total_knowledge_points"] == 2
        assert ds_summary["trainable_knowledge_points"] == 1
        assert ds_summary["status"] == "no_data"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_subject_map_builds_parented_tree_and_keeps_state_semantics(tmp_path):
    engine, session_factory = await _make_database(tmp_path)
    try:
        ids = await _seed(session_factory)
        async with session_factory() as db:
            db.add(
                UserKnowledgeState(
                    user_id=9,
                    subject_id=ids["ds"],
                    knowledge_point_id=2,
                    attempt_count=4,
                    correct_count=1,
                    wrong_count=3,
                    accuracy=0.25,
                    mastery_score=30.0,
                    weakness_level="weak",
                    confidence=0.8,
                    recent_answer_count=4,
                    recent_correct_count=1,
                    recent_wrong_count=3,
                )
            )
            await db.commit()

        async with session_factory() as db:
            result = await knowledge_map_service.get_subject_map(db, 9, ids["ds"])
        assert result is not None
        assert result["subject"]["status"] == "weak"
        assert result["root_count"] == 1
        assert result["parented_knowledge_points"] == 1
        nodes = {node["knowledge_point_id"]: node for node in result["nodes"]}
        assert nodes[1]["depth"] == 0
        assert nodes[2]["parent_id"] == 1
        assert nodes[2]["depth"] == 1
        assert nodes[2]["status"] == "weak"
        assert nodes[2]["trainable_question_count"] == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_point_detail_uses_recent_answers_and_syllabus_relations(tmp_path):
    engine, session_factory = await _make_database(tmp_path)
    try:
        ids = await _seed(session_factory)
        async with session_factory() as db:
            db.add(
                PracticeRecord(
                    user_id=9,
                    question_id=ids["question"],
                    question_version_id=ids["question_version"],
                    subject_id=ids["ds"],
                    question_type="single_choice",
                    user_answer="A",
                    is_correct=True,
                    used_time=12,
                    projection_state="completed",
                )
            )
            await db.commit()

        async with session_factory() as db:
            result = await knowledge_map_service.get_point_detail(db, 9, 2)
        assert result is not None
        assert result["knowledge_point_id"] == 2
        assert result["parent_id"] == 1
        assert result["ancestors"] == [
            {"knowledge_point_id": 1, "name": "线性表", "depth": 0}
        ]
        assert result["recent_answers"][0]["is_correct"] is True
        assert result["practice_route_params"] == {
            "subject_id": ids["ds"],
            "mode": "random",
            "count": 1,
            "knowledge_point": "链表",
            "knowledge_point_id": 2,
            "include_descendants": 0,
            "allow_repeat": 1,
            "autostart": 1,
            "source": "knowledge_map",
        }
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_point_detail_rejects_points_outside_active_408_scope(tmp_path):
    engine, session_factory = await _make_database(tmp_path)
    try:
        ids = await _seed(session_factory)
        async with session_factory() as db:
            point = (
                await db.execute(select(KnowledgePoint).where(KnowledgePoint.id == 3))
            ).scalar_one()
            await db.delete(point)
            await db.commit()

        async with session_factory() as db:
            detail = await knowledge_map_service.get_point_detail(db, 9, 3)
            os_map = await knowledge_map_service.get_subject_map(db, 9, ids["os"])
        assert detail is None
        assert os_map is not None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_catalog_label_mutations_preserve_snapshots_and_guard_delete(tmp_path):
    from app.schemas.syllabus import KnowledgeLabelResponse
    from app.services import knowledge_catalog_service as labels

    engine, factory = await _make_database(tmp_path)
    await _seed(factory)
    try:
        async with factory() as db:
            member = await db.scalar(select(SyllabusKnowledgePoint).limit(1))
            version_id = member.syllabus_version_id
            old_name = member.name_snapshot
            point = await labels.update_label(
                db,
                member.knowledge_point_id,
                {
                    "name": "规范标签修订",
                    "difficulty_level": 4,
                    "description": "修订说明",
                    "is_active": False,
                },
            )
            assert point.normalized_name == "规范标签修订"
            assert (
                KnowledgeLabelResponse.model_validate(
                    point, from_attributes=True
                ).is_active
                is False
            )
            assert member.name_snapshot == old_name
            assert not any(
                row["knowledge_point_id"] == point.id
                for row in (await syllabus_service.get_catalog(db, version_id))["items"]
            )
            full = await syllabus_service.get_catalog(
                db, version_id, include_inactive=True
            )
            assert (
                next(
                    row
                    for row in full["items"]
                    if row["knowledge_point_id"] == point.id
                )["is_active"]
                is False
            )
            with pytest.raises(syllabus_service.SyllabusError, match="不能删除"):
                await labels.delete_label(db, point.id)
            # New leaf labels may be removed with their incoming placement edge.
            parent = await db.scalar(
                select(KnowledgePoint)
                .where(KnowledgePoint.is_active.is_(True))
                .limit(1)
            )
            leaf = await labels.create_label(
                db,
                {
                    "name": "  新标签  ",
                    "subject_id": parent.subject_id,
                    "description": None,
                    "difficulty_level": 3,
                    "parent_knowledge_point_id": parent.id,
                },
            )
            leaf_id = leaf.id
            await labels.delete_label(db, leaf_id)
            assert await db.get(KnowledgePoint, leaf_id) is None
            assert (
                await db.scalar(
                    select(KnowledgeEdge.id).where(
                        KnowledgeEdge.target_knowledge_point_id == leaf_id
                    )
                )
                is None
            )
            # Existing graph descendants cannot be orphaned by deleting a parent.
            with pytest.raises(syllabus_service.SyllabusError, match="不能删除"):
                await labels.delete_label(db, parent.id)
            await db.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_label_parent_validation_and_reference_guard(tmp_path):
    from pydantic import ValidationError

    from app.schemas.syllabus import KnowledgeLabelCreate, KnowledgeLabelUpdate
    from app.services import knowledge_catalog_service as labels

    engine, factory = await _make_database(tmp_path)
    await _seed(factory)
    try:
        with pytest.raises(ValidationError):
            KnowledgeLabelCreate(subject_id=10, name="  ")
        with pytest.raises(ValidationError):
            KnowledgeLabelUpdate(name="标签", difficulty_level=9)
        with pytest.raises(ValidationError):
            KnowledgeLabelUpdate()
        with pytest.raises(ValidationError):
            KnowledgeLabelUpdate(name=None)
        with pytest.raises(ValidationError):
            KnowledgeLabelUpdate(is_active=None)
        async with factory() as db:
            parent = await db.scalar(select(KnowledgePoint).limit(1))
            other = await db.scalar(
                select(Subject.id)
                .where(
                    Subject.id != parent.subject_id,
                    Subject.code.in_(EXAM408_CORE_CODES),
                )
                .limit(1)
            )
            with pytest.raises(syllabus_service.SyllabusError, match="同一科目"):
                await labels.create_label(
                    db,
                    {
                        "subject_id": other,
                        "name": "错误父项",
                        "parent_knowledge_point_id": parent.id,
                    },
                )
            leaf = await labels.create_label(
                db, {"subject_id": parent.subject_id, "name": "没有边但有历史考纲引用"}
            )
            version = await db.scalar(select(SyllabusVersion).limit(1))
            db.add(
                SyllabusKnowledgePoint(
                    syllabus_version_id=version.id,
                    knowledge_point_id=leaf.id,
                    subject_id=leaf.subject_id,
                    name_snapshot=leaf.name,
                    normalized_name_snapshot=leaf.normalized_name,
                    difficulty_level_snapshot=3,
                    sort_order=99,
                )
            )
            await db.flush()
            with pytest.raises(syllabus_service.SyllabusError, match="考纲"):
                await labels.delete_label(db, leaf.id)
            await db.rollback()
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_label_http_permissions_validation_and_audit(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.v1.admin_syllabus import router
    from app.core import admin_security
    from app.core.database import get_db
    from app.models.admin import AuditLog
    from app.services import knowledge_catalog_service as labels

    engine, factory = await _make_database(tmp_path)
    await _seed(factory)
    app = FastAPI()
    app.include_router(router)

    async def database():
        async with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[admin_security.get_current_admin] = lambda: (
        SimpleNamespace(id=None, username="label-unit-test", role_id=1)
    )
    granted = set()
    monkeypatch.setattr(
        admin_security,
        "_get_permission_names",
        AsyncMock(side_effect=lambda *_: granted),
    )
    cache_mock = AsyncMock()
    monkeypatch.setattr(labels, "invalidate_label_cache", cache_mock)
    prefix = "/api/admin/v1/knowledge/syllabus/catalog/knowledge-points"
    try:
        async with AsyncClient(
            transport=ASGITransport(app), base_url="http://test"
        ) as client:
            data = {"subject_id": 10, "name": "新建规范节点", "difficulty_level": 3}
            assert (await client.post(prefix, json=data)).status_code == 403
            assert (await client.patch(prefix + "/1", json=data)).status_code in {
                403,
                422,
            }
            assert (await client.delete(prefix + "/1")).status_code == 403
            granted.add("knowledge:write")
            assert (
                await client.post(prefix, json={**data, "name": "  "})
            ).status_code == 422
            created = await client.post(prefix, json=data)
            assert created.status_code == 201, created.text
            point_id = created.json()["id"]
            disabled = await client.patch(
                prefix + f"/{point_id}",
                json={
                    "description": "应保留的说明",
                    "is_active": False,
                },
            )
            assert disabled.status_code == 200, disabled.text
            assert disabled.json()["is_active"] is False

            renamed = await client.patch(
                prefix + f"/{point_id}",
                json={"name": "重命名规范节点", "difficulty_level": 4},
            )
            assert renamed.status_code == 200, renamed.text
            assert renamed.json()["name"] == "重命名规范节点"
            assert renamed.json()["description"] == "应保留的说明"
            assert renamed.json()["is_active"] is False

            reenabled = await client.patch(
                prefix + f"/{point_id}", json={"is_active": True}
            )
            assert reenabled.status_code == 200, reenabled.text
            assert reenabled.json()["name"] == "重命名规范节点"
            assert reenabled.json()["difficulty_level"] == 4
            assert reenabled.json()["description"] == "应保留的说明"
            assert (
                await client.patch(prefix + f"/{point_id}", json={})
            ).status_code == 422
            assert (await client.delete(prefix + f"/{point_id}")).status_code == 200
            async with factory() as db:
                actions = list(
                    (
                        await db.scalars(select(AuditLog.action).order_by(AuditLog.id))
                    ).all()
                )
                assert actions == [
                    "knowledge_label.create",
                    "knowledge_label.update",
                    "knowledge_label.update",
                    "knowledge_label.update",
                    "knowledge_label.delete",
                ]
            assert cache_mock.await_count == 5
    finally:
        await engine.dispose()
