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
};

export const GRAPH_ALPHA_DECAY = 0.025;
export const GRAPH_VELOCITY_DECAY = 0.23;

export function createGraphForces<
  Node extends GraphPhysicsNode,
  Edge extends SimulationLinkDatum<Node>,
>(nodes: Node[], links: Edge[], settings: GraphForceSettings, nodeScale = 1, aspect = 1) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const viewportAspect = Math.max(0.6, Math.min(2.4, aspect));
  const endpoint = (value: Edge["source"]) =>
    typeof value === "object" ? value : byId.get(Number(value));

  return {
    charge: forceManyBody<Node>().strength(-settings.charge * 30).distanceMin(24),
    link: forceLink<Node, Edge>(links)
      .id((node) => node.id)
      .distance(settings.distance)
      .strength((edge) => {
        const source = endpoint(edge.source);
        const target = endpoint(edge.target);
        const degree = Math.max(1, Math.min(source?.degree ?? 1, target?.degree ?? 1));
        return (settings.link * 0.25) / Math.sqrt(degree);
      }),
    x: forceX<Node>(0).strength(settings.center * 0.018 / viewportAspect),
    y: forceY<Node>(0).strength(settings.center * 0.018 * viewportAspect),
    collision: forceCollide<Node>()
      .radius((node) => node.radius * nodeScale + 22)
      .strength(0.85)
      .iterations(2),
  };
}

export function prewarmGraphLayout<
  Node extends GraphPhysicsNode,
  Edge extends SimulationLinkDatum<Node>,
>(nodes: Node[], links: Edge[], settings = DEFAULT_GRAPH_FORCES, nodeScale = 1, aspect = 1) {
  const forces = createGraphForces(nodes, links, settings, nodeScale, aspect);
  const simulation = forceSimulation(nodes)
    .stop()
    .alphaDecay(GRAPH_ALPHA_DECAY)
    .velocityDecay(GRAPH_VELOCITY_DECAY);
  for (const [name, force] of Object.entries(forces)) simulation.force(name, force);
  simulation.tick(260);
}
