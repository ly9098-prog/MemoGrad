import type { AIStatsResponse, DailyTrendPoint } from "@/lib/api/types";
import { getTrendPaths, getTrendScale } from "./trend-geometry";

export type AiTrendMetric = "calls" | "tokens" | "success" | "latency";
export type AiTrendPeriod = 7 | 30;

export const AI_TREND_METRICS: { key: AiTrendMetric; label: string; unit: string }[] = [
  { key: "calls", label: "调用", unit: "次" },
  { key: "tokens", label: "Token", unit: "Token" },
  { key: "success", label: "成功率", unit: "%" },
  { key: "latency", label: "耗时", unit: "秒" },
];

export function validAiValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function formatAiNumber(value: number | null, digits = 0): string {
  return value === null ? "--" : value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function getAiSummary(stats?: AIStatsResponse) {
  const hasCalls = validAiValue(stats?.monthly_calls) && stats.monthly_calls > 0;
  const read = (value: unknown) => validAiValue(value) ? value : null;
  const rate = hasCalls && validAiValue(stats?.success_rate) && stats.success_rate <= 100
    ? stats.success_rate : null;
  const latency = hasCalls && validAiValue(stats?.avg_latency_ms) ? stats.avg_latency_ms / 1000 : null;
  const sampleHint = stats?.monthly_calls === 0 ? "本月暂无调用样本" : "本月调用样本未知";
  return [
    { key: "today", label: "今日调用", value: formatAiNumber(read(stats?.today_calls)), unit: "次", hint: "上海自然日" },
    { key: "monthly", label: "本月调用", value: formatAiNumber(read(stats?.monthly_calls)), unit: "次", hint: "本月累计" },
    { key: "success", label: "调用成功率", value: formatAiNumber(rate, 1), unit: "%", hint: hasCalls ? "本月调用" : sampleHint },
    { key: "latency", label: "平均响应", value: formatAiNumber(latency, 2), unit: "秒", hint: hasCalls ? "本月调用均值" : sampleHint },
    { key: "tokens", label: "Token 消耗", value: formatAiNumber(read(stats?.total_tokens)), unit: "Token", hint: "本月累计" },
    { key: "cost", label: "预计费用", value: formatAiNumber(read(stats?.estimated_cost), 2), unit: "元", hint: "本月估算，非账单" },
  ];
}

export function getAiTrendValue(point: DailyTrendPoint, metric: AiTrendMetric): number | null {
  if (metric === "calls") return validAiValue(point.calls) ? point.calls : null;
  if (metric === "tokens") return validAiValue(point.tokens) ? point.tokens : null;
  if (!validAiValue(point.calls) || point.calls === 0) return null;
  if (metric === "success") {
    return validAiValue(point.success_rate) && point.success_rate <= 100 ? point.success_rate : null;
  }
  return validAiValue(point.avg_latency_ms) ? point.avg_latency_ms / 1000 : null;
}

export function formatAiTrendValue(value: number | null, metric: AiTrendMetric): string {
  if (value === null) return "--";
  const digits = metric === "latency" ? 2 : metric === "success" ? 1 : 0;
  const unit = AI_TREND_METRICS.find((item) => item.key === metric)!.unit;
  return `${formatAiNumber(value, digits)} ${unit}`;
}

export function getAiTrendWindow(trends: DailyTrendPoint[] | undefined, period: AiTrendPeriod) {
  return (trends ?? []).slice(-period);
}

export const AI_CHART = { width: 720, height: 168, left: 62, right: 16, top: 16, bottom: 32 };

export function getAiTrendGeometry(data: DailyTrendPoint[], metric: AiTrendMetric, width: number = AI_CHART.width) {
  const values = data.map((point) => getAiTrendValue(point, metric));
  const peak = Math.max(0, ...values.filter((value): value is number => value !== null));
  const scale = metric === "success" ? { ceiling: 100, ticks: [0, 25, 50, 75, 100] }
    : getTrendScale(peak, metric === "latency");
  const { ceiling, ticks } = scale;
  const plotWidth = Math.max(1, width - AI_CHART.left - AI_CHART.right);
  const plotHeight = AI_CHART.height - AI_CHART.top - AI_CHART.bottom;
  const points = values.map((value, index) => ({
    value,
    x: AI_CHART.left + (data.length <= 1 ? plotWidth / 2 : index * plotWidth / (data.length - 1)),
    y: value === null ? null : AI_CHART.top + plotHeight * (1 - value / ceiling),
  }));
  const paths = getTrendPaths(points, AI_CHART.height - AI_CHART.bottom);
  return { points, path: paths.line, area: paths.area, ceiling, ticks };
}

export function getAiTrendKeyboardIndex(key: string, current: number | null, length: number) {
  if (key === "Escape") return null;
  if (length === 0) return current;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowLeft") return Math.max(0, (current ?? length) - 1);
  if (key === "ArrowRight") return Math.min(length - 1, (current ?? -1) + 1);
  return current;
}
