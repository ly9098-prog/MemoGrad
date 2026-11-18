"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  Download,
  FileCode2,
  FileImage,
  FileText,
  Focus,
  Gauge,
  GitBranch,
  LocateFixed,
  Maximize2,
  Minus,
  Minimize2,
  Network,
  Palette,
  Plus,
  Image as ImageIcon,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Type,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MutableRefObject } from "react";
import { forceCollide, forceX, forceY } from "d3-force";
import type { ForceGraphMethods, NodeObject } from "react-force-graph-2d";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { apiRequest, toQuery } from "@/lib/api/client";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  KnowledgeGraphResponse,
  KnowledgeGraphSubject,
} from "@/lib/api/types";
import {
  RELATIONS,
  buildDonutStops,
  clusterRingAnchors,
  computeDonutTotal,
  difficultyText,
  edgeStrength,
  escapeHtml,
  graphNodeRadius,
  relationColor,
  relationLabel,
  selectDefaultSubject,
  shortName,
  type RelationKey,
} from "@/lib/knowledge-graph-utils";
import {
  buildKnowledgeGraphHtml,
  buildKnowledgeGraphSvg,
  graphExportFilename,
  type GraphExportFormat,
} from "@/lib/knowledge-graph-export";
import type { KgLinkPayload, KgNodePayload, SmoothZoomControl } from "./force-canvas";

const ForceCanvas = dynamic(() => import("./force-canvas"), {
  ssr: false,
  loading: () => null,
});

const CLUSTER_COLORS = ["#24688F", "#147A83", "#6F5D8B", "#B07A35", "#A7596D"];
const NEUTRAL_COLOR = "#7C93A5";
const FIT_PADDING = 56;
const DEFAULT_FORCE = {
  center: 0.52,
  charge: 10,
  link: 1,
  distance: 250,
};
const DEFAULT_APPEARANCE = {
  arrows: false,
  textFade: true,
  textFadeThreshold: 0.52,
  nodeScale: 1,
  dimNeighbors: true,
  linkWidth: 1,
};

const EXPORT_OPTIONS: Array<{
  format: GraphExportFormat;
  label: string;
  hint: string;
  Icon: typeof ImageIcon;
}> = [
  { format: "png", label: "PNG 图片", hint: "完整图谱 · 2× 清晰度", Icon: ImageIcon },
  { format: "jpg", label: "JPG 图片", hint: "完整图谱 · 体积更小", Icon: FileImage },
  { format: "svg", label: "SVG 矢量", hint: "完整图谱 · 可缩放", Icon: FileCode2 },
  { format: "html", label: "HTML 页面", hint: "完整图谱 · 带标题图例", Icon: FileText },
];

type Cluster = {
  key: number;
  label: string;
  color: string;
  count: number;
  topicId: number | null;
};

type NeighborEntry = {
  node: KnowledgeGraphNode;
  relations: Array<{ edge: KgLinkPayload; outgoing: boolean }>;
  maxConfidence: number;
};

type SettingsSection = "filter" | "colors" | "appearance" | "forces";

function clusterStorageKey(cluster: Pick<Cluster, "topicId">) {
  return cluster.topicId == null ? "orphan" : `topic:${cluster.topicId}`;
}

function effectiveNodeColor(
  node: Pick<KgNodePayload, "clusterKey" | "color"> | undefined,
  overrides: Record<string, string>,
) {
  if (!node) return NEUTRAL_COLOR;
  return overrides[node.clusterKey] ?? node.color;
}

function rgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return `rgba(124, 147, 165, ${alpha})`;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function endpointId(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "id" in value) {
    const raw = (value as { id?: string | number }).id;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function buildClusters(
  nodes: KnowledgeGraphNode[],
  edges: KnowledgeGraphEdge[],
  topics: KnowledgeGraphResponse["overview_topics"],
): { clusters: Cluster[]; assignments: Map<number, number> } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map<number, number[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    adjacency.get(edge.target)?.push(edge.source);
  }

  let seeds = topics.map((topic) => topic.id).filter((id) => nodeById.has(id));
  if (seeds.length < 2) {
    seeds = [...nodes]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 5)
      .map((node) => node.id);
  }
  seeds = [...new Set(seeds)].slice(0, 5);

  const topicNames = new Map(topics.map((topic) => [topic.id, topic.name]));
  const assignments = new Map<number, number>();
  const queue: number[] = [];
  seeds.forEach((id, index) => {
    assignments.set(id, index);
    queue.push(id);
  });

  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const owner = assignments.get(current);
    if (owner == null) continue;
    for (const next of adjacency.get(current) ?? []) {
      if (assignments.has(next)) continue;
      assignments.set(next, owner);
      queue.push(next);
    }
  }

  let orphanCount = 0;
  for (const node of nodes) {
    if (assignments.has(node.id)) continue;
    assignments.set(node.id, 99);
    orphanCount += 1;
  }

  const clusters: Cluster[] = seeds.map((id, index) => ({
    key: index,
    label: topicNames.get(id) ?? nodeById.get(id)?.name ?? `主题簇 ${index + 1}`,
    color: CLUSTER_COLORS[index] ?? NEUTRAL_COLOR,
    count: 0,
    topicId: id,
  }));

  if (orphanCount) {
    clusters.push({
      key: 99,
      label: "孤立节点",
      color: NEUTRAL_COLOR,
      count: 0,
      topicId: null,
    });
  }

  for (const owner of assignments.values()) {
    const cluster = clusters.find((item) => item.key === owner);
    if (cluster) cluster.count += 1;
  }

  return { clusters, assignments };
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="kg-switch"
      data-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  const ratio = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <div className="kg-range-row">
      <div className="kg-range-meta">
        <span>{label}</span>
        <em>{display}</em>
      </div>
      <input
        type="range"
        aria-label={label}
        className="kg-range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{
          background: `linear-gradient(90deg, #25638a 0%, #7fd3f0 ${ratio}%, #d5e1eb ${ratio}%, #d5e1eb 100%)`,
        }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export default function KnowledgeGraphWorkspace() {
  const [subjectId, setSubjectId] = useState("");
  const [relationType, setRelationType] = useState("");
  const [depth, setDepth] = useState("2");
  const [showOrphans, setShowOrphans] = useState(true);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [centerId, setCenterId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("filter");
  const [legendOpen, setLegendOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewReady, setViewReady] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>({});

  const [force, setForce] = useState(DEFAULT_FORCE);
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);

  const graphRef = useRef<ForceGraphMethods<KgNodePayload, KgLinkPayload> | undefined>(undefined);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const smoothZoomControlRef = useRef<SmoothZoomControl | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const lastClickRef = useRef<{ id: number; at: number } | null>(null);
  const pendingViewRef = useRef<{ mode: "fit" | "focus"; focusId: number | null } | null>(null);
  const settingsCloseRef = useRef<HTMLButtonElement | null>(null);
  const lastSettingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const hoverClearTimerRef = useRef<number | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const labelMetricsRef = useRef(new Map<string, number>());
  const hasFittedRef = useRef(false);
  const lastFitDataRef = useRef<KnowledgeGraphResponse | null>(null);
  const initialFitDoneRef = useRef(false);

  const subjects = useQuery({
    queryKey: ["knowledge-graph", "subjects"],
    queryFn: () => apiRequest<KnowledgeGraphSubject[]>("/knowledge/subjects"),
  });

  useEffect(() => {
    if (subjectId || !subjects.data?.length) return;
    const selected = selectDefaultSubject(subjects.data);
    if (selected) setSubjectId(String(selected.id));
  }, [subjectId, subjects.data]);

  useEffect(() => {
    const next = searchDraft.trim();
    if (next === searchTerm) return;
    const timer = window.setTimeout(() => {
      setCenterId(null);
      setSelectedId(null);
      setSearchTerm(next);
    }, next ? 320 : 160);
    return () => window.clearTimeout(timer);
  }, [searchDraft, searchTerm]);

  const graph = useQuery({
    queryKey: ["knowledge-graph", subjectId, relationType, depth, searchTerm, centerId],
    enabled: Boolean(subjectId),
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      apiRequest<KnowledgeGraphResponse>(
        `/knowledge/graph${toQuery({
          subject_id: Number(subjectId),
          relation_type: relationType || undefined,
          knowledge_point_id: centerId ?? undefined,
          search: searchTerm || undefined,
          depth: Number(depth),
          // 120 is the backend's visualisation ceiling; a local view keeps the
          // neighbourhood readable instead of re-fitting the entire subject.
          max_nodes: centerId != null || searchTerm ? 56 : 120,
        })}`,
      ),
  });

  const graphData = useMemo(() => {
    const payload = graph.data;
    if (!payload) {
      return {
        nodes: [] as KgNodePayload[],
        links: [] as KgLinkPayload[],
        clusters: [] as Cluster[],
        nodeById: new Map<number, KgNodePayload>(),
      };
    }

    const visibleNodes = showOrphans
      ? payload.nodes
      : payload.nodes.filter((node) => node.degree > 0);
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = payload.edges.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    );
    const childCounts = new Map<number, number>();
    for (const edge of visibleEdges) {
      if (edge.relation_type !== "parent") continue;
      childCounts.set(edge.source, (childCounts.get(edge.source) ?? 0) + 1);
    }

    const { clusters, assignments } = buildClusters(
      visibleNodes,
      visibleEdges,
      payload.overview_topics,
    );

    const nodes: KgNodePayload[] = visibleNodes.map((node) => {
      const cluster = clusters.find((item) => item.key === assignments.get(node.id));
      const childCount = childCounts.get(node.id) ?? 0;
      const isTopic = cluster?.topicId === node.id;
      return {
        ...node,
        radius: graphNodeRadius(node, { childCount, isTopic }),
        color: cluster?.color ?? NEUTRAL_COLOR,
        clusterId: cluster?.key ?? -1,
        clusterKey: cluster ? clusterStorageKey(cluster) : "orphan",
        clusterLabel: cluster?.label ?? "其他",
        isTopic,
      };
    });

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const links: KgLinkPayload[] = visibleEdges
      .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
      .map((edge) => ({
        ...edge,
        baseColor: nodeById.get(edge.source)?.color ?? NEUTRAL_COLOR,
        relationColor: relationColor(edge.relation_type),
      }));

    return { nodes, links, clusters, nodeById };
  }, [graph.data, showOrphans]);

  const forceGraphData = useMemo(
    () => ({ nodes: graphData.nodes, links: graphData.links }),
    [graphData.nodes, graphData.links],
  );

  const summary = graph.data?.summary;
  const subjectName =
    graph.data?.subject.name
    ?? subjects.data?.find((item) => String(item.id) === subjectId)?.name
    ?? (subjects.data?.length === 0 ? "暂无科目" : "全部科目");
  const subjectMeta = summary
    ? ` · ${summary.total_nodes} 知识点 · ${summary.total_edges} 条关系`
    : subjects.data?.length === 0
      ? ""
      : " · 正在加载";

  useEffect(() => {
    const payload = graph.data;
    if (!payload) return;
    pendingViewRef.current = {
      mode: centerId != null || Boolean(searchTerm) ? "focus" : "fit",
      focusId: payload.focus_id,
    };
  }, [graph.data, centerId, searchTerm]);

  useEffect(() => {
    if (!graph.data || size.width <= 0 || size.height <= 0) return;
    if (lastFitDataRef.current === graph.data) return;
    lastFitDataRef.current = graph.data;
    hasFittedRef.current = false;
    if (initialFitDoneRef.current) return;
    let frame = 0;
    let attempts = 0;
    const fitWhenReady = () => {
      const fg = graphRef.current;
      const canvas = canvasWrapRef.current?.querySelector("canvas");
      const bbox = fg?.getGraphBbox();
      const hasViewport = Boolean(canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0);
      const hasBounds = Boolean(
        bbox
          && Number.isFinite(bbox.x[0])
          && Number.isFinite(bbox.x[1])
          && Number.isFinite(bbox.y[0])
          && Number.isFinite(bbox.y[1])
          && bbox.x[1] - bbox.x[0] > 1
          && bbox.y[1] - bbox.y[0] > 1,
      );
      if (!fg || !hasViewport || !hasBounds) {
        if (attempts < 60) {
          attempts += 1;
          frame = window.requestAnimationFrame(fitWhenReady);
        } else {
          setViewReady(true);
        }
        return;
      }
      if (pendingViewRef.current?.mode === "fit") {
        fg.zoomToFit(0, FIT_PADDING);
        hasFittedRef.current = true;
        pendingViewRef.current = null;
        initialFitDoneRef.current = true;
      }
      setViewReady(true);
    };
    frame = window.requestAnimationFrame(fitWhenReady);
    return () => window.cancelAnimationFrame(frame);
  }, [graph.data, size.height, size.width]);

  useEffect(() => {
    const element = canvasWrapRef.current;
    if (!element) return;
    const update = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const charge = fg.d3Force("charge") as unknown as
      | { strength?: (value: number) => void }
      | undefined;
    const densityScale = Math.max(1, Math.sqrt(graphData.nodes.length) / 7);
    charge?.strength?.(-force.charge * 10 * densityScale);

    const viewportAspect = size.height > 0 ? size.width / size.height : 1.6;
    const anchors = clusterRingAnchors(
      graphData.clusters,
      graphData.nodes.length,
      viewportAspect * 1.35,
    );
    const link = fg.d3Force("link") as unknown as
      | {
          distance?: (value: number | ((link: unknown) => number)) => void;
          strength?: (value: number | ((link: unknown) => number)) => void;
        }
      | undefined;
    link?.distance?.((rawLink) => {
      const edge = rawLink as KgLinkPayload;
      const source = graphData.nodeById.get(endpointId(edge.source) ?? -1);
      const target = graphData.nodeById.get(endpointId(edge.target) ?? -1);
      const sameCluster = source && target ? source.clusterId === target.clusterId : true;
      return Math.max(70, force.distance * (sameCluster ? 0.36 : 1.35));
    });
    link?.strength?.((rawLink) => {
      const edge = rawLink as KgLinkPayload;
      const sourceId = endpointId(edge.source);
      const targetId = endpointId(edge.target);
      const source = sourceId == null ? undefined : graphData.nodeById.get(sourceId);
      const target = targetId == null ? undefined : graphData.nodeById.get(targetId);
      const sameCluster = source && target ? source.clusterId === target.clusterId : true;
      const sharedDegree = Math.min(source?.degree ?? 1, target?.degree ?? 1);
      const scale = sameCluster ? 0.8 : 0.18;
      return (force.link * scale) / Math.sqrt(Math.max(1, sharedDegree));
    });

    const collision = forceCollide<KgNodePayload>()
      .radius((node) => Math.max(10, node.radius * appearance.nodeScale + 14))
      .strength(0.9)
      .iterations(2);

    const anchorStrength = force.center * 0.5;
    fg.d3Force(
      "x",
      forceX<KgNodePayload>((node) => anchors.get(node.clusterId)?.x ?? 0).strength(anchorStrength),
    );
    fg.d3Force(
      "y",
      forceY<KgNodePayload>((node) => anchors.get(node.clusterId)?.y ?? 0).strength(anchorStrength),
    );
    fg.d3Force("collision", collision as never);
    fg.d3ReheatSimulation();
  }, [appearance.nodeScale, force, graphData, size.height, size.width]);

  useEffect(() => {
    const handler = () => {
      const active = document.fullscreenElement === workspaceRef.current;
      setIsFullscreen(active);
      setPortalContainer(active ? workspaceRef.current : null);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(
    () => () => {
      if (hoverClearTimerRef.current != null) {
        window.clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }
      if (zoomFrameRef.current != null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsOpen) setSettingsOpen(false);
      else setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  useEffect(() => {
    if (settingsOpen) {
      settingsCloseRef.current?.focus();
      return;
    }
    lastSettingsTriggerRef.current?.focus();
  }, [settingsOpen]);

  useEffect(() => {
    if (!exportOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (exportMenuRef.current?.contains(event.target as Node)) return;
      setExportOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [exportOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const panel = settingsCloseRef.current?.closest(".kg-settings");
    panel
      ?.querySelector(`[data-kg-section="${activeSection}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [activeSection, settingsOpen]);

  useEffect(() => {
    if (!graph.data) return;
    labelMetricsRef.current.clear();
    setSelectedId((current) =>
      current != null && !graphData.nodeById.has(current) ? null : current,
    );
    setHoveredId((current) =>
      current != null && !graphData.nodeById.has(current) ? null : current,
    );
  }, [graph.data, graphData.nodeById]);

  const selectedNode = useMemo(
    () => (selectedId == null ? null : graphData.nodeById.get(selectedId) ?? null),
    [graphData.nodeById, selectedId],
  );

  const selectedNeighbors = useMemo<NeighborEntry[]>(() => {
    if (selectedId == null) return [];
    const grouped = new Map<
      number,
      { node: KnowledgeGraphNode; relations: NeighborEntry["relations"]; maxConfidence: number }
    >();

    for (const edge of graphData.links) {
      const sourceId = endpointId(edge.source);
      const targetId = endpointId(edge.target);
      if (sourceId !== selectedId && targetId !== selectedId) continue;
      const outgoing = sourceId === selectedId;
      const otherId = outgoing ? targetId : sourceId;
      if (otherId == null) continue;
      const node = graphData.nodeById.get(otherId);
      if (!node) continue;
      const current = grouped.get(otherId) ?? { node, relations: [], maxConfidence: 0 };
      current.relations.push({ edge, outgoing });
      current.maxConfidence = Math.max(current.maxConfidence, edge.confidence);
      grouped.set(otherId, current);
    }

    return [...grouped.values()]
      .map((entry) => ({
        ...entry,
        relations: entry.relations.sort((a, b) => edgeStrength(b.edge) - edgeStrength(a.edge)),
      }))
      .sort((a, b) => b.maxConfidence - a.maxConfidence || b.node.degree - a.node.degree);
  }, [graphData.links, graphData.nodeById, selectedId]);

  const focusId = hoveredId ?? selectedId;
  const focusSet = useMemo(() => {
    if (focusId == null) return null;
    const set = new Set<number>([focusId]);
    for (const edge of graphData.links) {
      const sourceId = endpointId(edge.source);
      const targetId = endpointId(edge.target);
      if (sourceId === focusId && targetId != null) set.add(targetId);
      else if (targetId === focusId && sourceId != null) set.add(sourceId);
    }
    return set;
  }, [focusId, graphData.links]);

  function fitView() {
    smoothZoomControlRef.current?.cancel();
    graphRef.current?.zoomToFit(460, FIT_PADDING);
  }

  function changeZoom(factor: number) {
    smoothZoomControlRef.current?.cancel();
    const fg = graphRef.current;
    if (!fg) return;
    fg.zoom(Math.min(4, Math.max(0.2, fg.zoom() * factor)), 220);
  }

  function focusNode(id: number) {
    smoothZoomControlRef.current?.cancel();
    setCenterId(id);
    setSelectedId(id);
    setSearchDraft("");
    setSearchTerm("");
    setSettingsOpen(false);
  }

  function resetScope() {
    smoothZoomControlRef.current?.cancel();
    setCenterId(null);
    setSelectedId(null);
    setSearchDraft("");
    setSearchTerm("");
  }

  function restoreViewDefaults() {
    resetScope();
    setRelationType("");
    setDepth("2");
    setShowOrphans(true);
    setHoveredId(null);
    setForce(DEFAULT_FORCE);
    setAppearance(DEFAULT_APPEARANCE);
    setColorOverrides({});
    pendingViewRef.current = { mode: "fit", focusId: null };
    window.requestAnimationFrame(() => graphRef.current?.zoomToFit(460, FIT_PADDING));
  }

  function handleNodeClick(node: NodeObject<KgNodePayload>) {
    const id = Number(node.id);
    const now = Date.now();
    if (lastClickRef.current?.id === id && now - lastClickRef.current.at < 340) {
      lastClickRef.current = null;
      focusNode(id);
      return;
    }
    lastClickRef.current = { id, at: now };
    setSelectedId(id);
  }

  function handleNodeHover(node: NodeObject<KgNodePayload> | null) {
    if (hoverClearTimerRef.current != null) {
      window.clearTimeout(hoverClearTimerRef.current);
      hoverClearTimerRef.current = null;
    }
    if (node) {
      const id = Number(node.id);
      setHoveredId((current) => (current === id ? current : id));
      return;
    }
    hoverClearTimerRef.current = window.setTimeout(() => {
      hoverClearTimerRef.current = null;
      setHoveredId(null);
    }, 110);
  }

  function handleZoomEnd(transform: { k: number }) {
    const zoom = Number(transform?.k);
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    if (zoomFrameRef.current != null) {
      window.cancelAnimationFrame(zoomFrameRef.current);
    }
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      setZoomLevel(zoom);
    });
  }

  function handleEngineStop() {
    smoothZoomControlRef.current?.cancel();
    const pending = pendingViewRef.current;
    if (!pending) return;
    pendingViewRef.current = null;
    const fg = graphRef.current;
    if (!fg) return;

    if (pending.mode === "focus" && pending.focusId != null) {
      const target = graphData.nodes.find((node) => node.id === pending.focusId) as
        | (KgNodePayload & { x?: number; y?: number })
        | undefined;
      if (target?.x != null && target?.y != null) {
        fg.centerAt(target.x, target.y, 280);
        fg.zoom(1.55, 280);
        return;
      }
    }

    if (!hasFittedRef.current) {
      fg.zoomToFit(0, FIT_PADDING);
      hasFittedRef.current = true;
    }
  }

  function paintNode(
    node: NodeObject<KgNodePayload>,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) {
    const id = Number(node.id);
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = nodeDisplayRadius(node);
    const nodeColor = effectiveNodeColor(node, colorOverrides);
    const isFocusNode = focusId === id;
    const inFocus = focusSet ? focusSet.has(id) : true;
    const alpha = focusSet && appearance.dimNeighbors ? (inFocus ? 1 : 0.14) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (isFocusNode) {
      ctx.shadowColor = "rgba(127, 211, 240, 0.55)";
      ctx.shadowBlur = 22 / globalScale;
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (isFocusNode) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 4.5 / globalScale, 0, Math.PI * 2);
      ctx.strokeStyle = "#7FD3F0";
      ctx.lineWidth = 2.6 / globalScale;
      ctx.stroke();
    } else if (hoveredId === id) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5 / globalScale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.lineWidth = 1.2 / globalScale;
      ctx.stroke();
    }

    ctx.restore();
  }

  function nodeDisplayRadius(node: NodeObject<KgNodePayload>) {
    return Math.max(
      2.4,
      node.radius * appearance.nodeScale * (focusId === Number(node.id) ? 1.12 : 1),
    );
  }

  function paintLabels(ctx: CanvasRenderingContext2D, globalScale: number) {
    const labelVisible = appearance.textFade
      ? Math.max(
          0.34,
          Math.min(1, globalScale / Math.max(0.001, appearance.textFadeThreshold)),
        )
      : 1;
    const ordered = [...graphData.nodes].sort((left, right) => {
      const leftFocus = Number(left.id === focusId);
      const rightFocus = Number(right.id === focusId);
      return rightFocus - leftFocus || right.degree - left.degree;
    });
    type LabelRect = { left: number; right: number; top: number; bottom: number };
    const labels: Array<{
      label: string;
      x: number;
      y: number;
      fontSize: number;
      alpha: number;
      isFocusNode: boolean;
    }> = [];
    const fontFor = (isFocusNode: boolean, fontSize: number) =>
      `${isFocusNode ? 700 : 600} ${fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
    const pad = 2 / globalScale;
    const cellSize = Math.max(1, 40 / globalScale);
    const grid = new Map<string, LabelRect[]>();
    const cellKeys = (left: number, right: number, top: number, bottom: number) => {
      const keys: string[] = [];
      const firstX = Math.floor(left / cellSize);
      const lastX = Math.floor(right / cellSize);
      const firstY = Math.floor(top / cellSize);
      const lastY = Math.floor(bottom / cellSize);
      for (let cellX = firstX; cellX <= lastX; cellX += 1) {
        for (let cellY = firstY; cellY <= lastY; cellY += 1) {
          keys.push(`${cellX}:${cellY}`);
        }
      }
      return keys;
    };
    const occupy = (rect: LabelRect) => {
      for (const key of cellKeys(rect.left, rect.right, rect.top, rect.bottom)) {
        const bucket = grid.get(key);
        if (bucket) bucket.push(rect);
        else grid.set(key, [rect]);
      }
    };

    const labelVariants = (name: string) => {
      const full = shortName(name, globalScale < 0.9 ? 11 : 16);
      const variants = [full];
      for (const limit of [9, 6]) {
        if (full.length <= limit) continue;
        const shortened = shortName(full, limit);
        if (!variants.includes(shortened)) variants.push(shortened);
      }
      return variants;
    };

    const overlapArea = (rect: LabelRect) => {
      let sum = 0;
      const seen = new Set<LabelRect>();
      for (const key of cellKeys(
        rect.left - pad,
        rect.right + pad,
        rect.top - pad,
        rect.bottom + pad,
      )) {
        for (const occupied of grid.get(key) ?? []) {
          if (seen.has(occupied)) continue;
          seen.add(occupied);
          const horizontal =
            Math.min(rect.right + pad, occupied.right) - Math.max(rect.left - pad, occupied.left);
          const vertical =
            Math.min(rect.bottom + pad, occupied.bottom) - Math.max(rect.top - pad, occupied.top);
          sum += horizontal > 0 && vertical > 0 ? horizontal * vertical : 0;
        }
      }
      return sum;
    };
    const metrics = labelMetricsRef.current;
    if (metrics.size > 1500) metrics.clear();
    const measureScreenWidth = (text: string, screenFontSize: number, weight: number) => {
      const key = `${weight}:${screenFontSize}:${text}`;
      const cached = metrics.get(key);
      if (cached != null) return cached;
      ctx.save();
      ctx.font = fontFor(weight === 700, screenFontSize);
      const measured = ctx.measureText(text).width;
      ctx.restore();
      metrics.set(key, measured);
      return measured;
    };

    for (const node of ordered) {
      const id = Number(node.id);
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      const isFocusNode = focusId === id;
      const inFocus = focusSet ? focusSet.has(id) : true;
      const alpha = isFocusNode ? 1 : focusSet && !inFocus ? 0.2 : labelVisible;
      const fontSize = (isFocusNode ? 12 : 10.5) / globalScale;
      const radius = nodeDisplayRadius(node);
      const gap = 5 / globalScale;
      const height = fontSize * 1.25;
      const variants = labelVariants(node.name);
      let label = variants[0];
      let width = 0;
      let best = { left: x, top: y + radius + gap };
      let bestRatio = Number.POSITIVE_INFINITY;

      for (const variant of variants) {
        const variantWidth =
          measureScreenWidth(variant, isFocusNode ? 12 : 10.5, isFocusNode ? 700 : 600) /
          globalScale;
        const candidate = {
          left: x - variantWidth / 2,
          top: y + radius + gap,
        };
        const ratio =
          overlapArea({
            left: candidate.left,
            right: candidate.left + variantWidth,
            top: candidate.top,
            bottom: candidate.top + height,
          }) / Math.max(1, variantWidth * height);
        if (ratio < bestRatio) {
          best = candidate;
          bestRatio = ratio;
          label = variant;
          width = variantWidth;
        }
        if (ratio <= 0.35) break;
      }

      occupy({
        left: best.left,
        right: best.left + width,
        top: best.top,
        bottom: best.top + height,
      });
      labels.push({
        label,
        x: best.left,
        y: best.top + height / 2,
        fontSize,
        alpha: alpha * (bestRatio > 0.85 ? 0.55 : 1),
        isFocusNode,
      });
    }

    for (const item of labels.reverse()) {
      ctx.save();
      ctx.globalAlpha = item.alpha;
      ctx.font = `${item.isFocusNode ? 700 : 600} ${item.fontSize}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 2.6 / globalScale;
      ctx.strokeStyle = "rgba(247, 250, 252, 0.96)";
      ctx.strokeText(item.label, item.x, item.y);
      ctx.fillStyle = item.isFocusNode ? "#0F3A52" : "#173342";
      ctx.fillText(item.label, item.x, item.y);
      ctx.restore();
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  function exportGraph(format: GraphExportFormat) {
    setExportOpen(false);
    const title = `${subjectName}知识图谱`;
    const subtitle =
      `${graphData.nodes.length} 个知识点 · ${graphData.links.length} 条关系` +
      ` · 平均置信度 ${confidence}%`;
    const svg = buildKnowledgeGraphSvg({
      title,
      subtitle,
      nodes: graphData.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        x: node.x,
        y: node.y,
        radius: node.radius * appearance.nodeScale,
        color: effectiveNodeColor(node, colorOverrides),
      })),
      links: graphData.links,
      clusters: graphData.clusters
        .filter((cluster) => cluster.count > 0)
        .map((cluster) => ({
          label: cluster.label,
          color: colorOverrides[clusterStorageKey(cluster)] ?? cluster.color,
          count: cluster.count,
        })),
      linkWidth: 0.72 * appearance.linkWidth,
      arrows: appearance.arrows,
    });
    if (!svg) return;
    const filename = graphExportFilename(
      graph.data?.subject.code ?? "graph",
      format,
    );
    if (format === "png" || format === "jpg") {
      const url = URL.createObjectURL(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      );
      const image = new window.Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(
          2,
          4096 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1),
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#F7FAFC";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (blob) downloadBlob(blob, filename);
          },
          format === "jpg" ? "image/jpeg" : "image/png",
          0.92,
        );
      };
      image.onerror = () => URL.revokeObjectURL(url);
      image.src = url;
      return;
    }
    if (format === "svg") {
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        filename,
      );
      return;
    }
    downloadBlob(
      new Blob([buildKnowledgeGraphHtml(svg, { title, subtitle })], {
        type: "text/html;charset=utf-8",
      }),
      filename,
    );
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    const element = workspaceRef.current;
    if (!element) return;
    await element.requestFullscreen?.().catch(() => undefined);
  }

  function openSettings(section: SettingsSection, trigger?: HTMLButtonElement) {
    lastSettingsTriggerRef.current = trigger ?? null;
    setSettingsOpen(true);
    setActiveSection(section);
  }

  const subjectOptions = (subjects.data ?? []).map((item) => ({
    value: String(item.id),
    label: item.name,
    suffix: `${item.knowledge_point_count}`,
  }));

  const relationOptions = [
    { value: "", label: "全部关系" },
    ...(Object.keys(RELATIONS) as RelationKey[]).map((key) => ({
      value: key,
      label: RELATIONS[key].label,
    })),
  ];

  const depthOptions = [
    { value: "1", label: "一跳邻居" },
    { value: "2", label: "两跳邻居" },
    { value: "3", label: "三跳邻居" },
  ];

  const confidence = summary ? Math.round(summary.avg_confidence * 100) : 0;
  const hasInferredLinks = graphData.links.some((link) => link.source_type === "inferred");
  const donutStops = selectedNode ? buildDonutStops(selectedNode.relation_counts) : [];
  const donutTotal = selectedNode ? computeDonutTotal(selectedNode.relation_counts) : 0;
  const errorMessage =
    graph.error instanceof Error
      ? graph.error.message
      : graph.isError
        ? "图谱加载失败，请稍后重试"
        : null;

  return (
    <div ref={workspaceRef} className="kg-workspace">
      <header className="kg-header">
        <div className="kg-header-title">
          <h1>知识图谱</h1>
          <p>
            {subjectName}
            {subjectMeta}
          </p>
        </div>

        <div className="kg-header-actions">
          <Select
            value={subjectId}
            onChange={(value) => {
              setSubjectId(value);
              setCenterId(null);
              setSelectedId(null);
              setSearchDraft("");
              setSearchTerm("");
            }}
            options={subjectOptions}
            placeholder="选择科目"
            className="kg-subject-select"
            portalContainer={portalContainer}
          />

          <div className="kg-search">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setCenterId(null);
                  setSelectedId(null);
                  setSearchTerm(searchDraft.trim());
                }
                if (event.key === "Escape") setSearchDraft("");
              }}
              placeholder="搜索知识点、别名或 ID"
              aria-label="搜索知识点、别名或 ID"
            />
            {searchDraft && (
              <button
                type="button"
                className="kg-search-clear"
                onClick={() => setSearchDraft("")}
                aria-label="清空搜索"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <Button variant="secondary" size="sm" onClick={restoreViewDefaults}>
            <RefreshCw className="h-3.5 w-3.5" />
            重置
          </Button>
          <div className="kg-export" ref={exportMenuRef}>
            <Button
              size="sm"
              aria-haspopup="true"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen((current) => !current)}
            >
              <Download className="h-3.5 w-3.5" />
              导出图谱
              <ChevronDown className={`h-3 w-3 transition-transform ${exportOpen ? "rotate-180" : ""}`} />
            </Button>
            {exportOpen && (
              <div
                className="kg-export-menu kg-glass"
                role="group"
                aria-label="选择导出格式"
              >
                {EXPORT_OPTIONS.map(({ format, label, hint, Icon }) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => exportGraph(format)}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>
                      <strong>{label}</strong>
                      <em>{hint}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="kg-canvas-wrap" data-inspector={selectedNode ? "true" : undefined}>
        <div className="kg-grid" />
        <div ref={canvasWrapRef} className="kg-canvas" data-ready={viewReady ? "true" : "false"}>
          {size.width > 0 && size.height > 0 && (
            <ForceCanvas
              graphRef={graphRef as MutableRefObject<ForceGraphMethods<KgNodePayload, KgLinkPayload> | undefined>}
              zoomControlRef={smoothZoomControlRef}
              graphData={forceGraphData}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              nodeRelSize={1}
              nodeVal={(node) => Math.pow(node.radius * appearance.nodeScale, 2)}
              nodeLabel={(node) =>
                escapeHtml(`${node.name} · ${node.degree} 条关系 · ${node.question_count} 题`)
              }
              nodeColor={(node) => effectiveNodeColor(node, colorOverrides)}
              nodeCanvasObject={paintNode}
              onRenderFramePost={paintLabels}
              nodePointerAreaPaint={(node, color, ctx, globalScale) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(
                  node.x ?? 0,
                  node.y ?? 0,
                  nodeDisplayRadius(node) + 5 / globalScale,
                  0,
                  Math.PI * 2,
                );
                ctx.fill();
              }}
              linkSource="source"
              linkTarget="target"
              linkCurvature={0}
              linkColor={(link) => {
                const payload = link as unknown as KgLinkPayload;
                const sourceId = endpointId(link.source);
                const targetId = endpointId(link.target);
                const sourceNode =
                  sourceId == null ? undefined : graphData.nodeById.get(sourceId);
                const active =
                  focusId != null && (sourceId === focusId || targetId === focusId);
                const baseColor = effectiveNodeColor(sourceNode, colorOverrides);
                if (focusId == null) return rgba(baseColor, 0.17);
                return active ? rgba(payload.relationColor, 0.98) : rgba(baseColor, 0.055);
              }}
              linkWidth={() => 0.72 * appearance.linkWidth}
              linkLabel={(link) => {
                const payload = link as unknown as KgLinkPayload;
                return escapeHtml(
                  `${relationLabel(payload.relation_type)} · ${Math.round(payload.confidence * 100)}%${
                    payload.source_type === "inferred" ? " · 自动推断" : ""
                  }`,
                );
              }}
              linkDirectionalArrowLength={appearance.arrows ? 3.2 : 0}
              linkDirectionalArrowColor={(link) => {
                const payload = link as unknown as KgLinkPayload;
                return rgba(payload.relationColor, 0.55);
              }}
              linkDirectionalArrowRelPos={0.86}
              linkHoverPrecision={6}
              linkLineDash={(link) =>
                (link as unknown as KgLinkPayload).source_type === "inferred" ? [5, 4] : null
              }
              d3AlphaDecay={0.022}
              d3VelocityDecay={0.3}
              d3AlphaMin={0.001}
              warmupTicks={240}
              cooldownTicks={50}
              minZoom={0.2}
              maxZoom={4}
              enableNodeDrag
              enableZoomInteraction={(event) => event.type !== "wheel"}
              enablePanInteraction
              showPointerCursor
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              onBackgroundClick={() => setSelectedId(null)}
              onEngineStop={handleEngineStop}
              onZoomEnd={handleZoomEnd}
            />
          )}
        </div>

        <nav
          className="kg-toolbar kg-glass"
          aria-label="图谱工具"
          hidden={settingsOpen}
          inert={settingsOpen ? true : undefined}
        >
            <button
              type="button"
              className="kg-tool"
              data-active={settingsOpen && activeSection === "filter"}
              onClick={(event) => openSettings("filter", event.currentTarget)}
              title="筛选"
            >
              <SlidersHorizontal />
              <span>筛选</span>
            </button>
            <button
              type="button"
              className="kg-tool"
              data-active={settingsOpen && activeSection === "colors"}
              onClick={(event) => openSettings("colors", event.currentTarget)}
              title="颜色组"
            >
              <Palette />
              <span>颜色组</span>
            </button>
            <button
              type="button"
              className="kg-tool"
              data-active={settingsOpen && activeSection === "appearance"}
              onClick={(event) => openSettings("appearance", event.currentTarget)}
              title="外观"
            >
              <Type />
              <span>外观</span>
            </button>
            <button
              type="button"
              className="kg-tool"
              data-active={settingsOpen && activeSection === "forces"}
              onClick={(event) => openSettings("forces", event.currentTarget)}
              title="力度"
            >
              <Gauge />
              <span>力度</span>
            </button>
            <button type="button" className="kg-tool" onClick={fitView} title="适应画布">
              <LocateFixed />
              <span>定位</span>
            </button>
        </nav>

        <div className="kg-breadcrumb kg-glass">
          {centerId != null ? (
            <>
              <button type="button" onClick={resetScope}>
                <ChevronLeft className="h-3 w-3" />
                全局图谱
              </button>
              <span className="kg-crumb-sep">›</span>
              <span className="kg-crumb-current">
                {selectedNode?.name ?? graph.data?.nodes.find((node) => node.id === centerId)?.name ?? `#${centerId}`}
              </span>
            </>
          ) : (
            <>
              <Network className="h-3 w-3 text-[var(--color-primary)]" />
              <span className="kg-crumb-current">全局图谱</span>
              <span className="kg-crumb-sep">·</span>
              <span>{graphData.nodes.length} / {summary?.total_nodes ?? 0} 节点</span>
            </>
          )}
          {searchTerm && (
            <span className="kg-search-chip">
              <Search className="h-2.5 w-2.5" />
              <span>{searchTerm}</span>
            </span>
          )}
        </div>

        {graphData.clusters.length > 0 && (
          <div className="kg-legend kg-glass" data-open={legendOpen ? "true" : undefined}>
            <button
              type="button"
              className="kg-legend-toggle"
              aria-expanded={legendOpen}
              onClick={() => setLegendOpen((current) => !current)}
            >
              <span>颜色组 · {graphData.clusters.filter((cluster) => cluster.count > 0).length} 簇</span>
              <span className="kg-legend-dots" aria-hidden="true">
                {graphData.clusters
                  .filter((cluster) => cluster.count > 0)
                  .map((cluster) => (
                    <i
                      key={cluster.key}
                      style={{
                        background:
                          colorOverrides[clusterStorageKey(cluster)] ?? cluster.color,
                      }}
                    />
                  ))}
              </span>
              <ChevronDown className="kg-legend-chevron" />
            </button>
            {legendOpen && (
              <div className="kg-legend-body">
                <div className="kg-legend-list">
                  {graphData.clusters.filter((cluster) => cluster.count > 0).map((cluster) => (
                    <div className="kg-legend-row" key={cluster.key}>
                      <i
                        style={{
                          background:
                            colorOverrides[clusterStorageKey(cluster)] ?? cluster.color,
                        }}
                      />
                      <span>{cluster.label}</span>
                      <em>{cluster.count}</em>
                    </div>
                  ))}
                </div>
                <div className="kg-legend-note">
                  {Object.keys(colorOverrides).length > 0 ? "自定义配色" : "自动配色"}
                  {hasInferredLinks ? " · 虚线表示自动推断关系" : ""}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="kg-status kg-glass">
          <span className="kg-status-live" data-busy={graph.isFetching} />
          <span><strong>{graphData.nodes.length}</strong> / {summary?.total_nodes ?? 0} 节点</span>
          <span className="kg-status-divider" />
          <span><strong>{graphData.links.length}</strong> 关系</span>
          <span className="kg-status-divider" />
          <span>平均置信度 <strong>{confidence}%</strong></span>
          {summary?.isolated_nodes ? (
            <>
              <span className="kg-status-divider" />
              <span>孤立 {summary.isolated_nodes}</span>
            </>
          ) : null}
        </div>

        <div className="kg-zoom">
          <div className="kg-zoom-stack kg-glass">
            <button
              type="button"
              className="kg-zoom-btn"
              onClick={() => changeZoom(1.25)}
              title="放大"
              aria-label="放大图谱"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <div className="kg-zoom-level" aria-live="polite">
              {Math.round(zoomLevel * 100)}%
            </div>
            <button
              type="button"
              className="kg-zoom-btn"
              onClick={() => changeZoom(0.8)}
              title="缩小"
              aria-label="缩小图谱"
            >
              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="kg-zoom-extra kg-glass">
            <button
              type="button"
              className="kg-zoom-btn"
              onClick={fitView}
              title="适应画布"
              aria-label="适应画布"
            >
              <LocateFixed className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="kg-zoom-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? "退出全屏" : "全屏"}
              aria-label={isFullscreen ? "退出全屏" : "全屏"}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {!settingsOpen && !selectedNode && (
          <div className="kg-hint kg-glass">单击查看 · 双击聚焦 · 滚轮缩放</div>
        )}

        {subjects.isLoading && (
          <div className="kg-overlay">
            <div className="kg-state">
              <Network />
              <h3>正在载入科目</h3>
              <p>读取可用的知识图谱科目…</p>
            </div>
          </div>
        )}

        {subjects.isError && (
          <div className="kg-overlay">
            <div className="kg-state">
              <X />
              <h3>科目加载失败</h3>
              <p>
                {subjects.error instanceof Error
                  ? subjects.error.message
                  : "请稍后重试"}
              </p>
              <div className="kg-state-actions">
                <Button size="sm" onClick={() => subjects.refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </Button>
              </div>
            </div>
          </div>
        )}

        {!subjects.isLoading && !subjects.isError && subjects.data?.length === 0 && (
          <div className="kg-overlay">
            <div className="kg-state">
              <Network />
              <h3>暂无可用科目</h3>
              <p>请先在科目页创建知识点，再回到知识图谱。</p>
            </div>
          </div>
        )}

        {graph.isLoading && (
          <div className="kg-overlay">
            <div className="kg-state">
              <Network />
              <h3>正在构建图谱</h3>
              <p>加载知识点、关系与主题簇…</p>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="kg-overlay">
            <div className="kg-state">
              <X />
              <h3>图谱加载失败</h3>
              <p>{errorMessage}</p>
              <div className="kg-state-actions">
                <Button size="sm" onClick={() => graph.refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  重试
                </Button>
              </div>
            </div>
          </div>
        )}

        {!graph.isLoading && !errorMessage && graph.data && searchTerm && graph.data.nodes.length === 0 && (
          <div className="kg-overlay">
            <div className="kg-state">
              <Search />
              <h3>没有匹配的知识点</h3>
              <p>尝试更短的关键词、英文别名，或直接输入知识点 ID。</p>
              <div className="kg-state-actions">
                <Button size="sm" variant="secondary" onClick={() => setSearchDraft("")}>
                  清空搜索
                </Button>
              </div>
            </div>
          </div>
        )}

        {settingsOpen && (
          <aside className="kg-settings kg-glass" aria-label="图谱设置">
            <div className="kg-settings-head">
              <div>
                <h2>图谱设置</h2>
                <p>调整会即时作用于画布</p>
              </div>
              <div className="kg-settings-actions">
                <button
                  type="button"
                  className="kg-text-btn"
                  onClick={restoreViewDefaults}
                >
                  恢复默认设置
                </button>
                <button
                  ref={settingsCloseRef}
                  type="button"
                  className="kg-close-btn"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="关闭设置"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="kg-settings-body">
              <section className="kg-section" data-kg-section="filter" data-lit={activeSection === "filter"}>
                <div className="kg-section-head">
                  <h3><SlidersHorizontal />筛选</h3>
                  <button
                    type="button"
                    className="kg-text-btn"
                    onClick={() => {
                      setRelationType("");
                      setDepth("2");
                      setShowOrphans(true);
                      resetScope();
                      setHoveredId(null);
                    }}
                  >
                    清除筛选
                  </button>
                </div>
                <div className="kg-field">
                  <div>
                    <div className="kg-field-label">关系类型</div>
                    <div className="kg-field-hint">只保留一种语义关系时，图谱会自动重新取景</div>
                  </div>
                  <Select
                    value={relationType}
                    onChange={(value) => {
                      setRelationType(value);
                      setSelectedId(null);
                    }}
                    options={relationOptions}
                    className="kg-select-compact"
                    portalContainer={portalContainer}
                  />
                </div>
                <div className="kg-field">
                  <div>
                    <div className="kg-field-label">展开深度</div>
                    <div className="kg-field-hint">双击节点进入局部图谱后生效</div>
                  </div>
                  <Select
                    value={depth}
                    onChange={(value) => {
                      setDepth(value);
                      setSelectedId(null);
                    }}
                    options={depthOptions}
                    className="kg-select-compact"
                    portalContainer={portalContainer}
                  />
                </div>
                <div className="kg-field">
                  <div>
                    <div className="kg-field-label">弱化非相邻节点</div>
                    <div className="kg-field-hint">聚焦时仅保留选中节点与一跳邻居</div>
                  </div>
                  <Toggle
                    checked={appearance.dimNeighbors}
                    onChange={(value) => setAppearance((current) => ({ ...current, dimNeighbors: value }))}
                    label="弱化非相邻节点"
                  />
                </div>
                <div className="kg-field">
                  <div>
                    <div className="kg-field-label">显示孤立节点</div>
                    <div className="kg-field-hint">关闭后隐藏没有任何关系的知识点</div>
                  </div>
                  <Toggle
                    checked={showOrphans}
                    onChange={setShowOrphans}
                    label="显示孤立节点"
                  />
                </div>
              </section>

              <section className="kg-section" data-kg-section="colors" data-lit={activeSection === "colors"}>
                <div className="kg-section-head">
                  <h3><Palette />颜色组</h3>
                  {Object.keys(colorOverrides).length > 0 ? (
                    <button
                      type="button"
                      className="kg-text-btn"
                      onClick={() => setColorOverrides({})}
                    >
                      恢复自动
                    </button>
                  ) : null}
                </div>
                <div className="kg-color-list">
                  {graphData.clusters.filter((cluster) => cluster.count > 0).map((cluster) => (
                    <div className="kg-color-row" key={cluster.key}>
                      <input
                        type="color"
                        className="kg-color-input"
                        aria-label={`${cluster.label}颜色`}
                        value={colorOverrides[clusterStorageKey(cluster)] ?? cluster.color}
                        onChange={(event) =>
                          setColorOverrides((current) => ({
                            ...current,
                            [clusterStorageKey(cluster)]: event.target.value,
                          }))
                        }
                      />
                      <span>{cluster.label}</span>
                      <em>{cluster.count} 节点</em>
                    </div>
                  ))}
                  {!graphData.clusters.length && (
                    <div className="kg-field-hint">暂无颜色组。</div>
                  )}
                </div>
              </section>

              <section className="kg-section" data-kg-section="appearance" data-lit={activeSection === "appearance"}>
                <div className="kg-section-head">
                  <h3><Type />外观</h3>
                  <button
                    type="button"
                    className="kg-text-btn"
                    onClick={() => setAppearance(DEFAULT_APPEARANCE)}
                  >
                    恢复默认
                  </button>
                </div>
                <div className="kg-field">
                  <div>
                    <div className="kg-field-label">显示箭头</div>
                    <div className="kg-field-hint">关闭时使用无向直线</div>
                  </div>
                  <Toggle
                    checked={appearance.arrows}
                    onChange={(value) => setAppearance((current) => ({ ...current, arrows: value }))}
                    label="显示箭头"
                  />
                </div>
                <div className="kg-field">
                  <div>
                    <div className="kg-field-label">文本淡出</div>
                    <div className="kg-field-hint">
                      缩放到阈值以下时淡化全部节点标签
                    </div>
                  </div>
                  <Toggle
                    checked={appearance.textFade}
                    onChange={(value) => setAppearance((current) => ({ ...current, textFade: value }))}
                    label="文本淡出"
                  />
                </div>
                <RangeControl
                  label="文本淡出阈值"
                  value={appearance.textFadeThreshold}
                  min={0.3}
                  max={1}
                  step={0.01}
                  display={`${Math.round(appearance.textFadeThreshold * 100)}%`}
                  onChange={(value) =>
                    setAppearance((current) => ({
                      ...current,
                      textFadeThreshold: value,
                    }))
                  }
                />
                <div className="kg-range-row">
                  <div className="kg-range-meta">
                    <span>节点大小</span>
                    <em>{Math.round(appearance.nodeScale * 100)}%</em>
                  </div>
                  <input
                    type="range"
                    aria-label="节点大小"
                    className="kg-range"
                    min={0.6}
                    max={1.6}
                    step={0.05}
                    value={appearance.nodeScale}
                    style={{ background: "linear-gradient(90deg, #25638a 0%, #7fd3f0 55%, #d5e1eb 55%, #d5e1eb 100%)" }}
                    onChange={(event) =>
                      setAppearance((current) => ({ ...current, nodeScale: Number(event.target.value) }))
                    }
                  />
                </div>
                <RangeControl
                  label="连线粗细"
                  value={appearance.linkWidth}
                  min={0.4}
                  max={2}
                  step={0.05}
                  display={`${appearance.linkWidth.toFixed(2)}×`}
                  onChange={(value) =>
                    setAppearance((current) => ({ ...current, linkWidth: value }))
                  }
                />
              </section>

              <section className="kg-section" data-kg-section="forces" data-lit={activeSection === "forces"}>
                <div className="kg-section-head">
                  <h3><Gauge />力度</h3>
                  <button
                    type="button"
                    className="kg-text-btn"
                    onClick={() => setForce(DEFAULT_FORCE)}
                  >
                    恢复默认
                  </button>
                </div>
                <RangeControl
                  label="图谱向心力"
                  value={force.center}
                  min={0}
                  max={1}
                  step={0.01}
                  display={force.center.toFixed(2)}
                  onChange={(value) => setForce((current) => ({ ...current, center: value }))}
                />
                <RangeControl
                  label="节点间的排斥力"
                  value={force.charge}
                  min={1}
                  max={30}
                  step={0.1}
                  display={force.charge.toFixed(2)}
                  onChange={(value) => setForce((current) => ({ ...current, charge: value }))}
                />
                <RangeControl
                  label="相连节点间的吸引力"
                  value={force.link}
                  min={0}
                  max={2}
                  step={0.01}
                  display={force.link.toFixed(2)}
                  onChange={(value) => setForce((current) => ({ ...current, link: value }))}
                />
                <RangeControl
                  label="连线长度"
                  value={force.distance}
                  min={80}
                  max={400}
                  step={5}
                  display={String(force.distance)}
                  onChange={(value) => setForce((current) => ({ ...current, distance: value }))}
                />
              </section>

              <div className="kg-settings-note">
                拖动滑块即时生效；右上角可恢复全部默认值。
              </div>
            </div>
          </aside>
        )}

        {selectedNode && (
          <aside className="kg-inspector kg-glass" aria-label="知识点详情">
            <div className="kg-inspector-head">
              <p>知识点详情</p>
              <button type="button" className="kg-close-btn" onClick={() => setSelectedId(null)} aria-label="关闭详情">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="kg-inspector-body">
              <div className="kg-node-title">
                <h2>{selectedNode.name}</h2>
                <span className="kg-node-badge">知识点</span>
              </div>
              <p className="kg-node-desc">
                {selectedNode.description || "暂无知识点描述，可通过关系结构与关联题量判断其在学习路径中的位置。"}
              </p>
              {!!selectedNode.aliases?.length && (
                <div className="kg-alias-row">
                  {selectedNode.aliases.slice(0, 6).map((alias) => (
                    <span key={alias} className="kg-alias">{alias}</span>
                  ))}
                  {selectedNode.aliases.length > 6 && (
                    <span className="kg-alias">+{selectedNode.aliases.length - 6}</span>
                  )}
                </div>
              )}

              <div className="kg-metric-grid">
                <div><span>知识点 ID</span><strong>#{selectedNode.id}</strong></div>
                <div><span>难度</span><strong>{difficultyText(selectedNode.difficulty_level)} · L{selectedNode.difficulty_level}</strong></div>
                <div><span>关联题目</span><strong>{selectedNode.question_count} 题</strong></div>
                <div><span>连接度</span><strong>{selectedNode.degree} 条</strong></div>
                <div><span>入边</span><strong>{selectedNode.in_degree}</strong></div>
                <div><span>出边</span><strong>{selectedNode.out_degree}</strong></div>
              </div>

              <div className="kg-subhead">
                <span>关联关系 <em>({selectedNeighbors.length})</em></span>
                <em>按最高置信度排序</em>
              </div>
              <div className="kg-neighbor-list">
                {selectedNeighbors.length ? (
                  selectedNeighbors.slice(0, 8).map(({ node, relations, maxConfidence }) => {
                    const lead = relations[0];
                    if (!lead) return null;
                    return (
                      <button
                        type="button"
                        key={node.id}
                        className="kg-neighbor"
                        onClick={() => setSelectedId(node.id)}
                      >
                        <i style={{ background: relationColor(lead.edge.relation_type) }} />
                        <span className="kg-neighbor-name">{node.name}</span>
                        {relations.slice(0, 2).map(({ edge, outgoing }) => (
                          <span
                            key={edge.id}
                            className="kg-relation-chip"
                            style={{
                              color: relationColor(edge.relation_type),
                              background: rgba(relationColor(edge.relation_type), 0.09),
                            }}
                          >
                            {outgoing ? "→" : "←"}{relationLabel(edge.relation_type)}
                          </span>
                        ))}
                        {relations.length > 2 && <span className="kg-neighbor-confidence">+{relations.length - 2}</span>}
                        <span className="kg-neighbor-confidence">{Math.round(maxConfidence * 100)}%</span>
                      </button>
                    );
                  })
                ) : (
                  <div className="kg-field-hint">当前视图中没有相邻关系。</div>
                )}
              </div>

              <div className="kg-subhead">关系类型分布</div>
              <div className="kg-donut-row">
                <div
                  className="kg-donut"
                  style={{ background: donutTotal ? `conic-gradient(${donutStops.join(",")})` : "#e8eef3" }}
                >
                  <div className="kg-donut-center">
                    <div>
                      <strong>{donutTotal}</strong>
                      <span>关系</span>
                    </div>
                  </div>
                </div>
                <div>
                  {(Object.keys(RELATIONS) as RelationKey[]).map((key) => {
                    const value = Number(selectedNode.relation_counts[key] ?? 0);
                    return (
                      <div key={key} className="kg-quality-meta">
                        <span className="inline-flex items-center gap-1.5">
                          <i className="h-1.5 w-1.5 rounded-full" style={{ background: RELATIONS[key].color }} />
                          {RELATIONS[key].label}
                        </span>
                        <span className="font-mono text-[9px] text-[var(--color-text-hint)]">{value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="kg-subhead">
                <span className="inline-flex items-center gap-1.5"><GitBranch className="h-3 w-3" />图谱质量</span>
              </div>
              {(Object.keys(RELATIONS) as RelationKey[]).map((key) => {
                const count = Number(summary?.relation_counts?.[key] ?? 0);
                const relationConfidence = Number(summary?.relation_confidence?.[key] ?? 0);
                if (!count) return null;
                return (
                  <div className="kg-quality-row" key={key}>
                    <div className="kg-quality-meta">
                      <span>{RELATIONS[key].label} · {count}</span>
                      <span>{Math.round(relationConfidence * 100)}% 置信度</span>
                    </div>
                    <div className="kg-quality-track">
                      <div
                        className="kg-quality-fill"
                        style={{
                          width: `${Math.min(100, Math.max(3, relationConfidence * 100))}%`,
                          background: RELATIONS[key].color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="kg-inspector-foot">
              <Link href={`/questions?knowledge_point_id=${selectedNode.id}`}>
                <BookOpen className="h-3.5 w-3.5" />
                查看题目
              </Link>
              <button
                type="button"
                onClick={() => focusNode(selectedNode.id)}
                disabled={centerId === selectedNode.id}
              >
                <Focus className="h-3.5 w-3.5" />
                {centerId === selectedNode.id ? "已聚焦" : "设为焦点"}
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
