import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { QuestionDetailDrawer } from "./question-detail-drawer";

function renderDrawer(overrides: Partial<Omit<Parameters<typeof QuestionDetailDrawer>[0], "children">> = {}) {
  const onClose = vi.fn();
  const props: Omit<Parameters<typeof QuestionDetailDrawer>[0], "children"> = {
    open: true,
      questionId: 7,
      editing: false,
      dirty: false,
      canWrite: true,
      canDelete: true,
      copyButton: createElement("button", { type: "button", "aria-label": "复制题干和选项" }),
      onBackToDetail: () => undefined,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onClose,
    ...overrides,
  };
  const element = createElement(
    QuestionDetailDrawer,
    props as Parameters<typeof QuestionDetailDrawer>[0],
    createElement("div", null, "drawer body"),
  );
  return { html: renderToStaticMarkup(element), onClose };
}

describe("QuestionDetailDrawer", () => {
  it("renders the overlay, dialog semantics, header, and body", () => {
    const drawer = renderDrawer();

    expect(drawer.html).toContain("drawer body");
    expect(drawer.html).toContain('aria-modal="true"');
    expect(drawer.html).toContain('tabindex="-1"');
    expect(drawer.html).toContain("题目详情");
    expect(drawer.html).toContain("复制题干和选项");
  });

  it("uses the edit label while editing", () => {
    expect(renderDrawer({ editing: true }).html).toContain("编辑题目");
  });

  it("renders nothing when closed or no question is selected", () => {
    expect(renderDrawer({ open: false }).html).toBe("");
    expect(renderDrawer({ questionId: null }).html).toBe("");
  });
});
