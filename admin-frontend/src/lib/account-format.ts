import type { LearnerUser, UserIdentity } from "@/lib/api/types";

export const PROVIDER_LABELS: Record<string, string> = {
  email: "邮箱",
  github: "GitHub",
  wechat: "微信",
  password: "账号密码",
};

export function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function identityDescription(
  identity: UserIdentity,
  email: string | null | undefined,
) {
  if (identity.provider === "email" && email) return email;
  if (identity.provider === "wechat") return "微信小程序中的学习身份";
  if (identity.provider === "github") return "GitHub 稳定账号";
  return identity.masked_subject;
}

export function accountName(
  email: string | null | undefined,
  nickname: string | null | undefined,
  id: number,
) {
  return nickname?.trim() || email || `用户 ${id}`;
}

export function accountInitial(
  email: string | null | undefined,
  nickname: string | null | undefined,
  id: number,
) {
  return Array.from(accountName(email, nickname, id).trim())[0]?.toUpperCase() || "M";
}

export function currentEmail(user: LearnerUser) {
  return user.identities.find((identity) => identity.provider === "email")?.masked_subject
    ?? user.email
    ?? null;
}
