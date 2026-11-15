"use client";

import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import {
  TONE_MAP,
  actionLabel,
  operatorLabel,
  severityLabel,
  statusLabel,
} from "./action-labels";
import { formatLocalDateTime, truncate } from "./date-utils";
import type { AuditLogListItem } from "@/lib/api/types";

type AuditLogItemProps = {
  log: AuditLogListItem;
  onOpen: (id: number) => void;
};

export const AuditLogItem = memo(function AuditLogItem({ log, onOpen }: AuditLogItemProps) {
  const summary = log.detail_summary;

  return (
    <button
      className="group w-full border-b border-border/70 px-4 py-3.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
      onClick={() => onOpen(log.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(log.id); } }}
      aria-label={`${actionLabel(log.action)} 日志详情`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="text-[13px] font-semibold text-foreground">{actionLabel(log.action)}</span>
            <StatusBadge tone={log.status === "failed" ? "danger" : "success"}>
              {statusLabel(log.status)}
            </StatusBadge>
            <StatusBadge tone={TONE_MAP[log.severity] ?? "neutral"}>
              {severityLabel(log.severity)}
            </StatusBadge>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {log.resource_type ? (
              <span>
                {log.resource_type}
                {log.resource_id ? <span className="font-mono"> #{log.resource_id}</span> : null}
              </span>
            ) : null}
            <span>by {operatorLabel(log.operator_name, log.operator_id)}</span>
            {log.ip ? <span className="font-mono text-[10px] text-muted-foreground/75">{log.ip}</span> : null}
          </div>

          {summary ? (
            <div className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-muted-foreground/75">
              {[
                summary.subject_name,
                summary.question_type,
                truncate(
                  typeof summary.content_preview === "string" ? summary.content_preview : null,
                  80,
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}

          {log.error_message ? (
            <div className="mt-2 rounded-lg border border-destructive/25 bg-destructive-light px-2.5 py-1.5 text-[11px] text-destructive">
              {truncate(log.error_message, 150)}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/75 sm:flex-col sm:items-end">
          <span title={log.created_at}>{formatLocalDateTime(log.created_at)}</span>
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </button>
  );
});
