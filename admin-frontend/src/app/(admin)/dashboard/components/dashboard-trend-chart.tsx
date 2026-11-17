"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import type { DashboardDailyPoint } from "@/lib/api/types";
import { AnimatedDigits } from "./animated-digits";
import { getTrendPaths, getTrendScale } from "./trend-geometry";
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
  { key: "users", dataKey: "users_new", label: "新增用户", color: "var(--dash-chart-users)" },
  { key: "questions", dataKey: "questions_new", label: "新增题目", color: "var(--dash-chart-questions)" },
  { key: "imports", dataKey: "imports_new", label: "导入批次", color: "var(--dash-chart-imports)" },
  { key: "audits", dataKey: "audits_total", label: "审计事件", color: "var(--dash-chart-audits)" },
];

const VIEWBOX_HEIGHT = 224;
const PLOT = { left: 39, right: 20, top: 26, bottom: 28 };
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

export function DashboardTrendChart({
  data,
  loading,
  error,
  period,
  onPeriodChange,
}: {
  data?: DashboardDailyPoint[] | null;
  loading?: boolean;
  error?: boolean;
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
  const [focusKey, setFocusKey] = useState<SeriesKey>("questions");
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverIndexRef = useRef<number | null>(null);
  const gradientId = useId();

  const rows = useMemo(() => data ?? [], [data]);
  const hasData = rows.length > 0;
  const hasEnabledSeries = Object.values(series).some(Boolean);

  useEffect(() => {
    if (loading || !hasData || !hasEnabledSeries) return;
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
  }, [loading, hasData, hasEnabledSeries]);

  const chart = useMemo(() => {
    const width = chartWidth > 0 ? chartWidth : 280;
    const plotWidth = Math.max(1, width - PLOT.left - PLOT.right);
    const enabledSeries = SERIES.filter((item) => series[item.key]);
    const maxValue = Math.max(
      0,
      ...rows.flatMap((row) => enabledSeries.map((item) => safeNumber(row[item.dataKey]))),
    );
    const yScale = getTrendScale(maxValue);
    const yMax = yScale.ceiling;
    const xForIndex = (index: number) =>
      rows.length <= 1 ? PLOT.left + plotWidth / 2 : PLOT.left + (index / (rows.length - 1)) * plotWidth;
    const yForValue = (value: number) => PLOT.top + PLOT_HEIGHT - (value / yMax) * PLOT_HEIGHT;

    const paths = Object.fromEntries(
      SERIES.map((meta) => {
        const points = rows.map((row, index) => ({
          x: xForIndex(index),
          y: yForValue(safeNumber(row[meta.dataKey])),
        }));
        return [meta.key, { points, ...getTrendPaths(points, PLOT.top + PLOT_HEIGHT) }];
      }),
    ) as Record<SeriesKey, { points: Array<{ x: number; y: number }>; line: string; area: string }>;

    const yTicks = yScale.ticks.map((value) => ({ value, y: yForValue(value) }));

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

    return { width, plotWidth, paths, yTicks, xTickIndices, totals, enabledSeries };
  }, [chartWidth, period, rows, series]);

  const primary = chart.enabledSeries.find((item) => item.key === focusKey) ?? chart.enabledSeries[0];
  const primaryPoints = primary ? chart.paths[primary.key].points : [];
  const peakIndex = primary ? rows.reduce((highest, row, index) =>
    safeNumber(row[primary.dataKey]) > safeNumber(rows[highest]?.[primary.dataKey]) ? index : highest, 0) : 0;
  const peak = primaryPoints[peakIndex];
  const hoveredRow = hoverIndex !== null ? rows[hoverIndex] : null;
  const hoveredX = hoverIndex !== null ? chart.paths.users.points[hoverIndex]?.x ?? null : null;
  const tooltipLeft = Math.max(88, Math.min(chart.width - 88, hoveredX ?? chart.width / 2));
  const periodLabel = period === "7d" ? "近 7 天" : "近 30 天";

  useEffect(() => () => {
    clearTimeout(hoverTimerRef.current);
    hoverIndexRef.current = null;
  }, [period, rows]);

  const clearHover = () => {
    clearTimeout(hoverTimerRef.current);
    hoverIndexRef.current = null;
  };

  const inspectPointer = (event: PointerEvent<SVGSVGElement>, commit = false) => {
    if (!rows.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const localX = (event.clientX - rect.left) * chart.width / rect.width;
    const ratio = Math.max(0, Math.min(1, (localX - PLOT.left) / chart.plotWidth));
    const index = rows.length <= 1 ? 0 : Math.round(ratio * (rows.length - 1));
    if (commit) {
      clearHover();
      setHoverIndex(index);
    } else if (hoverIndexRef.current !== index) {
      clearHover();
      hoverIndexRef.current = index;
      hoverTimerRef.current = setTimeout(() => setHoverIndex(index), 100);
    }
  };

  return (
    <section className={styles.trendPanel} aria-labelledby="dashboard-trend-title">
      <header className={styles.panelHeader}>
        <div>
          <h2 id="dashboard-trend-title" className={styles.panelTitle}>运营趋势</h2>
          <p className={styles.panelSubtitle}>用户、题目、导入与审计的每日新增</p>
        </div>

        <div className={styles.periodSwitch} role="group" aria-label="趋势周期">
          {(["7d", "30d"] as Period[]).map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => { clearHover(); setHoverIndex(null); onPeriodChange(item); }}
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
        <div className={styles.summaryGrid} role="group" aria-label={`${periodLabel}趋势摘要`}>
          {SERIES.map((item, index) => {
            const value = hasData ? formatCount(chart.totals[item.key]) : "--";
            return (
              <button
                key={item.key}
                type="button"
                className={styles.summaryStat}
                data-disabled={!series[item.key]}
                data-primary={primary?.key === item.key}
                style={{ color: item.color }}
                aria-label={`${item.label}，${periodLabel}累计${loading ? "加载中" : value}`}
                aria-pressed={series[item.key]}
                onClick={() => {
                  if (!series[item.key]) setFocusKey(item.key);
                  setSeries((current) => ({ ...current, [item.key]: !current[item.key] }));
                }}
              >
                <span><i className={styles.seriesSample} data-series={item.key} style={{ color: item.color }} />{item.label}</span>
                <strong aria-label={loading ? "--" : value}>
                  {loading ? "--" : <AnimatedDigits key={`${period}-${value}`} value={value} baseDelay={20 + index * 30} metricKey={`summary:${period}:${item.key}`} />}
                </strong>
              </button>
            );
          })}
        </div>
        <div className={styles.analysisChart}>
          {primary && hasData && !loading ? <div className={styles.chartCaption}>
            <span>每日新增</span>
            <span>{primary.label}峰值 <strong>{formatCount(safeNumber(rows[peakIndex]?.[primary.dataKey]))}</strong> · {formatDateTick(rows[peakIndex]?.date ?? "")}</span>
          </div> : null}
          {loading ? (
            <div className={styles.chartLoading} aria-label="正在加载运营趋势" />
          ) : hasData && Object.values(series).some(Boolean) ? (
            <div ref={chartContainerRef} className={styles.chartShell}>
              {hoveredRow ? (
                <div
                  className={styles.chartTooltip}
                  id="dashboard-trend-tooltip"
                  role="tooltip"
                  style={{ left: `${tooltipLeft}px`, transform: "translateX(-50%)" }}
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
            role="group"
            aria-describedby={hoveredRow ? "dashboard-trend-tooltip" : undefined}
            aria-label="每日新增趋势图，使用左右方向键查看日期，Escape 关闭提示"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Escape") { clearHover(); setHoverIndex(null); }
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                clearHover();
                setHoverIndex((current) => event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : current == null ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1))));
              }
            }}
            onBlur={() => { clearHover(); setHoverIndex(null); }}
            onPointerMove={(event) => { if (event.pointerType === "mouse") inspectPointer(event); }}
            onPointerUp={(event) => { if (event.pointerType !== "mouse") inspectPointer(event, true); }}
            onPointerLeave={(event) => { clearHover(); if (event.pointerType === "mouse") setHoverIndex(null); }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={primary?.color} stopOpacity="0.24" />
                <stop offset="75%" stopColor={primary?.color} stopOpacity="0.06" />
                <stop offset="100%" stopColor={primary?.color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {chart.yTicks.map((tick) => (
              <g key={`y-${tick.value}`}>
                <line
                  x1={PLOT.left}
                  x2={PLOT.left + chart.plotWidth}
                  y1={tick.y}
                  y2={tick.y}
                  className={styles.chartGridLine}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={PLOT.left - 9} y={tick.y + 3.5} textAnchor="end" className={styles.chartAxisText}>
                  {tick.value.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: 1 })}
                </text>
              </g>
            ))}

            {chart.xTickIndices.map((index) => {
              const x = chart.paths.users.points[index]?.x;
              if (x === undefined) return null;
              return (
                <g key={`x-${index}`}>
                    <text x={x} y={VIEWBOX_HEIGHT - 8} textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"} className={styles.chartAxisText}>
                    {formatDateTick(rows[index]?.date ?? "")}
                  </text>
                </g>
              );
            })}

            {primary && chart.paths[primary.key].area ? (
              <path key={primary.key} className={styles.chartArea} d={chart.paths[primary.key].area} fill={`url(#${gradientId})`} />
            ) : null}

            {SERIES.toSorted((first, second) => Number(first.key === primary?.key) - Number(second.key === primary?.key)).map((meta) => {
              if (!series[meta.key]) return null;
              const path = chart.paths[meta.key].line;
              if (!path) return null;
              return (
                <g key={`${meta.key}-${meta.key === primary?.key}`}>
                  <path
                    className={styles.chartLine}
                    data-primary={meta.key === primary?.key}
                    d={path}
                    fill="none"
                    pathLength={meta.key === primary?.key ? 1 : undefined}
                    stroke={meta.color}
                    strokeWidth={meta.key === primary?.key ? "2.6" : "1.6"}
                    strokeDasharray={meta.key === primary?.key ? undefined : meta.key === "imports" ? "6 5" : meta.key === "audits" ? "2 4" : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}

            {primary && rows.length <= 14
              ? primaryPoints.map((point, index) => (
                  <circle
                    key={`user-dot-${index}`}
                    className={styles.chartPoint}
                    cx={point.x}
                    cy={point.y}
                    r={hoverIndex === index || index === peakIndex ? 3.5 : 2.3}
                    fill="var(--dash-surface)"
                    stroke={primary.color}
                    strokeWidth="1.6"
                    vectorEffect="non-scaling-stroke"
                  />
                ))
              : null}

            {primary && peak && rows.length > 14 ? <circle cx={peak.x} cy={peak.y} r={3.5} fill="var(--dash-surface)" stroke={primary.color} strokeWidth={1.6} /> : null}

            {hoveredX !== null ? (
              <g>
              <rect x={hoveredX - 12} y={PLOT.top} width={24} height={PLOT_HEIGHT} className={styles.chartSelectionBand} />
              <line
                x1={hoveredX}
                x2={hoveredX}
                y1={PLOT.top}
                y2={PLOT.top + PLOT_HEIGHT}
                className={styles.chartSelectionLine}
                vectorEffect="non-scaling-stroke"
              />
              </g>
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
            <div className={styles.chartState} role={error ? "alert" : "status"}>{hasData ? "选择上方任一序列查看趋势" : error ? "趋势加载失败，请刷新重试" : "当前周期暂无趋势记录"}</div>
          )}
          {error && hasData ? <p className={styles.inlineWarning}>更新失败，当前显示上次读取的趋势</p> : null}
        </div>
      </div>
    </section>
  );
}
