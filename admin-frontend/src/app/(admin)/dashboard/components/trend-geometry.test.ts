import { describe, expect, it } from "vitest";
import { getTrendPaths, getTrendScale } from "./trend-geometry";

describe("dashboard trend geometry", () => {
  it("keeps smoothed values inside each adjacent pair, including flat segments and sharp reversals", () => {
    const points = [140, 140, 0, 140, 139, 60, 60].map((value, index) => ({ x: index * 60, y: value }));
    const curves = getTrendPaths(points, 160).line.split(" C").slice(1);
    expect(curves).toHaveLength(points.length - 1);
    curves.forEach((curve, index) => {
      const coordinates = curve.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(coordinates.slice(4)).toEqual([points[index + 1].x, points[index + 1].y]);
      for (let step = 0; step <= 20; step += 1) {
        const progress = step / 20;
        const remaining = 1 - progress;
        const value = remaining ** 3 * points[index].y
          + 3 * remaining ** 2 * progress * coordinates[1]
          + 3 * remaining * progress ** 2 * coordinates[3]
          + progress ** 3 * points[index + 1].y;
        expect(value).toBeGreaterThanOrEqual(Math.min(points[index].y, points[index + 1].y) - 0.01);
        expect(value).toBeLessThanOrEqual(Math.max(points[index].y, points[index + 1].y) + 0.01);
      }
    });
  });

  it("splits both the curve and fill at missing samples and never fills an isolated day", () => {
    const paths = getTrendPaths([
      { x: 0, y: 10 }, { x: 10, y: 20 }, { x: 20, y: null },
      { x: 30, y: 15 }, { x: 40, y: 25 }, { x: 50, y: null }, { x: 60, y: 12 },
    ], 100);
    expect(paths.line.match(/M/g)).toHaveLength(3);
    expect(paths.area.match(/M/g)).toHaveLength(2);
    expect(paths.area.match(/Z/g)).toHaveLength(2);
    expect(paths.line).not.toMatch(/NaN|Infinity/);
    expect(getTrendPaths([{ x: 1, y: 0 }], 100).area).toBe("");
    expect(getTrendPaths([], 100)).toEqual({ line: "", area: "" });
  });

  it("keeps zero series flat instead of inventing visible fluctuations", () => {
    const paths = getTrendPaths([0, 1, 2, 3].map((index) => ({ x: index * 30, y: 100 })), 100);
    const verticalCoordinates = paths.line.match(/,-?\d+(?:\.\d+)?/g)!.map((value) => Number(value.slice(1)));
    expect(verticalCoordinates.every((value) => value === 100)).toBe(true);
  });

  it.each([0, 1, 7, 8, 62, 88, 12345])("provides an integer zero-based count scale covering %s", (peak) => {
    const scale = getTrendScale(peak);
    expect(scale.ceiling).toBeGreaterThan(peak);
    expect(scale.ticks[0]).toBe(0);
    expect(scale.ticks.at(-1)).toBe(scale.ceiling);
    expect(scale.ticks.every(Number.isInteger)).toBe(true);
    expect(scale.ticks.length).toBeLessThanOrEqual(6);
  });

  it("preserves sub-second latency precision on its own zero-based scale", () => {
    const scale = getTrendScale(0.035, true);
    expect(scale.ceiling).toBeGreaterThan(0.035);
    expect(scale.ceiling).toBeLessThan(0.1);
    expect(scale.ticks[0]).toBe(0);
  });
});
