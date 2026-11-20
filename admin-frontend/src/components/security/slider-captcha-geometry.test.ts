import { describe, expect, it } from "vitest";
import { buildSliderVerification } from "./slider-captcha-geometry";

const render = { width: 280, height: 140, pieceLeft: 12 };
const challenge = { width: 320, height: 160 };

describe("buildSliderVerification", () => {
  it("includes the puzzle's initial left edge in the server offset", () => {
    const result = buildSliderVerification(
      {
        x: 93,
        duration: 600,
        trail: [[500, 500], [520, 502], [540, 503]],
      },
      challenge,
      render,
    );

    expect(result.offset).toBe(120);
  });

  it("normalizes the pointer trail to the puzzle offset", () => {
    const result = buildSliderVerification(
      {
        x: 93,
        duration: 600,
        trail: [[500, 500], [520, 502], [540, 503]],
      },
      challenge,
      render,
    );

    expect(result.trajectory).toEqual([
      { x: 0, y: 0, t: 0 },
      { x: 60, y: 2, t: 300 },
      { x: 120, y: 3, t: 600 },
    ]);
  });

  it("caps long trajectories at the API limit while preserving both endpoints", () => {
    const trail = Array.from(
      { length: 140 },
      (_, index) => [500 + index, 500 + (index % 7)] as [number, number],
    );
    const result = buildSliderVerification(
      {
        x: 93,
        duration: 2400,
        trail,
      },
      challenge,
      render,
    );

    expect(result.trajectory).toHaveLength(64);
    expect(result.trajectory[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(result.trajectory.at(-1)).toEqual({ x: 120, y: 7, t: 2400 });
    expect(result.trajectory.map((point) => point.t)).toEqual(
      [...result.trajectory.map((point) => point.t)].sort((a, b) => a - b),
    );
  });
});
