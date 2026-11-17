"""Admin mutations of canonical labels; syllabus snapshots stay immutable."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.orm_base import Base
from app.models.knowledge_edge import KnowledgeEdge
from app.models.knowledge_point import KnowledgePoint
from app.services.knowledge_point_resolution import normalize_knowledge_name
from app.services.syllabus_service import SyllabusError, _root_and_core_subjects


async def _point(db: AsyncSession, point_id: int) -> KnowledgePoint:
    point = await db.get(KnowledgePoint, point_id)
    if point is None:
        raise SyllabusError("知识点标签不存在")
    _, subjects = await _root_and_core_subjects(db)
    if point.subject_id not in {subject.id for subject in subjects}:
        raise SyllabusError("只能管理 408 核心科目的标签")
    # Serialize mutations of this canonical row on PostgreSQL.
    return await db.scalar(
        select(KnowledgePoint)
        .where(KnowledgePoint.id == point_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def create_label(db: AsyncSession, values: dict) -> KnowledgePoint:
    _, subjects = await _root_and_core_subjects(db)
    if values["subject_id"] not in {subject.id for subject in subjects}:
        raise SyllabusError("只能管理 408 核心科目的标签")
    values = dict(values)
    parent_id = values.pop("parent_knowledge_point_id", None)
    parent = await _point(db, parent_id) if parent_id else None
    if parent and (parent.subject_id != values["subject_id"] or not parent.is_active):
        raise SyllabusError("父标签必须属于同一科目且已启用")
    point = KnowledgePoint(
        **values, normalized_name=normalize_knowledge_name(values["name"]), aliases=[]
    )
    db.add(point)
    await db.flush()
    if parent:
        db.add(
            KnowledgeEdge(
                subject_id=point.subject_id,
                source_knowledge_point_id=parent.id,
                target_knowledge_point_id=point.id,
                relation_type="parent",
                source="manual",
                is_active=True,
            )
        )
        await db.flush()
    return point


async def update_label(db: AsyncSession, point_id: int, values: dict) -> KnowledgePoint:
    point = await _point(db, point_id)
    for field, value in values.items():
        setattr(point, field, value)
    if "name" in values:
        point.normalized_name = normalize_knowledge_name(point.name)
    await db.flush()
    return point


async def delete_label(db: AsyncSession, point_id: int) -> int:
    point = await _point(db, point_id)
    # An incoming parent link is the label's placement, not a dependent record.
    # Other edges and every persisted FK consumer block deletion, including
    # historical syllabus snapshots. Disabled labels can always be re-enabled.
    edge = await db.scalar(
        select(KnowledgeEdge.id)
        .where(
            (KnowledgeEdge.source_knowledge_point_id == point_id)
            | (
                (KnowledgeEdge.target_knowledge_point_id == point_id)
                & (KnowledgeEdge.relation_type != "parent")
            )
        )
        .limit(1)
    )
    if edge is not None:
        raise SyllabusError("标签存在子节点或图谱引用，不能删除；可改为禁用")
    for table in Base.metadata.sorted_tables:
        if table.name == "knowledge_edges":
            continue
        for column in table.columns:
            if not any(
                fk.target_fullname == "knowledge_points.id"
                for fk in column.foreign_keys
            ):
                continue
            if (
                await db.scalar(select(column).where(column == point_id).limit(1))
                is not None
            ):
                raise SyllabusError(
                    "标签存在题目、考纲或学习记录引用，不能删除；可改为禁用"
                )
    await db.execute(
        delete(KnowledgeEdge).where(
            KnowledgeEdge.target_knowledge_point_id == point_id,
            KnowledgeEdge.relation_type == "parent",
        )
    )
    subject_id = point.subject_id
    await db.delete(point)
    await db.flush()
    return subject_id


async def invalidate_label_cache(subject_id: int) -> None:
    # Run only after commit; these are the public list/tree caches.
    for scope in ("all", str(subject_id)):
        await cache.delete(f"kp:list:{scope}")
        await cache.delete(f"kp:tree:{scope}")
