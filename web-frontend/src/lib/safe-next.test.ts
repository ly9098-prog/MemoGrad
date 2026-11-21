import { describe, expect, it } from "vitest";
import {
  safeGithubLoginNext,
  safeUserNext,
} from "./safe-next";

describe("safeUserNext", () => {
  it("keeps internal login return paths", () => {
    expect(safeUserNext("/settings?tab=identities")).toBe(
      "/settings?tab=identities",
    );
    expect(safeUserNext("/settings")).toBe("/settings");
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil",
    "/bad\npath",
  ])("rejects unsafe return target %s", (value) => {
    expect(safeUserNext(value)).toBe("/");
  });

  it("keeps default GitHub login inside the user Web", () => {
    expect(safeGithubLoginNext(null)).toBe("/");
    expect(safeGithubLoginNext("https://evil.example")).toBe(
      "/",
    );
    expect(safeGithubLoginNext("/settings")).toBe("/settings");
  });
});
