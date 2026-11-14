"use client";

import { AlertTriangle } from "lucide-react";

interface MissingOptionImageAlertProps {
  placeholderKeys: string[];
  missingImageKeys: string[];
  importId?: number;
  sourceQuestionNo?: string;
  /** Original placeholder values for audit trail. */
  legacyPlaceholders?: Record<string, string>;
}

/**
 * Alert card shown when image-type options have no valid image assets.
 * Blocks approval — the affected question cannot be passed until resolved.
 */
export function MissingOptionImageAlert({
  placeholderKeys,
  missingImageKeys,
  importId,
  sourceQuestionNo,
  legacyPlaceholders,
}: MissingOptionImageAlertProps) {
  const allAffectedKeys = Array.from(new Set([...placeholderKeys, ...missingImageKeys])).sort();
  if (allAffectedKeys.length === 0) return null;

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive-light/80 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-destructive-light">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-bold text-destructive">图片选项资产缺失</p>
          <p className="text-xs leading-relaxed text-destructive/90">
            检测到以下选项包含图片占位符，但 <code className="rounded bg-destructive-light px-1 font-mono text-[10px]">parsed_content</code>{" "}
            和 <code className="rounded bg-destructive-light px-1 font-mono text-[10px]">parsed_options</code> 中没有可用图片资源：
          </p>

          <div className="flex flex-wrap gap-1.5">
            {allAffectedKeys.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-md bg-destructive-light px-2 py-0.5 font-mono text-xs font-bold text-destructive"
              >
                {k}
                {missingImageKeys.includes(k) ? (
                  <span className="text-[9px] font-normal text-destructive/80">(缺图)</span>
                ) : null}
              </span>
            ))}
          </div>

          {importId || sourceQuestionNo ? (
            <div className="flex flex-wrap gap-2 text-[10px] text-destructive">
              {importId ? <span>import_id={importId}</span> : null}
              {sourceQuestionNo ? <span>source_question_no={sourceQuestionNo}</span> : null}
            </div>
          ) : null}

          {/* Legacy placeholder audit trail */}
          {legacyPlaceholders && Object.keys(legacyPlaceholders).length > 0 ? (
            <details className="rounded-lg border border-destructive/25 bg-destructive-light/60 p-2">
              <summary className="cursor-pointer text-[10px] font-semibold text-destructive hover:text-destructive/80">
                原始占位数据（审计追溯）
              </summary>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-destructive/80">
                {JSON.stringify(legacyPlaceholders, null, 2)}
              </pre>
            </details>
          ) : null}

          <div className="rounded-lg border border-destructive/25 bg-card/60 p-2.5">
            <p className="text-[10px] font-medium text-destructive">风险标记</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {placeholderKeys.length > 0 ? (
                <span className="rounded bg-destructive-light px-1.5 py-0.5 font-mono text-[9px] text-destructive">
                  legacy_option_placeholder
                </span>
              ) : null}
              {missingImageKeys.length > 0 ? (
                <span className="rounded bg-destructive-light px-1.5 py-0.5 font-mono text-[9px] text-destructive">
                  missing_option_image_asset
                </span>
              ) : null}
              <span className="rounded bg-destructive-light px-1.5 py-0.5 font-mono text-[9px] text-destructive">
                requires_manual_review
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-warning/30 bg-warning-light/70 p-2">
            <p className="text-[10px] font-medium text-warning-foreground">当前状态</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-warning-foreground/80">
              该题禁止审核通过。请返回补图流程重新生成选项图片，或手动替换图片。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
