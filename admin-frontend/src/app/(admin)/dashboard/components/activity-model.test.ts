import { describe, expect, it } from "vitest";
import { buildActivityModel, layoutDistribution } from "./activity-model";
import type { DashboardDailyPoint } from "@/lib/api/types";

function point(date: string, questions: number, imports = 0): DashboardDailyPoint {
  return { date, questions_new: questions, imports_new: imports, users_new: 0, audits_total: 0 };
}

describe("dashboard activity calendar", () => {
  it("keeps missing days unknown and includes actual zero days", () => {
    const model = buildActivityModel([point("2026-11-15", 0), point("2026-11-17", 8)], "2026-11-15", "2026-11-17", "questions_new");
    expect(model.cells.filter((cell) => cell.inRange).map((cell) => [cell.date, cell.count])).toEqual([
      ["2026-11-15", 0], ["2026-11-16", null], ["2026-11-17", 8],
    ]);
    expect(model).toMatchObject({ total: 8, coveredDays: 2, activeDays: 1, peak: 8, peakDate: "2026-11-17" });
    expect(model.cells[0].day).toBe(0);
    expect(model.cells[0].date).toBe("2026-11-09");
    expect(model.cells[0].inRange).toBe(false);
  });

  it("aggregates duplicate dates and switches the counted business unit without mixing series", () => {
    const data = [point("2026-11-17", 8, 2), point("2026-11-17", 3, 1)];
    expect(buildActivityModel(data, "2026-11-17", "2026-11-17", "questions_new").total).toBe(11);
    expect(buildActivityModel(data, "2026-11-17", "2026-11-17", "imports_new").total).toBe(3);
  });

  it("rejects impossible dates, negative counts, nonfinite values, and out of range records", () => {
    const data = [point("2026-02-30", 9), point("2026-11-15", -1), point("2026-11-16", NaN), point("2026-11-18", 100), point("2026-11-17", 5)];
    expect(buildActivityModel(data, "2026-11-15", "2026-11-17", "questions_new")).toMatchObject({ total: 5, coveredDays: 1, peak: 5 });
    expect(buildActivityModel(data, "invalid", "2026-11-17", "questions_new").cells).toEqual([]);
  });

  it("does not invent a sample year when the API supplies no records", () => {
    const model = buildActivityModel([], "2025-11-18", "2026-11-17", "questions_new");
    expect(model.coveredDays).toBe(0);
    expect(model.cells.filter((cell) => cell.inRange)).toHaveLength(365);
    expect(model.cells.every((cell) => cell.count == null)).toBe(true);
  });

  it("handles a leap day as an ordinary literal calendar date", () => {
    const model = buildActivityModel([point("2024-02-29", 7)], "2024-02-28", "2024-03-01", "questions_new");
    expect(model.cells.filter((cell) => cell.inRange).map((cell) => cell.date)).toEqual(["2024-02-28", "2024-02-29", "2024-03-01"]);
    expect(model.peakDate).toBe("2024-02-29");
  });
});

describe("question distribution area", () => {
  it("preserves all category values and their exact proportion without minimum area inflation", () => {
    const source = [{ name: "large", count: 900 }, { name: "medium", count: 99 }, { name: "small", count: 1 }];
    const tiles = layoutDistribution(source);
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile.width * tile.height / 10000).toBeCloseTo(tile.count / 1000);
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.width).toBeLessThanOrEqual(100.00001);
      expect(tile.y + tile.height).toBeLessThanOrEqual(100.00001);
    }
    expect(tiles.reduce((total, tile) => total + tile.width * tile.height, 0)).toBeCloseTo(10000);
    expect(source[2].name).toBe("small");
  });

  it("leaves empty or invalid category sets empty", () => {
    expect(layoutDistribution([{ name: "zero", count: 0 }, { name: "invalid", count: NaN }])).toEqual([]);
  });
});
