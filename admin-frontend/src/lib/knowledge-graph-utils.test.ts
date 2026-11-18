import { describe, it, expect } from "vitest";
import {
  shortName,
  clamp,
  edgeStrength,
  graphNodeRadius,
  advanceGraphZoom,
  graphZoomTarget,
  GRAPH_MIN_ZOOM,
  wheelZoomFactor,
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
  return { id: 1, name: "Test", degree: 3, is_chapter_root: false, subject_id: 1, ...overrides } as KnowledgeGraphNode;
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

describe("graphNodeRadius", () => {
  it("uses exactly two sizes regardless of degree", () => {
    const radii = [0, 1, 4, 20, 1000].flatMap((degree) =>
      [false, true].map((is_chapter_root) => graphNodeRadius(makeNode({ degree, is_chapter_root }))),
    );
    expect(new Set(radii).size).toBe(2);
    expect(graphNodeRadius(makeNode({ is_chapter_root: true })))
      .toBeGreaterThan(graphNodeRadius(makeNode({ degree: 1000 })));
  });
  it("does not promote nodes when an older server omits chapter metadata", () => {
    expect(graphNodeRadius(makeNode({ degree: 1000, is_chapter_root: undefined })))
      .toBe(graphNodeRadius(makeNode({ degree: 0 })));
  });
});

describe("advanceGraphZoom", () => {
  it("converges smoothly instead of jumping to a wheel target", () => {
    const next = advanceGraphZoom(1, 1.2, 1000 / 60);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(1.2);
    expect(advanceGraphZoom(1.2, 1, 1000 / 60)).toBeGreaterThan(1);
  });
  it("moves the same distance at 60Hz and 120Hz over the same time", () => {
    const sample = (frames: number) => Array.from({ length: frames }).reduce<number>(
      (current) => advanceGraphZoom(current, 2, 200 / frames), 1,
    );
    expect(sample(12)).toBeCloseTo(sample(24), 10);
  });
  it("can reverse direction immediately and settles exactly", () => {
    const halfway = advanceGraphZoom(1, 2, 80);
    expect(advanceGraphZoom(halfway, 0.5, 16)).toBeLessThan(halfway);
    expect(advanceGraphZoom(1, 2, 0)).toBe(1);
    expect(advanceGraphZoom(1.9999, 2, 16)).toBe(2);
  });
});

describe("graph zoom input sequences", () => {
  it("accumulates pending detents that keep moving in the same direction", () => {
    expect(graphZoomTarget(1.1, 1.25, 1.25)).toBeCloseTo(1.25 ** 2);
  });
  it("reverses from the visible scale instead of an unfinished wheel or button target", () => {
    const zoomingIn = 1.2993;
    const zoomOutTarget = graphZoomTarget(zoomingIn, 2.5, 0.84);
    expect(advanceGraphZoom(zoomingIn, zoomOutTarget, 16)).toBeLessThan(zoomingIn);
    const zoomingOut = 0.8;
    const zoomInTarget = graphZoomTarget(zoomingOut, 0.4, 1.19);
    expect(advanceGraphZoom(zoomingOut, zoomInTarget, 16)).toBeGreaterThan(zoomingOut);
  });
  it("cancels the old inward target when reversal is clamped at the minimum", () => {
    expect(graphZoomTarget(GRAPH_MIN_ZOOM, 0.1, 0.8)).toBe(GRAPH_MIN_ZOOM);
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
