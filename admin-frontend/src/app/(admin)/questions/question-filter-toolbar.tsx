"use client";

import type { ReactNode, RefObject } from "react";
import { ChevronDown, Loader2, RotateCcw, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { QUESTION_TYPE_OPTIONS } from "@/lib/question-types";
import type { QuestionSubjectOption } from "./hooks/use-question-subject-options";
import type { QuestionMenuKind } from "./hooks/use-question-menus";
import type { QuestionListFilters } from "./question-list-state";

const activeOptions = [
  { label: "全部状态", value: "" },
  { label: "启用", value: "true" },
  { label: "停用", value: "false" },
];

const difficultyOptions = [
  { label: "全部难度", value: "" },
  { label: "简单", value: "1" },
  { label: "较易", value: "2" },
  { label: "中等", value: "3" },
  { label: "较难", value: "4" },
  { label: "困难", value: "5" },
];

type QuestionFilterToolbarProps = {
  filters: QuestionListFilters;
  subjectOptions: QuestionSubjectOption[];
  keywordInput: string;
  importBatchInput: string;
  searchDebouncing: boolean;
  listFetching: boolean;
  hasActiveFilters: boolean;
  commonFilterOpen: boolean;
  moreFilterOpen: boolean;
  commonFilterRef: RefObject<HTMLDivElement | null>;
  moreFilterRef: RefObject<HTMLDivElement | null>;
  onKeywordChange: (value: string) => void;
  onResetFilters: () => void;
  onToggleMenu: (key: QuestionMenuKind) => void;
  onApplyFilterPreset: (preset: Partial<QuestionListFilters>) => void;
  onApplySavedFilters: () => void;
  onSaveCurrentFilters: (filters: QuestionListFilters) => void;
  onFilterChange: <K extends keyof QuestionListFilters>(key: K, value: QuestionListFilters[K]) => void;
  onImportBatchChange: (value: string) => void;
};

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-10 min-w-0 items-center gap-2 rounded-[9px] bg-secondary/50 px-3 transition-colors focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/15">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function QuestionFilterToolbar({
  filters,
  subjectOptions,
  keywordInput,
  importBatchInput,
  searchDebouncing,
  listFetching,
  hasActiveFilters,
  commonFilterOpen,
  moreFilterOpen,
  commonFilterRef,
  moreFilterRef,
  onKeywordChange,
  onResetFilters,
  onToggleMenu,
  onApplyFilterPreset,
  onApplySavedFilters,
  onSaveCurrentFilters,
  onFilterChange,
  onImportBatchChange,
}: QuestionFilterToolbarProps) {
  return (
    <div className="relative z-20 space-y-3">
      <section className="overflow-visible rounded-[18px] border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] bg-secondary/50 px-3 transition-colors focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/15">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              aria-label="搜索题目"
              className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:outline-none"
              placeholder="搜索题干 / 科目 / 题目编号"
              value={keywordInput}
              onChange={(event) => onKeywordChange(event.target.value)}
            />
            <div className="flex shrink-0 items-center gap-1">
              {searchDebouncing || (listFetching && Boolean(filters.keyword)) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="正在搜索" />
              ) : null}
              {keywordInput ? (
                <button
                  type="button"
                  onClick={() => onKeywordChange("")}
                  className="grid h-7 w-7 place-items-center rounded-[7px] text-muted-foreground transition hover:bg-card hover:text-foreground"
                  aria-label="清空搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <div ref={commonFilterRef} className="relative shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onToggleMenu("isCommonFilterOpen")}
                aria-expanded={commonFilterOpen}
                aria-haspopup="menu"
                className="h-9 rounded-[9px] border-border bg-card px-3 text-[11px] font-medium"
              >
                常用筛选
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition ${commonFilterOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </Button>
              {commonFilterOpen ? (
                <div className="absolute left-0 top-full z-30 mt-2 min-w-[176px] animate-drop-in overflow-hidden rounded-[12px] border border-border bg-popover p-1.5 shadow-[var(--shadow-floating)]">
                  <button
                    type="button"
                    onClick={() => onApplyFilterPreset({})}
                    className="flex w-full rounded-[8px] px-3 py-2 text-left text-[12px] text-foreground transition hover:bg-secondary/60"
                  >
                    全部有效题目
                  </button>
                  <button
                    type="button"
                    onClick={() => onApplyFilterPreset({ is_active: "true" })}
                    className="flex w-full rounded-[8px] px-3 py-2 text-left text-[12px] text-foreground transition hover:bg-secondary/60"
                  >
                    仅看已启用
                  </button>
                  <button
                    type="button"
                    onClick={() => onApplyFilterPreset({ difficulty: "5" })}
                    className="flex w-full rounded-[8px] px-3 py-2 text-left text-[12px] text-foreground transition hover:bg-secondary/60"
                  >
                    困难题目
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    onClick={onApplySavedFilters}
                    className="flex w-full rounded-[8px] px-3 py-2 text-left text-[12px] text-foreground transition hover:bg-secondary/60"
                  >
                    已保存筛选
                  </button>
                </div>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSaveCurrentFilters(filters)}
              className="h-9 rounded-[9px] px-3 text-[11px] font-medium"
            >
              <Star className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              保存筛选
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              disabled={!hasActiveFilters}
              className="h-9 rounded-[9px] px-3 text-[11px] font-medium text-muted-foreground disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              重置
            </Button>
          </div>
        </div>

        <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-[1.08fr_1fr_1fr_0.82fr_1fr_auto]">
          <FilterField label="科目">
            <CustomSelect
              className="h-8 rounded-md !border-0 !bg-transparent pl-0 pr-1 text-[12px] shadow-none !ring-0 hover:!border-transparent"
              value={filters.subject_id}
              onChange={(value) => onFilterChange("subject_id", value)}
              options={[
                { label: "全部科目", value: "" },
                ...subjectOptions.map((subject) => ({
                  label: subject.name,
                  value: String(subject.id),
                })),
              ]}
            />
          </FilterField>

          <FilterField label="题型">
            <CustomSelect
              className="h-8 rounded-md !border-0 !bg-transparent pl-0 pr-1 text-[12px] shadow-none !ring-0 hover:!border-transparent"
              placeholder="全部题型"
              value={filters.question_type}
              onChange={(value) => onFilterChange("question_type", value)}
              options={QUESTION_TYPE_OPTIONS}
            />
          </FilterField>

          <FilterField label="状态">
            <CustomSelect
              className="h-8 rounded-md !border-0 !bg-transparent pl-0 pr-1 text-[12px] shadow-none !ring-0 hover:!border-transparent"
              value={filters.is_active}
              onChange={(value) => onFilterChange("is_active", value)}
              options={activeOptions}
            />
          </FilterField>

          <FilterField label="年份">
            <input
              inputMode="numeric"
              aria-label="年份"
              className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 text-[12px] text-foreground outline-none shadow-none placeholder:text-muted-foreground focus:border-0 focus:outline-none focus:ring-0"
              placeholder="选择年份"
              value={filters.year}
              maxLength={4}
              onChange={(event) =>
                onFilterChange("year", event.target.value.replace(/\D/g, "").slice(0, 4))
              }
            />
          </FilterField>

          <FilterField label="难度">
            <CustomSelect
              className="h-8 rounded-md !border-0 !bg-transparent pl-0 pr-1 text-[12px] shadow-none !ring-0 hover:!border-transparent"
              value={filters.difficulty}
              onChange={(value) => onFilterChange("difficulty", value)}
              options={difficultyOptions}
            />
          </FilterField>

          <div ref={moreFilterRef} className="relative">
            <button
              type="button"
              onClick={() => onToggleMenu("isMoreFilterOpen")}
              aria-expanded={moreFilterOpen}
              aria-haspopup="dialog"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-secondary/50 px-3 text-[11px] font-medium text-foreground transition hover:bg-secondary/80 xl:w-auto"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              更多条件
            </button>
            {moreFilterOpen ? (
              <div className="absolute right-0 top-full z-30 mt-2 w-[min(300px,calc(100vw_-_2.5rem))] animate-drop-in rounded-[12px] border border-border bg-popover p-3 shadow-[var(--shadow-floating)]">
                <p className="text-[11px] font-medium text-muted-foreground">导入批次 ID</p>
                <Input
                  className="mt-2 h-9 rounded-[8px] border-border bg-card px-3 text-[12px]"
                  placeholder="输入批次 ID 片段"
                  value={importBatchInput}
                  onChange={(event) => onImportBatchChange(event.target.value)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {filters.knowledge_point_id ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-primary/20 bg-accent px-4 py-2 text-[12px] text-accent-foreground">
          <span className="font-semibold">覆盖率跳转筛选</span>
          <span>知识点 #{filters.knowledge_point_id}</span>
          <button
            type="button"
            className="rounded-[7px] px-2 py-1 text-[11px] font-semibold transition hover:bg-card/70"
            onClick={() => onFilterChange("knowledge_point_id", "")}
          >
            清除
          </button>
        </div>
      ) : null}
    </div>
  );
}
