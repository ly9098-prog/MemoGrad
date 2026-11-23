import { describe, expect, it } from "vitest";
import { isLearnerPath } from "./learner-routes";
import { safeLearnerNext } from "./auth/learner-next";

describe("ordinary-user read-only navigation", () => {
  it.each([
    "/dashboard",
    "/practice",
    "/mistakes",
    "/formulas",
    "/account/settings",
    "/questions/7",
  ])("allows %s", (path) => {
    expect(isLearnerPath(path)).toBe(true);
    expect(safeLearnerNext(`${path}?from=login`)).toBe(`${path}?from=login`);
  });

  it.each([
    "/workbench",
    "/formulas/new",
    "/formulas/7",
    "/formulas/categories",
    "/app-users",
    "//evil.example/formulas",
  ])("blocks management paths %s", (path) => {
    expect(isLearnerPath(path)).toBe(false);
    expect(safeLearnerNext(path)).toBe("/dashboard");
  });

  it.each([undefined, null, "", "https://evil.example", "/\\evil.example", "/account\n/settings"])("uses the shared home for missing or unsafe destinations (%s)", (path) => {
    expect(safeLearnerNext(path)).toBe("/dashboard");
  });
});
