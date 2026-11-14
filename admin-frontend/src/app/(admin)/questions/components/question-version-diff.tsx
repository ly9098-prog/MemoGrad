import { versionValueText } from "../question-version-comparison";
import { QuestionVersionValue } from "./question-version-value";

export function QuestionVersionDiff({
  label, leftValue, rightValue, leftTitle, rightTitle,
}: {
  label: string; leftValue: unknown; rightValue: unknown; leftTitle: string; rightTitle: string;
}) {
  const left = versionValueText(leftValue);
  const right = versionValueText(rightValue);
  const changed = left !== right;
  return (
    <section key={label} className={`rounded-xl border border-border bg-card ${label === "解析" ? "p-3" : "p-4"}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <span className={`rounded-md px-2 py-1 text-[10px] font-medium ${changed ? "bg-warning-light text-warning-foreground" : "bg-muted text-muted-foreground"}`}>
          {changed ? "有变更" : "无变更"}
        </span>
      </div>
      {changed ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={`min-w-0 rounded-lg bg-warning-light/70 ${label === "解析" ? "p-2.5" : "p-3"}`}>
            <p className="mb-2 text-[10px] font-semibold tracking-wide text-warning-foreground">{leftTitle}</p>
            <QuestionVersionValue label={label} value={leftValue} />
          </div>
          <div className={`min-w-0 rounded-lg bg-success-light/60 ${label === "解析" ? "p-2.5" : "p-3"}`}>
            <p className="mb-2 text-[10px] font-semibold tracking-wide text-success">{rightTitle}</p>
            <QuestionVersionValue label={label} value={rightValue} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-muted p-3"><QuestionVersionValue label={label} value={leftValue} emphasized={label === "题干"} /></div>
      )}
    </section>
  );
}
