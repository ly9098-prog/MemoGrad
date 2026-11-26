import { describe, expect, it } from "vitest";

import { buildSliderVerification, toImagePoint } from "./slider-captcha-geometry";

describe("buildSliderVerification", () => {
  it("keeps the published origin and reported target in image pixels", () => {
    const result = buildSliderVerification({
      start: { x: 20, y: 48 },
      end: { x: 180, y: 48 },
      moves: [
        { x: 20, y: 48, t: 0 },
        { x: 100, y: 48, t: 200 },
        { x: 180, y: 48, t: 500 },
      ],
      width: 300,
      height: 220,
    });

    expect(result.x).toBe(180);
    expect(result.y).toBe(48);
    expect(result.trajectory[0]).toEqual({ x: 20, y: 48, t: 0 });
    expect(result.trajectory.at(-1)).toEqual({ x: 180, y: 48, t: 500 });
  });

  it("gives fast drags a verifiable duration without changing coordinates", () => {
    const result = buildSliderVerification({
      start: { x: 12, y: 30 },
      end: { x: 170, y: 30 },
      moves: [{ x: 170, y: 30, t: 80 }],
      width: 300,
      height: 220,
    });

    expect(result.trajectory.at(-1)?.t).toBeGreaterThanOrEqual(300);
    expect(result.trajectory.at(-1)?.x).toBe(170);
  });

  it("clamps points to the image and caps the trajectory", () => {
    const moves = Array.from({ length: 200 }, (_, index) => ({
      x: index + 400,
      y: -50,
      t: index * 10,
    }));
    const result = buildSliderVerification({
      start: { x: -10, y: -10 },
      end: { x: 999, y: -40 },
      moves,
      width: 300,
      height: 220,
    });

    expect(result.x).toBe(300);
    expect(result.y).toBe(0);
    expect(result.trajectory).toHaveLength(64);
    expect(result.trajectory[0]).toEqual({ x: 0, y: 0, t: 0 });
  });

  it("never lets timestamps go backwards", () => {
    const result = buildSliderVerification({
      start: { x: 10, y: 20 },
      end: { x: 120, y: 20 },
      moves: [
        { x: 60, y: 20, t: 400 },
        { x: 90, y: 20, t: 200 },
        { x: 120, y: 20, t: 260 },
      ],
      width: 300,
      height: 220,
    });

    const times = result.trajectory.map((point) => point.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("toImagePoint", () => {
  it("maps displayed pixels back to challenge-image pixels", () => {
    expect(toImagePoint({ x: 150, y: 110 }, 0.5, 0.5)).toEqual({
      x: 300,
      y: 220,
    });
  });

  it("keeps responsive scaling error well inside the verification tolerance", () => {
    const point = toImagePoint({ x: 223, y: 105 }, 291 / 300, 211 / 220);

    expect(point.x).toBeCloseTo(229.9, 1);
    expect(point.y).toBeCloseTo(109.5, 1);
  });
});
