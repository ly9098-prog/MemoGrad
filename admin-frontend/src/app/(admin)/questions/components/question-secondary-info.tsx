import type { AdminQuestion, AdminQuestionImportSummary } from "@/lib/api/types";

type QuestionWithImport = AdminQuestion & {
  import_record?: AdminQuestionImportSummary | null;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <p className="shrink-0 text-[11px] text-muted-foreground">{label}</p>
      <p className="min-w-0 break-words text-right text-[12px] font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}

function ImportRecordDetails({ importRecord }: { importRecord: AdminQuestionImportSummary }) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[11px] text-muted-foreground">题目 hash</p>
          <p className="mt-1 break-all font-mono text-[11px] text-foreground">
            {importRecord.question_hash || "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">正式题关联</p>
          <p className="mt-1 font-mono text-[11px] text-foreground">
            {importRecord.duplicate_of_question_id
              ? `#${importRecord.duplicate_of_question_id}`
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">导入项关联</p>
          <p className="mt-1 font-mono text-[11px] text-foreground">
            {importRecord.duplicate_of_import_id
              ? `#${importRecord.duplicate_of_import_id}`
              : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function QuestionSecondaryInfo({
  question,
  className,
}: {
  question: QuestionWithImport;
  className?: string;
}) {
  const importRecord = question.import_record;
  return (
    <details
      className={["border-t border-border pt-4 text-sm", className].filter(Boolean).join(" ")}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">辅助信息</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              科目、年份、启用状态与导入关联信息
            </p>
          </div>
        </div>
      </summary>
      <div className="mt-3 grid gap-x-5 sm:grid-cols-2">
        <InfoRow label="科目" value={question.subject_name || question.subject_code || "—"} />
        <InfoRow label="年份" value={String(question.year || "—")} />
        <InfoRow label="启用状态" value={question.is_active ? "启用" : "停用"} />
        <InfoRow label="题目 ID" value={`#${question.id}`} />
      </div>
      {importRecord ? <ImportRecordDetails importRecord={importRecord} /> : null}
    </details>
  );
}
