"use client";

import { memo } from "react";
import { Eye } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { RESOURCE_TYPE_LABELS, TONE_MAP, actionLabel, operatorLabel, severityLabel, statusLabel } from "./action-labels";
import { formatLocalDateTime, truncate } from "./date-utils";
import type { AuditLogListItem } from "@/lib/api/types";

type AuditLogItemProps = { log: AuditLogListItem; onOpen: (id: number) => void };

export const AuditLogItem = memo(function AuditLogItem({ log, onOpen }: AuditLogItemProps) {
  const operatorName = log.operator_name?.trim();
  const isSystem = log.operator_id == null && !operatorName;
  const summary = log.detail_summary;
  const preview = summary ? [summary.subject_name, summary.question_type,
    typeof summary.content_preview === "string" ? summary.content_preview : null].filter(Boolean).join(" · ") : "";

  return (
    <tr className="group border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent/30">
      <td className="max-w-[320px] px-5 py-4">
        <button type="button" onClick={() => onOpen(log.id)} aria-label={`${actionLabel(log.action)} · 日志 #${log.id} 详情`}
          className="rounded text-left text-sm font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {actionLabel(log.action)}
        </button>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">#{log.id}</span>
          <span className="truncate" title={log.action}>{log.action}</span>
        </div>
        {preview && <p title={preview} className="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{truncate(preview, 120)}</p>}
        {log.error_message && <p title={log.error_message} className="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-destructive">{truncate(log.error_message, 150)}</p>}
      </td>
      <td className="px-4 py-4">
        <div className="max-w-[160px] truncate text-sm" title={operatorName || undefined}>
          {isSystem ? "系统" : operatorLabel(operatorName, log.operator_id)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{isSystem ? "系统操作" : log.operator_id == null ? "未记录 ID" : `ID ${log.operator_id}`}</div>
      </td>
      <td className="px-4 py-4">
        <div className="max-w-[160px] truncate text-sm" title={log.resource_type || undefined}>
          {log.resource_type ? RESOURCE_TYPE_LABELS[log.resource_type] || log.resource_type : "—"}
        </div>
        <div className="mt-1 max-w-[160px] truncate font-mono text-xs tabular-nums text-muted-foreground" title={log.resource_id || undefined}>
          {log.resource_id ? `#${log.resource_id}` : "—"}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <StatusBadge tone={TONE_MAP[log.severity] ?? "neutral"}>{severityLabel(log.severity)}</StatusBadge>
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <StatusBadge tone={log.status === "failed" ? "danger" : "success"}>{statusLabel(log.status)}</StatusBadge>
      </td>
      <td className="px-4 py-4">
        <time dateTime={log.created_at} className="whitespace-nowrap text-xs tabular-nums" title={log.created_at}>{formatLocalDateTime(log.created_at)}</time>
        <div className="mt-1 max-w-[200px] truncate font-mono text-[11px] text-muted-foreground" title={log.ip || undefined}>
          {log.ip || "未记录 IP"}
        </div>
      </td>
      <td className="px-4 py-4 text-right">
        <Button variant="ghost" size="sm" onClick={() => onOpen(log.id)} aria-label={`查看日志 #${log.id} 详情`} className="h-8 gap-1.5 whitespace-nowrap text-xs">
          <Eye className="h-3.5 w-3.5" />详情
        </Button>
      </td>
    </tr>
  );
});
