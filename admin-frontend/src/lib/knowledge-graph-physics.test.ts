import { describe, expect, it } from "vitest";
import { forceSimulation, type SimulationLinkDatum } from "d3-force";
import {
  createGraphForces,
  DEFAULT_GRAPH_FORCES,
  GRAPH_ALPHA_DECAY,
  GRAPH_VELOCITY_DECAY,
  prewarmGraphLayout,
  type GraphForceSettings,
  type GraphPhysicsNode,
} from "./knowledge-graph-physics";

function fixture(count = 60) {
  const nodes: GraphPhysicsNode[] = Array.from({ length: count }, (_, id) => ({
    id,
    degree: id % 10 === 0 ? 10 : 2,
    radius: id % 10 === 0 ? 12 : 6,
  }));
  const links: SimulationLinkDatum<GraphPhysicsNode>[] = [];
  for (let id = 1; id < count; id += 1) {
    if (id % 10 === 0) links.push({ source: id - 10, target: id });
    else links.push({ source: Math.floor(id / 10) * 10, target: id });
  }
  return { nodes, links };
}

function simulationFor(
  data: ReturnType<typeof fixture>,
  settings: GraphForceSettings = DEFAULT_GRAPH_FORCES,
) {
  const simulation = forceSimulation(data.nodes).stop()
    .alphaDecay(GRAPH_ALPHA_DECAY)
    .velocityDecay(GRAPH_VELOCITY_DECAY);
  for (const [name, force] of Object.entries(createGraphForces(data.nodes, data.links, settings))) {
    simulation.force(name, force);
  }
  return simulation;
}

function medianLinkLength(data: ReturnType<typeof fixture>) {
  const distances = data.links.map((edge) => {
    const source = edge.source as GraphPhysicsNode;
    const target = edge.target as GraphPhysicsNode;
    return Math.hypot(source.x! - target.x!, source.y! - target.y!);
  }).sort((left, right) => left - right);
  return distances[Math.floor(distances.length / 2)];
}

describe("knowledge graph physics", () => {
  it("separates a 120-node graph using finite, deterministic initial positions", () => {
    const first = fixture(120);
    const second = fixture(120);
    prewarmGraphLayout(first.nodes, first.links);
    prewarmGraphLayout(second.nodes, second.links);
    expect(first.nodes.map(({ x, y }) => ({ x, y }))).toEqual(second.nodes.map(({ x, y }) => ({ x, y })));
    for (const node of first.nodes) {
      expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
      for (const other of first.nodes) {
        if (node.id >= other.id) continue;
        expect(Math.hypot(node.x! - other.x!, node.y! - other.y!)).toBeGreaterThan(node.radius + other.radius + 20);
      }
    }
  });

  it("increases actual link spacing when the link distance control grows", () => {
    const shorter = fixture();
    const longer = fixture();
    simulationFor(shorter, { ...DEFAULT_GRAPH_FORCES, distance: 120 }).tick(280);
    simulationFor(longer, { ...DEFAULT_GRAPH_FORCES, distance: 360 }).tick(280);
    expect(medianLinkLength(longer)).toBeGreaterThan(medianLinkLength(shorter) * 1.3);
  });

  it("lets a dragged node pull its neighbors and releases it without a fixed anchor", () => {
    const data = fixture();
    const simulation = simulationFor(data);
    simulation.tick(280);
    const hub = data.nodes[0];
    const neighbor = data.nodes[1];
    const before = { x: neighbor.x!, y: neighbor.y! };
    hub.fx = hub.x! + 280;
    hub.fy = hub.y;
    simulation.alpha(0.8).alphaTarget(0.3).tick(35);
    expect(Math.hypot(neighbor.x! - before.x, neighbor.y! - before.y)).toBeGreaterThan(15);
    const released = { x: hub.x!, y: hub.y! };
    hub.fx = undefined;
    hub.fy = undefined;
    simulation.alpha(0.8).alphaTarget(0).tick(40);
    expect(Math.hypot(hub.x! - released.x, hub.y! - released.y)).toBeGreaterThan(5);
    expect(hub.fx).toBeUndefined();
  });

  it("keeps isolated nodes finite with zero attraction and repulsion controls", () => {
    const data = { nodes: fixture(8).nodes, links: [] };
    simulationFor(data, { center: 0, charge: 0, link: 0, distance: 180 }).tick(50);
    expect(data.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  });

  it("prewarms new data with the same nondefault settings used by the live simulation", () => {
    const data = fixture();
    const settings = { ...DEFAULT_GRAPH_FORCES, distance: 360, charge: 22 };
    prewarmGraphLayout(data.nodes, data.links, settings, 1.6, 1.8);
    const before = data.nodes.map(({ x, y }) => ({ x: x!, y: y! }));
    const simulation = forceSimulation(data.nodes).stop().alpha(0.01)
      .alphaDecay(GRAPH_ALPHA_DECAY).velocityDecay(GRAPH_VELOCITY_DECAY);
    for (const [name, force] of Object.entries(createGraphForces(data.nodes, data.links, settings, 1.6, 1.8))) {
      simulation.force(name, force);
    }
    simulation.tick(40);
    const displacements = data.nodes.map((node, index) =>
      Math.hypot(node.x! - before[index].x, node.y! - before[index].y));
    expect(Math.max(...displacements)).toBeLessThan(15);
  });
});
