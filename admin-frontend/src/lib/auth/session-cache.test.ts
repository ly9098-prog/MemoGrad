import { describe, expect, it } from "vitest";
import { sessionCacheKey, shouldClearSessionCache } from "./session-cache";

describe("admin session query cache", () => {
  it("builds a key that separates access modes and users", () => {
    expect(sessionCacheKey(null, "anonymous")).toBe("none:anonymous");
    expect(sessionCacheKey("admin", 1)).toBe("admin:1");
    expect(sessionCacheKey("user", 1)).toBe("user:1");
  });

  it("keeps the cache during the initial anonymous bootstrap", () => {
    expect(shouldClearSessionCache(null, "admin:1")).toBe(false);
    expect(shouldClearSessionCache("none:anonymous", "admin:1")).toBe(false);
  });

  it("clears the cache when the authenticated identity changes", () => {
    expect(shouldClearSessionCache("admin:1", "admin:2")).toBe(true);
    expect(shouldClearSessionCache("admin:1", "user:1")).toBe(true);
    expect(shouldClearSessionCache("admin:1", "none:anonymous")).toBe(true);
  });

  it("does not clear on an unchanged identity", () => {
    expect(shouldClearSessionCache("admin:1", "admin:1")).toBe(false);
  });
});
