import { MathFormula } from "@/components/ui/math-formula";
import type { ImportQuestionItem } from "@/lib/api/types";
import { isMultiBlankChoice, type EditState } from "../review-edit-state";
import { isMeaningfulText } from "../review-display-text";
import { MultiBlankAnswerSummary } from "./multi-blank-answer-summary";

type AnswerItem = Pick<ImportQuestionItem, "answer_status" | "answer_confidence" | "answer_source" | "ai_answer_flag">;
type AnswerDraft = Pick<EditState, "answer" | "analysis" | "question_type" | "multiBlank">;

function AnswerStatus({ item, answer }: { item: AnswerItem; answer: string }) {
  return (
    (item.answer_status === "missing" || (!answer && item.answer_status !== "imported")) ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive-light px-2 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-destructive/20">需人工确认</span>
    ) : item.answer_status === "ai_filled" ? (
      <span className="inline-flex items-center gap-1 rounded-md bg-warning-light px-2 py-0.5 text-[10px] font-bold text-warning-foreground">
        AI 补全
        {item.answer_confidence != null ? <span className="font-normal opacity-70">({(item.answer_confidence * 100).toFixed(0)}%)</span> : null}
      </span>
    ) : item.answer_status === "manual_filled" ? (
      <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">人工填写</span>
    ) : item.answer_status === "manual_verified" ? (
      <span className="rounded-md bg-success-light px-2 py-0.5 text-[10px] font-bold text-success">人工已核验</span>
    ) : item.answer_status === "abnormal" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive-light px-2 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-destructive/20">答案异常</span>
    ) : item.ai_answer_flag ? (
      <span className="rounded-md bg-warning-light px-2 py-0.5 text-[10px] font-bold text-warning-foreground">AI 补全</span>
    ) : null
  );
}

function AnswerValue({ draft }: { draft: AnswerDraft }) {
  const mb = isMultiBlankChoice(draft.question_type) ? (draft.multiBlank ?? null) : null;
  const hasMultiBlank = mb != null && mb.groups.length >= 2;
  return (
    <span className={hasMultiBlank ? "" : "answer-box"}>
      {hasMultiBlank ? (
        <MultiBlankAnswerSummary groups={mb!.groups} answerMap={mb!.answerMap} />
      ) : (
        draft.answer || "—"
      )}
    </span>
  );
}

function AnswerPreview({ item, draft }: { item: AnswerItem; draft: AnswerDraft }) {
  return (
    <section className="animate-fade-up drawer-section-delay-3 section-scroll section-scroll-jade rounded-2xl border border-border/80 bg-card/90 p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-success/10">
          <span className="text-xs font-bold text-success font-display">答</span>
        </span>
        <span className="text-sm font-semibold text-foreground">答案</span>
        {/* 答案状态标签 — 紧凑展示 */}
        <AnswerStatus item={item} answer={draft.answer} />
      </div>
      <div className="ml-9">
        {item.answer_source && isMeaningfulText(item.answer_source) && !["unknown"].includes(String(item.answer_source).toLowerCase()) ? (
          <p className="mb-2 text-[10px] text-muted-foreground/70">来源：{item.answer_source === "ai" ? "AI 补全" : item.answer_source === "ocr" ? "OCR 识别" : item.answer_source === "parser" ? "解析器提取" : item.answer_source === "manual" ? "人工填写" : item.answer_source}</p>
        ) : null}
        <AnswerValue draft={draft} />
      </div>
    </section>
  );
}

function AnalysisPreview({ analysis }: { analysis: string }) {
  return (
    <section className="animate-fade-up drawer-section-delay-4 section-scroll section-scroll-jade rounded-2xl border border-border/80 bg-card/90 p-5 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-success/10">
          <span className="text-xs font-bold text-success font-display">析</span>
        </span>
        <span className="text-sm font-semibold text-foreground">解析</span>
      </div>
      <div className="ml-9">
        {analysis ? (
          <div className="stem-text">
            <MathFormula text={analysis} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70">（无解析）</p>
        )}
      </div>
    </section>
  );
}

export function ReviewAnswerPreview({ item, draft }: { item: AnswerItem; draft: AnswerDraft }) {
  return (
    <>
      <AnswerPreview item={item} draft={draft} />
      <AnalysisPreview analysis={draft.analysis} />
    </>
  );
}
