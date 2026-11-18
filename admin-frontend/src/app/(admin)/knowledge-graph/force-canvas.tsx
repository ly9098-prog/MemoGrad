"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
  type ReactElement,
} from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "@/lib/api/types";
import { wheelZoomFactor } from "@/lib/knowledge-graph-utils";

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
};

export type SmoothZoomControl = {
  cancel: () => void;
};

type ForceGraphRenderProps = ForceGraphProps<KgNodePayload, KgLinkPayload> & {
  ref?: MutableRefObject<ForceGraphMethods<KgNodePayload, KgLinkPayload> | undefined>;
};

type ZoomTransform = { k: number; x: number; y: number };
type WheelAnchor = { worldX: number; worldY: number; screenX: number; screenY: number };
type PendingZoom = { target: number; anchor: WheelAnchor };

const ZOOM_IDLE_MS = 110;

// react-force-graph-2d exposes a generic function component, which is awkward to
// instantiate through a dynamic import. Casting once here keeps the page types strict.
const ForceGraph = ForceGraph2D as unknown as (props: ForceGraphRenderProps) => ReactElement;

export default function ForceCanvas({ graphRef, zoomControlRef, ...props }: ForceCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const pendingZoomRef = useRef<PendingZoom | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const wheelZoomingRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  const onZoomEndRef = useRef(props.onZoomEnd);

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

    function commitPendingZoom() {
      zoomFrameRef.current = null;
      const pending = pendingZoomRef.current;
      pendingZoomRef.current = null;
      const graph = graphRef.current;
      if (!graph || !pending) return;
      const { target, anchor } = pending;
      const offsetX = anchor.screenX - canvasElement.clientWidth / 2;
      const offsetY = anchor.screenY - canvasElement.clientHeight / 2;
      graph.zoom(target);
      graph.centerAt(anchor.worldX - offsetX / target, anchor.worldY - offsetY / target);
    }

    function finishWheelZoom(notify: boolean, commit = true) {
      if (idleTimerRef.current != null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (commit && pendingZoomRef.current) commitPendingZoom();
      if (zoomFrameRef.current != null) {
        window.cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = null;
      }
      pendingZoomRef.current = null;
      wheelZoomingRef.current = false;
      if (notify) emitZoomEnd();
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
      const start = pendingZoomRef.current?.target ?? graph.zoom();
      const target = Math.min(4, Math.max(0.2, start * factor));
      if (Math.abs(target - start) < 0.0001) return;
      pendingZoomRef.current = {
        target,
        anchor: {
          worldX: world.x,
          worldY: world.y,
          screenX,
          screenY,
        },
      };
      wheelZoomingRef.current = true;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        finishWheelZoom(true);
        return;
      }
      if (zoomFrameRef.current == null) {
        zoomFrameRef.current = window.requestAnimationFrame(commitPendingZoom);
      }
      if (idleTimerRef.current != null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        finishWheelZoom(true);
      }, ZOOM_IDLE_MS);
    }

    function handlePointerDown() {
      if (wheelZoomingRef.current) finishWheelZoom(true);
    }

    const control: SmoothZoomControl = {
      cancel: () => finishWheelZoom(true),
    };
    if (zoomControlRef) zoomControlRef.current = control;
    canvasElement.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      canvasElement.removeEventListener("wheel", handleWheel);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      if (zoomControlRef?.current === control) zoomControlRef.current = null;
      finishWheelZoom(false, false);
    };
  }, [graphRef, zoomControlRef]);

  return (
    <div ref={hostRef} className="kg-force-canvas">
      <ForceGraph ref={graphRef} {...props} onZoomEnd={handleZoomEnd} />
    </div>
  );
}
