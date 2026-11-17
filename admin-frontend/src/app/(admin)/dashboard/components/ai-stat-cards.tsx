"use client";

import Image from "next/image";
import type { AIStatsResponse } from "@/lib/api/types";
import { getAiModelIcon } from "@/lib/ai-model-icons";
import { getAiSummary } from "./ai-overview-data";
import styles from "./ai-overview.module.css";

export function AiStatCards({ data, loading }: { data?: AIStatsResponse; loading: boolean }) {
  return (
    <div className={styles.metricsPanel}>
      <dl className={styles.metrics} aria-label="AI 调用统计" aria-busy={loading}>
        {getAiSummary(data).map((metric) => {
          const modelIcon = metric.key === "model" ? getAiModelIcon(data?.model_name) : null;
          return (
            <div key={metric.key} className={styles.metric} data-metric={metric.key}>
              <dt>{metric.label}</dt>
              <dd title={metric.exactValue ? `${metric.exactValue} Token` : metric.key === "model" ? metric.hint : undefined}>
                {modelIcon && metric.value !== "--" && <Image className={styles.modelIcon} src={modelIcon} alt="" width={20} height={20} unoptimized />}
                <span className={loading && !data ? styles.metricSkeleton : styles.metricValue} aria-hidden={metric.exactValue ? true : undefined}>
                  {loading && !data ? "--" : metric.value}
                </span>
                {metric.exactValue
                  ? <span className="sr-only">{metric.exactValue} Token</span>
                  : metric.unit && <span className={metric.key === "tokens" ? "sr-only" : styles.metricUnit}>{metric.unit}</span>}
              </dd>
              <dd className={data && metric.value === "--" ? styles.metricHint : "sr-only"}>{data ? metric.hint : "等待统计数据"}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
