"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type ReactElement,
} from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "@/lib/api/types";
import { advanceGraphZoom, graphZoomTarget, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM, wheelZoomFactor } from "@/lib/knowledge-graph-utils";
import { createGraphForces, prewarmGraphLayout, type GraphForceSettings } from "@/lib/knowledge-graph-physics";

export type KgNodePayload = KnowledgeGraphNode & {
  radius: number;
  x?: number;
  y?: number;
  color: string;
  clusterId: number;
  clusterKey: string;
  clusterLabel: string;
  isTopic: boolean;
};

export type KgLinkPayload = Omit<KnowledgeGraphEdge, "source" | "target"> & {
  source: number | KgNodePayload;
  target: number | KgNodePayload;
  baseColor: string;
  relationColor: string;
};

type ForceCanvasProps = ForceGraphProps<KgNodePayload, KgLinkPayload> & {
  graphRef: MutableRefObject<ForceGraphMethods<KgNodePayload, KgLinkPayload> | undefined>;
  zoomControlRef?: MutableRefObject<SmoothZoomControl | null>;
  forceSettings: GraphForceSettings;
  nodeScale: number;
};

export type SmoothZoomControl = {
  cancel: () => void;
  zoomBy: (factor: number) => void;
  fit: (padding: number) => void;
  focus: (x: number, y: number, zoom: number) => void;
};

type ForceGraphRenderProps = ForceGraphProps<KgNodePayload, KgLinkPayload> & {
  ref?: MutableRefObject<ForceGraphMethods<KgNodePayload, KgLinkPayload> | undefined>;
};

type ZoomTransform = { k: number; x: number; y: number };
type WheelAnchor = { worldX: number; worldY: number; screenX: number; screenY: number };
type PendingZoom = { target: number } & (
  | { anchor: WheelAnchor; center?: never }
  | { center: { x: number; y: number }; anchor?: never }
);

// react-force-graph-2d exposes a generic function component, which is awkward to
// instantiate through a dynamic import. Casting once here keeps the page types strict.
const ForceGraph = ForceGraph2D as unknown as (props: ForceGraphRenderProps) => ReactElement;

export default function ForceCanvas({ graphRef, zoomControlRef, forceSettings, nodeScale, ...props }: ForceCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pendingZoomRef = useRef<PendingZoom | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const wheelZoomingRef = useRef(false);
  const lastZoomTimeRef = useRef(0);
  const onZoomEndRef = useRef(props.onZoomEnd);
  const appliedLayoutRef = useRef<{
    data: ForceCanvasProps["graphData"];
    forceSettings: GraphForceSettings;
    nodeScale: number;
    aspect: number;
  } | null>(null);

  useLayoutEffect(() => {
    const graph = graphRef.current;
    const data = props.graphData;
    if (!graph || !data) return;
    const aspect = props.width && props.height ? props.width / props.height : 1;
    const previous = appliedLayoutRef.current;
    const initializing = previous?.data !== data;
    if (initializing) {
      prewarmGraphLayout(data.nodes, data.links, forceSettings, nodeScale, aspect);
    }
    const forces = createGraphForces(data.nodes, data.links, forceSettings, nodeScale, aspect);
    graph.d3Force("center", null);
    for (const [name, force] of Object.entries(forces)) graph.d3Force(name, force as never);
    if (!initializing && previous && (
      previous.forceSettings !== forceSettings || previous.nodeScale !== nodeScale || previous.aspect !== aspect
    )) graph.d3ReheatSimulation();
    appliedLayoutRef.current = { data, forceSettings, nodeScale, aspect };
  }, [graphRef, props.graphData, props.width, props.height, forceSettings, nodeScale]);

  useEffect(() => {
    onZoomEndRef.current = props.onZoomEnd;
  }, [props.onZoomEnd]);

  const handleZoomEnd = useCallback((transform: ZoomTransform) => {
    if (!wheelZoomingRef.current) onZoomEndRef.current?.(transform);
  }, []);

  useEffect(() => {
    const canvas = hostRef.current?.querySelector("canvas");
    if (!canvas) return;
    const canvasElement: HTMLCanvasElement = canvas;

    function emitZoomEnd() {
      const graph = graphRef.current;
      const zoom = graph?.zoom();
      if (!graph || zoom == null || !Number.isFinite(zoom) || zoom <= 0) return;
      const translation = graph.graph2ScreenCoords(0, 0);
      onZoomEndRef.current?.({ k: zoom, x: translation.x, y: translation.y });
    }

    function commitPendingZoom(now: number) {
      zoomFrameRef.current = null;
      const pending = pendingZoomRef.current;
      const graph = graphRef.current;
      if (!graph || !pending) return;
      const { target, anchor, center } = pending;
      const elapsed = Math.min(64, Math.max(0, now - lastZoomTimeRef.current));
      lastZoomTimeRef.current = now;
      const next = advanceGraphZoom(graph.zoom(), target, elapsed);
      const previousCenter = graph.centerAt();
      const progress = 1 - Math.exp(-elapsed / 65);
      const nextCenter = anchor ? {
        x: anchor.worldX - (anchor.screenX - canvasElement.clientWidth / 2) / next,
        y: anchor.worldY - (anchor.screenY - canvasElement.clientHeight / 2) / next,
      } : {
        x: previousCenter.x + (center.x - previousCenter.x) * progress,
        y: previousCenter.y + (center.y - previousCenter.y) * progress,
      };
      graph.zoom(next);
      graph.centerAt(nextCenter.x, nextCenter.y);
      const centered = !center || Math.hypot(nextCenter.x - center.x, nextCenter.y - center.y) * next < 0.05;
      if (next === target && centered) {
        if (center) graph.centerAt(center.x, center.y);
        finishWheelZoom(true);
      }
      else zoomFrameRef.current = window.requestAnimationFrame(commitPendingZoom);
    }

    function finishWheelZoom(notify: boolean) {
      if (zoomFrameRef.current != null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
      pendingZoomRef.current = null;
      wheelZoomingRef.current = false;
      if (notify) emitZoomEnd();
    }

    function startZoom(pending: PendingZoom) {
      const graph = graphRef.current;
      if (!graph) return;
      pendingZoomRef.current = pending;
      wheelZoomingRef.current = true;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        graph.zoom(pending.target);
        if (pending.anchor) {
          graph.centerAt(
            pending.anchor.worldX - (pending.anchor.screenX - canvasElement.clientWidth / 2) / pending.target,
            pending.anchor.worldY - (pending.anchor.screenY - canvasElement.clientHeight / 2) / pending.target,
          );
        } else graph.centerAt(pending.center.x, pending.center.y);
        finishWheelZoom(true);
        return;
      }
      if (zoomFrameRef.current == null) {
        lastZoomTimeRef.current = performance.now();
        zoomFrameRef.current = window.requestAnimationFrame(commitPendingZoom);
      }
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      event.stopPropagation();
      const graph = graphRef.current;
      if (!graph) return;

      const rect = canvasElement.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const world = graph.screen2GraphCoords(screenX, screenY);
      const factor = wheelZoomFactor(
        event.deltaY,
        event.deltaMode,
        window.innerHeight,
        event.ctrlKey,
      );
      const pending = pendingZoomRef.current;
      const start = pending?.anchor ? pending.target : graph.zoom();
      const target = graphZoomTarget(graph.zoom(), pending?.anchor ? pending.target : undefined, factor);
      if (target === start) return;
      startZoom({
        target,
        anchor: {
          worldX: world.x,
          worldY: world.y,
          screenX,
          screenY,
        },
      });
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".kg-zoom")) return;
      if (wheelZoomingRef.current) finishWheelZoom(true);
    }

    const control: SmoothZoomControl = {
      cancel: () => finishWheelZoom(true),
      zoomBy: (factor) => {
        const graph = graphRef.current;
        if (!graph) return;
        const pending = pendingZoomRef.current;
        const center = graph.centerAt();
        startZoom({
          target: graphZoomTarget(graph.zoom(), pending?.anchor ? pending.target : undefined, factor),
          anchor: { worldX: center.x, worldY: center.y, screenX: canvasElement.clientWidth / 2, screenY: canvasElement.clientHeight / 2 },
        });
      },
      fit: (padding) => {
        const bounds = graphRef.current?.getGraphBbox();
        if (!bounds) return;
        startZoom({
          target: Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, Math.min(
            (canvasElement.clientWidth - padding * 2) / Math.max(1, bounds.x[1] - bounds.x[0]),
            (canvasElement.clientHeight - padding * 2) / Math.max(1, bounds.y[1] - bounds.y[0]),
          ))),
          center: { x: (bounds.x[0] + bounds.x[1]) / 2, y: (bounds.y[0] + bounds.y[1]) / 2 },
        });
      },
      focus: (x, y, target) => startZoom({ target, center: { x, y } }),
    };
    if (zoomControlRef) zoomControlRef.current = control;
    canvasElement.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      canvasElement.removeEventListener("wheel", handleWheel);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      if (zoomControlRef?.current === control) zoomControlRef.current = null;
      finishWheelZoom(false);
    };
  }, [graphRef, zoomControlRef]);

  return (
    <div ref={hostRef} className="kg-force-canvas">
      <ForceGraph ref={graphRef} {...props} onZoomEnd={handleZoomEnd} />
    </div>
  );
}
