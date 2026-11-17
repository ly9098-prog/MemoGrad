"""Read-only chapter metadata shared by the admin catalog and coverage report."""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge_edge import KnowledgeEdge
from app.models.knowledge_point import KnowledgePoint
from app.services.knowledge_map_topology import _build_parent_map


def _outline_label(point, member=None) -> str:
    name = member.name_snapshot if member is not None else point.name
    description = (
        member.description_snapshot if member is not None else point.description
    )
    # Imported syllabus descriptions retain the original chapter/section numbers.
    if description and description.startswith("408考纲节点："):
        leaf = description.removeprefix("408考纲节点：").rstrip("。 ").split(" > ")[-1]
        prefix = re.match(r"^(第\d+章|\d+(?:\.\d+)*)(?:\s+)", leaf)
        if prefix:
            return f"{prefix[1]} {name}"
    return str(name)


def build_outline(points: list, edges: list, memberships: dict | None = None) -> dict:
    by_id = {int(point.id): point for point in points}
    members = memberships or {}
    # Reject legacy cross-subject edges before applying the existing deterministic
    # parent priority and cycle rejection policy used by the knowledge map.
    edges = [
        edge
        for edge in edges
        if edge.source_knowledge_point_id in by_id
        and edge.target_knowledge_point_id in by_id
        and by_id[edge.source_knowledge_point_id].subject_id
        == by_id[edge.target_knowledge_point_id].subject_id
    ]
    parents = _build_parent_map(points, edges)
    labels = {
        key: _outline_label(point, members.get(key)) for key, point in by_id.items()
    }
    children: dict[int | None, list[int]] = {}
    for key in by_id:
        children.setdefault(parents.get(key), []).append(key)

    def sort_key(key):
        # Natural section ordering: chapter 2 precedes chapter 10.
        parts = tuple(
            int(part) for part in re.findall(r"\d+", labels[key].split(" ")[0])
        )
        return (by_id[key].subject_id, 0 if parts else 1, parts, labels[key], key)

    for keys in children.values():
        keys.sort(key=sort_key)
    result: dict[int, dict] = {}
    stack = [(key, []) for key in reversed(children.get(None, []))]
    while stack:
        key, ancestors = stack.pop()
        path = [*ancestors, key]
        root = path[0]
        # An isolated point is not silently promoted to a chapter.
        chapter = (
            root if children.get(root) or re.match(r"第\d+章", labels[root]) else None
        )
        result[key] = {
            "parent_knowledge_point_id": parents.get(key),
            "chapter_id": chapter,
            "chapter_name": labels[chapter] if chapter is not None else None,
            "outline_path": [labels[item] for item in path],
            "outline_depth": len(ancestors),
            "outline_order": len(result),
        }
        stack.extend((child, path) for child in reversed(children.get(key, [])))
    return result


async def load_outline(
    db: AsyncSession, subject_ids: list[int], memberships: dict | None = None
) -> dict[int, dict]:
    if not subject_ids:
        return {}
    points = list(
        (
            await db.scalars(
                select(KnowledgePoint).where(KnowledgePoint.subject_id.in_(subject_ids))
            )
        ).all()
    )
    edges = list(
        (
            await db.scalars(
                select(KnowledgeEdge).where(
                    KnowledgeEdge.subject_id.in_(subject_ids),
                    KnowledgeEdge.relation_type == "parent",
                    KnowledgeEdge.is_active.is_(True),
                )
            )
        ).all()
    )
    return build_outline(points, edges, memberships)
