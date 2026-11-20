import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  root: { children: [] as HTMLElement[] },
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: () => ({ current: h.root }),
  useLayoutEffect: (effect: () => undefined | (() => void)) => {
    effect();
  },
}));

import { useStaggeredEntrance } from "./staggered-entrance";

class FakeElement {
  animate = vi.fn(() => ({
    cancel: vi.fn(),
    onfinish: null,
  }));
}

beforeEach(() => {
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  h.root = {
    children: Array.from({ length: 3 }, () => new FakeElement()) as unknown as HTMLElement[],
  };
});

describe("staggered spring entrance", () => {
  it("attaches a delayed sampled spring to each existing list child", () => {
    useStaggeredEntrance({
      ready: true,
      itemCount: h.root.children.length,
      animationKey: "page-1",
    });

    const animate = h.root.children[0].animate as ReturnType<typeof vi.fn>;
    expect(animate).toHaveBeenCalledTimes(1);
    expect(h.root.children[1].animate).toHaveBeenCalledTimes(1);
    expect(h.root.children[2].animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0].at(-1)).toMatchObject({
      opacity: 1,
      transform: "translate3d(0, 0px, 0)",
    });
    expect(animate.mock.calls[0][1]).toMatchObject({
      delay: 0,
      easing: "linear",
      fill: "backwards",
    });
  });

  it("caps stagger delay so long pages remain immediately usable", () => {
    h.root = {
      children: Array.from({ length: 20 }, () => new FakeElement()) as unknown as HTMLElement[],
    };

    useStaggeredEntrance({
      ready: true,
      itemCount: h.root.children.length,
      animationKey: "long-page",
    });

    const lastAnimate = h.root.children.at(-1)?.animate as ReturnType<typeof vi.fn>;
    expect(lastAnimate.mock.calls[0][1]).toMatchObject({ delay: 420 });
  });
});
