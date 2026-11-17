import { Fragment, isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KnowledgeGraphPage from "./page";
import { BodyPortal } from "@/components/ui/body-portal";

type Element = ReactElement<Record<string, unknown>>;
const state = vi.hoisted(() => ({ index: 0, mode: "none" }));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useMemo: (compute: () => unknown) => compute(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [state.index++ === 11 ? state.mode : initial, vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
}));

function findPanelContainer(node: unknown): Element | undefined {
  if (Array.isArray(node)) {
    return node.map(findPanelContainer).find(Boolean);
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (node.type === BodyPortal || node.type === Fragment) return node;
  return findPanelContainer(node.props.children);
}

beforeEach(() => {
  state.index = 0;
  state.mode = "none";
});

describe("knowledge graph fullscreen placement", () => {
  it("portals the fallback panel outside the animated page container", () => {
    state.mode = "overlay";
    const container = findPanelContainer(KnowledgeGraphPage())!;
    expect(container.type).toBe(BodyPortal);
    const panel = container.props.children as Element;
    expect(panel.type).toBe("section");
    expect(panel.props.className).toContain("fixed inset-3");
    expect(panel.props.className).toContain("100dvh");
  });

  it.each(["none", "native"])("keeps the %s panel in place", (mode) => {
    state.mode = mode;
    const container = findPanelContainer(KnowledgeGraphPage())!;
    expect(container.type).toBe(Fragment);
    expect((container.props.children as Element).props.className).not.toContain("fixed");
  });
});
