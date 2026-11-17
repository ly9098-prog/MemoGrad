"use client";

import { BookOpen, Clock, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathFormula } from "@/components/ui/math-formula";
import type { AdminQuestion } from "@/lib/api/types";
import { looksLikeProgrammingCode } from "@/lib/math-text";
import { CustomCheckbox } from "./components/question-custom-checkbox";
import { DifficultyBadge } from "./components/question-difficulty-badge";
import { TypeBadge } from "./components/question-type-badge";
import { textForStemEditor } from "./question-content-editing";
import { QuestionListFeedback } from "./question-list-feedback";
import { QuestionListPagination } from "./question-list-pagination";
import { QuestionListToolbar } from "./question-list-toolbar";
import type { QuestionListFilters } from "./question-list-state";

type QuestionListCardProps = {
  items: AdminQuestion[];
  total?: number;
  page: number;
  totalPages: number;
  pageSize: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  hasActiveFilters: boolean;
  selectedQuestionId: number | null;
  selectedIds: Set<number>;
  allChecked: boolean;
  filters: QuestionListFilters;
  exportOpen: boolean;
  exportingFormat: "csv" | "docx" | null;
  exportMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleAll: () => void;
  onToggleOne: (id: number) => void;
  onSelectQuestion: (id: number) => void;
  onOpenDetail: (id: number) => void;
  onPrefetchDetail: (id: number) => void;
  onToggleExportMenu: () => void;
  onExport: (format: "csv" | "docx") => void;
  onResetFilters: () => void;
  onRetry: () => void;
  onPageSizeChange: (value: string) => void;
  onSetPage: (page: number) => void;
};

function ListLoading() {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex h-[84px] animate-pulse items-center gap-3 px-4 py-2.5 motion-reduce:animate-none">
          <div className="h-4 w-4 shrink-0 rounded bg-secondary" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-2.5 w-1/3 rounded bg-secondary" />
            <div className="h-3 w-4/5 rounded bg-secondary" />
            <div className="h-2 w-1/2 rounded bg-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuestionListItem({
  question,
  selected,
  checked,
  onPrefetch,
  onToggle,
  onSelect,
  onOpenDetail,
}: {
  question: AdminQuestion;
  selected: boolean;
  checked: boolean;
  onPrefetch: () => void;
  onToggle: () => void;
  onSelect: () => void;
  onOpenDetail: () => void;
}) {
  const stemText = textForStemEditor(question.content) || `题目 #${question.id}`;

  return (
    <article
      onMouseEnter={onPrefetch}
      className={`group relative transition-colors last:rounded-b-[17px] ${
        selected
          ? "bg-accent/45 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-r-full before:bg-primary"
          : "bg-card hover:bg-secondary/35"
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-2.5">
        <CustomCheckbox checked={checked} onChange={onToggle} className="mt-1" />

        <div className="min-w-0 flex-1">
          <button type="button" onClick={onSelect} className="w-full text-left">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-[5px] bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                #{String(question.id).padStart(4, "0")}
              </span>
              <TypeBadge type={question.question_type} />
              <DifficultyBadge difficulty={question.difficulty} />
              <span
                className={`inline-flex items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-medium ${
                  question.is_active
                    ? "bg-success-light text-success"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {question.is_active ? "已启用" : "已停用"}
              </span>
            </div>

            <div className="mt-1 line-clamp-1 text-[13px] font-medium leading-5 text-foreground">
              {looksLikeProgrammingCode(stemText) ? stemText : <MathFormula text={stemText} />}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              {question.subject_name || question.subject_code ? (
                <span className="inline-flex items-center gap-1">
                  <BookOpen className="h-3 w-3" aria-hidden="true" />
                  {question.subject_name || question.subject_code}
                </span>
              ) : null}
              {question.year ? (
                <span className="inline-flex items-center gap-1">
                  <Tag className="h-3 w-3" aria-hidden="true" />
                  {question.year} 年
                </span>
              ) : null}
              {question.updated_at ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  更新于 {question.updated_at.slice(0, 16).replace("T", " ")}
                </span>
              ) : null}
            </div>
          </button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenDetail}
          className="mt-0.5 h-8 rounded-[8px] px-2.5 text-[11px] text-muted-foreground transition-colors group-hover:bg-secondary/50 group-hover:text-foreground"
        >
          详情
        </Button>
      </div>
    </article>
  );
}

export function QuestionListCard({
  items,
  total,
  page,
  totalPages,
  pageSize,
  isLoading,
  isFetching,
  isError,
  hasActiveFilters,
  selectedQuestionId,
  selectedIds,
  allChecked,
  filters,
  exportOpen,
  exportingFormat,
  exportMenuRef,
  onToggleAll,
  onToggleOne,
  onSelectQuestion,
  onOpenDetail,
  onPrefetchDetail,
  onToggleExportMenu,
  onExport,
  onResetFilters,
  onRetry,
  onPageSizeChange,
  onSetPage,
}: QuestionListCardProps) {
  return (
    <section className="admin-table-surface min-w-0 overflow-visible rounded-[18px]">
      <QuestionListToolbar
        itemCount={items.length}
        total={total}
        isFetching={isFetching}
        isLoading={isLoading}
        hasActiveFilters={hasActiveFilters}
        selectedCount={selectedIds.size}
        allChecked={allChecked}
        exportOpen={exportOpen}
        exportingFormat={exportingFormat}
        exportMenuRef={exportMenuRef}
        onToggleAll={onToggleAll}
        onToggleExportMenu={onToggleExportMenu}
        onExport={onExport}
      />

      <div className={`transition-opacity duration-200 ${isFetching && !isLoading ? "opacity-70" : "opacity-100"}`}>
        {isLoading ? <ListLoading /> : null}

        <div
          key={`${filters.subject_id}-${filters.question_type}-${filters.is_active}-${filters.year}-${filters.difficulty}-${filters.keyword}-${filters.import_batch_id}-${filters.knowledge_point_id}-${page}-${pageSize}`}
          className="divide-y divide-border"
        >
          {items.map((question) => (
            <QuestionListItem
              key={question.id}
              question={question}
              selected={selectedQuestionId === question.id}
              checked={selectedIds.has(question.id)}
              onPrefetch={() => onPrefetchDetail(question.id)}
              onToggle={() => onToggleOne(question.id)}
              onSelect={() => onSelectQuestion(question.id)}
              onOpenDetail={() => onOpenDetail(question.id)}
            />
          ))}
        </div>

        <QuestionListFeedback
          emptyVisible={!isLoading && !isError && items.length === 0}
          isError={isError}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={onResetFilters}
          onRetry={onRetry}
        />
      </div>

      <QuestionListPagination
        visible={totalPages > 1}
        total={total ?? 0}
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        isFetching={isFetching}
        onPageSizeChange={onPageSizeChange}
        onSetPage={onSetPage}
      />
    </section>
  );
}
