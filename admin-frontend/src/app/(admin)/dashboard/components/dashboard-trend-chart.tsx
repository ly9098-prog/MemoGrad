"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { DashboardDailyPoint } from "@/lib/api/types";
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
  { key: "users", dataKey: "users_new", label: "新增用户", color: "#168985" },
  { key: "questions", dataKey: "questions_new", label: "新增题目", color: "#6768e8" },
  { key: "imports", dataKey: "imports_new", label: "导入批次", color: "#e978a4" },
  { key: "audits", dataKey: "audits_total", label: "审计事件", color: "#66808a" },
];

const VIEWBOX_HEIGHT = 230;
const PLOT = { left: 41, right: 13, top: 10, bottom: 26 };
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

function niceMax(value: number) {
  if (value <= 0) return 5;
  const target = value * 1.12;
  const rawStep = target / 5;
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = (steps.find((candidate) => normalized <= candidate) ?? 10) * magnitude;
  return Math.max(5, Math.ceil(step) * 5);
}

function pointToString(point: { x: number; y: number }) {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${pointToString(points[0])}`;
  if (points.length === 2) return `M ${pointToString(points[0])} L ${pointToString(points[1])}`;

  let path = `M ${pointToString(points[0])}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;
    const tension = 0.17;
    const cp1 = {
      x: current.x + (next.x - previous.x) * tension,
      y: current.y + (next.y - previous.y) * tension,
    };
    const cp2 = {
      x: next.x - (afterNext.x - current.x) * tension,
      y: next.y - (afterNext.y - current.y) * tension,
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
    const width = Math.max(chartWidth, 300);
    const plotWidth = Math.max(190, width - PLOT.left - PLOT.right);
    const enabledSeries = SERIES.filter((item) => series[item.key]);
    const maxValue = Math.max(
      0,
      ...rows.flatMap((row) => enabledSeries.map((item) => safeNumber(row[item.dataKey]))),
    );
    const yMax = niceMax(maxValue);
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

    const yTicks = Array.from({ length: 6 }, (_, index) => {
      const value = (yMax / 5) * index;
      return { value, y: yForValue(value) };
    }).reverse();

    const desiredTicks = period === "30d" ? 7 : Math.min(7, rows.length);
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
          <p className={styles.panelSubtitle}>新增用户、题目、导入与审计事件</p>
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

      <div className={styles.trendSummary}>
        <div className={styles.heroMetric}>
          <div className={styles.heroMetricLabel}>
            {periodLabel}新增用户
            <span>累计</span>
          </div>
          <strong className={styles.heroMetricValue}>
            {loading ? "--" : formatCount(chart.totals.users)}
          </strong>
        </div>

        <div className={styles.summaryStats}>
          <div className={styles.summaryStat}>
            <span>新增题目</span>
            <strong>{loading ? "--" : formatCount(chart.totals.questions)}</strong>
          </div>
          <div className={styles.summaryStat}>
            <span>导入批次</span>
            <strong>{loading ? "--" : formatCount(chart.totals.imports)}</strong>
          </div>
          <div className={styles.summaryStat}>
            <span>审计事件</span>
            <strong>{loading ? "--" : formatCount(chart.totals.audits)}</strong>
          </div>
        </div>
      </div>

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
              <span className={styles.legendDot} style={{ backgroundColor: enabled ? item.color : "#a9bcba" }} />
              {item.label}
            </button>
          );
        })}
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
                <stop offset="0%" stopColor="#168985" stopOpacity="0.16" />
                <stop offset="48%" stopColor="#168985" stopOpacity="0.065" />
                <stop offset="100%" stopColor="#168985" stopOpacity="0.004" />
              </linearGradient>
              <pattern id="dashboardHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
                <line x1="0" y1="0" x2="0" y2="7" stroke="#3f7775" strokeOpacity="0.17" strokeWidth="1" />
              </pattern>
              <clipPath id="dashboardUsersClip">
                <path d={chart.paths.users.area} />
              </clipPath>
              <clipPath id="dashboardAuditsClip">
                <path d={chart.paths.audits.area} />
              </clipPath>
            </defs>

            {chart.yTicks.map((tick) => (
              <g key={`y-${tick.value}`}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.left + chart.plotWidth}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="rgba(57, 100, 99, 0.17)"
                  strokeDasharray="3 5"
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
                  <line
                    x1={x}
                    x2={x}
                    y1={PLOT.top}
                    y2={PLOT.top + PLOT_HEIGHT}
                    stroke="rgba(57, 100, 99, 0.1)"
                    strokeDasharray="2 7"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text x={x} y={VIEWBOX_HEIGHT - 8} textAnchor="middle" className={styles.chartAxisText}>
                    {formatDateTick(rows[index]?.date ?? "")}
                  </text>
                </g>
              );
            })}

            {series.users && chart.paths.users.area ? (
              <>
                <path d={chart.paths.users.area} fill="url(#dashboardUsersArea)" />
                <rect
                  x={PLOT.left}
                  y={PLOT.top}
                  width={chart.plotWidth}
                  height={PLOT_HEIGHT}
                  fill="url(#dashboardHatch)"
                  clipPath="url(#dashboardUsersClip)"
                  opacity="0.58"
                />
              </>
            ) : null}

            {series.audits && chart.paths.audits.area ? (
              <rect
                x={PLOT.left}
                y={PLOT.top}
                width={chart.plotWidth}
                height={PLOT_HEIGHT}
                fill="url(#dashboardHatch)"
                clipPath="url(#dashboardAuditsClip)"
                opacity="0.44"
              />
            ) : null}

            {SERIES.map((meta) => {
              if (!series[meta.key]) return null;
              const path = chart.paths[meta.key].line;
              if (!path) return null;
              return (
                <g key={meta.key}>
                  <path
                    d={path}
                    fill="none"
                    stroke={meta.color}
                    strokeWidth={meta.key === "users" ? "4.2" : "3.2"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.045"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={meta.color}
                    strokeWidth={meta.key === "users" ? "2.15" : "1.7"}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}

            {series.users
              ? chart.paths.users.points.map((point, index) => (
                  <circle
                    key={`user-dot-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={hoverIndex === index ? 3.7 : 1.85}
                    fill={hoverIndex === index ? "#168985" : "rgba(22, 137, 133, 0.66)"}
                    stroke={hoverIndex === index ? "rgba(248, 252, 249, 0.94)" : "none"}
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
                stroke="rgba(22, 78, 79, 0.28)"
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
                      stroke="rgba(249, 252, 249, 0.96)"
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
    </section>
  );
}
