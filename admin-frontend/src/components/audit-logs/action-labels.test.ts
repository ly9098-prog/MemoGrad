import { describe, expect, it } from "vitest";

import { operatorLabel } from "./action-labels";

describe("operatorLabel", () => {
  it("prefers the operator name over the numeric id", () => {
    expect(operatorLabel("admin", 1)).toBe("admin");
  });

  it("falls back to the id when the name is missing", () => {
    expect(operatorLabel(null, 7)).toBe("#7");
  });

  it("ignores a blank name and falls back to the id", () => {
    expect(operatorLabel("   ", 3)).toBe("#3");
  });

  it("uses system when neither name nor id exists", () => {
    expect(operatorLabel(null, null)).toBe("system");
  });
});
