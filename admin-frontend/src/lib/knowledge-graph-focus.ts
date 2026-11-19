export type GraphFocusLayer = { id: number; strength: number };

export const GRAPH_HOVER_DELAY = 90;
export const GRAPH_HOVER_FADE_IN = 600;
export const GRAPH_HOVER_FADE_OUT = 220;

export function sampleGraphFocus(
  previous: GraphFocusLayer[],
  targetId: number | null,
  elapsed: number,
  immediate = false,
): GraphFocusLayer[] {
  const time = Math.max(0, elapsed);
  const layers = previous
    .filter((layer) => layer.id !== targetId)
    .map((layer) => ({
      id: layer.id,
      strength: Math.max(0, layer.strength - time / GRAPH_HOVER_FADE_OUT),
    }))
    .filter((layer) => layer.strength > 0);
  if (targetId != null) {
    const start = previous.find((layer) => layer.id === targetId)?.strength ?? 0;
    const delay = immediate ? 0 : GRAPH_HOVER_DELAY;
    const duration = immediate ? GRAPH_HOVER_FADE_OUT : GRAPH_HOVER_FADE_IN;
    const strength = Math.min(1, start + Math.max(0, time - delay) / duration);
    layers.push({ id: targetId, strength });
  }
  return layers;
}

export function graphUnrelatedFocus(
  id: number,
  layers: Array<GraphFocusLayer & { neighbors: ReadonlySet<number> }>,
  activeNeighbors: ReadonlySet<number> | null,
) {
  if (activeNeighbors?.has(id)) return 0;
  return Math.min(1, layers.reduce((sum, layer) =>
    sum + (layer.neighbors.has(id) ? 0 : layer.strength), 0));
}

export function graphFocusLinkColor(
  base: string,
  highlight: string,
  active: number,
  inactive: number,
  dimBackground: boolean,
) {
  const strength = Math.min(1, Math.max(0, active));
  const channels = [1, 3, 5].map((offset) => {
    const start = Number.parseInt(base.slice(offset, offset + 2), 16);
    const end = Number.parseInt(highlight.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * strength);
  });
  const backgroundAlpha = 0.22 - (dimBackground ? 0.17 * Math.min(1, Math.max(0, inactive)) : 0);
  const alpha = backgroundAlpha + (0.95 - backgroundAlpha) * strength;
  return `rgba(${channels.join(", ")}, ${alpha})`;
}
