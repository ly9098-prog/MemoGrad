"use client";

import { CheckCircle2, X } from "lucide-react";
import type { NormalizedBatchResult } from "../review-queue-state";

type ReviewBatchResultProps = {
  decision: "approved" | "rejected";
  result: NormalizedBatchResult;
  onDismiss: () => void;
};

/**
 * Per-id batch feedback required by the admin UI rules: both successful ids
 * and failed items stay visible until the operator dismisses the panel.
 */
export function ReviewBatchResult({
  decision,
  result,
  onDismiss,
}: ReviewBatchResultProps) {
  const label = decision === "approved" ? "批量通过" : "批量拒绝";

  return (
    <section
      aria-live="polite"
      className="animate-fade-in rounded-2xl border border-border bg-card/90 p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{label}结果</p>
          <p className="mt-1 text-xs text-muted-foreground">
            成功 {result.successIds.length} 项，失败 {result.failedItems.length} 项。
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
          aria-label="关闭批量结果"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-success/30 bg-success-light/55 p-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            成功 {result.successIds.length} 项
          </p>
          <p className="mt-1.5 break-words font-mono text-[11px] leading-5 text-muted-foreground">
            {result.successIds.length > 0
              ? result.successIds.map((id) => `#${id}`).join("、")
              : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-destructive/25 bg-destructive-light/55 p-3">
          <p className="text-xs font-semibold text-destructive">
            失败 {result.failedItems.length} 项
          </p>
          {result.failedItems.length > 0 ? (
            <ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-muted-foreground">
              {result.failedItems.map((item) => (
                <li key={`${item.id}-${item.error}`} className="break-words">
                  <span className="font-mono text-destructive">#{item.id}</span>{" "}
                  {item.error}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">无失败项</p>
          )}
        </div>
      </div>
    </section>
  );
}
