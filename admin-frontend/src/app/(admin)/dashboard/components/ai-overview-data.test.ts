import { describe, expect, it } from "vitest";
import type { AIStatsResponse, DailyTrendPoint } from "@/lib/api/types";
import { getAiModelIcon, getAiProviderIcon } from "@/lib/ai-model-icons";
import {
  AI_CHART,
  formatAiTokens,
  formatAiTrendValue,
  getAiSummary,
  getAiTrendGeometry,
  getAiTrendKeyboardIndex,
  getAiTrendValue,
  getAiTrendWindow,
} from "./ai-overview-data";

const point: DailyTrendPoint = { date: "11/17", calls: 10, tokens: 12345, success_rate: 80, avg_latency_ms: 1250 };
const stats: AIStatsResponse = {
  today_calls: 7, monthly_calls: 100, success_rate: 98.5, avg_latency_ms: 1250,
  total_tokens: 12345, model_name: "glm-4.6", daily_trends: [point],
};

describe("AI overview data accuracy", () => {
  it("uses recorded model names and compact Token counts in the six-field summary", () => {
    expect(getAiSummary(stats).map(({ key, value, unit }) => ({ key, value, unit }))).toEqual([
      { key: "today", value: "7", unit: "次" },
      { key: "monthly", value: "100", unit: "次" },
      { key: "success", value: "98.5", unit: "%" },
      { key: "latency", value: "1.25", unit: "秒" },
      { key: "tokens", value: "12.35K", unit: "Token" },
      { key: "model", value: "glm-4.6", unit: "" },
    ]);
    expect(getAiSummary(stats)[4].exactValue).toBe("12,345");
  });

  it("keeps missing summary data unknown and real zero counts visible", () => {
    expect(getAiSummary().every((item) => item.value === "--")).toBe(true);
    const result = getAiSummary({ ...stats, today_calls: 0, monthly_calls: 0, total_tokens: 0 });
    expect(result.map((item) => item.value)).toEqual(["0", "0", "--", "--", "0", "--"]);
    expect(result[2].hint).toBe("本月暂无调用样本");
  });

  it("rejects invalid negative, infinite and out-of-range summary measurements", () => {
    expect(getAiSummary({ ...stats, today_calls: Number.NaN, monthly_calls: -1, total_tokens: Infinity })
      .every((item) => item.value === "--")).toBe(true);
    expect(getAiSummary({ ...stats, success_rate: 101, avg_latency_ms: -10 }).slice(2, 4)
      .map((item) => item.value)).toEqual(["--", "--"]);
  });

  it.each([
    [0, "0"], [999, "999"], [1000, "1K"], [12345, "12.35K"],
    [999999, "1M"], [1248620, "1.25M"], [1000000000, "1B"],
    [null, "--"], [-1, "--"], [Infinity, "--"],
  ])("formats Token value %s as %s", (value, expected) => {
    expect(formatAiTokens(value)).toBe(expected);
  });

  it("keeps unreported model names unknown and does not infer them from the default configuration", () => {
    expect(getAiSummary({ ...stats, model_name: undefined })[5].value).toBe("--");
    expect(getAiSummary({ ...stats, model_name: "  " })[5].value).toBe("--");
    expect(getAiSummary({ ...stats, model_name: "  qwen3.5-plus  " })[5].value).toBe("qwen3.5-plus");
  });

  it.each([
    ["deepseek-v4-flash", "/model-icons/deepseek.svg"],
    ["deepseek/deepseek-v4-flash", "/model-icons/deepseek.svg"],
    ["Qwen3.5-Plus", "/model-icons/qwen.png"],
    ["glm-4.6", "/model-icons/glm.svg"],
    ["chatglm3", "/model-icons/glm.svg"],
    ["kimi-k2.5", "/model-icons/kimi.png"],
    ["moonshot/moonshot-v1-128k", "/model-icons/kimi.png"],
    ["GPT-5.1", "/model-icons/gpt.svg"],
    ["openai/gpt-5.1", "/model-icons/gpt.svg"],
    ["o3-mini", "/model-icons/gpt.svg"],
    ["anthropic/claude-sonnet-4-5", "/model-icons/claude.svg"],
    ["claude-opus-4-1", "/model-icons/claude.svg"],
    ["google/gemini-2.5-pro", "/model-icons/gemini.png"],
    [" gemini-2.5-flash ", "/model-icons/gemini.png"],
    ["my-deepseek-proxy", null], ["custom-model", null], [null, null],
  ])("matches the official icon for %s without guessing another provider", (model, expected) => {
    expect(getAiModelIcon(model)).toBe(expected);
  });

  it("uses provider icons for explicit candidates while leaving generic gateways unbranded", () => {
    for (const provider of [
      "moonshot",
      "openai",
      "anthropic",
      "gemini",
      "minimax",
      "openrouter",
      "dashscope",
      "volcengine",
      "siliconflow",
      "azure",
      "ollama",
      "lmstudio",
      "vllm",
      "paddle",
      "paddle-ocr",
      "paddleoce",
    ]) {
      expect(getAiProviderIcon(provider)).toMatch(/^\/model-icons\//);
    }
    expect(getAiProviderIcon("relay")).toBeNull();
    expect(getAiProviderIcon("custom")).toBeNull();
  });

  it("takes the latest 7 or 30 server buckets without synthesizing missing dates", () => {
    const trends = Array.from({ length: 30 }, (_, index) => ({ ...point, date: `day-${index}` }));
    expect(getAiTrendWindow(trends, 7).map((item) => item.date)).toEqual(trends.slice(23).map((item) => item.date));
    expect(getAiTrendWindow(trends, 30)).toEqual(trends);
    expect(getAiTrendWindow(undefined, 7)).toEqual([]);
    expect(getAiTrendWindow([point], 30)).toEqual([point]);
  });

  it("treats zero-call quality measurements as absent without replacing real 0% failures", () => {
    const empty = { ...point, calls: 0, tokens: 0, success_rate: 100, avg_latency_ms: 99 };
    expect(getAiTrendValue(empty, "success")).toBeNull();
    expect(getAiTrendValue(empty, "latency")).toBeNull();
    expect(getAiTrendValue(empty, "calls")).toBe(0);
    expect(getAiTrendValue(empty, "tokens")).toBe(0);
    expect(getAiTrendValue({ ...point, success_rate: 0 }, "success")).toBe(0);
    expect(formatAiTrendValue(getAiTrendValue(point, "latency"), "latency")).toBe("1.25 秒");
  });

  it("breaks quality paths at days without samples and keeps each metric on its own scale", () => {
    const data = [point, { ...point, calls: 0 }, { ...point, date: "11/19" }];
    const success = getAiTrendGeometry(data, "success");
    expect(success.ceiling).toBe(100);
    expect(success.points[1].y).toBeNull();
    expect(success.path.match(/M/g)).toHaveLength(2);
    expect(success.path).not.toContain("NaN");
    expect(getAiTrendGeometry(data, "calls").ceiling).toBeGreaterThanOrEqual(10);
    expect(getAiTrendGeometry(data, "tokens").ceiling).toBeGreaterThan(12000);
    expect(getAiTrendGeometry(data, "latency").ceiling).toBeGreaterThanOrEqual(1.25);
  });

  it("keeps empty, zero and single-day geometries finite at a narrow measured width", () => {
    expect(getAiTrendGeometry([], "calls").path).toBe("");
    const single = getAiTrendGeometry([{ ...point, calls: 0 }], "calls", 240);
    expect(single.ceiling).toBeGreaterThan(0);
    expect(single.points[0].x).toBe((AI_CHART.left + 240 - AI_CHART.right) / 2);
    expect(single.points[0].y).toBe(AI_CHART.height - AI_CHART.bottom);
    expect(single.path).not.toMatch(/NaN|Infinity/);
  });

  it("bounds keyboard navigation and supports endpoints and clearing a selected day", () => {
    expect(getAiTrendKeyboardIndex("ArrowRight", null, 7)).toBe(0);
    expect(getAiTrendKeyboardIndex("ArrowLeft", null, 7)).toBe(6);
    expect(getAiTrendKeyboardIndex("ArrowLeft", 0, 7)).toBe(0);
    expect(getAiTrendKeyboardIndex("ArrowRight", 6, 7)).toBe(6);
    expect(getAiTrendKeyboardIndex("Home", 5, 7)).toBe(0);
    expect(getAiTrendKeyboardIndex("End", 0, 7)).toBe(6);
    expect(getAiTrendKeyboardIndex("Escape", 5, 7)).toBeNull();
    expect(getAiTrendKeyboardIndex("x", 5, 7)).toBe(5);
    expect(getAiTrendKeyboardIndex("Home", null, 0)).toBeNull();
  });
});
