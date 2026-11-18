"use client";

import type { MutableRefObject, ReactElement } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods, ForceGraphProps } from "react-force-graph-2d";
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "@/lib/api/types";

export type KgNodePayload = KnowledgeGraphNode & {
  radius: number;
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
};

type ForceGraphRenderProps = ForceGraphProps<KgNodePayload, KgLinkPayload> & {
  ref?: MutableRefObject<ForceGraphMethods<KgNodePayload, KgLinkPayload> | undefined>;
};

// react-force-graph-2d exposes a generic function component, which is awkward to
// instantiate through a dynamic import. Casting once here keeps the page types strict.
const ForceGraph = ForceGraph2D as unknown as (props: ForceGraphRenderProps) => ReactElement;

export default function ForceCanvas({ graphRef, ...props }: ForceCanvasProps) {
  return <ForceGraph ref={graphRef} {...props} />;
}
