"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Drawer } from "@/components/ui/drawer";
import { apiRequest } from "@/lib/api/client";
import {
  actionLabel,
  operatorLabel,
  severityLabel,
  statusLabel,
  TONE_MAP,
} from "./action-labels";
import { formatLocalDateTime, formatUtcTime } from "./date-utils";
import { QuestionDetailCard } from "./question-detail-card";
import { ChangeComparison } from "./change-comparison";
import { RawJsonViewer } from "./raw-json-viewer";
import { cn } from "@/lib/utils";
import type { AuditLogDetail } from "@/lib/api/types";

type AuditLogDrawerProps = {
  detailId: number | null;
  onClose: () => void;
};

export function AuditLogDrawer({ detailId, onClose }: AuditLogDrawerProps) {
  const [showFullUa, setShowFullUa] = useState(false);

  const detail = useQuery({
    queryKey: ["audit-logs", "detail", detailId],
    queryFn: () => apiRequest<AuditLogDetail>(`/audit-logs/${detailId}`),
    enabled: detailId !== null,
    retry: 1,
    staleTime: 30_000,
  });

  const handleRefresh = useCallback(() => {
    detail.refetch();
  }, [detail]);

  const data = detail.data;

  return (
    <Drawer
      open={detailId !== null}
      onClose={onClose}
      ariaLabel="审计日志详情"
      className="w-full max-w-[760px] sm:max-w-[640px] lg:max-w-[760px]"
    >
      {/* Loading */}
      {detail.isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
        </div>
      )}

      {/* Error */}
      {detail.isError && !detail.isLoading && (
        <div className="flex flex-col items-center gap-4 py-12">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-destructive">
            {detail.error instanceof Error ? detail.error.message.slice(0, 200) : "加载详情失败"}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleRefresh}>重试</Button>
            <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
          </div>
        </div>
      )}

      {/* Content */}
      {data && (
        <div className="space-y-5">
          {/* ── Header info ── */}
          <Section>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">{actionLabel(data.action)}</h3>
              <StatusBadge tone={data.status === "failed" ? "danger" : "success"}>
                {statusLabel(data.status)}
              </StatusBadge>
              <StatusBadge tone={TONE_MAP[data.severity] ?? "neutral"}>
                {severityLabel(data.severity)}
              </StatusBadge>
            </div>
            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground/70">
              <p>
                日志 <span className="font-mono text-muted-foreground">#{data.id}</span>
                <span className="ml-3 font-mono text-[10px]">{data.action}</span>
              </p>
              <p>{formatLocalDateTime(data.created_at)}（北京时间）</p>
              <p>UTC：{formatUtcTime(data.created_at)}</p>
            </div>
          </Section>

          {/* ── Basic info grid ── */}
          <Section title="基本信息">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoBlock
                label="操作人"
                value={operatorLabel(data.operator_name, data.operator_id)}
              />
              {data.operator_id != null && <InfoBlock label="操作人 ID" value={String(data.operator_id)} mono />}
              <InfoBlock label="资源类型" value={data.resource_type ?? "—"} />
              {data.resource_id != null && <InfoBlock label="资源 ID" value={data.resource_id} mono />}
              <InfoBlock label="操作状态" value={statusLabel(data.status)} />
              <InfoBlock label="严重程度" value={severityLabel(data.severity)} />
              {data.ip && <InfoBlock label="IP 地址" value={data.ip} mono />}
            </div>

            {/* User-Agent (collapsible) */}
            {data.user_agent && (
              <div className="mt-3">
                <InfoBlock
                  label="User-Agent"
                  value={
                    <button
                      onClick={() => setShowFullUa(!showFullUa)}
                      className={cn(
                        "block w-full text-left font-mono text-xs leading-relaxed text-muted-foreground",
                        !showFullUa && "line-clamp-1",
                      )}
                    >
                      {data.user_agent}
                    </button>
                  }
                />
                {data.user_agent.length > 100 && (
                  <button
                    onClick={() => setShowFullUa(!showFullUa)}
                    className="mt-1 flex items-center gap-1 text-xs text-primary"
                  >
                    <ChevronDown className={cn("h-3 w-3 transition-transform", showFullUa && "rotate-180")} />
                    {showFullUa ? "收起" : "展开完整 User-Agent"}
                  </button>
                )}
              </div>
            )}
          </Section>

          {/* ── Error info ── */}
          {data.error_message && (
            <Section>
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive-light p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-destructive">失败原因</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                    {data.error_message}
                  </p>
                </div>
              </div>
            </Section>
          )}

          {/* ── Question detail ── */}
          {data.question_detail && (
            <Section>
              <QuestionDetailCard qd={data.question_detail} />
            </Section>
          )}

          {/* ── Fallback for question logs without data ── */}
          {!data.question_detail && (
            (data.resource_type === "question" || data.action.startsWith("question."))
          ) && (
            <Section>
              <p className="text-sm text-muted-foreground/70">
                该历史日志未保存题目快照，当前数据库中也未找到对应题目。
              </p>
            </Section>
          )}

          {/* ── Change comparison ── */}
          {data.detail && typeof data.detail === "object" && (
            <ChangeComparison detail={data.detail as Record<string, unknown>} />
          )}

          {/* ── Raw JSON ── */}
          {data.detail && (
            <RawJsonViewer data={data.detail} />
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── Helpers ──

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      {title && (
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      )}
      {children}
    </div>
  );
}

function InfoBlock({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground/70">{label}</p>
      <div className={cn("mt-0.5 text-sm text-foreground", mono && "font-mono text-xs")}>
        {value}
      </div>
    </div>
  );
}
