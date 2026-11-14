import { Input } from "@/components/ui/input";
import { isMultiBlankChoice } from "../review-edit-state";
import { isReviewAnswerSelected, toggleReviewAnswer } from "../review-answer-selection";

type AnswerEditorProps = {
  questionType: string;
  options: Array<{ key: string }>;
  answer: string;
  analysis: string;
  onAnswerChange: (answer: string) => void;
  onAnalysisChange: (analysis: string) => void;
};

function AnswerOption({ questionType, answer, optionKey, onAnswerChange }: {
  questionType: string;
  answer: string;
  optionKey: string;
  onAnswerChange: (answer: string) => void;
}) {
  const selected = isReviewAnswerSelected(questionType, answer, optionKey);
  return (
    <button
      type="button"
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3.5 text-sm font-medium transition ${
        selected
          ? "border-success bg-success text-success-foreground shadow-sm"
          : "border-border bg-card/70 text-muted-foreground hover:border-success hover:text-success"
      }`}
      onClick={() => onAnswerChange(toggleReviewAnswer(questionType, answer, optionKey))}
    >
      {optionKey}
    </button>
  );
}

function QuickAnswerSelection({ questionType, options, answer, onAnswerChange }: Omit<
  AnswerEditorProps, "analysis" | "onAnalysisChange"
>) {
  if (isMultiBlankChoice(questionType)) return null;
  return (
    <>
      {options.length === 0 ? <p className="mb-2 text-sm text-muted-foreground/70">请先编辑选项</p> : null}
      {options.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {options.map((option) => (
            <AnswerOption
              key={option.key}
              questionType={questionType}
              answer={answer}
              optionKey={option.key}
              onAnswerChange={onAnswerChange}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function ReviewAnswerEditor({
  questionType, options, answer, analysis, onAnswerChange, onAnalysisChange,
}: AnswerEditorProps) {
  return (
    <section className="animate-fade-up drawer-section-delay-4 rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-success-light">
          <span className="text-[10px] font-bold text-success">签</span>
        </span>
        <p className="text-xs font-semibold text-muted-foreground">答案与解析</p>
      </div>
      <QuickAnswerSelection questionType={questionType} options={options} answer={answer} onAnswerChange={onAnswerChange} />
      <label className="mb-3 block space-y-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success/60" />
          答案
        </span>
        <Input value={answer} onChange={(event) => onAnswerChange(event.target.value)} />
        {isMultiBlankChoice(questionType) ? <p className="mt-1 text-[10px] text-warning-foreground">多空选择题的答案由上方各空位的答案选择器生成；展开高级答案输入后，也可以使用槽位格式手动修改。</p> : null}
      </label>
      <label className="block space-y-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-success/60" />
          解析
        </span>
        <textarea className="min-h-24 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" value={analysis} onChange={(event) => onAnalysisChange(event.target.value)} />
      </label>
    </section>
  );
}
