"use client";

import Image from "next/image";
import Link from "next/link";
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accountInitial } from "@/lib/account-format";
import { ApiError } from "@/lib/api/errors";
import type { LearnerUser } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { saveLearnerNickname, uploadLearnerAvatar, validateAvatar } from "@/lib/learner-profile";

export function LearnerProfile({ user }: { user: LearnerUser }) {
  const [nickname, setNickname] = useState(user.nickname ?? "");
  const [avatar, setAvatar] = useState<{ file: File; preview: string } | null>(null);
  const [busy, setBusy] = useState<"nickname" | "avatar" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => () => {
    if (avatar) URL.revokeObjectURL(avatar.preview);
  }, [avatar]);

  function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || pendingRef.current) return;
    setMessage("");
    const invalid = validateAvatar(file);
    if (invalid) { setError(invalid); return; }
    setError("");
    setAvatar({ file, preview: URL.createObjectURL(file) });
  }

  async function save(kind: "nickname" | "avatar") {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(kind);
    setError("");
    setMessage("");
    try {
      const updated = kind === "avatar" && avatar
        ? await uploadLearnerAvatar(avatar.file)
        : await saveLearnerNickname(nickname);
      const current = useAuthStore.getState();
      if (current.accessMode !== "user" || current.learnerUser !== user) return;
      useAuthStore.setState({ learnerUser: updated });
      if (!mountedRef.current) return;
      if (kind === "avatar") setAvatar(null);
      else setNickname(updated.nickname ?? "");
      setMessage(kind === "avatar" ? "头像已更新" : "昵称已保存");
    } catch (saveError) {
      if (!mountedRef.current) return;
      setError(saveError instanceof ApiError && saveError.status >= 500
        ? "保存暂时失败，请稍后重试，已填写的内容会保留。"
        : saveError instanceof Error ? saveError.message : "保存失败，请重试");
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }

  function submitNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save("nickname");
  }

  const avatarUrl = avatar?.preview ?? user.avatar_url;

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-label="个人资料">
      <div className="grid gap-7 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
        <div className="flex flex-col items-start gap-3">
          <div className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-accent text-3xl font-semibold text-primary">
            {avatarUrl
              ? <Image src={avatarUrl} alt={avatar ? "待保存的头像预览" : "当前头像"} width={96} height={96} unoptimized className="h-full w-full object-cover" />
              : accountInitial(user.email, user.nickname, user.id)}
          </div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像图片" className="sr-only" disabled={Boolean(busy)} onChange={selectAvatar} />
          <Button variant="secondary" type="button" disabled={Boolean(busy)} onClick={() => fileInputRef.current?.click()}>
            <Camera className="h-4 w-4" aria-hidden="true" />{avatar ? "重新选择" : "更换头像"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">JPG、PNG 或 WebP，最大 5MB。<br />保存后自动居中裁剪为方形。</p>
          {avatar ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={Boolean(busy)} aria-busy={busy === "avatar"} onClick={() => void save("avatar")}>
                {busy === "avatar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}保存头像
              </Button>
              <Button type="button" variant="ghost" disabled={Boolean(busy)} onClick={() => setAvatar(null)}>取消</Button>
            </div>
          ) : null}
        </div>
        <form onSubmit={submitNickname} className="grid max-w-lg content-start gap-5" aria-busy={busy === "nickname"}>
          <div className="grid gap-2">
            <label htmlFor="profile-nickname" className="text-sm font-medium text-foreground">昵称</label>
            <Input id="profile-nickname" name="nickname" autoComplete="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} required disabled={Boolean(busy)} placeholder="请输入昵称" aria-describedby="nickname-hint" aria-invalid={Array.from(nickname).length > 64 || undefined} />
            <p id="nickname-hint" className="text-xs text-muted-foreground">{Array.from(nickname).length} / 64 个字符，保存后同步到当前账号。</p>
          </div>
          <div className="grid gap-2 text-sm">
            <span className="font-medium text-foreground">邮箱</span>
            <p className="break-all text-muted-foreground">{user.email ?? "尚未绑定邮箱"}</p>
            <Link href="/account/settings" className="w-fit text-primary underline underline-offset-4">前往安全设置修改邮箱</Link>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={Boolean(busy) || !nickname.trim() || nickname.trim() === (user.nickname ?? "")}>
              {busy === "nickname" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}保存昵称
            </Button>
            <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => { setNickname(user.nickname ?? ""); setError(""); setMessage(""); }}>重置</Button>
          </div>
        </form>
      </div>
      {error ? <p role="alert" className="mt-5 text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="mt-5 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{message}</p> : null}
    </section>
  );
}
