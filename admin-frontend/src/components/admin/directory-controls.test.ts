import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DirectoryPagination, DirectorySearch, FilterChip } from "./directory-controls";
import { DateRangePicker } from "@/components/ui/date-range-picker";

type Element = ReactElement<Record<string, unknown>>;

function findByLabel(node: unknown, label: string): Element | undefined {
  if (Array.isArray(node)) return node.map((item) => findByLabel(item, label)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.props["aria-label"] === label) return node;
  return findByLabel(node.props.children, label);
}

describe("shared directory controls", () => {
  it("labels the search and clears only through its callback", () => {
    const clear = vi.fn();
    const change = vi.fn();
    const tree = DirectorySearch({ value: "operator", onChange: change, onClear: clear, label: "搜索管理员", placeholder: "输入用户名、姓名或邮箱" });
    const input = findByLabel(tree, "搜索管理员")!;
    expect(input.props["aria-keyshortcuts"]).toBe("/");
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "new" } });
    expect(change).toHaveBeenCalledWith("new");
    (findByLabel(tree, "清空搜索")!.props.onClick as () => void)();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("shows the shortcut instead of a clear button for an empty search", () => {
    const tree = DirectorySearch({ value: "", onChange: vi.fn(), onClear: vi.fn(), label: "搜索普通用户", placeholder: "输入昵称、OpenID 或邮箱" });
    expect(findByLabel(tree, "清空搜索")).toBeUndefined();
    expect(renderToStaticMarkup(tree)).toContain("<kbd");
  });

  it("removes a named filter without coupling to either account type", () => {
    const remove = vi.fn();
    const tree = FilterChip({ label: "角色：管理员", onRemove: remove });
    (findByLabel(tree, "移除筛选：角色：管理员")!.props.onClick as () => void)();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("renders active page semantics and boundary buttons", () => {
    const tree = DirectoryPagination({ page: 1, totalPages: 3, items: [1, 2, 3], onPageChange: vi.fn(), label: "管理员列表分页" });
    expect(findByLabel(tree, "上一页")!.props.disabled).toBe(true);
    expect(findByLabel(tree, "下一页")!.props.disabled).toBe(false);
    expect(findByLabel(tree, "第 1 页")!.props["aria-current"]).toBe("page");
  });

  it("dispatches page changes and disables next on the final page", () => {
    const change = vi.fn();
    const tree = DirectoryPagination({ page: 8, totalPages: 8, items: [1, "ellipsis-left", 7, 8], onPageChange: change, label: "用户列表分页" });
    expect(findByLabel(tree, "下一页")!.props.disabled).toBe(true);
    (findByLabel(tree, "上一页")!.props.onClick as () => void)();
    (findByLabel(tree, "第 1 页")!.props.onClick as () => void)();
    expect(change.mock.calls).toEqual([[7], [1]]);
  });

  it("disables every navigation button while cached pages are being refreshed", () => {
    const tree = DirectoryPagination({ page: 2, totalPages: 3, items: [1, 2, 3], onPageChange: vi.fn(), label: "审计日志分页", disabled: true });
    for (const label of ["上一页", "下一页", "第 1 页", "第 2 页", "第 3 页"]) {
      expect(findByLabel(tree, label)!.props.disabled).toBe(true);
    }
  });

  it("lets Admin reuse the calendar without calling creation a registration", () => {
    const html = renderToStaticMarkup(createElement(DateRangePicker, { from: "", to: "", dateLabel: "创建日期", onChange: vi.fn() }));
    expect(html).toContain('aria-label="选择创建日期"');
    const ordinaryUser = renderToStaticMarkup(createElement(DateRangePicker, { from: "", to: "", onChange: vi.fn() }));
    expect(ordinaryUser).toContain('aria-label="选择注册日期"');
  });
});
