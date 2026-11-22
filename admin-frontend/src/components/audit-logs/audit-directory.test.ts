import { createElement, isValidElement, type ReactElement, type MemoExoticComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogFilters, type AuditLogFiltersState } from "./audit-log-filters";
import { AuditLogList } from "./audit-log-list";
import { AuditLogItem } from "./audit-log-item";
import { DirectoryPagination, DirectorySearch, FilterChip } from "@/components/admin/directory-controls";
import { CustomSelect } from "@/components/ui/custom-select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ApiError } from "@/lib/api/errors";
import { localDateToUtcIso, localDateToUtcIsoNext } from "./date-utils";
import type { AuditLogListItem } from "@/lib/api/types";

type Element = ReactElement<Record<string, unknown>>;
const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: () => ({ current: null }),
  useEffect: (callback: () => void | (() => void)) => { effects.push(callback); },
}));
vi.mock("@/components/motion/staggered-entrance", () => ({ useStaggeredEntrance: () => ({ current: null }) }));

const emptyFilters: AuditLogFiltersState = {
  keyword: "", debouncedKeyword: "", severity: "", status: "", action: "", resourceType: "", dateFrom: "", dateTo: "",
};
const log: AuditLogListItem = {
  id: 12, operator_id: null, operator_name: null, action: "question.update", resource_type: "question",
  resource_id: "73", severity: "important", status: "failed", ip: "2001:db8::1", created_at: "2026-11-22T13:08:00Z",
  detail_summary: { subject_name: "数据结构", content_preview: "线性表的插入操作" }, error_message: "操作失败",
};
const listProps = () => ({
  data: { items: [log], total: 43, page: 1, page_size: 20, total_pages: 3 }, isLoading: false,
  isError: false, isFetching: false, error: null, page: 1, pageSize: 20, totalPages: 3,
  onPageChange: vi.fn(), onPageSizeChange: vi.fn(), onOpenDetail: vi.fn(), onRefresh: vi.fn(), onReset: vi.fn(), hasFilters: false,
});

function findAll(node: unknown, predicate: (element: Element) => boolean): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAll(child, predicate));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(predicate(node) ? [node] : []), ...findAll(node.props.children, predicate)];
}
function byType(node: unknown, type: unknown) {
  return findAll(node, (element) => element.type === type);
}

beforeEach(() => { effects.length = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("audit directory filters", () => {
  it("reuses the directory search, calendar and independently removable chips", () => {
    const change = vi.fn();
    const tree = AuditLogFilters({ filters: { ...emptyFilters, keyword: "题目", debouncedKeyword: "题目", status: "failed", severity: "important" }, onFilterChange: change, onReset: vi.fn() });
    expect(byType(tree, DirectorySearch)).toHaveLength(1);
    expect(byType(tree, DateRangePicker)[0].props.dateLabel).toBe("操作日期");
    const chips = byType(tree, FilterChip);
    expect(chips.map((chip) => chip.props.label)).toEqual(["关键词：题目", "级别：重要", "结果：失败"]);
    (chips[1].props.onRemove as () => void)();
    expect(change).toHaveBeenCalledWith({ severity: "" });
  });

  it("clears both search values and limits input to the existing 200 character contract", () => {
    const change = vi.fn();
    const tree = AuditLogFilters({ filters: emptyFilters, onFilterChange: change, onReset: vi.fn() });
    const search = byType(tree, DirectorySearch)[0];
    (search.props.onChange as (value: string) => void)("a".repeat(250));
    expect(change).toHaveBeenLastCalledWith({ keyword: "a".repeat(200) });
    (search.props.onClear as () => void)();
    expect(change).toHaveBeenLastCalledWith({ keyword: "", debouncedKeyword: "" });
  });

  it("debounces queries and cancels pending search when reset or unmounted", () => {
    vi.useFakeTimers();
    const change = vi.fn();
    AuditLogFilters({ filters: { ...emptyFilters, keyword: "old" }, onFilterChange: change, onReset: vi.fn() });
    const cleanup = effects.at(-1)!();
    vi.advanceTimersByTime(299);
    expect(change).not.toHaveBeenCalled();
    if (cleanup) cleanup();
    vi.advanceTimersByTime(100);
    expect(change).not.toHaveBeenCalled();
    AuditLogFilters({ filters: { ...emptyFilters, keyword: "new" }, onFilterChange: change, onReset: vi.fn() });
    effects.at(-1)!();
    vi.advanceTimersByTime(300);
    expect(change).toHaveBeenCalledWith({ debouncedKeyword: "new" });
  });

  it("keeps date selection and clearing atomic", () => {
    const change = vi.fn();
    const tree = AuditLogFilters({ filters: { ...emptyFilters, dateFrom: "2026-11-01", dateTo: "2026-11-22" }, onFilterChange: change, onReset: vi.fn() });
    (byType(tree, DateRangePicker)[0].props.onChange as (range: { from: string; to: string }) => void)({ from: "2026-11-02", to: "2026-11-03" });
    expect(change).toHaveBeenLastCalledWith({ dateFrom: "2026-11-02", dateTo: "2026-11-03" });
    (byType(tree, FilterChip)[0].props.onRemove as () => void)();
    expect(change).toHaveBeenLastCalledWith({ dateFrom: "", dateTo: "" });
    expect(localDateToUtcIso("2026-11-02")).toBe("2026-11-01T16:00:00.000Z");
    expect(localDateToUtcIsoNext("2026-11-03")).toBe("2026-11-03T16:00:00.000Z");
  });
});

describe("audit directory list", () => {
  it("renders a semantic table with readable resources, summaries and exact detail IDs", () => {
    const props = listProps();
    const html = renderToStaticMarkup(createElement(AuditLogList, props));
    expect(html).toContain('<th scope="col"');
    expect(html).toContain("关联资源");
    expect(html).toContain("数据结构");
    expect(html).toContain("系统操作");
    expect(html).toContain("操作失败");
    expect(html).toContain('aria-label="查看日志 #12 详情"');
    expect(html).not.toContain("by system");
  });

  it("reuses shared pagination and maps page size without changing the endpoint", () => {
    const props = listProps();
    const tree = AuditLogList(props);
    const pagination = byType(tree, DirectoryPagination)[0];
    expect(pagination.props.items).toEqual([1, 2, 3]);
    expect(pagination.props.onPageChange).toBe(props.onPageChange);
    (byType(tree, CustomSelect)[0].props.onChange as (value: string) => void)("50");
    expect(props.onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("does not hide cached data under a full-page loading state", () => {
    const html = renderToStaticMarkup(createElement(AuditLogList, { ...listProps(), isFetching: true }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("线性表");
    expect(html).toContain("更新中");
  });

  it("blocks stale pagination while a filter request is pending", () => {
    const tree = AuditLogList({ ...listProps(), isFetching: true });
    expect(byType(tree, DirectoryPagination)[0].props.disabled).toBe(true);
    expect(byType(AuditLogList(listProps()), DirectoryPagination)[0].props.disabled).toBe(false);
  });

  it("does not label a named historical operator without an ID as a system action", () => {
    const html = renderToStaticMarkup(createElement(AuditLogItem, { log: { ...log, operator_name: "retired-admin" }, onOpen: vi.fn() }));
    expect(html).toContain("retired-admin");
    expect(html).toContain("未记录 ID");
    expect(html).not.toContain("系统操作");
  });

  it("treats an absent ID and a blank operator name as a system action", () => {
    const html = renderToStaticMarkup(createElement(AuditLogItem, { log: { ...log, operator_name: "  " }, onOpen: vi.fn() }));
    expect(html).toContain(">系统</div>");
    expect(html).toContain("系统操作");
  });

  it("renders initial table skeletons without fake records", () => {
    const html = renderToStaticMarkup(createElement(AuditLogList, { ...listProps(), data: undefined, isLoading: true, isFetching: true }));
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("暂无审计日志");
    expect(html).not.toContain("共 43 条");
  });

  it.each([true, false])("keeps empty state and reset meaningful with filters=%s", (hasFilters) => {
    const props = listProps();
    const html = renderToStaticMarkup(createElement(AuditLogList, { ...props, data: { ...props.data, items: [], total: 0, total_pages: 0 }, totalPages: 0, hasFilters }));
    expect(html).toContain(hasFilters ? "未找到匹配的操作记录" : "暂无审计日志");
    expect(html.includes("清除筛选")).toBe(hasFilters);
    expect(html).toContain("第 1 / 1 页");
    expect(html).not.toContain('min-w-[1040px]');
  });

  it("shows structured permission errors and allows retry", () => {
    const props = { ...listProps(), isError: true, error: new ApiError(403, "Denied", null) };
    const tree = AuditLogList(props);
    expect(renderToStaticMarkup(tree)).toContain("权限不足，需要审计日志查看权限");
    const retry = findAll(tree, (element) => element.props.children === "重新加载")[0];
    (retry.props.onClick as () => void)();
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it("opens the same detail from both row actions without row click interception", () => {
    const open = vi.fn();
    const renderItem = (AuditLogItem as MemoExoticComponent<(props: { log: AuditLogListItem; onOpen: (id: number) => void }) => ReactElement>).type;
    const tree = renderItem({ log, onOpen: open });
    const actions = findAll(tree, (element) => typeof element.props["aria-label"] === "string");
    actions.forEach((action) => (action.props.onClick as () => void)());
    expect(open.mock.calls).toEqual([[12], [12]]);
  });
});
