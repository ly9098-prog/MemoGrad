"use client";

import { Save } from "lucide-react";
import Link from "next/link";
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
  canEdit,
  isSuperAdmin,
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
  canEdit: boolean;
  isSuperAdmin: boolean;
}) {
  const callCount = current?.current_usage.call_count ?? 0;
  const limit = current?.monthly_call_limit ?? 0;
  const limitLabel = limit > 0 ? limit.toLocaleString("zh-CN") : "不限";
  const progressWidth = limit > 0 ? Math.min(100, usageRate) : 0;
  const overLimit = isQuotaExhausted(callCount, limit);
  const remainingCalls = current?.remaining_calls;
  const statusLabel = !current
    ? loading
      ? "读取中"
      : error
        ? "不可用"
        : "未加载"
    : current.ai_parse_enabled
      ? "已开启"
      : "已关闭";

  return (
    <Section
      eyebrow="06 / 系统"
      title="后台导题与补全控制"
      lead="控制后台导题、补全及其现有富化准入是否允许继续调用模型。普通用户学习 AI 的额度在“普通用户”页面管理。"
      aside={
        <span className={styles.statusText}>
          {formatSavedAt(current?.updated_at)}
        </span>
      }
    >
      {error ? <p className={styles.noticeError}>{error}</p> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
        <span className="text-xs leading-5 text-muted-foreground">
          普通用户的学习 AI 额度由普通用户目录单独管理。
        </span>
        <Link
          className="text-xs font-semibold text-primary hover:underline"
          href="/app-users"
        >
          前往普通用户管理
        </Link>
      </div>

      <div className={styles.controlBand}>
        <div className={styles.controlCopy}>
          <h3 className={styles.controlTitle}>全局 AI 解析</h3>
          <p className={styles.controlDesc}>
            关闭后，所有管理员都不能发起新的后台 AI 解析调用；已开始的请求按本配置保存前版本执行。
          </p>
        </div>
        <div className={styles.controlAction}>
          <span className={styles.controlActionLabel}>{statusLabel}</span>
          <Toggle
            ariaLabel="全局 AI 解析"
            checked={enabled}
            disabled={!current || isPending || !canEdit}
            onChange={() => onEnabledChange(!enabled)}
          />
        </div>
      </div>
      {!canEdit ? (
        <p className={styles.limitHint}>当前账号只有读取权限，所有修改控件已禁用。</p>
      ) : null}

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
            <span className={styles.statKicker}>
              {current.current_usage.year_month} 后台模型调用
            </span>
            <div className={styles.bigUsage}>
              {callCount.toLocaleString("zh-CN")}
              <span className={styles.usageLimit}>
                {limit > 0 ? `/ ${limitLabel} 次` : "· 不限"}
              </span>
            </div>
            {limit > 0 ? (
              <div className={styles.progressTrack}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progressWidth}%` }}
                />
              </div>
            ) : null}
            <div className={styles.progressLabels}>
              <span>0</span>
              <span>{limit > 0 ? limitLabel : "不限制"}</span>
            </div>
            <div className={styles.usageStatus} data-over={overLimit ? "true" : "false"}>
              {overLimit
                ? isSuperAdmin
                  ? "已达普通管理员上限 · 当前账号可继续"
                  : "已达月度上限"
                : limit === 0
                  ? "不限调用次数"
                  : "额度内"}
              <span className={styles.usageStatusHint}>
                {limit > 0
                  ? overLimit
                    ? "调用仍会继续累计"
                    : remainingCalls == null
                      ? "剩余额度暂不可用"
                      : `剩余 ${remainingCalls.toLocaleString("zh-CN")} 次`
                  : "不限次数，但仍按调用计量"}
              </span>
            </div>

            <div className={styles.impactBlock}>
              <h3 className={styles.impactTitle}>影响范围</h3>
              <p className={styles.impactText}>
                受控范围：后台导题与补全模型调用，以及现有 AI 富化准入。
              </p>
              <p className={styles.impactText}>
                月度额度只限制非 super_admin；调用仍会计入本月用量。
              </p>
              <p className={styles.impactText}>
                普通用户错题复盘、学习问答等额度不在此处分流。
              </p>
              <p className={styles.impactText}>
                月度计数从该计数链路启用后开始累计，启用前的历史调用未补账。
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
                  disabled={!current || isPending || !canEdit}
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
              0 = 不限制次数；只限制非 super_admin。
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
                disabled={!canSave || isPending || !canEdit}
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
