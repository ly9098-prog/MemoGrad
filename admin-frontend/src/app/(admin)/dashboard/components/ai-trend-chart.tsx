"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { DailyTrendPoint } from "@/lib/api/types";
import { RecordDialog } from "./record-dialog";
import {
  AI_CHART,
  AI_TREND_METRICS,
  formatAiTrendValue,
  getAiTrendGeometry,
  getAiTrendKeyboardIndex,
  getAiTrendValue,
  getAiTrendWindow,
  type AiTrendMetric,
  type AiTrendPeriod,
} from "./ai-overview-data";
import styles from "./ai-overview.module.css";

export function AiTrendChart({
  trends,
  loading,
  unavailable = false,
}: {
  trends?: DailyTrendPoint[];
  loading: boolean;
  unavailable?: boolean;
}) {
  const [metric, setMetric] = useState<AiTrendMetric>("calls");
  const [period, setPeriod] = useState<AiTrendPeriod>(7);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(AI_CHART.width);
  const [recordsExpanded, setRecordsExpanded] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverIndexRef = useRef<number | null>(null);
  const gradientId = useId();
  const data = useMemo(() => getAiTrendWindow(trends, period), [period, trends]);
  const geometry = useMemo(() => getAiTrendGeometry(data, metric, width), [data, metric, width]);
  const selected = selectedIndex !== null && selectedIndex < data.length ? selectedIndex : null;
  const selectedPoint = selected === null ? null : data[selected];
  const metricMeta = AI_TREND_METRICS.find((item) => item.key === metric)!;
  const inspectedPoint = selectedPoint ?? data.at(-1);
  const inspectedValue = inspectedPoint ? getAiTrendValue(inspectedPoint, metric) : null;
  const values = geometry.points.flatMap((point) => point.value === null ? [] : [point.value]);
  const isCount = metric === "calls" || metric === "tokens";
  const periodValue = values.length === 0 ? null : isCount
    ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values);
  const metricColors = {
    calls: "var(--dash-chart-users)", tokens: "var(--dash-chart-imports)",
    success: "var(--dash-chart-questions)", latency: "var(--admin-warning, #96601f)",
  };

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const updateWidth = () => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth > 0) setWidth(Math.round(nextWidth));
    };
    updateWidth();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateWidth);
    observer?.observe(element);
    window.addEventListener("resize", updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  useEffect(() => () => {
    clearTimeout(hoverTimerRef.current);
    hoverIndexRef.current = null;
  }, [metric, period, trends]);

  const clearHover = () => {
    clearTimeout(hoverTimerRef.current);
    hoverIndexRef.current = null;
  };

  const handleChartKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) {
      event.preventDefault();
      clearHover();
      setSelectedIndex(getAiTrendKeyboardIndex(event.key, selected, data.length));
    }
  };

  const inspectPointer = (event: MouseEvent<SVGSVGElement>, commit = true) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || data.length === 0) return;
    const localX = (event.clientX - rect.left) * width / rect.width;
    const plotWidth = Math.max(1, width - AI_CHART.left - AI_CHART.right);
    const ratio = Math.max(0, Math.min(1, (localX - AI_CHART.left) / plotWidth));
    const nextIndex = Math.round(ratio * (data.length - 1));
    if (commit) {
      clearHover();
      setSelectedIndex(nextIndex);
    } else if (hoverIndexRef.current !== nextIndex) {
      clearHover();
      hoverIndexRef.current = nextIndex;
      hoverTimerRef.current = setTimeout(() => setSelectedIndex(nextIndex), 100);
    }
  };

  const setPeriodAndClearSelection = (nextPeriod: AiTrendPeriod) => {
    clearHover();
    setPeriod(nextPeriod);
    setSelectedIndex(null);
  };

  return (
    <section className={styles.trend} aria-labelledby="dashboard-ai-trend-title" style={{ "--ai-chart-color": metricColors[metric] } as CSSProperties}>
      <div className={styles.trendHeader}>
        <div>
          <h3 id="dashboard-ai-trend-title">调用趋势</h3>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label="AI 趋势指标" data-segments="4" data-active={AI_TREND_METRICS.findIndex((item) => item.key === metric)}>
            {AI_TREND_METRICS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={metric === item.key}
                onClick={() => {
                  clearHover();
                  setMetric(item.key);
                  setSelectedIndex(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className={styles.segmented} role="group" aria-label="AI 趋势周期" data-active={period === 7 ? 0 : 1}>
            {([7, 30] as const).map((nextPeriod) => (
              <button
                key={nextPeriod}
                type="button"
                aria-pressed={period === nextPeriod}
                onClick={() => setPeriodAndClearSelection(nextPeriod)}
              >
                {nextPeriod} 天
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.trendSummary}>
        <p className={styles.readout} aria-live="polite">
          <span>{inspectedPoint?.date ?? "—"} · {metricMeta.label}</span>
          <strong>{formatAiTrendValue(inspectedValue, metric)}</strong>
          {inspectedPoint && inspectedValue === null && <small>无有效调用样本</small>}
        </p>
        <p className={styles.trendContext}>
          <span>{period} 天{isCount ? "合计" : "最高"}</span>
          <strong>{formatAiTrendValue(periodValue, metric)}</strong>
        </p>
      </div>

      <div ref={chartRef} className={styles.chartWrap}>
      {loading && data.length === 0 ? (
        <div className={styles.chartState} data-loading="true" role="status">正在加载趋势…</div>
      ) : unavailable ? (
        <div className={styles.chartState} role="status">趋势数据暂不可用，请通过工作台刷新重试。</div>
      ) : data.length === 0 ? (
        <div className={styles.chartState} role="status">暂无趋势数据。</div>
      ) : geometry.points.every((point) => point.value === null) ? (
        <div className={styles.chartState} role="status">所选周期暂无可计算{metricMeta.label}的调用样本。</div>
      ) : (
        <svg
          className={styles.chart}
          viewBox={`0 0 ${width} ${AI_CHART.height}`}
          role="group"
          tabIndex={0}
          aria-label={`${metricMeta.label}趋势图，可用左右方向键浏览数据点`}
          aria-describedby="dashboard-ai-trend-hint"
          onKeyDown={handleChartKeyDown}
          onPointerMove={(event) => { if (event.pointerType === "mouse") inspectPointer(event, false); }}
          onPointerLeave={clearHover}
          onBlur={clearHover}
          onClick={(event) => inspectPointer(event)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ai-chart-color)" stopOpacity={0.2} />
              <stop offset="90%" stopColor="var(--ai-chart-color)" stopOpacity={0.015} />
            </linearGradient>
          </defs>
          {geometry.ticks.map((value) => {
            const y = AI_CHART.top + (AI_CHART.height - AI_CHART.top - AI_CHART.bottom) * (1 - value / geometry.ceiling);
            return (
              <g key={value}>
                <line className={styles.gridLine} x1={AI_CHART.left} x2={width - AI_CHART.right} y1={y} y2={y} />
                <text className={styles.axis} x={AI_CHART.left - 10} y={y + 4} textAnchor="end">
                  {metric === "success" ? `${value.toFixed(0)}%` : value.toLocaleString("zh-CN", { notation: "compact", maximumFractionDigits: metric === "latency" ? 3 : 0 })}
                </text>
              </g>
            );
          })}
          <path key={`area-${metric}-${period}`} className={styles.trendArea} d={geometry.area} fill={`url(#${gradientId})`} />
          <path key={`${metric}-${period}`} className={styles.trendLine} d={geometry.path} pathLength={1} />
          {geometry.points.map((point, index) => {
            const trendPoint = data[index];
            const selectedPointClass = selected === index ? styles.selectionPoint : styles.point;
            return (
              <g key={`${trendPoint.date}-${index}`}>
                {selected === index && <>
                  <rect className={styles.selectionBand} x={Math.max(AI_CHART.left, point.x - 12)} y={AI_CHART.top} width={Math.min(24, width - AI_CHART.right - Math.max(AI_CHART.left, point.x - 12))} height={AI_CHART.height - AI_CHART.top - AI_CHART.bottom} />
                  <line className={styles.selectionLine} x1={point.x} x2={point.x} y1={AI_CHART.top} y2={AI_CHART.height - AI_CHART.bottom} />
                </>}
                {point.y !== null && (data.length <= 7 || selected === index || index === data.length - 1 || (geometry.points[index - 1]?.y == null && geometry.points[index + 1]?.y == null)) && <circle className={selectedPointClass} cx={point.x} cy={point.y} r={selected === index ? 4.5 : index === data.length - 1 ? 3.5 : 2.5} />}
                <circle
                  className={styles.hitTarget}
                  cx={point.x}
                  cy={point.y ?? AI_CHART.height / 2}
                  r={12}
                  aria-hidden="true"
                  onClick={() => { clearHover(); setSelectedIndex(index); }}
                />
                {(index === 0 || index === data.length - 1 || (data.length <= 7 && width >= 520)) && (
                  <text className={styles.axis} x={point.x} y={AI_CHART.height - 8} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>
                    {trendPoint.date}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      </div>

      <p id="dashboard-ai-trend-hint" className="sr-only">点按图表查看数值；键盘左右浏览，Home/End 跳转，Escape 清除选择。无调用时成功率与耗时显示 --。</p>
    <RecordDialog
      id="dashboard-ai-records-panel"
      label="每日调用明细"
      meta={`${data.length} 天数据`}
      open={recordsExpanded}
      onOpenChange={setRecordsExpanded}
    >
        <div className={styles.tableScroll} role="region" aria-label="AI 趋势数据表" tabIndex={0}>
          <table>
            <caption className="sr-only">AI {period} 天趋势数据</caption>
            <thead>
              <tr><th scope="col">日期</th><th scope="col">调用</th><th scope="col">Token</th><th scope="col">成功率</th><th scope="col">耗时</th></tr>
            </thead>
            <tbody>
              {data.map((point, index) => (
                <tr key={point.date} data-selected={selected === index}>
                  <th scope="row">{point.date}</th>
                  <td>{formatAiTrendValue(getAiTrendValue(point, "calls"), "calls")}</td>
                  <td>{formatAiTrendValue(getAiTrendValue(point, "tokens"), "tokens")}</td>
                  <td>{formatAiTrendValue(getAiTrendValue(point, "success"), "success")}</td>
                  <td>{formatAiTrendValue(getAiTrendValue(point, "latency"), "latency")}</td>
                </tr>
              ))}
              {data.length === 0 && <tr><td colSpan={5}>暂无可用趋势数据</td></tr>}
            </tbody>
          </table>
        </div>
    </RecordDialog>
    </section>
  );
}
