import { afterEach, describe, expect, it, vi } from "vitest";
import { hasOpenTransientOverlay } from "./modal-focus";

function overlayWithRects(count: number): HTMLElement {
  return {
    getClientRects: () => Array.from({ length: count }, () => ({})),
  } as unknown as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hasOpenTransientOverlay", () => {
  it("returns false when no transient overlay exists", () => {
    vi.stubGlobal("document", {
      querySelectorAll: () => [],
    });

    expect(hasOpenTransientOverlay()).toBe(false);
  });

  it("ignores hidden overlays", () => {
    vi.stubGlobal("document", {
      querySelectorAll: () => [overlayWithRects(0), overlayWithRects(0)],
    });

    expect(hasOpenTransientOverlay()).toBe(false);
  });

  it("returns true when a visible overlay exists", () => {
    vi.stubGlobal("document", {
      querySelectorAll: () => [overlayWithRects(0), overlayWithRects(1)],
    });

    expect(hasOpenTransientOverlay()).toBe(true);
  });
});
