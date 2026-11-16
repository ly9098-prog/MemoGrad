"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { DashboardDailyPoint } from "@/lib/api/types";
import { AnimatedDigits } from "./animated-digits";
import styles from "../dashboard-workspace.module.css";

type Period = "7d" | "30d";
type SeriesKey = "users" | "questions" | "imports" | "audits";

interface SeriesState {
  users: boolean;
  questions: boolean;
  imports: boolean;
  audits: boolean;
}

interface SeriesMeta {
  key: SeriesKey;
  dataKey: keyof DashboardDailyPoint;
  label: string;
  color: string;
}

const SERIES: SeriesMeta[] = [
  { key: "users", dataKey: "users_new", label: "新增用户", color: "#246B96" },
  { key: "questions", dataKey: "questions_new", label: "新增题目", color: "#147A83" },
  { key: "imports", dataKey: "imports_new", label: "导入批次", color: "#8172A6" },
  { key: "audits", dataKey: "audits_total", label: "审计事件", color: "#52697A" },
];

const VIEWBOX_HEIGHT = 238;
const PLOT = { left: 39, right: 12, top: 10, bottom: 25 };
const PLOT_HEIGHT = VIEWBOX_HEIGHT - PLOT.top - PLOT.bottom;

function formatDateTick(value: string) {
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  return `${parts[1]}-${parts[2]}`;
}

function formatCount(value: number) {
  return value.toLocaleString("zh-CN");
}

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildYScale(value: number) {
  const target = value > 0 ? value * 1.1 : 5;
  const roughStep = target / 5;
  const exponent = Math.floor(Math.log10(roughStep));
  const magnitude = 10 ** exponent;
  const candidates = [1, 2, 5, 10, 20, 50, 100].map((factor) => factor * magnitude).filter((step) => step >= 1);
  let candidateIndex = 0;
  candidates.forEach((candidate, index) => {
    if (candidate <= roughStep) candidateIndex = index;
  });
  let step = candidates[candidateIndex];
  let intervalCount = Math.max(3, Math.ceil(target / step));
  while (intervalCount > 7 && candidateIndex < candidates.length - 1) {
    candidateIndex += 1;
    step = candidates[candidateIndex];
    intervalCount = Math.ceil(target / step);
  }
  return {
    max: step * intervalCount,
    values: Array.from({ length: intervalCount + 1 }, (_, index) => step * index),
  };
}

function pointToString(point: { x: number; y: number }) {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${pointToString(points[0])}`;
  if (points.length === 2) return `M ${pointToString(points[0])} L ${pointToString(points[1])}`;

  const slopes = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    return (next.y - point.y) / (next.x - point.x);
  });
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes.at(-1) ?? 0;
    const previous = slopes[index - 1];
    const next = slopes[index];
    if (previous === 0 || next === 0 || previous * next < 0) return 0;
    const limit = 3 * Math.min(Math.abs(previous), Math.abs(next));
    return Math.sign(previous) * Math.min(Math.abs((previous + next) / 2), limit);
  });

  let path = `M ${pointToString(points[0])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const width = next.x - current.x;
    const cp1 = {
      x: current.x + width / 3,
      y: current.y + (tangents[index] * width) / 3,
    };
    const cp2 = {
      x: next.x - width / 3,
      y: next.y - (tangents[index + 1] * width) / 3,
    };
    path += ` C ${pointToString(cp1)}, ${pointToString(cp2)}, ${pointToString(next)}`;
  }
  return path;
}

function areaPath(points: Array<{ x: number; y: number }>, baseline: number) {
  if (!points.length) return "";
  return `${smoothPath(points)} L ${points.at(-1)!.x.toFixed(2)} ${baseline.toFixed(2)} L ${points[0].x.toFixed(2)} ${baseline.toFixed(2)} Z`;
}

export function DashboardTrendChart({
  data,
  loading,
  period,
  onPeriodChange,
}: {
  data?: DashboardDailyPoint[] | null;
  loading?: boolean;
  period: Period;
  onPeriodChange: (period: Period) => void;
}) {
  const [series, setSeries] = useState<SeriesState>({
    users: true,
    questions: true,
    imports: true,
    audits: true,
  });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  const rows = useMemo(() => data ?? [], [data]);
  const hasData = rows.length > 0;

  useEffect(() => {
    if (loading || !hasData) return;
    const element = chartContainerRef.current;
    if (!element) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = element.clientWidth || element.getBoundingClientRect().width;
        if (width > 0) setChartWidth(Math.round(width));
      });
    };

    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [loading, hasData]);

  const chart = useMemo(() => {
    const width = Math.max(chartWidth, 280);
    const plotWidth = Math.max(180, width - PLOT.left - PLOT.right);
    const enabledSeries = SERIES.filter((item) => series[item.key]);
    const maxValue = Math.max(
      0,
      ...rows.flatMap((row) => enabledSeries.map((item) => safeNumber(row[item.dataKey]))),
    );
    const yScale = buildYScale(maxValue);
    const yMax = yScale.max;
    const xForIndex = (index: number) =>
      rows.length <= 1 ? PLOT.left + plotWidth / 2 : PLOT.left + (index / (rows.length - 1)) * plotWidth;
    const yForValue = (value: number) => PLOT.top + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT;

    const paths = Object.fromEntries(
      SERIES.map((meta) => {
        const points = rows.map((row, index) => ({
          x: xForIndex(index),
          y: yForValue(safeNumber(row[meta.dataKey])),
        }));
        return [meta.key, { points, line: smoothPath(points), area: areaPath(points, PLOT.top + PLOT_HEIGHT) }];
      }),
    ) as Record<SeriesKey, { points: Array<{ x: number; y: number }>; line: string; area: string }>;

    const yTicks = yScale.values.map((value) => ({ value, y: yForValue(value) }));

    const desiredTicks = Math.min(
      period === "30d" ? 7 : rows.length,
      Math.max(2, Math.floor(plotWidth / 70) + 1),
    );
    const xTickIndices = Array.from({ length: desiredTicks }, (_, index) => {
      if (desiredTicks <= 1) return 0;
      return Math.round((index / (desiredTicks - 1)) * Math.max(0, rows.length - 1));
    }).filter((value, index, all) => all.indexOf(value) === index);

    const totals = Object.fromEntries(
      SERIES.map((meta) => [
        meta.key,
        rows.reduce((sum, row) => sum + safeNumber(row[meta.dataKey]), 0),
      ]),
    ) as Record<SeriesKey, number>;

    return { width, plotWidth, paths, yTicks, xTickIndices, totals };
  }, [chartWidth, period, rows, series]);

  const hoveredRow = hoverIndex !== null ? rows[hoverIndex] : null;
  const hoveredX = hoverIndex !== null ? chart.paths.users.points[hoverIndex]?.x ?? null : null;
  const tooltipLeft = hoverIndex !== null && rows.length > 1 ? (hoverIndex / (rows.length - 1)) * 100 : 50;
  const periodLabel = period === "7d" ? "近 7 天" : "近 30 天";

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!rows.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const localX = event.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (localX - PLOT.left) / chart.plotWidth));
    const index = rows.length <= 1 ? 0 : Math.round(ratio * (rows.length - 1));
    setHoverIndex(index);
  };

  return (
    <section className={styles.trendPanel} aria-labelledby="dashboard-trend-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="dashboard-trend-title" className={styles.panelTitle}>平台动能</h2>
          <p className={styles.panelSubtitle}>把用户、题库、导入与审计放进同一条运营脉搏。</p>
        </div>

        <div className={styles.periodSwitch} aria-label="趋势周期">
          {(["7d", "30d"] as Period[]).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => onPeriodChange(item)}
              className={styles.periodButton}
              data-active={period === item}
              aria-pressed={period === item}
            >
              {item === "7d" ? "7 天" : "30 天"}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.analysisBody}>
        <div className={styles.analysisChart}>
          <div className={styles.legendBar}>
            <span className={styles.legendCaption}>趋势序列</span>
            <div className={styles.legendRow}>
              {SERIES.map((item) => {
                const enabled = series[item.key];
                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => setSeries((current) => ({ ...current, [item.key]: !current[item.key] }))}
                    className={styles.legendButton}
                    data-disabled={!enabled}
                    aria-pressed={enabled}
                  >
                    <span
                      className={styles.legendDot}
                      style={{ backgroundColor: enabled ? item.color : "#A9B8C4" }}
                    />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <span className={styles.legendPeriod}>{periodLabel}</span>
          </div>

          {loading ? (
            <div className={styles.chartLoading} aria-label="正在加载运营趋势" />
          ) : hasData ? (
            <div ref={chartContainerRef} className={styles.chartShell}>
              {hoveredRow ? (
                <div
                  className={styles.chartTooltip}
                  role="tooltip"
                  style={{ left: `${Math.min(82, Math.max(18, tooltipLeft))}%`, transform: "translateX(-50%)" }}
                >
                  <p className={styles.chartTooltipTitle}>{hoveredRow.date}</p>
                  {SERIES.filter((item) => series[item.key]).map((item) => (
                    <p key={item.key} className={styles.chartTooltipRow}>
                      <span>
                        <i className={styles.legendDot} style={{ backgroundColor: item.color }} />
                        {item.label}
                      </span>
                      <strong>{formatCount(safeNumber(hoveredRow[item.dataKey]))}</strong>
                    </p>
                  ))}
                </div>
              ) : null}

          <svg
            key={period}
            viewBox={`0 0 ${chart.width} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            className={styles.chartSvg}
            aria-label="近日新增用户、题目、导入与审计事件趋势图"
            focusable="false"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id="dashboardUsersArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#246B96" stopOpacity="0.14" />
                <stop offset="72%" stopColor="#246B96" stopOpacity="0.035" />
                <stop offset="100%" stopColor="#246B96" stopOpacity="0" />
              </linearGradient>
            </defs>

            {chart.yTicks.map((tick) => (
              <g key={`y-${tick.value}`}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.left + chart.plotWidth}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="rgba(78, 112, 137, 0.14)"
                  strokeDasharray="2 7"
                  vectorEffect="non-scaling-stroke"
                />
                <text x={PLOT.left - 9} y={tick.y + 3.5} textAnchor="end" className={styles.chartAxisText}>
                  {Math.round(tick.value)}
                </text>
              </g>
            ))}

            {chart.xTickIndices.map((index) => {
              const x = chart.paths.users.points[index]?.x;
              if (x === undefined) return null;
              return (
                <g key={`x-${index}`}>
                  <text x={x} y={VIEWBOX_HEIGHT - 8} textAnchor="middle" className={styles.chartAxisText}>
                    {formatDateTick(rows[index]?.date ?? "")}
                  </text>
                </g>
              );
            })}

            {series.users && chart.paths.users.area ? (
              <>
                <path className={styles.chartArea} d={chart.paths.users.area} fill="url(#dashboardUsersArea)" />
              </>
            ) : null}

            {SERIES.map((meta, seriesIndex) => {
              if (!series[meta.key]) return null;
              const path = chart.paths[meta.key].line;
              if (!path) return null;
              return (
                <g key={meta.key}>
                  <path
                    className={styles.chartLine}
                    d={path}
                    fill="none"
                    pathLength={1}
                    stroke={meta.color}
                    strokeWidth={meta.key === "users" ? "2.15" : "1.8"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ animationDelay: `${seriesIndex * 90}ms` }}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}

            {series.users && rows.length <= 14
              ? chart.paths.users.points.map((point, index) => (
                  <circle
                    key={`user-dot-${index}`}
                    className={styles.chartPoint}
                    cx={point.x}
                    cy={point.y}
                    r={hoverIndex === index ? 3.7 : 1.85}
                    fill={hoverIndex === index ? "#246B96" : "rgba(36, 107, 150, 0.64)"}
                    stroke={hoverIndex === index ? "rgba(255, 255, 255, 0.96)" : "none"}
                    strokeWidth="1.3"
                    vectorEffect="non-scaling-stroke"
                  />
                ))
              : null}

            {hoveredX !== null ? (
              <line
                x1={hoveredX}
                x2={hoveredX}
                y1={PLOT.top}
                y2={PLOT.top + PLOT_HEIGHT}
                stroke="rgba(37, 99, 138, 0.24)"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}

            {hoverIndex !== null
              ? SERIES.map((meta) => {
                  if (!series[meta.key]) return null;
                  const point = chart.paths[meta.key].points[hoverIndex];
                  if (!point) return null;
                  return (
                    <circle
                      key={`active-${meta.key}`}
                      cx={point.x}
                      cy={point.y}
                      r="3.4"
                      fill={meta.color}
                      stroke="rgba(255, 255, 255, 0.96)"
                      strokeWidth="1.7"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })
              : null}
          </svg>
            </div>
          ) : (
            <div className={styles.chartState}>暂无趋势数据</div>
          )}
        </div>

        <aside className={styles.analysisRail} aria-label={`${periodLabel}趋势摘要`}>
          <p className={styles.summaryCaption}>{periodLabel}累计</p>
          <div className={styles.summaryGrid}>
            {SERIES.map((item, index) => {
              const value = formatCount(chart.totals[item.key]);
              return (
                <div
                  key={item.key}
                  className={styles.summaryStat}
                  data-disabled={!series[item.key]}
                  data-series={item.key}
                >
                  <span>
                    <i className={styles.legendDot} style={{ backgroundColor: item.color }} />
                    {item.label}
                  </span>
                  <strong aria-label={loading ? "--" : value}>
                    {loading ? "--" : (
                      <AnimatedDigits
                        key={`${period}-${value}`}
                        value={value}
                        baseDelay={20 + index * 30}
                        metricKey={`summary:${period}:${item.key}`}
                      />
                    )}
                  </strong>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}
