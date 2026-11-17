"use client";

import type { AIStatsResponse } from "@/lib/api/types";
import { getAiSummary } from "./ai-overview-data";
import styles from "./ai-overview.module.css";

export function AiStatCards({ data, loading }: { data?: AIStatsResponse; loading: boolean }) {
  return (
    <div className={styles.metricsPanel}>
      <dl className={styles.metrics} aria-label="AI 调用统计" aria-busy={loading}>
        {getAiSummary(data).map((metric) => (
          <div key={metric.key} className={styles.metric} data-metric={metric.key}>
            <dt>{metric.label}</dt>
            <dd>
              <span className={loading && !data ? styles.metricSkeleton : styles.metricValue}>
                {loading && !data ? "--" : metric.value}
              </span>
              <span className={metric.key === "tokens" ? "sr-only" : styles.metricUnit}>{metric.unit}</span>
            </dd>
            <dd className={data && metric.value === "--" ? styles.metricHint : "sr-only"}>{data ? metric.hint : "等待统计数据"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
