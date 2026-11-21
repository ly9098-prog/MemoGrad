/**
 * Pure helpers for knowledge graph page, extracted from knowledge-graph/page.tsx.
 */

import type { KnowledgeGraphNode, KnowledgeGraphEdge } from "@/lib/api/types";

export const RELATIONS = {
  prerequisite: { label: "前置", color: "#4a6f8a", text: "学习目标所依赖的基础知识" },
  parent: { label: "父子", color: "#5b8c5b", text: "概念与细分知识点的层级关系" },
  next: { label: "后续", color: "#c49a6b", text: "掌握当前知识后自然衔接的节点" },
  related: { label: "相关", color: "#8b7c97", text: "没有强依赖但语义关联紧密" },
} as const;

export type RelationKey = keyof typeof RELATIONS;

export function shortName(name: string, length = 9): string {
  return name.length > length ? `${name.slice(0, length)}…` : name;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function edgeStrength(edge: Pick<KnowledgeGraphEdge, "weight" | "confidence">): number {
  const normalizedWeight = clamp(edge.weight / 10, 0, 1);
  return (edge.confidence ?? 0) * 0.76 + normalizedWeight * 0.24;
}

export function graphNodeRadius(
  node: Pick<KnowledgeGraphNode, "is_chapter_root">,
): number {
  return node.is_chapter_root ? 18 : 10;
}

export const GRAPH_MIN_ZOOM = 0.04;
export const GRAPH_MAX_ZOOM = 4;

export function graphZoomTarget(current: number, pending: number | undefined, factor: number): number {
  const reversing = pending != null && (factor - 1) * (pending - current) < 0;
  const start = pending == null || reversing ? current : pending;
  return clamp(start * factor, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
}

export function advanceGraphZoom(current: number, target: number, elapsed: number): number {
  const remaining = Math.log(target / current);
  if (Math.abs(remaining) < 0.0005) return target;
  const progress = 1 - Math.exp(-Math.max(0, elapsed) / 65);
  return current * Math.exp(remaining * progress);
}

export function wheelZoomFactor(
  deltaY: number,
  deltaMode = 0,
  viewportHeight = 800,
  ctrlKey = false,
): number {
  const modeScale = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1;
  const normalizedDelta = clamp(deltaY * modeScale, -240, 240);
  const sensitivity = ctrlKey ? 0.0034 : 0.0015;
  return clamp(Math.exp(-normalizedDelta * sensitivity), 0.84, 1.19);
}

export function relationLabel(type: string): string {
  return RELATIONS[type as RelationKey]?.label ?? type;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function relationColor(type: string): string {
  return RELATIONS[type as RelationKey]?.color ?? "#8a9ba9";
}

export function difficultyText(level: number): string {
  if (level <= 1) return "基础";
  if (level === 2) return "较易";
  if (level === 3) return "中等";
  if (level === 4) return "较难";
  return "进阶";
}

import type { KnowledgeGraphSubject } from "@/lib/api/types";

/**
 * Select the default subject for the knowledge graph view.
 * Prefers data_structure, falls back to the subject with the most edges/knowledge points.
 */
export function selectDefaultSubject(subjects: KnowledgeGraphSubject[]): KnowledgeGraphSubject | undefined {
  if (!subjects.length) return undefined;
  const dataStructure = subjects.find(
    (item) => item.code === "data_structure" || item.name.trim() === "数据结构",
  );
  if (dataStructure) return dataStructure;
  return [...subjects].sort(
    (a, b) => b.edge_count - a.edge_count || b.knowledge_point_count - a.knowledge_point_count,
  )[0];
}

/**
 * Build conic-gradient stops for the relation donut chart.
 * Returns an array of "color start% end%" strings.
 */
export function buildDonutStops(counts: Record<string, number>): string[] {
  const entries = (Object.keys(RELATIONS) as RelationKey[])
    .map((key) => ({ key, value: Number(counts[key]) || 0 }))
    .filter((item) => item.value > 0);
  const total = entries.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  return entries.map((item) => {
    const start = cursor;
    cursor += total ? (item.value / total) * 100 : 0;
    return `${RELATIONS[item.key].color} ${start}% ${cursor}%`;
  });
}

/**
 * Compute the total count for the relation donut chart.
 */
export function computeDonutTotal(counts: Record<string, number>): number {
  return (Object.keys(RELATIONS) as RelationKey[])
    .reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
}
