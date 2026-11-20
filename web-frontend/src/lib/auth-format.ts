import type { User, UserIdentity } from "@/lib/types";

export const PROVIDER_LABELS: Record<string, string> = {
  email: "邮箱",
  github: "GitHub",
  wechat: "微信",
  password: "账号密码",
};

export function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function identityDescription(identity: UserIdentity, user: User) {
  if (identity.provider === "email" && user.email) return user.email;
  if (identity.provider === "wechat") return "微信小程序中的学习身份";
  if (identity.provider === "github") return "GitHub 稳定账号";
  if (identity.provider === "password") return identity.masked_subject;
  return identity.masked_subject;
}

export function accountName(user: User) {
  return user.nickname?.trim() || user.email || `MemoGrad 用户 ${user.id}`;
}

export function accountInitial(user: User) {
  return Array.from(accountName(user).trim())[0]?.toUpperCase() || "M";
}
