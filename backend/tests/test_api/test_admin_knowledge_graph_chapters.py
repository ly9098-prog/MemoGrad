"""Admin graph chapter sizes stay stable across view filters and fallback topics."""

from importlib import import_module
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.admin_knowledge import get_knowledge_graph
from app.core.database import Base
from app.models.admin import Subject
from app.models.knowledge_edge import KnowledgeEdge
from app.models.knowledge_point import KnowledgePoint

import_module("app.models")


@pytest.mark.asyncio
@pytest.mark.parametrize("subject_root", [False, True])
@pytest.mark.parametrize("relation_type", [None, "next"])
async def test_only_first_level_chapters_are_ancestors(subject_root, relation_type):
    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            db.add(
                Subject(
                    id=1,
                    code="data_structure",
                    name="数据结构",
                    path="data_structure",
                    is_active=True,
                )
            )
            await db.flush()
            names = {
                2: "线性表",
                3: "链表",
                4: "单链表",
                5: "指针",
                6: "树",
                7: "二叉树",
                8: "搜索树",
            }
            if subject_root:
                names[1] = "数据结构"
                names[9] = "绪论"
            db.add_all(
                [
                    KnowledgePoint(
                        id=point_id, subject_id=1, name=name, normalized_name=name
                    )
                    for point_id, name in names.items()
                ]
            )
            await db.flush()
            parent_pairs = [(2, 3), (3, 4), (4, 5), (6, 7), (7, 8)]
            if subject_root:
                parent_pairs.extend([(1, 2), (1, 6), (1, 9)])
            db.add_all(
                [
                    KnowledgeEdge(
                        subject_id=1,
                        source_knowledge_point_id=source,
                        target_knowledge_point_id=target,
                        relation_type="parent",
                    )
                    for source, target in parent_pairs
                ]
            )
            db.add(
                KnowledgeEdge(
                    subject_id=1,
                    source_knowledge_point_id=3,
                    target_knowledge_point_id=7,
                    relation_type="next",
                )
            )
            await db.commit()
            root_ids = {2, 6, 9} if subject_root else {2, 6}
            for center_id in [None, 5]:
                result = await get_knowledge_graph(
                    subject_id=1,
                    relation_type=relation_type,
                    knowledge_point_id=center_id,
                    search=None,
                    depth=2,
                    max_nodes=10,
                    principal=SimpleNamespace(identity_kind="admin"),
                    db=db,
                )
                for node in result["nodes"]:
                    assert node["is_chapter_root"] is (node["id"] in root_ids)
                    expected_chapter = (
                        2 if node["id"] in {2, 3, 4, 5}
                        else 6 if node["id"] in {6, 7, 8}
                        else 9 if node["id"] == 9
                        else None
                    )
                    assert node["chapter_id"] == expected_chapter
                    if expected_chapter is None:
                        assert node["chapter_order"] is None
                    else:
                        assert node["chapter_order"] in range(len(root_ids))
                if center_id is None:
                    assert {
                        node["id"]
                        for node in result["nodes"]
                        if node["is_chapter_root"]
                    } == root_ids
                    assert any(
                        topic["id"] not in root_ids for topic in result["overview_topics"]
                    )
                if relation_type == "next":
                    assert all(
                        edge["relation_type"] == "next" for edge in result["edges"]
                    )
    finally:
        await engine.dispose()


def test_subject_chapters_keep_complete_parent_priority_before_root_removal():
    from app.services.knowledge_graph_chapters import build_graph_chapter_metadata

    points = [
        SimpleNamespace(id=key, subject_id=1, name=name, description=None)
        for key, name in [(1, "数据结构"), (2, "绪论"), (3, "排序"), (4, "归并排序")]
    ]
    edges = [
        SimpleNamespace(
            source_knowledge_point_id=source,
            target_knowledge_point_id=target,
            relation_type="parent", is_active=True,
            source=edge_source, confidence=1.0, weight=1.0,
        )
        for source, target, edge_source in [
            (1, 2, "manual"), (1, 3, "manual"),
            (3, 4, "imported"), (3, 2, "imported"),
        ]
    ]
    result = build_graph_chapter_metadata(points, edges, 1, {})
    assert result[1]["chapter_id"] is None
    assert result[2]["is_chapter_root"] is True
    assert result[2]["chapter_id"] == 2
    assert result[3]["is_chapter_root"] is True
    assert result[4]["chapter_id"] == 3


@pytest.mark.asyncio
async def test_chapter_order_uses_the_active_syllabus_not_popularity_or_ids():
    from app.models.syllabus import SyllabusKnowledgePoint, SyllabusVersion
    from app.services.knowledge_graph_chapters import graph_chapter_metadata

    engine = create_async_engine("sqlite+aiosqlite://")
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            db.add(Subject(id=1, code="ds", name="数据结构", path="ds"))
            await db.flush()
            points = [
                KnowledgePoint(id=1, subject_id=1, name="排序", normalized_name="排序"),
                KnowledgePoint(id=2, subject_id=1, name="绪论", normalized_name="绪论"),
                KnowledgePoint(id=3, subject_id=1, name="算法", normalized_name="算法"),
                KnowledgePoint(id=4, subject_id=1, name="独立点", normalized_name="独立点"),
            ]
            db.add_all(points)
            version = SyllabusVersion(
                code="ds-active", name="当前考纲", root_subject_id=1,
                effective_year=2027, status="active",
            )
            db.add(version)
            await db.flush()
            for point_id, name, order in [(1, "排序", 80), (2, "绪论", 10)]:
                db.add(SyllabusKnowledgePoint(
                    syllabus_version_id=version.id, knowledge_point_id=point_id,
                    subject_id=1, name_snapshot=name, normalized_name_snapshot=name,
                    description_snapshot=f"408考纲节点：数据结构 > 第{order // 10}章 {name}。",
                    sort_order=order,
                ))
            edge = KnowledgeEdge(
                subject_id=1, source_knowledge_point_id=2,
                target_knowledge_point_id=3, relation_type="parent",
            )
            db.add(edge)
            await db.commit()
            result = await graph_chapter_metadata(db, points, [edge], None)
            assert result[2] == {
                "chapter_id": 2, "chapter_order": 0, "is_chapter_root": True,
            }
            assert result[1] == {
                "chapter_id": 1, "chapter_order": 1, "is_chapter_root": True,
            }
            assert result[3] == {
                "chapter_id": 2, "chapter_order": 0, "is_chapter_root": False,
            }
            assert result[4] == {
                "chapter_id": None, "chapter_order": None, "is_chapter_root": False,
            }
    finally:
        await engine.dispose()
