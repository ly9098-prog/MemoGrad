"use client";

import { changedFieldLabel, friendlyBoolean, friendlyStatus } from "./action-labels";
import { cn } from "@/lib/utils";

type ChangeComparisonProps = {
  detail: Record<string, unknown>;
};

const FIELD_CONFIG: Record<string, "boolean" | "status" | "text"> = {
  is_active: "boolean",
  review_status: "status",
};

function renderDiffValue(field: string, value: unknown): string {
  if (value === undefined || value === null) return "—";
  const config = FIELD_CONFIG[field];
  if (config === "boolean") return friendlyBoolean(value as boolean | null | undefined);
  if (config === "status") return friendlyStatus(value as string | null | undefined);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[序列化异常]";
  }
}

export function ChangeComparison({ detail }: ChangeComparisonProps) {
  const before = detail.before as Record<string, unknown> | undefined;
  const after = detail.after as Record<string, unknown> | undefined;
  const changedFields = detail.changed_fields as string[] | undefined;
  const editReason = detail.edit_reason as string | undefined;

  if (!before && !after && !changedFields) return null;

  // Collect all changed fields to show
  let fieldsToShow: string[];
  if (changedFields && changedFields.length > 0) {
    fieldsToShow = changedFields;
  } else if (before && after) {
    fieldsToShow = Object.keys({ ...before, ...after });
  } else {
    fieldsToShow = [];
  }

  // If there's only individual fields (delete_mode, requested_ids, etc.)
  const isStructuredChange = before !== undefined || after !== undefined || fieldsToShow.length > 0;

  if (!isStructuredChange) return null;

  return (
    <section className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">变更内容</h4>

      {editReason && (
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground/70">编辑原因</p>
          <p className="mt-0.5 text-sm text-foreground">{editReason}</p>
        </div>
      )}

      {fieldsToShow.length > 0 && (
        <div className="space-y-2">
          {fieldsToShow.map((field) => {
            const beforeVal = before?.[field];
            const afterVal = after?.[field];
            // Skip if both undefined (edge case)
            if (beforeVal === undefined && afterVal === undefined) return null;
            // No actual change — could still show for context
            const label = changedFieldLabel(field);
            return (
              <div
                key={field}
                className="rounded-lg border border-border bg-card overflow-hidden"
              >
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground/70 border-b border-border bg-muted/50">
                  {label}
                </p>
                <div className="grid gap-0 sm:grid-cols-2">
                  <div className={cn("p-3", after !== undefined && "border-r-0 sm:border-r border-border")}>
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                      修改前
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
                      {renderDiffValue(field, beforeVal)}
                    </pre>
                  </div>
                  <div className="p-3">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                      修改后
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm font-medium text-foreground">
                      {renderDiffValue(field, afterVal)}
                    </pre>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Extra fields not in before/after */}
      {!!detail.delete_mode && (
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground/70">删除方式</p>
          <p className="mt-0.5 text-sm text-foreground">{String(detail.delete_mode)}</p>
        </div>
      )}

      {Array.isArray(detail.requested_ids) && (
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground/70">请求删除的 ID</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            共 {(detail.requested_ids as number[]).length} 个: [{(detail.requested_ids as number[]).join(", ")}]
          </p>
        </div>
      )}

      {Array.isArray(detail.success_ids) && (
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground/70">成功删除的 ID</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            共 {(detail.success_ids as number[]).length} 个: [{(detail.success_ids as number[]).join(", ")}]
          </p>
        </div>
      )}

      {Array.isArray(detail.failed_items) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive-light px-3 py-2.5">
          <p className="text-xs font-medium text-destructive">失败项</p>
          {(detail.failed_items as Array<{ id: number; error: string }>).length > 0 ? (
            <div className="mt-1 space-y-1">
              {(detail.failed_items as Array<{ id: number; error: string }>).map((f, i) => (
                <p key={i} className="font-mono text-xs text-muted-foreground">
                  #{f.id}: {f.error}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">无</p>
          )}
        </div>
      )}
    </section>
  );
}
