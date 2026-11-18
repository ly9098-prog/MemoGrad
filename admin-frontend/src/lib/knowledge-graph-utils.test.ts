import { describe, it, expect } from "vitest";
import {
  shortName,
  clamp,
  edgeStrength,
  collapseEdgesByPair,
  nodeRadius,
  graphNodeRadius,
  clusterRingAnchors,
  wheelZoomFactor,
  estimatedLabelWidth,
  relationLabel,
  escapeHtml,
  relationColor,
  difficultyText,
} from "./knowledge-graph-utils";
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "./api/types";

function makeEdge(overrides: Partial<KnowledgeGraphEdge>): KnowledgeGraphEdge {
  return { id: 1, source: 1, target: 2, type: "prerequisite", weight: 5, confidence: 0.8, ...overrides } as KnowledgeGraphEdge;
}
function makeNode(overrides: Partial<KnowledgeGraphNode>): KnowledgeGraphNode {
  return { id: 1, name: "Test", degree: 3, level: 1, subject_id: 1, ...overrides } as KnowledgeGraphNode;
}

describe("shortName", () => {
  it("returns name when within length", () => { expect(shortName("abc", 9)).toBe("abc"); });
  it("truncates with ellipsis", () => { expect(shortName("abcdefghijk", 5)).toBe("abcde…"); });
  it("uses default length 9", () => { expect(shortName("abcdefghijk")).toBe("abcdefghi…"); });
});

describe("clamp", () => {
  it("clamps to min", () => { expect(clamp(-5, 0, 10)).toBe(0); });
  it("clamps to max", () => { expect(clamp(15, 0, 10)).toBe(10); });
  it("returns value when in range", () => { expect(clamp(5, 0, 10)).toBe(5); });
});

describe("edgeStrength", () => {
  it("computes weighted blend", () => {
    const e = makeEdge({ weight: 10, confidence: 1.0 });
    expect(edgeStrength(e)).toBeCloseTo(1.0);
  });
  it("handles zero weight", () => {
    const e = makeEdge({ weight: 0, confidence: 0.5 });
    expect(edgeStrength(e)).toBeCloseTo(0.38);
  });
});

describe("collapseEdgesByPair", () => {
  it("keeps strongest edge per pair", () => {
    const edges = [
      makeEdge({ id: 1, source: 1, target: 2, confidence: 0.5, weight: 3 }),
      makeEdge({ id: 2, source: 2, target: 1, confidence: 0.9, weight: 8 }),
    ];
    const result = collapseEdgesByPair(edges);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe(2);
  });
  it("preserves different pairs", () => {
    const edges = [
      makeEdge({ id: 1, source: 1, target: 2 }),
      makeEdge({ id: 2, source: 1, target: 3 }),
    ];
    expect(collapseEdgesByPair(edges).length).toBe(2);
  });
  it("handles empty array", () => { expect(collapseEdgesByPair([])).toEqual([]); });
});

describe("nodeRadius", () => {
  it("clamps to minimum 18", () => {
    expect(nodeRadius(makeNode({ degree: 0 }))).toBeGreaterThanOrEqual(18);
  });
  it("clamps to maximum 28", () => {
    expect(nodeRadius(makeNode({ degree: 1000 }))).toBeLessThanOrEqual(28);
  });
  it("scales with degree", () => {
    const r1 = nodeRadius(makeNode({ degree: 1 }));
    const r2 = nodeRadius(makeNode({ degree: 16 }));
    expect(r2).toBeGreaterThan(r1);
  });
});

describe("graphNodeRadius", () => {
  it("keeps leaf nodes compact", () => {
    expect(graphNodeRadius(makeNode({ degree: 1 }))).toBeLessThan(6);
  });
  it("renders hierarchy parents larger than equally connected leaves", () => {
    const leaf = graphNodeRadius(makeNode({ degree: 4 }));
    const parent = graphNodeRadius(makeNode({ degree: 4 }), { childCount: 3 });
    expect(parent).toBeGreaterThan(leaf * 1.35);
  });
  it("gives overview topics an additional visual boost", () => {
    const regular = graphNodeRadius(makeNode({ degree: 20 }), { childCount: 2 });
    const topic = graphNodeRadius(makeNode({ degree: 20 }), { childCount: 2, isTopic: true });
    expect(topic).toBeGreaterThan(regular);
  });
  it("caps very large hubs", () => {
    expect(
      graphNodeRadius(makeNode({ degree: 1000 }), { childCount: 1000, isTopic: true }),
    ).toBeLessThanOrEqual(20);
  });
});

describe("clusterRingAnchors", () => {
  it("returns no anchors without clusters", () => {
    expect(clusterRingAnchors([], 0).size).toBe(0);
  });
  it("centers a single cluster", () => {
    const anchors = clusterRingAnchors([{ key: 7, count: 12 }], 12);
    expect(anchors.get(7)).toEqual({ x: 0, y: 0 });
  });
  it("places two clusters on a horizontal axis", () => {
    const anchors = clusterRingAnchors(
      [
        { key: 0, count: 10 },
        { key: 1, count: 10 },
      ],
      20,
      1.7,
    );
    expect(anchors.get(0)?.y).toBe(0);
    expect(anchors.get(1)?.y).toBe(0);
    expect(anchors.get(0)?.x ?? 0).toBeLessThan(0);
    expect(anchors.get(1)?.x ?? 0).toBeGreaterThan(0);
  });
  it("stretches wide viewports horizontally", () => {
    const clusters = [0, 1, 2, 3, 4].map((key) => ({ key, count: 10 }));
    const square = clusterRingAnchors(clusters, 50, 1);
    const wide = clusterRingAnchors(clusters, 50, 2.4);
    const spreadX = (anchors: Map<number, { x: number; y: number }>) =>
      Math.max(...[...anchors.values()].map((anchor) => Math.abs(anchor.x)));
    const spreadY = (anchors: Map<number, { x: number; y: number }>) =>
      Math.max(...[...anchors.values()].map((anchor) => Math.abs(anchor.y)));
    expect(spreadX(wide)).toBeGreaterThan(spreadX(square));
    expect(spreadY(wide)).toBeLessThan(spreadY(square));
  });
  it("gives larger clusters more room", () => {
    const anchors = clusterRingAnchors(
      [
        { key: 0, count: 30 },
        { key: 1, count: 4 },
      ],
      34,
      1.7,
    );
    const distance = (key: number) => {
      const anchor = anchors.get(key);
      return Math.hypot(anchor?.x ?? 0, anchor?.y ?? 0);
    };
    expect(distance(0)).toBeGreaterThan(distance(1));
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in for upward wheel motion", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
  });
  it("zooms out for downward wheel motion", () => {
    expect(wheelZoomFactor(100)).toBeLessThan(1);
  });
  it("normalizes line-mode wheel deltas", () => {
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48, 0));
  });
  it("limits a single wheel step", () => {
    expect(wheelZoomFactor(100000)).toBe(0.84);
    expect(wheelZoomFactor(-100000)).toBe(1.19);
  });
});

describe("estimatedLabelWidth", () => {
  it("clamps to minimum 54", () => {
    expect(estimatedLabelWidth(makeNode({ name: "A" }))).toBeGreaterThanOrEqual(54);
  });
  it("clamps to maximum 154", () => {
    expect(estimatedLabelWidth(makeNode({ name: "非常长的知识点名称超过限制" }))).toBeLessThanOrEqual(154);
  });
});

describe("relationLabel", () => {
  it("returns label for known type", () => { expect(relationLabel("prerequisite")).toBe("前置"); });
  it("returns type for unknown type", () => { expect(relationLabel("unknown")).toBe("unknown"); });
});

describe("escapeHtml", () => {
  it("escapes every HTML metacharacter", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
    );
  });
  it("leaves ordinary text unchanged", () => {
    expect(escapeHtml("数据结构 · 12 条关系")).toBe("数据结构 · 12 条关系");
  });
});

describe("relationColor", () => {
  it("returns color for known type", () => { expect(relationColor("parent")).toBe("#5b8c5b"); });
  it("returns default for unknown type", () => { expect(relationColor("unknown")).toBe("#8a9ba9"); });
});

describe("difficultyText", () => {
  it("returns 基础 for level <= 1", () => { expect(difficultyText(0)).toBe("基础"); expect(difficultyText(1)).toBe("基础"); });
  it("returns 较易 for level 2", () => { expect(difficultyText(2)).toBe("较易"); });
  it("returns 中等 for level 3", () => { expect(difficultyText(3)).toBe("中等"); });
  it("returns 较难 for level 4", () => { expect(difficultyText(4)).toBe("较难"); });
  it("returns 进阶 for level > 4", () => { expect(difficultyText(5)).toBe("进阶"); });
});

import { selectDefaultSubject, buildDonutStops, computeDonutTotal } from "./knowledge-graph-utils";
import type { KnowledgeGraphSubject } from "./api/types";

const subjects: KnowledgeGraphSubject[] = [
  { id: 1, code: "computer_network", name: "计算机网络", level: 1, path: "/cn", knowledge_point_count: 50, edge_count: 80 },
  { id: 2, code: "data_structure", name: "数据结构", level: 1, path: "/ds", knowledge_point_count: 60, edge_count: 100 },
  { id: 3, code: "operating_system", name: "操作系统", level: 1, path: "/os", knowledge_point_count: 40, edge_count: 70 },
];

describe("selectDefaultSubject", () => {
  it("prefers data_structure by code", () => {
    expect(selectDefaultSubject(subjects)?.id).toBe(2);
  });
  it("prefers 数据结构 by name when no code match", () => {
    const s = [{ ...subjects[0], code: "ds", name: "数据结构" }];
    expect(selectDefaultSubject(s)?.name).toBe("数据结构");
  });
  it("falls back to highest edge_count", () => {
    const s = [
      { ...subjects[0], code: "x", name: "Other", edge_count: 50 },
      { ...subjects[2], code: "y", name: "Another", edge_count: 200 },
    ];
    expect(selectDefaultSubject(s)?.id).toBe(subjects[2].id);
  });
  it("falls back to highest knowledge_point_count when edges equal", () => {
    const s = [
      { id: 1, code: "a", name: "A", level: 1, path: "", knowledge_point_count: 10, edge_count: 50 },
      { id: 2, code: "b", name: "B", level: 1, path: "", knowledge_point_count: 20, edge_count: 50 },
    ];
    expect(selectDefaultSubject(s)?.id).toBe(2);
  });
  it("returns undefined for empty list", () => {
    expect(selectDefaultSubject([])).toBeUndefined();
  });
});

describe("buildDonutStops", () => {
  it("returns empty for all-zero counts", () => {
    expect(buildDonutStops({})).toEqual([]);
  });
  it("builds single stop when one relation", () => {
    const stops = buildDonutStops({ prerequisite: 5 });
    expect(stops).toHaveLength(1);
    expect(stops[0]).toContain("0%");
    expect(stops[0]).toContain("100%");
  });
  it("builds multiple stops proportionally", () => {
    const stops = buildDonutStops({ prerequisite: 3, related: 1 });
    expect(stops).toHaveLength(2);
    expect(stops[0]).toContain("0%");
    expect(stops[0]).toContain("75%");
    expect(stops[1]).toContain("75%");
    expect(stops[1]).toContain("100%");
  });
  it("handles NaN values as 0", () => {
    expect(buildDonutStops({ prerequisite: NaN })).toEqual([]);
  });
});

describe("computeDonutTotal", () => {
  it("sums all relation counts", () => {
    expect(computeDonutTotal({ prerequisite: 3, related: 2, next: 1 })).toBe(6);
  });
  it("returns 0 for empty", () => {
    expect(computeDonutTotal({})).toBe(0);
  });
  it("treats NaN as 0", () => {
    expect(computeDonutTotal({ prerequisite: NaN, related: 3 })).toBe(3);
  });
});
