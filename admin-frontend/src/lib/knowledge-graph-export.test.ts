import { describe, expect, it } from "vitest";
import {
  buildKnowledgeGraphHtml,
  buildKnowledgeGraphSvg,
  exportLinkCoordinates,
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
    expect(svg).toMatch(/data-node-id="1"[^>]*transform="translate\([\d.]+ [\d.]+\)"/);
    expect(svg).toContain('<text x="0" y="26.00" text-anchor="middle"');
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

  it("wraps complete long names and keeps labels readable on a widely dispersed graph", () => {
    const name = "归并排序、基数排序和计数排序的时间复杂度与空间复杂度";
    const svg = buildKnowledgeGraphSvg(makeInput({
      nodes: [
        { id: 1, name, x: -20000, y: 0, radius: 10, color: "#24688F" },
        { id: 2, name: "绪论", x: 20000, y: 20000, radius: 18, color: "#24688F", isChapterRoot: true },
      ],
    })) ?? "";
    const label = /data-node-id="1"[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/.exec(svg)?.[1] ?? "";
    expect(label.match(/<tspan /g)?.length).toBeGreaterThan(1);
    expect(label.replace(/<[^>]*>/g, "")).toBe(name);
    expect(svg).toContain('font-size="13"');
    expect(svg).toContain('font-size="15"');
    expect(Number(/width="([\d.]+)" height="[\d.]+" font-family/.exec(svg)?.[1])).toBeLessThan(1900);
  });

  it("does not embed active color URLs or dangling edges", () => {
    const svg = buildKnowledgeGraphSvg(makeInput({
      nodes: [{ id: 1, name: "有效节点", x: 0, y: 0, radius: 8, color: "url(https://example.test)" }],
    })) ?? "";
    expect(svg).not.toContain("example.test");
    expect(svg).not.toContain("data-source");
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

describe("exportLinkCoordinates", () => {
  it("stops directed edges at node boundaries and keeps coincident endpoints finite", () => {
    expect(exportLinkCoordinates({ x: 0, y: 0, radius: 8 }, { x: 100, y: 0, radius: 5 })).toEqual([9, 0, 92, 0]);
    expect(exportLinkCoordinates({ x: 4, y: 2, radius: 8 }, { x: 4, y: 2, radius: 5 })).toEqual([4, 2, 4, 2]);
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
    const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).not.toContain("<b>标题</b>");
    expect(() => new Function(script)).not.toThrow();
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
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
