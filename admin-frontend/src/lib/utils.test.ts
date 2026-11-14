import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps class precedence for shared utilities", () => {
    expect(cn("px-2 text-sm", "px-4 text-base")).toBe("px-4 text-base");
  });

  it("merges conflicting arbitrary color utilities", () => {
    expect(cn("bg-[var(--color-primary)]", "bg-white")).toBe("bg-white");
    expect(cn("text-[var(--color-text-secondary)]", "text-[var(--color-danger)]")).toBe(
      "text-[var(--color-danger)]",
    );
  });

  it("preserves conditional and non-conflicting classes", () => {
    expect(cn("rounded-xl", false && "hidden", ["border", undefined])).toBe("rounded-xl border");
  });
});
