import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphHtml,
  buildKnowledgeGraphSvg,
  graphExportFilename,
  type ExportGraphInput,
} from "./knowledge-graph-export";

function makeInput(overrides: Partial<ExportGraphInput> = {}): ExportGraphInput {
  return {
    title: "数据结构知识图谱",
    subtitle: "2 个知识点 · 1 条关系",
    nodes: [
      { id: 1, name: "线性表", x: 10, y: 20, radius: 8, color: "#24688F" },
      { id: 2, name: "链表", x: 80, y: 40, radius: 5, color: "#147A83" },
    ],
    links: [
      {
        source: 1,
        target: 2,
        relation_type: "next",
        source_type: "inferred",
        confidence: 0.8,
      },
    ],
    clusters: [{ label: "线性结构", color: "#24688F", count: 2 }],
    linkWidth: 0.72,
    arrows: false,
    ...overrides,
  };
}

describe("buildKnowledgeGraphSvg", () => {
  it("returns null without positioned nodes", () => {
    expect(
      buildKnowledgeGraphSvg(
        makeInput({ nodes: [{ id: 1, name: "a", radius: 4, color: "#000" }] }),
      ),
    ).toBeNull();
  });

  it("draws labels below their nodes", () => {
    const svg = buildKnowledgeGraphSvg(makeInput()) ?? "";
    expect(svg).toContain('cy="20.0"');
    expect(svg).toMatch(/<text x="10\.0" y="41\.0"/);
    expect(svg).toContain("线性表");
  });

  it("escapes node names", () => {
    const svg =
      buildKnowledgeGraphSvg(
        makeInput({
          nodes: [{ id: 1, name: "<script>alert(1)</script>", x: 0, y: 0, radius: 4, color: "#000" }],
        }),
      ) ?? "";
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("keeps inferred links dashed", () => {
    const svg = buildKnowledgeGraphSvg(makeInput({ arrows: true })) ?? "";
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain('marker-end="url(#kg-arrow)"');
  });
});

describe("buildKnowledgeGraphHtml", () => {
  it("wraps the svg in a standalone page and escapes metadata", () => {
    const html = buildKnowledgeGraphHtml("<svg></svg>", {
      title: "<b>标题</b>",
      subtitle: "2 个知识点",
      generatedAt: new Date("2026-11-19T08:00:00+08:00"),
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<svg></svg>");
    expect(html).toContain("&lt;b&gt;标题&lt;/b&gt;");
    expect(html).toContain("2 个知识点");
  });
});

describe("graphExportFilename", () => {
  it("sanitizes the subject code and appends the format", () => {
    expect(
      graphExportFilename("data structure/2026", "svg", new Date(2026, 10, 19, 8, 5)),
    ).toBe("knowledge-graph-datastructure2026-20261119-0805.svg");
  });

  it("falls back to graph when the code has no safe characters", () => {
    expect(graphExportFilename("知识/图谱", "png", new Date(2026, 0, 2, 3, 4))).toBe(
      "knowledge-graph-graph-20260102-0304.png",
    );
  });
});
