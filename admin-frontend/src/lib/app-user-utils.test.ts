import { describe, it, expect } from "vitest";
import {
  csvEscape,
  buildUserCsvHeader,
  buildUserCsvRow,
  filterBatchActionCandidates,
  noCandidatesMessage,
  buildPagination,
  buildPageRange,
  statusToQueryValue,
  endOfChinaDateUtcIso,
  identityProviderLabel,
  summarizeIdentityProviders,
  userIdentitySubtitle,
  type AppUserLike,
} from "./app-user-utils";

const baseUser: AppUserLike = {
  id: 1, nickname: "Test", openid: "abc123",
  is_banned: false, banned_reason: null, banned_at: null, created_at: "2024-01-01T00:00:00Z",
};

describe("csvEscape", () => {
  it("wraps string in quotes", () => {
    expect(csvEscape("hello")).toBe('"hello"');
  });
  it("doubles internal quotes", () => {
    expect(csvEscape('he"llo')).toBe('"he""llo"');
  });
  it("returns empty quotes for null", () => {
    expect(csvEscape(null)).toBe('""');
  });
  it("returns empty quotes for undefined", () => {
    expect(csvEscape(undefined)).toBe('""');
  });
  it("converts number to string", () => {
    expect(csvEscape(42)).toBe('"42"');
  });
  it("handles empty string", () => {
    expect(csvEscape("")).toBe('""');
  });
  it("handles comma in value", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
  });
});

describe("buildUserCsvHeader", () => {
  it("returns 11 columns including the latest activity timestamp", () => {
    expect(buildUserCsvHeader()).toHaveLength(11);
    expect(buildUserCsvHeader()[6]).toBe("最近活跃时间（北京时间）");
  });
  it("includes ID and 昵称", () => {
    const h = buildUserCsvHeader();
    expect(h[0]).toBe("ID");
    expect(h[1]).toBe("昵称");
  });
});

describe("buildUserCsvRow", () => {
  const fmt = (v: string | null | undefined) => v || "";
  it("builds row for unbanned user", () => {
    const row = buildUserCsvRow(baseUser, fmt);
    expect(row[3]).toBe("未知");
    expect(row[4]).toBe("");
    expect(row[5]).toBe("");
    expect(row[6]).toBe("");
    expect(row[7]).toBe("正常");
    expect(row[9]).toBe("");
  });
  it("builds row for banned user", () => {
    const row = buildUserCsvRow({ ...baseUser, is_banned: true, banned_reason: "spam", banned_at: "2024-06-01T00:00:00Z" }, fmt);
    expect(row[7]).toBe("已封禁");
    expect(row[8]).toBe("spam");
    expect(row[9]).toBe("2024-06-01T00:00:00Z");
  });
  it("builds client boundary columns", () => {
    const row = buildUserCsvRow({
      ...baseUser,
      user_type: "both",
      registration_source: "miniprogram",
      last_active_client: "web",
      last_active_at: "2024-02-03T04:05:06Z",
    }, fmt);
    expect(row[3]).toBe("Web + 小程序");
    expect(row[4]).toBe("小程序");
    expect(row[5]).toBe("Web");
    expect(row[6]).toBe("2024-02-03T04:05:06Z");
  });
  it("uses fallback nickname", () => {
    const row = buildUserCsvRow({ ...baseUser, nickname: null }, fmt);
    expect(row[1]).toBe("未设置昵称");
  });
  it("passes id and openid", () => {
    const row = buildUserCsvRow(baseUser, fmt);
    expect(row[0]).toBe(1);
    expect(row[2]).toBe("abc123");
  });
});

describe("filterBatchActionCandidates", () => {
  const users = [
    { ...baseUser, id: 1, is_banned: false },
    { ...baseUser, id: 2, is_banned: true },
    { ...baseUser, id: 3, is_banned: false },
  ];
  it("returns unbanned users for ban action", () => {
    const out = filterBatchActionCandidates(users, "ban");
    expect(out.map((u) => u.id)).toEqual([1, 3]);
  });
  it("returns banned users for unban action", () => {
    const out = filterBatchActionCandidates(users, "unban");
    expect(out.map((u) => u.id)).toEqual([2]);
  });
  it("returns empty when all banned for ban action", () => {
    expect(filterBatchActionCandidates([{ ...baseUser, is_banned: true }], "ban")).toEqual([]);
  });
  it("returns empty when all unbanned for unban action", () => {
    expect(filterBatchActionCandidates([{ ...baseUser, is_banned: false }], "unban")).toEqual([]);
  });
  it("returns empty for empty input", () => {
    expect(filterBatchActionCandidates([], "ban")).toEqual([]);
  });
});

describe("noCandidatesMessage", () => {
  it("ban message", () => {
    expect(noCandidatesMessage("ban")).toBe("所选用户均已处于封禁状态。");
  });
  it("unban message", () => {
    expect(noCandidatesMessage("unban")).toBe("所选用户均为正常状态，无需解封。");
  });
});

describe("buildPagination", () => {
  it("returns all pages when total <= 7", () => {
    expect(buildPagination(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("returns compact list when current near start", () => {
    expect(buildPagination(2, 10)).toEqual([1, 2, 3, 4, 5, "ellipsis-right", 10]);
  });
  it("returns compact list when current near end", () => {
    expect(buildPagination(9, 10)).toEqual([1, "ellipsis-left", 6, 7, 8, 9, 10]);
  });
  it("returns centered list in middle", () => {
    expect(buildPagination(5, 10)).toEqual([1, "ellipsis-left", 4, 5, 6, "ellipsis-right", 10]);
  });
  it("handles total of 7 exactly", () => {
    expect(buildPagination(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("statusToQueryValue", () => {
  it("returns false for active (not banned)", () => {
    expect(statusToQueryValue("active")).toBe(false);
  });
  it("returns true for banned", () => {
    expect(statusToQueryValue("banned")).toBe(true);
  });
  it("returns undefined for all", () => {
    expect(statusToQueryValue("all")).toBeUndefined();
  });
});

describe("endOfChinaDateUtcIso", () => {
  it("returns non-empty string for valid date", () => {
    const result = endOfChinaDateUtcIso("2025-01-15");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
  it("returns empty string for empty input", () => {
    expect(endOfChinaDateUtcIso("")).toBe("");
  });
  it("ends with microsecond precision", () => {
    const result = endOfChinaDateUtcIso("2025-01-15");
    expect(result.endsWith(".999999Z")).toBe(true);
  });
});

describe("identity helpers", () => {
  it("maps known providers and keeps unknown providers verbatim", () => {
    expect(identityProviderLabel("wechat")).toBe("微信");
    expect(identityProviderLabel("github")).toBe("GitHub");
    expect(identityProviderLabel("saml")).toBe("saml");
  });

  it("de-duplicates providers while preserving first-seen order", () => {
    expect(
      summarizeIdentityProviders([
        { provider: "wechat" },
        { provider: "email" },
        { provider: "wechat" },
        { provider: "github" },
      ]),
    ).toEqual(["微信", "邮箱", "GitHub"]);
    expect(summarizeIdentityProviders(null)).toEqual([]);
  });

  it("prefers masked email, then shortened openid, then actual identity labels", () => {
    expect(
      userIdentitySubtitle(
        [{ provider: "email", masked_subject: "ab***@example.com" }],
        "openid-value",
      ),
    ).toBe("ab***@example.com");
    expect(userIdentitySubtitle([{ provider: "wechat" }], "0123456789abcdefghij")).toBe(
      "openid 0123456789abcd…",
    );
    expect(userIdentitySubtitle([], null)).toBe("未绑定登录身份");
    expect(userIdentitySubtitle([{ provider: "github" }], null)).toBe("GitHub 账号");
  });
});

describe("buildPageRange", () => {
  it("returns an inclusive range inside the page", () => {
    expect(buildPageRange(2, 20, 45)).toEqual({ start: 21, end: 40 });
  });
  it("clamps the final page to the total", () => {
    expect(buildPageRange(3, 20, 45)).toEqual({ start: 41, end: 45 });
  });
  it("returns zero for an empty result", () => {
    expect(buildPageRange(1, 20, 0)).toEqual({ start: 0, end: 0 });
  });
});
