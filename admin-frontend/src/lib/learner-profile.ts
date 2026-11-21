import { apiRequest } from "@/lib/api/client";
import type { LearnerUser } from "@/lib/api/types";

export function validateAvatar(file: File): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "请选择 JPG、PNG 或 WebP 图片";
  }
  if (file.size === 0) return "头像文件为空，请重新选择";
  if (file.size > 5 * 1024 * 1024) return "头像文件不能超过 5MB";
  return null;
}

export async function saveLearnerNickname(nickname: string) {
  const normalized = nickname.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("请输入昵称");
  if (Array.from(normalized).length > 64) throw new Error("昵称不能超过 64 个字符");
  return apiRequest<LearnerUser>("/users/me", {
    method: "PUT",
    scope: "user",
    exposeErrorDetail: true,
    body: JSON.stringify({ nickname: normalized }),
  });
}

export async function uploadLearnerAvatar(file: File) {
  const error = validateAvatar(file);
  if (error) throw new Error(error);
  const body = new FormData();
  body.append("file", file);
  return apiRequest<LearnerUser>("/users/me/avatar", {
    method: "POST",
    scope: "user",
    exposeErrorDetail: true,
    body,
  });
}
