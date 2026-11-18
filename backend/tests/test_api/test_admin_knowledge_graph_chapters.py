"""Admin graph chapter sizes stay stable across view filters and fallback topics."""

from importlib import import_module

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
                parent_pairs.extend([(1, 2), (1, 6)])
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
            for center_id in [None, 5]:
                result = await get_knowledge_graph(
                    subject_id=1,
                    relation_type=relation_type,
                    knowledge_point_id=center_id,
                    search=None,
                    depth=2,
                    max_nodes=10,
                    _=None,
                    db=db,
                )
                for node in result["nodes"]:
                    assert node["is_chapter_root"] is (node["id"] in {2, 6})
                if center_id is None:
                    assert {
                        node["id"]
                        for node in result["nodes"]
                        if node["is_chapter_root"]
                    } == {2, 6}
                    assert any(
                        topic["id"] not in {2, 6} for topic in result["overview_topics"]
                    )
                if relation_type == "next":
                    assert all(
                        edge["relation_type"] == "next" for edge in result["edges"]
                    )
    finally:
        await engine.dispose()
