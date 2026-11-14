import { createElement } from "react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyPortal } from "./body-portal";

vi.mock("react-dom", () => ({
  createPortal: vi.fn((node: unknown, target: unknown) => ({ node, target })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("BodyPortal", () => {
  it("renders in place when document is unavailable", () => {
    vi.stubGlobal("document", undefined);
    const child = createElement("div", null, "内容");

    expect(BodyPortal({ children: child })).toBe(child);
  });

  it("portals content to document.body in the browser", () => {
    const body = { tagName: "BODY" };
    const child = createElement("div", null, "内容");
    vi.stubGlobal("document", { body });

    expect(BodyPortal({ children: child })).toEqual({ node: child, target: body });
    expect(createPortal).toHaveBeenCalledWith(child, body);
  });
});
