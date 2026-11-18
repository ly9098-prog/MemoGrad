import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";

export const DEFAULT_GRAPH_FORCES = {
  center: 0.3,
  charge: 12,
  link: 0.8,
  distance: 180,
};

export type GraphForceSettings = typeof DEFAULT_GRAPH_FORCES;
export type GraphPhysicsNode = SimulationNodeDatum & {
  id: number;
  degree: number;
  radius: number;
  is_chapter_root?: boolean;
  chapter_id?: number | null;
  chapter_order?: number | null;
};

export const GRAPH_ALPHA_DECAY = 0.025;
export const GRAPH_VELOCITY_DECAY = 0.23;

function createChapterOrderForce<Node extends GraphPhysicsNode>(nodes: Node[], gap: number) {
  const roots = nodes.filter((node) => node.is_chapter_root && node.chapter_order != null)
    .sort((left, right) => left.chapter_order! - right.chapter_order!);
  const retention = 1 - GRAPH_VELOCITY_DECAY;
  return () => {
    const free = roots.filter((node) => node.fx == null && Number.isFinite(node.x));
    const inverted = free.some((node, index) => index > 0 && node.x! < free[index - 1].x!);
    const blocks: Array<{ start: number; end: number; total: number; count: number }> = [];
    for (const [index, node] of free.entries()) {
      blocks.push({ start: index, end: index, total: node.x! + (node.vx ?? 0) * retention - index * gap, count: 1 });
      while (blocks.length > 1) {
        const right = blocks[blocks.length - 1];
        const left = blocks[blocks.length - 2];
        if (left.total / left.count <= right.total / right.count) break;
        blocks.splice(-2, 2, { start: left.start, end: right.end, total: left.total + right.total, count: left.count + right.count });
      }
    }
    for (const block of blocks) {
      for (let index = block.start; index <= block.end; index += 1) {
        const node = free[index];
        const predicted = node.x! + (node.vx ?? 0) * retention;
        const ordered = block.total / block.count + index * gap;
        const next = inverted ? predicted + (ordered - predicted) * 0.18 : ordered;
        node.vx = (next - node.x!) / retention;
      }
    }
  };
}

export function createGraphForces<
  Node extends GraphPhysicsNode,
  Edge extends SimulationLinkDatum<Node>,
>(nodes: Node[], links: Edge[], settings: GraphForceSettings, nodeScale = 1, aspect = 1) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const viewportAspect = Math.max(0.6, Math.min(2.4, aspect));
  const chapterOrders = [...new Set(nodes.flatMap((node) =>
    node.chapter_id != null && node.chapter_order != null ? [node.chapter_order] : [],
  ))].sort((left, right) => left - right);
  const chapterPositions = new Map(chapterOrders.map((order, index) => [
    order, (index - (chapterOrders.length - 1) / 2) * settings.distance * 1.8,
  ]));
  const endpoint = (value: Edge["source"]) =>
    typeof value === "object" ? value : byId.get(Number(value));

  return {
    charge: forceManyBody<Node>().strength(-settings.charge * 30).distanceMin(24),
    link: forceLink<Node, Edge>(links)
      .id((node) => node.id)
      .distance((edge) => {
        const source = endpoint(edge.source);
        const target = endpoint(edge.target);
        if (source?.chapter_id == null || target?.chapter_id == null) return settings.distance;
        return settings.distance * (source.chapter_id === target.chapter_id ? 1.8 : 0.6);
      })
      .strength((edge) => {
        const source = endpoint(edge.source);
        const target = endpoint(edge.target);
        const degree = Math.max(1, Math.min(source?.degree ?? 1, target?.degree ?? 1));
        return (settings.link * 0.25) / Math.sqrt(degree);
      }),
    x: forceX<Node>((node) => chapterPositions.get(node.chapter_order ?? -1) ?? 0)
      .strength((node) => settings.center * (
        chapterPositions.has(node.chapter_order ?? -1)
          ? node.is_chapter_root ? 0.18 : 0.02
          : 0.018 / viewportAspect
      )),
    y: forceY<Node>(0).strength(settings.center * 0.018 * viewportAspect),
    collision: forceCollide<Node>()
      .radius((node) => node.radius * nodeScale + 22)
      .strength(0.85)
      .iterations(2),
    chapterOrder: createChapterOrderForce(nodes, Math.max(24, settings.distance * 0.4)),
  };
}

export function prewarmGraphLayout<
  Node extends GraphPhysicsNode,
  Edge extends SimulationLinkDatum<Node>,
>(nodes: Node[], links: Edge[], settings = DEFAULT_GRAPH_FORCES, nodeScale = 1, aspect = 1) {
  const forces = createGraphForces(nodes, links, settings, nodeScale, aspect);
  const chapterOffsets = new Map<number, number>();
  for (const node of nodes) {
    if (node.chapter_id == null || node.chapter_order == null) continue;
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) continue;
    const index = chapterOffsets.get(node.chapter_id) ?? 0;
    chapterOffsets.set(node.chapter_id, index + 1);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = node.is_chapter_root ? 0 : settings.distance * Math.sqrt(index + 1) * 0.5;
    node.x = forces.x.x()(node, 0, nodes) + Math.cos(angle) * radius;
    node.y = Math.sin(angle) * radius;
  }
  const simulation = forceSimulation(nodes)
    .stop()
    .alphaDecay(GRAPH_ALPHA_DECAY)
    .velocityDecay(GRAPH_VELOCITY_DECAY);
  for (const [name, force] of Object.entries(forces)) simulation.force(name, force);
  simulation.tick(260);
}
