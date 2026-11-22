/**
 * Pure helpers for app-users page, extracted from app-users/page.tsx.
 * Covers CSV escaping, user-row building, batch-action candidate filtering,
 * pagination, and date/status query mapping.
 */

import { chinaDateToUtcIso } from "@/lib/time";

export type UserAction = "ban" | "unban";

export type UserStatusFilter = "all" | "active" | "banned";

export type PaginationItem = number | "ellipsis-left" | "ellipsis-right";

const IDENTITY_PROVIDER_LABELS: Record<string, string> = {
  wechat: "微信",
  email: "邮箱",
  github: "GitHub",
};

export type IdentityLike = {
  provider: string;
  masked_subject?: string | null;
};

/**
 * Build a compact pagination item list with ellipses for large page counts.
 */
export function buildPagination(current: number, total: number): PaginationItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  if (current <= 4) return [1, 2, 3, 4, 5, "ellipsis-right", total];
  if (current >= total - 3) return [1, "ellipsis-left", total - 4, total - 3, total - 2, total - 1, total];

  return [1, "ellipsis-left", current - 1, current, current + 1, "ellipsis-right", total];
}

/**
 * Map a user status filter to the API boolean value, or undefined for "all".
 * Note: "active" maps to false (not banned), "banned" maps to true.
 */
export function statusToQueryValue(status: UserStatusFilter): boolean | undefined {
  if (status === "active") return false;
  if (status === "banned") return true;
  return undefined;
}

/**
 * Convert a China calendar date to the UTC ISO string of its end.
 * Emits the final microsecond before the next China calendar day so
 * PostgreSQL microsecond precision is covered.
 */
export function endOfChinaDateUtcIso(date: string): string {
  const nextDay = chinaDateToUtcIso(date, 1);
  if (!nextDay) return "";
  return new Date(new Date(nextDay).getTime() - 1000).toISOString().replace(/\.\d{3}Z$/, ".999999Z");
}

export function identityProviderLabel(provider: string): string {
  return IDENTITY_PROVIDER_LABELS[provider] ?? provider;
}

export function summarizeIdentityProviders(
  identities: readonly IdentityLike[] | null | undefined,
): string[] {
  if (!identities?.length) return [];
  const labels: string[] = [];
  for (const identity of identities) {
    const label = identityProviderLabel(identity.provider);
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

export function userIdentitySubtitle(
  identities: readonly IdentityLike[] | null | undefined,
  openid: string | null | undefined,
): string {
  const email = identities?.find((identity) => identity.provider === "email");
  if (email?.masked_subject) return email.masked_subject;
  if (openid) return `openid ${openid.length > 14 ? `${openid.slice(0, 14)}…` : openid}`;
  const labels = summarizeIdentityProviders(identities);
  return labels.length ? `${labels.join(" / ")} 账号` : "未绑定登录身份";
}

export function buildPageRange(
  page: number,
  pageSize: number,
  total: number,
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  return {
    start: (page - 1) * pageSize + 1,
    end: Math.min(page * pageSize, total),
  };
}

export type AppUserLike = {
  id: number;
  nickname?: string | null;
  openid?: string | null;
  is_banned: boolean;
  banned_reason?: string | null;
  banned_at?: string | null;
  created_at?: string | null;
  user_type?: "web" | "miniprogram" | "both" | "unknown";
  registration_source?: "web" | "miniprogram" | null;
  last_active_client?: "web" | "miniprogram" | null;
  last_active_at?: string | null;
};

/**
 * Escape a value for CSV output: wrap in quotes, double internal quotes.
 */
export function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Build the CSV header row for user export.
 */
export function buildUserCsvHeader(): string[] {
  return ["ID", "昵称", "OpenID", "类型", "注册来源", "最近活跃端", "最近活跃时间（北京时间）", "状态", "封禁原因", "封禁时间（北京时间）", "创建时间（北京时间）"];
}

/**
 * Build a CSV row array from a user record. The `formatDate` callback keeps
 * this function pure by deferring date formatting to the caller.
 */
export function buildUserCsvRow(
  user: AppUserLike,
  formatDate: (value: string | null | undefined) => string,
): Array<string | number> {
  return [
    user.id,
    user.nickname || "未设置昵称",
    user.openid || "",
    user.user_type === "web" ? "Web" : user.user_type === "miniprogram" ? "小程序" : user.user_type === "both" ? "Web + 小程序" : "未知",
    user.registration_source === "web" ? "Web" : user.registration_source === "miniprogram" ? "小程序" : "",
    user.last_active_client === "web" ? "Web" : user.last_active_client === "miniprogram" ? "小程序" : "",
    user.last_active_at ? formatDate(user.last_active_at) : "",
    user.is_banned ? "已封禁" : "正常",
    user.banned_reason || "",
    user.banned_at ? formatDate(user.banned_at) : "",
    user.created_at ? formatDate(user.created_at) : "",
  ];
}

/**
 * Filter selected users to candidates for a ban/unban batch action.
 * For ban, returns users not currently banned; for unban, returns banned users.
 */
export function filterBatchActionCandidates<T extends AppUserLike>(
  users: T[],
  action: UserAction,
): T[] {
  return users.filter((user) => (action === "ban" ? !user.is_banned : user.is_banned));
}

/**
 * Build the "no candidates" notice message for a given action.
 */
export function noCandidatesMessage(action: UserAction): string {
  return action === "ban"
    ? "所选用户均已处于封禁状态。"
    : "所选用户均为正常状态，无需解封。";
}
