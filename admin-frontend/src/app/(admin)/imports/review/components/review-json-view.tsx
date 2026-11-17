import type { ImportQuestionItem } from "@/lib/api/types";

type JsonSection = {
  title: string;
  accent: string;
  data: unknown;
};

function sections(item: ImportQuestionItem): JsonSection[] {
  return [
    {
      title: "基础信息",
      accent: "var(--primary)",
      data: {
        id: item.id, batch_id: item.batch_id, source_type: item.source_type, subject_id: item.subject_id,
        subject_code: item.subject_code, subject_name: item.subject_name, question_type: item.question_type,
        status: item.status, ai_generated: item.ai_generated, ai_answer_flag: item.ai_answer_flag,
        created_at: item.created_at, updated_at: item.updated_at,
      },
    },
    {
      title: "解析数据",
      accent: "var(--success)",
      data: {
        parsed_content: item.parsed_content, parsed_options: item.parsed_options,
        parsed_answer: item.parsed_answer, parsed_analysis: item.parsed_analysis,
      },
    },
    {
      title: "重复检测",
      accent: "var(--warning)",
      data: {
        duplicate_status: item.duplicate_status, duplicate_of_question_id: item.duplicate_of_question_id,
        duplicate_of_import_id: item.duplicate_of_import_id, question_hash: item.question_hash,
      },
    },
    {
      title: "OCR / AI 原始数据",
      accent: "var(--info)",
      data: { raw_data: item.raw_data, ai_metadata: item.ai_metadata },
    },
  ];
}

export function ReviewJsonView({ item }: { item: ImportQuestionItem }) {
  return (
    <div className="space-y-3">
      {sections(item).map(({ title, accent, data }) => (
        <section key={title} className="animate-fade-up rounded-xl border border-border/60 bg-card/80 shadow-sm" style={{ animationDelay: "0.03s" }}>
          <details className="group" open>
            <summary className="flex cursor-pointer items-center gap-2.5 border-b border-border/30 px-4 py-3 text-xs font-semibold text-muted-foreground transition hover:text-foreground [&::-webkit-details-marker]:hidden">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-10" style={{ backgroundColor: accent }}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: accent }} />
              </span>
              {title}
              <span className="ml-auto inline-block text-[10px] transition-transform group-open:rotate-90 opacity-50">▶</span>
            </summary>
            <div className="px-4 pb-3 pt-2">
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border/50 bg-muted/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{JSON.stringify(data, null, 2)}</pre>
            </div>
          </details>
        </section>
      ))}
    </div>
  );
}
