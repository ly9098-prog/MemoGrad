import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import KnowledgeGraphWorkspace from "./graph-workspace";

type Element = ReactElement<Record<string, unknown>>;
const state = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useMemo: (compute: () => unknown) => compute(),
  useRef: (current: unknown) => {
    const ref = { current };
    state.refs.push(ref);
    return ref;
  },
  useState: (initial: unknown) => [initial, vi.fn()],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false }),
}));

function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = find(child, predicate);
      if (match) return match;
    }
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node) ? node : find(node.props.children, predicate);
}

function renderWorkspace(): Element {
  state.refs = [];
  return KnowledgeGraphWorkspace() as Element;
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("document", {
    fullscreenElement: null,
    exitFullscreen: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("knowledge graph fullscreen", () => {
  it("requests native fullscreen on the workspace element", async () => {
    const tree = renderWorkspace();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    state.refs[1].current = { requestFullscreen };
    const fullscreenButton = find(
      tree,
      (element) => element.type === Button && element.props["aria-label"] === "全屏",
    )!;

    await (fullscreenButton.props.onClick as () => Promise<void>)();

    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it("exits native fullscreen when the document is already fullscreen", async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("document", { fullscreenElement: {}, exitFullscreen });
    const tree = renderWorkspace();
    const fullscreenButton = find(
      tree,
      (element) => element.type === Button && element.props["aria-label"] === "全屏",
    )!;

    await (fullscreenButton.props.onClick as () => Promise<void>)();

    expect(exitFullscreen).toHaveBeenCalledOnce();
  });
});
