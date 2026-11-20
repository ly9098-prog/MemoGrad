"use client";

import { type FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";
import { ManagementPage, ManagementPageHeader } from "@/components/admin/management-ui";
import { SecuritySettings } from "@/components/profile/security-settings";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import type { AuthUser, MeResponse } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";

function ProfileForm({ user }: { user: AuthUser }) {
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const changed = displayName.trim() !== (user.display_name ?? "");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !changed) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<MeResponse>("/auth/me", {
        method: "PATCH",
        exposeErrorDetail: true,
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
      const current = useAuthStore.getState().user;
      const currentId = current && ("id" in current ? current.id : current.user.id);
      if (!current || currentId !== user.id) return;
      const profile = { display_name: result.user.display_name };
      useAuthStore.setState({ user: "id" in current
        ? { ...current, ...profile }
        : { ...current, user: { ...current.user, ...profile } } });
      setDisplayName(result.user.display_name ?? "");
      setMessage("个人资料已保存");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={saveProfile} className="space-y-5" aria-busy={saving}>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          用户名
          <Input value={user.username} readOnly aria-describedby="username-help" />
          <span id="username-help" className="text-xs font-normal text-muted-foreground">由超级管理员分配</span>
        </label>
        <label className="grid content-start gap-2 text-sm font-medium">
          显示名称
          <Input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setMessage(""); setError(""); }} maxLength={64} autoComplete="nickname" placeholder={user.username} disabled={saving} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={saving || !changed}>
          {saving ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saving ? "正在保存" : "保存资料"}
        </Button>
        <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>{error || message}</p>
      </div>
    </form>
  );
}

export default function ProfilePage() {
  const storedUser = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const user = storedUser && ("id" in storedUser ? storedUser : storedUser.user);
  if (!user) return null;
  const name = user.display_name || user.username;

  return (
    <ManagementPage className="mx-auto max-w-5xl before:inset-x-0">
      <ManagementPageHeader title="个人信息" description="管理你的资料、邮箱与登录密码。" />
      <div className="flex min-w-0 items-center gap-4 py-1">
        <span aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-xl font-semibold text-primary">{Array.from(name)[0]}</span>
        <div className="min-w-0 space-y-1">
          <p className="break-words text-lg font-semibold">{name}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{role?.display_name ?? "管理员"}</span>
            <StatusBadge tone={user.email_verified ? "primary" : "neutral"}>{user.email_verified ? "邮箱已验证" : "邮箱未验证"}</StatusBadge>
          </div>
        </div>
      </div>
      <nav aria-label="个人信息分区" className="flex gap-6 text-sm font-medium">
        <a href="#details" className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">基本资料</a>
        <a href="#security" className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">登录与安全</a>
      </nav>
      <Card id="details" className="scroll-mt-6 rounded-2xl">
        <CardHeader><h2 className="text-lg font-semibold">基本资料</h2></CardHeader>
        <CardContent><ProfileForm key={user.id} user={user} /></CardContent>
      </Card>
      <section id="security" aria-labelledby="security-title" className="scroll-mt-6 space-y-4">
        <h2 id="security-title" className="text-lg font-semibold">登录与安全</h2>
        <SecuritySettings key={user.id} />
      </section>
    </ManagementPage>
  );
}
