"""Chapter identity and ordering for the admin graph's complete subject scope."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.knowledge_edge import KnowledgeEdge
from app.models.knowledge_point import KnowledgePoint
from app.services.knowledge_outline import build_outline
from app.services.syllabus_service import active_memberships


def build_graph_chapter_metadata(
    points: list[KnowledgePoint],
    edges: list[KnowledgeEdge],
    subject_root_id: int | None,
    memberships: dict,
) -> dict[int, dict]:
    outline = build_outline(points, edges, memberships)
    chapter_ids = {
        key for key, entry in outline.items()
        if key != subject_root_id and (
            entry["chapter_id"] == key
            or (subject_root_id is not None
                and entry["parent_knowledge_point_id"] == subject_root_id)
        )
    }
    ordered_ids = sorted(
        chapter_ids,
        key=lambda chapter_id: (
            memberships[chapter_id].sort_order
            if chapter_id in memberships
            else outline[chapter_id]["outline_order"],
            outline[chapter_id]["outline_order"],
        ),
    )
    orders = {chapter_id: index for index, chapter_id in enumerate(ordered_ids)}
    assignments: dict[int, int | None] = {}
    for key, entry in outline.items():
        assignments[key] = (
            key if key in chapter_ids
            else assignments.get(entry["parent_knowledge_point_id"])
        )
    return {
        point.id: {
            "chapter_id": assignments.get(point.id),
            "chapter_order": orders.get(assignments.get(point.id)),
            "is_chapter_root": point.id in chapter_ids,
        }
        for point in points
    }


async def graph_chapter_metadata(
    db: AsyncSession,
    points: list[KnowledgePoint],
    edges: list[KnowledgeEdge],
    subject_root_id: int | None,
) -> dict[int, dict]:
    if not points:
        return {}
    _, memberships = await active_memberships(db, [points[0].subject_id])
    return build_graph_chapter_metadata(points, edges, subject_root_id, memberships)
