"""Parent priority, cycle rejection and syllabus tree ordering contracts."""

from types import SimpleNamespace

from app.services import knowledge_map_service as service
from app.services.knowledge_outline import build_outline


def _point(point_id):
    return SimpleNamespace(id=point_id, name=f"point {point_id}")


def _edge(parent, child, source="manual", confidence=0.8, weight=1.0):
    return SimpleNamespace(
        source_knowledge_point_id=parent,
        target_knowledge_point_id=child,
        relation_type="parent",
        is_active=True,
        source=source,
        confidence=confidence,
        weight=weight,
    )


def test_parent_priority_rejects_cycles_and_external_endpoints():
    points = [_point(i) for i in range(1, 5)]
    edges = [
        _edge(1, 2, "ai", 1.0),
        _edge(3, 2, "manual", 0.1),
        _edge(2, 3),
        _edge(2, 4),
        _edge(4, 4),
        _edge(99, 1),
    ]
    assert service._build_parent_map(points, edges) == {3: 2, 4: 2, 2: 1}


def test_tree_uses_snapshot_order_and_clamps_display_depth():
    points = [_point(i) for i in range(1, 13)]
    parents = {i: i - 1 for i in range(3, 13)}
    members = {
        1: SimpleNamespace(sort_order=20, name_snapshot="a"),
        2: SimpleNamespace(sort_order=10, name_snapshot="z"),
    }
    rows = service._ordered_tree_rows(points, parents, members)
    assert [row[0].id for row in rows] == [*range(2, 13), 1]
    assert [row[1] for row in rows] == [*range(9), 8, 8, 0]
    assert rows[-1][2:] == (None, 0)


def test_tree_fallback_visits_cyclic_legacy_fragment_once():
    rows = service._ordered_tree_rows([_point(1), _point(2)], {1: 2, 2: 1})
    assert [(point.id, depth) for point, depth, _, _ in rows] == [(1, 0), (2, 1)]


def _outline_point(key, name, description=None, subject=1):
    return SimpleNamespace(
        id=key, name=name, description=description, subject_id=subject
    )


def test_admin_outline_natural_order_and_filtered_child_chapter_identity():
    points = [
        _outline_point(1, "排序", "408考纲节点：数据结构 > 第10章 排序。"),
        _outline_point(2, "线性表", "408考纲节点：数据结构 > 第2章 线性表。"),
        _outline_point(3, "链表", "408考纲节点：数据结构 > 第2章 线性表 > 2.1 链表。"),
    ]
    result = build_outline(points, [_edge(2, 3)])
    assert list(result) == [2, 3, 1]
    assert result[3]["chapter_id"] == 2
    assert result[3]["outline_path"] == ["第2章 线性表", "2.1 链表"]
    assert result[3]["outline_depth"] == 1


def test_admin_outline_preserves_snapshot_names_without_stale_description_titles():
    points = [_outline_point(1, "当前名称")]
    member = SimpleNamespace(
        name_snapshot="快照名称",
        description_snapshot="408考纲节点：数据结构 > 第3章 原名称。",
    )
    assert build_outline(points, [], {1: member})[1]["chapter_name"] == "第3章 快照名称"


def test_admin_outline_isolates_subjects_and_does_not_invent_chapters():
    points = [_outline_point(1, "独立点"), _outline_point(2, "其他科目", subject=2)]
    result = build_outline(points, [_edge(1, 2)])
    assert result[1]["chapter_id"] is None
    assert result[2]["parent_knowledge_point_id"] is None
    assert len(result) == 2


def test_admin_outline_cycle_rejection_keeps_every_point_once():
    points = [_outline_point(i, f"point {i}") for i in range(1, 4)]
    result = build_outline(points, [_edge(1, 2), _edge(2, 3), _edge(3, 1)])
    assert sorted(result) == [1, 2, 3]
    assert sorted(item["outline_order"] for item in result.values()) == [0, 1, 2]
