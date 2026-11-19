"use client";

import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import type { AISettings } from "@/lib/api/types";
import { Section, formatSavedAt } from "./editorial-settings";
import styles from "./editorial-settings.module.css";

export function isQuotaExhausted(callCount: number, limit: number) {
  return limit > 0 && callCount >= limit;
}

export function SystemSettingsSection({
  current,
  loading,
  error,
  enabled,
  monthlyLimit,
  onEnabledChange,
  onMonthlyLimitChange,
  canSave,
  onSave,
  isPending,
  usageRate,
}: {
  current?: AISettings | null;
  loading?: boolean;
  error?: string | null;
  enabled: boolean;
  monthlyLimit: string;
  onEnabledChange: (value: boolean) => void;
  onMonthlyLimitChange: (value: string) => void;
  canSave: boolean;
  onSave: () => void;
  isPending: boolean;
  usageRate: number;
}) {
  const callCount = current?.current_usage.call_count ?? 0;
  const limit = current?.monthly_call_limit ?? 0;
  const limitLabel = limit > 0 ? limit.toLocaleString("zh-CN") : "不限";
  const progressWidth = limit > 0 ? Math.min(100, usageRate) : 0;
  const overLimit = isQuotaExhausted(callCount, limit);

  return (
    <Section
      eyebrow="06 / 系统"
      title="运行边界"
      lead="设定整条 AI 链路什么时候可以工作。"
      aside={
        <span className={styles.statusText}>
          {formatSavedAt(current?.updated_at)}
        </span>
      }
    >
      {error ? <p className={styles.noticeError}>{error}</p> : null}

      <div className={styles.controlBand}>
        <div className={styles.controlCopy}>
          <h3 className={styles.controlTitle}>全局 AI 解析</h3>
          <p className={styles.controlDesc}>
            关闭后，所有管理员都不能新建 AI 解析任务。
          </p>
        </div>
        <div className={styles.controlAction}>
          <span className={styles.controlActionLabel}>
            {enabled ? "已开启" : "已关闭"}
          </span>
          <Toggle
            ariaLabel="全局 AI 解析"
            checked={enabled}
            disabled={!current || isPending}
            onChange={() => onEnabledChange(!enabled)}
          />
        </div>
      </div>

      {loading ? (
        <div className={styles.loadingBlock} aria-label="正在加载系统设置">
          <span className={styles.loadingLine} style={{ width: "72%" }} />
          <span className={styles.loadingLine} style={{ width: "48%" }} />
        </div>
      ) : !current ? (
        <p className={styles.noticeError}>
          {error || "暂时无法读取系统设置"}
        </p>
      ) : (
        <div className={styles.systemGrid}>
          <div className={styles.systemPane}>
            <span className={styles.statKicker}>本月累计 API 调用</span>
            <div className={styles.bigUsage}>
              {callCount.toLocaleString("zh-CN")}
              <span className={styles.usageLimit}>
                {limit > 0 ? `/ ${limitLabel} 次` : "· 不限"}
              </span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressWidth}%` }}
              />
            </div>
            <div className={styles.progressLabels}>
              <span>0</span>
              <span>{limit > 0 ? limitLabel : "不限制"}</span>
            </div>
            <div className={styles.usageStatus} data-over={overLimit ? "true" : "false"}>
              {overLimit ? "已达月度上限" : "额度内"}
              <span className={styles.usageStatusHint}>
                使用率 {usageRate}%
              </span>
            </div>

            <div className={styles.impactBlock}>
              <h3 className={styles.impactTitle}>影响范围</h3>
              <p className={styles.impactText}>
                全局关闭后，所有管理员都不能新建 AI 解析任务。
              </p>
              <p className={styles.impactText}>
                月度额度为全局 API 调用量，只限制非 super_admin。
              </p>
            </div>
          </div>

          <div className={styles.systemPane}>
            <span className={styles.statKicker}>月度调用额度</span>
            <div className={styles.limitRow}>
              <span className={styles.limitLabel}>每月上限</span>
              <div className={styles.limitInputWrap}>
                <input
                  aria-label="月度 API 调用额度"
                  className={styles.limitInput}
                  disabled={isPending}
                  min={0}
                  onChange={(event) => onMonthlyLimitChange(event.target.value)}
                  step={1}
                  type="number"
                  value={monthlyLimit}
                />
                <span className={styles.limitSuffix}>次</span>
              </div>
            </div>
            <p className={styles.limitHint}>
              0 = 不限制；只限制非 super_admin。
            </p>

            <div className={styles.auditBlock}>
              <div className={styles.auditHead}>
                <h3 className={styles.auditTitle}>操作记录</h3>
                <span className={styles.auditText}>
                  {formatSavedAt(current.updated_at)}
                </span>
              </div>
              <p className={styles.auditText}>
                每次保存都会写入审计日志，并立即作用于后续解析任务。
              </p>
            </div>

            <div className={styles.systemActions}>
              <Button
                className={styles.primaryButton}
                disabled={!canSave || isPending}
                onClick={onSave}
                type="button"
                variant="primary"
              >
                <Save className="h-3.5 w-3.5" />
                {isPending ? "保存中…" : "保存设置"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
