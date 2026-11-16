import type { DashboardDailyPoint } from "@/lib/api/types";

const DAY_MS = 86_400_000;

export type ActivityMetric = "questions_new" | "imports_new";
export type ActivityCell = {
  date: string;
  count: number | null;
  week: number;
  day: number;
  level: number;
  inRange: boolean;
};

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : NaN;
}

export function buildActivityModel(
  data: DashboardDailyPoint[],
  from: string,
  to: string,
  metric: ActivityMetric,
) {
  const start = parseDate(from);
  const end = parseDate(to);
  const counts = new Map<string, number>();
  for (const point of data) {
    const date = parseDate(point.date);
    const count = point[metric];
    if (date < start || date > end || !Number.isFinite(date)) continue;
    if (!Number.isFinite(count) || count < 0) continue;
    counts.set(point.date, (counts.get(point.date) ?? 0) + count);
  }
  const cells: ActivityCell[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 365 * DAY_MS) {
    return { cells, weeks: 0, total: 0, activeDays: 0, coveredDays: 0, peak: 0, peakDate: null as string | null };
  }
  const alignedStart = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY_MS;
  const nonzero = [...counts.values()].filter((count) => count > 0).sort((first, second) => first - second);
  const busy = nonzero[Math.floor((nonzero.length - 1) * 0.95)] ?? 0;
  let total = 0;
  let activeDays = 0;
  let peak = 0;
  let peakDate: string | null = null;
  for (let timestamp = alignedStart, index = 0; timestamp <= end; timestamp += DAY_MS, index += 1) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const count = counts.get(date) ?? null;
    const inRange = timestamp >= start;
    cells.push({
      date, count, inRange, week: Math.floor(index / 7), day: index % 7,
      level: count == null || count === 0 ? 0 : Math.min(4, 1 + Math.floor(count / Math.max(1, busy) * 4)),
    });
    if (count != null && inRange) {
      total += count;
      if (count > 0) activeDays += 1;
      if (count > peak) { peak = count; peakDate = date; }
    }
  }
  return { cells, weeks: Math.ceil(cells.length / 7), total, activeDays, coveredDays: counts.size, peak, peakDate };
}

export type DistributionItem = { name: string; count: number };
export type DistributionTile = DistributionItem & { x: number; y: number; width: number; height: number };

export function layoutDistribution(items: DistributionItem[]): DistributionTile[] {
  const valid = items.filter((item) => Number.isFinite(item.count) && item.count > 0)
    .sort((first, second) => second.count - first.count);
  const split = (group: DistributionItem[], left: number, top: number, width: number, height: number): DistributionTile[] => {
    if (group.length === 0) return [];
    if (group.length === 1) return [{ ...group[0], x: left, y: top, width, height }];
    const total = group.reduce((sum, item) => sum + item.count, 0);
    let subtotal = group[0].count;
    let cut = 1;
    while (cut < group.length - 1 && Math.abs(subtotal + group[cut].count - total / 2) < Math.abs(subtotal - total / 2)) {
      subtotal += group[cut].count;
      cut += 1;
    }
    const share = subtotal / total;
    if (width >= height) return [
      ...split(group.slice(0, cut), left, top, width * share, height),
      ...split(group.slice(cut), left + width * share, top, width * (1 - share), height),
    ];
    return [
      ...split(group.slice(0, cut), left, top, width, height * share),
      ...split(group.slice(cut), left, top + height * share, width, height * (1 - share)),
    ];
  };
  return split(valid, 0, 0, 100, 100);
}
