import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { ReviewFilterToolbar } from "./review-filter-toolbar";
import { createDefaultReviewFilters } from "../review-query-state";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => ({ current: null }),
}));
vi.mock("@/lib/use-outside-click", () => ({ useOutsideClick: () => {} }));

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const e = node as Element;
  return [e, ...elements(e.props.children as ReactNode)];
}

for (const [label, key, option] of [
  ["风险", "risk", "high"],
  ["答案", "answerStatus", "missing"],
] as const) {
  describe(`${label}筛选`, () => {
    it("点击能打开菜单，选择选项只分发一次并关闭", () => {
      const onDropdownChange = vi.fn();
      const onFilterChange = vi.fn();
      const state = {
        risk: false,
        answerStatus: false,
        subject: false,
        batch: false,
        status: false,
      };
      const render = () =>
        ReviewFilterToolbar({
          filters: createDefaultReviewFilters(),
          batchIdParam: "",
          subjectOptions: [],
          leafSubjectOptions: [],
          batches: [],
          batchesLoading: false,
          dropdownState: state,
          subjectButtonRef: { current: null },
          batchDropdownRef: { current: null },
          onKeywordChange: vi.fn(),
          onFilterChange,
          onReset: vi.fn(),
          onDropdownChange,
        });
      const dropdown = elements(render()).find((e) => e.props.label === label)!;
      const control = (dropdown.type as (props: unknown) => ReactNode)(
        dropdown.props,
      );
      const trigger = elements(control).find(
        (e) => e.props["aria-label"] === label,
      )!;
      (trigger.props.onClick as () => void)();
      expect(onDropdownChange).toHaveBeenCalledWith(key, true);
      state[key] = true;
      const opened = elements(render()).find((e) => e.props.label === label)!;
      const menu = (opened.type as (props: unknown) => ReactNode)(opened.props);
      const choice = elements(menu).find((e) => e.key === option)!;
      (choice.props.onClick as () => void)();
      expect(onFilterChange).toHaveBeenCalledTimes(1);
      expect(onFilterChange).toHaveBeenCalledWith(
        key === "risk" ? "risk_level" : "answer_status",
        option,
      );
      expect(onDropdownChange).toHaveBeenCalledWith(key, false);
    });
  });
}

it("URL 批次的叉号清空筛选并关闭菜单", () => {
  const onFilterChange = vi.fn();
  const onDropdownChange = vi.fn();
  const tree = ReviewFilterToolbar({
    filters: createDefaultReviewFilters(), batchIdParam: "url-batch",
    subjectOptions: [], leafSubjectOptions: [], batches: [], batchesLoading: false,
    dropdownState: { risk: false, answerStatus: false, subject: false, batch: true, status: false },
    subjectButtonRef: { current: null }, batchDropdownRef: { current: null },
    onKeywordChange: vi.fn(), onFilterChange, onReset: vi.fn(), onDropdownChange,
  });
  const clear = elements(tree).find(e => e.props["aria-label"] === "清空批次")!;
  expect(clear).toBeDefined();
  (clear.props.onClick as () => void)();
  expect(onFilterChange).toHaveBeenCalledExactlyOnceWith("batch_id", "");
  expect(onDropdownChange).toHaveBeenCalledExactlyOnceWith("batch", false);
});
