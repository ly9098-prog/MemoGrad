"use client";

import { useEffect, useRef } from "react";
import { ListFilter, RotateCcw } from "lucide-react";
import { DirectorySearch, FilterChip, useDirectorySearchShortcut } from "@/components/admin/directory-controls";
import { Button } from "@/components/ui/button";
import { CustomSelect, type SelectOption } from "@/components/ui/custom-select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ACTION_LABELS, SEVERITY_LABELS, STATUS_LABELS, RESOURCE_TYPE_LABELS } from "./action-labels";

const SEVERITY_OPTIONS: SelectOption[] = [
  { value: "", label: "全部级别" },
  ...Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label })),
];
const ACTION_OPTIONS: SelectOption[] = [
  { value: "", label: "全部操作" },
  ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label, suffix: value })),
];
const RESOURCE_OPTIONS: SelectOption[] = [
  { value: "", label: "全部资源" },
  ...Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => ({ value, label, suffix: value })),
];

export type AuditLogFiltersState = {
  keyword: string;
  debouncedKeyword: string;
  severity: string;
  status: string;
  action: string;
  resourceType: string;
  dateFrom: string;
  dateTo: string;
};

export type AuditLogFiltersProps = {
  filters: AuditLogFiltersState;
  onFilterChange: (patch: Partial<AuditLogFiltersState>) => void;
  onReset: () => void;
};

export function AuditLogFilters({ filters, onFilterChange, onReset }: AuditLogFiltersProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  useDirectorySearchShortcut(searchRef);
  const { keyword, debouncedKeyword, action, resourceType, severity, status, dateFrom, dateTo } = filters;

  useEffect(() => {
    if (keyword === debouncedKeyword) return;
    const timer = setTimeout(() => onFilterChange({ debouncedKeyword: keyword }), 300);
    return () => clearTimeout(timer);
  }, [keyword, debouncedKeyword, onFilterChange]);

  const clearKeyword = () => onFilterChange({ keyword: "", debouncedKeyword: "" });
  const chips = [
    keyword && { label: `关键词：${keyword}`, remove: clearKeyword },
    action && { label: `操作：${ACTION_LABELS[action] || action}`, remove: () => onFilterChange({ action: "" }) },
    resourceType && { label: `资源：${RESOURCE_TYPE_LABELS[resourceType] || resourceType}`, remove: () => onFilterChange({ resourceType: "" }) },
    severity && { label: `级别：${SEVERITY_LABELS[severity] || severity}`, remove: () => onFilterChange({ severity: "" }) },
    status && { label: `结果：${STATUS_LABELS[status] || status}`, remove: () => onFilterChange({ status: "" }) },
    (dateFrom || dateTo) && { label: `日期：${dateFrom || "不限"} — ${dateTo || "不限"}`, remove: () => onFilterChange({ dateFrom: "", dateTo: "" }) },
  ].filter((chip): chip is { label: string; remove: () => void } => Boolean(chip));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="min-w-0 flex-1 xl:max-w-[400px]">
          <DirectorySearch inputRef={searchRef} label="搜索审计日志" placeholder="输入操作、资源、操作人或资源 ID" value={keyword}
            onChange={(value) => value ? onFilterChange({ keyword: value.slice(0, 200) }) : clearKeyword()} onClear={clearKeyword} />
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3 xl:ml-auto xl:max-w-[600px]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <CustomSelect aria-label="筛选操作类型" value={action} onChange={(value) => onFilterChange({ action: value })}
              options={ACTION_OPTIONS} searchable searchPlaceholder="输入操作名称或标识" className="h-10 w-full bg-card text-xs" />
          </div>
          <CustomSelect aria-label="筛选资源类型" value={resourceType} onChange={(value) => onFilterChange({ resourceType: value })}
            options={RESOURCE_OPTIONS} searchable searchPlaceholder="输入资源名称或标识" className="h-10 w-full bg-card text-xs" />
          <CustomSelect aria-label="筛选日志级别" value={severity} onChange={(value) => onFilterChange({ severity: value })}
            options={SEVERITY_OPTIONS} className="h-10 w-full bg-card text-xs" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2.5">
        <DateRangePicker from={dateFrom} to={dateTo} dateLabel="操作日期" placeholder="选择操作日期范围" className="min-w-0 flex-1 sm:flex-none"
          onChange={({ from, to }) => onFilterChange({ dateFrom: from, dateTo: to })} />
        <Button variant="ghost" size="sm" disabled={!chips.length} onClick={onReset} className="h-10 self-end px-3 text-xs">
          <RotateCcw className="h-3.5 w-3.5" />重置筛选
        </Button>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><ListFilter className="h-3.5 w-3.5" />筛选条件</span>
          {chips.map((chip) => <FilterChip key={chip.label} label={chip.label} onRemove={chip.remove} />)}
        </div>
      )}
    </div>
  );
}
