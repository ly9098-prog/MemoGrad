import { AlertTriangle, Check, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BatchAnswerImageApplyResponse, BatchAnswerImagePreviewResponse } from "@/lib/api/types";

type ImagePreviewProps = {
  preview: BatchAnswerImagePreviewResponse;
  executing: boolean;
  onApply: () => void;
};
type ImagePreviewData = Pick<ImagePreviewProps, "preview">;

function ImageAnswerPreviewSummary({ preview }: ImagePreviewData) {
  return (
    <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs">
      <span>共 <strong>{preview.summary.total_images}</strong> 张图片</span>
      <span className="text-muted-foreground/70">·</span>
      <span>提取 <strong>{preview.summary.extracted_entries}</strong> 个条目</span>
      <span className="text-muted-foreground/70">·</span>
      <span className="text-success">匹配 <strong>{preview.summary.matched_count}</strong></span>
      {preview.summary.unmatched_count > 0 ? (
        <>
          <span className="text-muted-foreground/70">·</span>
          <span className="text-muted-foreground/70">未匹配 <strong>{preview.summary.unmatched_count}</strong></span>
        </>
      ) : null}
      {preview.summary.ambiguous_count > 0 ? (
        <>
          <span className="text-muted-foreground/70">·</span>
          <span className="text-warning-foreground">歧义 <strong>{preview.summary.ambiguous_count}</strong></span>
        </>
      ) : null}
      {preview.summary.writable_answer_count > 0 ? (
        <>
          <span className="text-muted-foreground/70">·</span>
          <span className="text-success">可写答案 <strong>{preview.summary.writable_answer_count}</strong></span>
        </>
      ) : null}
      {preview.summary.writable_analysis_count > 0 ? (
        <>
          <span className="text-muted-foreground/70">·</span>
          <span className="text-success">可写解析 <strong>{preview.summary.writable_analysis_count}</strong></span>
        </>
      ) : null}
    </div>
  );
}

function ImageAnswerPreviewRow({ item }: { item: BatchAnswerImagePreviewResponse["items"][number] }) {
  const statusColor = item.status === "matched"
    ? "text-success"
    : item.status === "ambiguous"
      ? "text-warning-foreground"
      : "text-muted-foreground/70";
  const statusLabel = item.status === "matched"
    ? "已匹配"
    : item.status === "ambiguous"
      ? "歧义"
      : "未匹配";
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/30">
      <td className="px-3 py-2 align-top font-mono text-muted-foreground">
        {item.source_question_no ?? item.source_order_index ?? "?"}
      </td>
      <td className="px-3 py-2 align-top max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap text-foreground" title={item.stem_excerpt}>
        {item.stem_excerpt || <span className="text-muted-foreground/70">—</span>}
      </td>
      <td className="px-3 py-2 align-top font-mono text-muted-foreground">
        {item.original_answer || <span className="text-muted-foreground/70">—</span>}
      </td>
      <td className="px-3 py-2 align-top font-mono font-semibold text-foreground">
        {item.extracted_answer || <span className="text-muted-foreground/70">—</span>}
      </td>
      <td className={`px-3 py-2 align-top ${statusColor}`}>
        {statusLabel}
      </td>
    </tr>
  );
}

function ImageAnswerPreviewTable({ preview }: ImagePreviewData) {
  return (
    <div className="max-h-[360px] overflow-y-auto rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-semibold text-muted-foreground">题号</th>
            <th className="px-3 py-2 font-semibold text-muted-foreground">题干</th>
            <th className="px-3 py-2 font-semibold text-muted-foreground">原答案</th>
            <th className="px-3 py-2 font-semibold text-muted-foreground">提取答案</th>
            <th className="px-3 py-2 font-semibold text-muted-foreground">状态</th>
          </tr>
        </thead>
        <tbody>
          {preview.items.map((item, idx) => <ImageAnswerPreviewRow key={idx} item={item} />)}
        </tbody>
      </table>
    </div>
  );
}

function ImageAnswerSources({ preview }: ImagePreviewData) {
  return (
    preview.items.some(i => i.source_filename) ? (
      <details className="group rounded-xl border border-border bg-muted/30 px-4 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-1.5">
            图片来源信息
            <span className="inline-block text-[10px] transition-transform group-open:rotate-90">▶</span>
          </span>
        </summary>
        <div className="mt-2 space-y-1 max-h-[120px] overflow-y-auto">
          {preview.items.filter(i => i.source_filename).map((item, idx) => (
            <p key={idx} className="text-[10px] text-muted-foreground/70">
              {item.source_question_no && <>题号 {item.source_question_no} · </>}
              {item.source_filename}
              {item.ocr_confidence != null && <> · 置信度 {(item.ocr_confidence * 100).toFixed(0)}%</>}
              {item.extract_method && <> · {item.extract_method === "rule" ? "规则提取" : "AI提取"}</>}
            </p>
          ))}
        </div>
      </details>
    ) : null
  );
}

export function ImageAnswerPreview({ preview, executing, onApply }: ImagePreviewProps) {
  return (
    <div className="space-y-4">
      <ImageAnswerPreviewSummary preview={preview} />
      <ImageAnswerPreviewTable preview={preview} />
      <ImageAnswerSources preview={preview} />
      {preview.warnings.length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning-light px-4 py-3 text-xs text-warning-foreground">
          {preview.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      ) : null}
      <Button
        className="h-9 w-full text-sm"
        disabled={preview.summary.writable_answer_count === 0 && preview.summary.writable_analysis_count === 0 || executing}
        onClick={onApply}
      >
        <Check className="mr-1.5 h-4 w-4" />
        确认写入
        {preview.summary.writable_answer_count > 0 ? ` ${preview.summary.writable_answer_count} 题答案` : ""}
        {preview.summary.writable_analysis_count > 0 ? ` ${preview.summary.writable_analysis_count} 题解析` : ""}
      </Button>
    </div>
  );
}

export function ImageAnswerResult({ result, onClose }: {
  result: BatchAnswerImageApplyResponse;
  onClose: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-success/30 bg-success-light px-5 py-4">
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-semibold">图片答案导入完成</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center text-sm">
          <div className="rounded-lg bg-card/70 px-3 py-2">
            <p className="text-lg font-bold text-success">{result.updated_answer_count}</p>
            <p className="text-xs text-success/70">答案已更新</p>
          </div>
          <div className="rounded-lg bg-card/70 px-3 py-2">
            <p className="text-lg font-bold text-success">{result.updated_analysis_count}</p>
            <p className="text-xs text-success/70">解析已更新</p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-center text-[11px] text-muted-foreground/70">
          <div>跳过已有答案 {result.skipped_existing_answer_count}</div>
          <div>跳过已有解析 {result.skipped_existing_analysis_count}</div>
        </div>
      </div>
      <Button
        variant="secondary"
        className="h-9 w-full text-sm"
        onClick={onClose}
      >
        关闭
      </Button>
    </div>
  );
}
