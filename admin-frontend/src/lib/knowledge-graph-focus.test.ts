import { describe, expect, it } from "vitest";
import {
  GRAPH_HOVER_DELAY,
  GRAPH_HOVER_FADE_IN,
  GRAPH_HOVER_FADE_OUT,
  sampleGraphFocus,
  graphUnrelatedFocus,
  graphFocusLinkColor,
} from "./knowledge-graph-focus";

describe("graph hover dwell", () => {
  it("does not dim the graph during a brief pass over a node", () => {
    expect(sampleGraphFocus([], 1, GRAPH_HOVER_DELAY - 1)).toEqual([{ id: 1, strength: 0 }]);
    expect(sampleGraphFocus([{ id: 1, strength: 0 }], null, 0)).toEqual([]);
  });

  it("fades in linearly with time spent on the same node", () => {
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const elapsed = GRAPH_HOVER_DELAY + GRAPH_HOVER_FADE_IN * fraction;
      expect(sampleGraphFocus([], 1, elapsed)[0].strength).toBeCloseTo(fraction);
    }
    expect(sampleGraphFocus([], 1, 5000)).toEqual([{ id: 1, strength: 1 }]);
  });

  it("fades out from the visible strength without dropping the previous focus", () => {
    const previous = [{ id: 7, strength: 0.8 }];
    expect(sampleGraphFocus(previous, null, 0)).toEqual(previous);
    expect(sampleGraphFocus(previous, null, GRAPH_HOVER_FADE_OUT * 0.4)).toEqual([
      { id: 7, strength: 0.4 },
    ]);
    expect(sampleGraphFocus(previous, null, GRAPH_HOVER_FADE_OUT)).toEqual([]);
  });

  it("starts a new dwell while fading the previous node on a switch", () => {
    const previous = [{ id: 1, strength: 1 }];
    expect(sampleGraphFocus(previous, 2, 0)).toEqual([
      { id: 1, strength: 1 },
      { id: 2, strength: 0 },
    ]);
    expect(sampleGraphFocus(previous, 2, GRAPH_HOVER_DELAY + GRAPH_HOVER_FADE_IN)).toEqual([
      { id: 2, strength: 1 },
    ]);
  });

  it("starts selection and drag focus without waiting for pointer dwell", () => {
    expect(sampleGraphFocus([], 1, GRAPH_HOVER_FADE_OUT / 2, true)).toEqual([
      { id: 1, strength: 0.5 },
    ]);
  });

  it("protects the new focus and its neighbors from the previous hover or selection", () => {
    const oldFocus = { id: 1, strength: 1, neighbors: new Set([1, 2]) };
    const newFocus = new Set([7, 8]);
    expect(graphUnrelatedFocus(7, [oldFocus], newFocus)).toBe(0);
    expect(graphUnrelatedFocus(8, [oldFocus], newFocus)).toBe(0);
    expect(graphUnrelatedFocus(9, [oldFocus], newFocus)).toBe(1);
    expect(graphUnrelatedFocus(7, [oldFocus], null)).toBe(1);
  });

  it("keeps link colors continuous at the end of a highlight fade", () => {
    const base = "#24688f";
    const relation = "#5b8c5b";
    const end = graphFocusLinkColor(base, relation, 0, 0, true);
    const nearEnd = graphFocusLinkColor(base, relation, 0.00001, 0, true);
    expect(end).toBe("rgba(36, 104, 143, 0.22)");
    expect(nearEnd.startsWith("rgba(36, 104, 143,")).toBe(true);
    expect(graphFocusLinkColor(base, relation, 0, 1, false)).toBe(end);
  });

  it("keeps opacity continuous when an old highlight fades into a different dimmed neighborhood", () => {
    const colorAt = (strength: number) =>
      graphFocusLinkColor("#24688f", "#5b8c5b", strength, 0.6, true);
    const alphaAt = (strength: number) => Number(colorAt(strength).split(",").at(-1)!.slice(0, -1));
    expect(alphaAt(0)).toBeCloseTo(0.118);
    expect(alphaAt(0.00001) - alphaAt(0)).toBeLessThan(0.00001);
  });
});
