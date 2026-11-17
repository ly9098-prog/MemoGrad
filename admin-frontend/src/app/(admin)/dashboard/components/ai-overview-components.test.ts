import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type { AIStatsResponse, DailyTrendPoint } from "@/lib/api/types";
import { DashboardAiOverview } from "./dashboard-ai-overview";
import { AiStatCards } from "./ai-stat-cards";
import { AiTrendChart } from "./ai-trend-chart";

type Element = ReactElement<Record<string, unknown>>;
const h = vi.hoisted(() => ({
  states: [] as unknown[], index: 0,
  refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as (() => unknown)[],
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (compute: () => unknown) => compute(),
  useId: () => "ai-chart-test",
  useEffect: (effect: () => unknown) => { h.effects.push(effect); },
  useRef: (current: unknown) => {
    const index = h.refIndex++;
    if (!(index in h.refs)) h.refs[index] = { current };
    return h.refs[index];
  },
  useState: (initial: unknown) => {
    const index = h.index++;
    if (!(index in h.states)) h.states[index] = initial;
    return [h.states[index], (next: unknown) => { h.states[index] = next; }];
  },
}));

const trends: DailyTrendPoint[] = Array.from({ length: 30 }, (_, index) => ({
  date: index < 13 ? `10/${19 + index}` : `11/${String(index - 12).padStart(2, "0")}`,
  calls: index === 27 ? 0 : index + 1,
  tokens: index === 27 ? 0 : (index + 1) * 1000,
  success_rate: index === 27 ? 0 : 80,
  avg_latency_ms: index === 27 ? 0 : 1250,
}));
const stats: AIStatsResponse = {
  today_calls: 0, monthly_calls: 10, success_rate: 80, avg_latency_ms: 1250,
  total_tokens: 12345, model_name: "glm-4.6", daily_trends: trends,
};

function elements(node: unknown, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
}

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement<Record<string, unknown>>(node) ? text(node.props.children) : "";
}

function renderChart() {
  h.index = 0;
  h.refIndex = 0;
  h.effects = [];
  return AiTrendChart({ trends, loading: false });
}

function click(tree: Element, label: string) {
  const button = elements(tree, (element) => element.type === "button" && text(element) === label)[0];
  expect(button).toBeDefined();
  (button.props.onClick as () => void)();
}

beforeEach(() => { h.states = []; h.index = 0; h.refs = []; h.refIndex = 0; h.effects = []; });

describe("dashboard AI overview presentation", () => {
  it("renders only the metrics, trend and state within the parent-owned surface", () => {
    const tree = DashboardAiOverview({ data: stats, loading: false });
    expect(elements(tree, (element) => element.type === AiStatCards)).toHaveLength(1);
    expect(elements(tree, (element) => element.type === AiTrendChart)).toHaveLength(1);
    expect(elements(tree, (element) => element.type === "h2" || element.type === "a")).toEqual([]);
    expect(elements(tree, (element) => element.props.role === "status")).toEqual([]);
  });

  it("keeps cached values and warns explicitly when a background refresh fails", () => {
    const tree = DashboardAiOverview({ data: stats, loading: false, error: true });
    expect(text(tree)).toContain("AI 统计刷新失败，当前保留上次数据");
    expect(elements(tree, (element) => element.type === AiStatCards)[0].props.data).toBe(stats);
    expect(elements(tree, (element) => element.type === AiTrendChart)[0].props.unavailable).toBe(false);
  });

  it("distinguishes loading, missing and failed data without defaulting the metrics to zero", () => {
    expect(text(DashboardAiOverview({ loading: true }))).toContain("正在加载 AI 统计");
    expect(text(DashboardAiOverview({ loading: false }))).toContain("暂未获取 AI 统计数据");
    expect(text(DashboardAiOverview({ loading: false, error: true }))).toContain("AI 统计加载失败");
    const missing = AiStatCards({ loading: false });
    expect(elements(missing, (element) => element.type === "dt")).toHaveLength(6);
    expect(elements(missing, (element) => element.type === "span" && text(element) === "--")).toHaveLength(6);
  });

  it("shows exact monthly values even if today has no calls", () => {
    const tree = AiStatCards({ data: stats, loading: false });
    expect(text(tree)).toContain("80.0");
    expect(text(tree)).toContain("1.25");
    expect(text(tree)).toContain("12.35K");
    expect(text(tree)).toContain("glm-4.6");
    expect(text(tree)).not.toContain("预计费用");
    expect(elements(tree, (element) => element.props["aria-hidden"] === true && text(element) === "12.35K")).toHaveLength(1);
    expect(elements(tree, (element) => element.props.className === "sr-only" && text(element) === "12,345 Token")).toHaveLength(1);
    expect(elements(tree, (element) => element.props.title === "12,345 Token")).toHaveLength(1);
    expect(elements(tree, (element) => element.props.src === "/model-icons/glm.svg")).toHaveLength(1);
  });

  it("keeps unknown models as text without a mismatched brand icon", () => {
    const custom = AiStatCards({ data: { ...stats, model_name: "custom-model" }, loading: false });
    expect(text(custom)).toContain("custom-model");
    expect(elements(custom, (element) => typeof element.props.src === "string")).toEqual([]);
    const missing = AiStatCards({ data: { ...stats, model_name: null }, loading: false });
    expect(text(missing)).toContain("调用记录未提供模型名称");
  });

  it("switches 7/30 day windows and retains server MM/DD labels across a month boundary", () => {
    let tree = renderChart();
    expect(elements(tree, (element) => element.type === "th" && element.props.scope === "row")).toHaveLength(7);
    click(tree, "30 天");
    tree = renderChart();
    const dates = elements(tree, (element) => element.type === "th" && element.props.scope === "row").map(text);
    expect(dates).toHaveLength(30);
    expect(dates).toContain("10/31");
    expect(dates).toContain("11/01");
    expect(dates[0]).toBe("10/19");
  });

  it("switches one metric at a time while keeping an accessible four-unit data table", () => {
    for (const label of ["Token", "成功率", "耗时", "调用"]) {
      let tree = renderChart();
      click(tree, label);
      tree = renderChart();
      expect(elements(tree, (element) => element.type === "path" && element.props.pathLength === 1)).toHaveLength(1);
      expect(elements(tree, (element) => element.type === "path" && typeof element.props.fill === "string")).toHaveLength(1);
      const selected = elements(tree, (element) => element.type === "button" && element.props["aria-pressed"] === true);
      expect(selected.map(text)).toEqual([label, "7 天"]);
      expect(elements(tree, (element) => element.type === "table")).toHaveLength(1);
      expect(text(tree)).toContain("--");
    }
  });

  it("selects daily numbers by keyboard and clears them with Escape without scrolling at endpoints", () => {
    let tree = renderChart();
    const press = (key: string) => {
      const chart = elements(tree, (element) => element.type === "svg")[0];
      const preventDefault = vi.fn();
      (chart.props.onKeyDown as (event: unknown) => void)({ key, preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      tree = renderChart();
    };
    press("Home");
    expect(text(elements(tree, (element) => element.props["aria-live"] === "polite")[0])).toContain(trends[23].date);
    press("ArrowLeft");
    expect(h.states[2]).toBe(0);
    press("End");
    expect(text(elements(tree, (element) => element.props["aria-live"] === "polite")[0])).toContain(trends[29].date);
    press("Escape");
    expect(h.states[2]).toBeNull();
  });

  it("supports a touch click on any chart day without pointer capture or a drag requirement", () => {
    let tree = renderChart();
    const chart = elements(tree, (element) => element.type === "svg")[0];
    (chart.props.onClick as (event: unknown) => void)({
      clientX: 720,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 720 }) },
    });
    tree = renderChart();
    expect(h.states[2]).toBe(6);
    expect(text(elements(tree, (element) => element.props["aria-live"] === "polite")[0])).toContain("30 次");
  });

  it("settles rapid mouse previews and lets clicks override a pending preview immediately", () => {
    vi.useFakeTimers();
    try {
      const chart = elements(renderChart(), (element) => element.type === "svg")[0];
      const pointer = (clientX: number) => ({
        pointerType: "mouse",
        clientX,
        currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 720 }) },
      });
      const move = chart.props.onPointerMove as (event: unknown) => void;
      move(pointer(62));
      vi.advanceTimersByTime(60);
      move(pointer(720));
      vi.advanceTimersByTime(99);
      expect(h.states[2]).toBeNull();
      vi.advanceTimersByTime(1);
      expect(h.states[2]).toBe(6);

      move(pointer(62));
      (chart.props.onPointerLeave as () => void)();
      vi.advanceTimersByTime(100);
      expect(h.states[2]).toBe(6);

      move(pointer(720));
      (chart.props.onClick as (event: unknown) => void)(pointer(62));
      expect(h.states[2]).toBe(0);
      vi.advanceTimersByTime(100);
      expect(h.states[2]).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("reschedules the same hovered day after new trend data cancels a pending preview", () => {
    vi.useFakeTimers();
    try {
      const chart = elements(renderChart(), (element) => element.type === "svg")[0];
      const cleanup = h.effects.at(-1)!() as () => void;
      const pointer = {
        pointerType: "mouse", clientX: 720,
        currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 720 }) },
      };
      (chart.props.onPointerMove as (event: unknown) => void)(pointer);
      vi.advanceTimersByTime(60);
      cleanup();
      h.index = 0;
      h.refIndex = 0;
      const updated = AiTrendChart({ trends: trends.map((point) => ({ ...point, calls: point.calls + 1 })), loading: false });
      const updatedChart = elements(updated, (element) => element.type === "svg")[0];
      (updatedChart.props.onPointerMove as (event: unknown) => void)(pointer);
      vi.advanceTimersByTime(100);
      expect(h.states[2]).toBe(6);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("states the missing quality sample when every day has zero calls", () => {
    h.states = ["success", 7, null, 240];
    const tree = AiTrendChart({ trends: trends.map((point) => ({ ...point, calls: 0 })), loading: false });
    expect(text(tree)).toContain("所选周期暂无可计算成功率的调用样本");
    expect(elements(tree, (element) => element.type === "svg")).toEqual([]);
    expect(elements(tree, (element) => element.type === "table")).toHaveLength(1);
  });
});
