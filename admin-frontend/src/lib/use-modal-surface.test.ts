import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  shouldHandleModalEscape,
  type ModalEscapeInput,
} from "./use-modal-surface";

const base: ModalEscapeInput = {
  key: "Escape",
  defaultPrevented: false,
  hasOnEscape: true,
  escapeDisabled: false,
  targetOwnsTransientOverlay: false,
  hasTransientOverlay: false,
  isTopModal: true,
};

describe("shouldHandleModalEscape", () => {
  it("accepts Escape only when every modal-ownership condition is clear", () => {
    expect(shouldHandleModalEscape(base)).toBe(true);
  });

  it.each([
    ["non-Escape key", { key: "Tab" }],
    ["already prevented", { defaultPrevented: true }],
    ["no Escape handler", { hasOnEscape: false }],
    ["Escape disabled", { escapeDisabled: true }],
    ["target owns a transient overlay", { targetOwnsTransientOverlay: true }],
    ["another transient overlay is open", { hasTransientOverlay: true }],
    ["surface is not the top modal", { isTopModal: false }],
  ] as const)("rejects %s", (_name, override) => {
    expect(shouldHandleModalEscape({ ...base, ...override })).toBe(false);
  });

  it("keeps the hook wired to the tested decision helper", () => {
    const source = readFileSync(new URL("./use-modal-surface.ts", import.meta.url), "utf8");

    expect(source).toContain("shouldHandleModalEscape({");
    expect(source).toContain("hasTransientOverlay: hasOpenTransientOverlay()");
  });
});
