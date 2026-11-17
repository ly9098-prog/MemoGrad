import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent, DialogDescription } from "./dialog";
import { ConfirmDialog } from "./confirm-dialog";

const { useRefMock } = vi.hoisted(() => ({ useRefMock: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: useRefMock,
  useEffect: (effect: () => void) => effect(),
}));

class FocusTarget {
  isConnected = true;
  focus = vi.fn();
  querySelector = vi.fn<() => FocusTarget | null>(() => null);
}

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const trigger = new FocusTarget();
  const content = new FocusTarget();
  vi.stubGlobal("HTMLElement", FocusTarget);
  vi.stubGlobal("document", { activeElement: trigger });
  const onCancel = vi.fn();
  const root = ConfirmDialog({
    open: true,
    title: "确认删除",
    onConfirm: vi.fn(),
    onCancel,
    ...overrides,
  }) as ReactElement<ComponentProps<typeof Dialog>>;
  const dialog = root.props.children as ReactElement<ComponentProps<typeof DialogContent>>;
  (dialog.props.ref as { current: unknown }).current = content;
  return { trigger, content, root, dialog, onCancel };
}

beforeEach(() => {
  useRefMock.mockImplementation((initial: unknown) => ({ current: initial }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ConfirmDialog controlled focus", () => {
  it("restores the opener without requiring a DialogTrigger", () => {
    const { trigger, content, dialog } = renderDialog();
    const openEvent = new Event("openAutoFocus", { cancelable: true });
    dialog.props.onOpenAutoFocus?.(openEvent);
    expect(content.focus).toHaveBeenCalledOnce();
    expect(openEvent.defaultPrevented).toBe(true);

    const closeEvent = new Event("closeAutoFocus", { cancelable: true });
    dialog.props.onCloseAutoFocus?.(closeEvent);
    expect(trigger.focus).toHaveBeenCalledOnce();
    expect(closeEvent.defaultPrevented).toBe(true);
  });

  it("does not restore focus to an unmounted opener", () => {
    const { trigger, dialog } = renderDialog();
    dialog.props.onOpenAutoFocus?.(new Event("openAutoFocus"));
    trigger.isConnected = false;
    dialog.props.onCloseAutoFocus?.(new Event("closeAutoFocus"));
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("keeps the existing preferred autofocus target", () => {
    const { content, dialog } = renderDialog();
    const preferred = new FocusTarget();
    content.querySelector.mockReturnValue(preferred);
    dialog.props.onOpenAutoFocus?.(new Event("openAutoFocus"));
    expect(preferred.focus).toHaveBeenCalledOnce();
    expect(content.focus).not.toHaveBeenCalled();
  });

  it("does not dismiss while an operation is loading", () => {
    const { root, onCancel } = renderDialog({ loading: true });
    root.props.onOpenChange?.(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("lets Radix generate the description association", () => {
    const { dialog } = renderDialog({ description: "删除后无法恢复" });
    const children = dialog.props.children as ReactElement[];
    const description = children.find((child) => child?.type === DialogDescription);
    expect(dialog.props["aria-describedby"]).toBeUndefined();
    expect(description?.props).not.toHaveProperty("id");
  });
});
