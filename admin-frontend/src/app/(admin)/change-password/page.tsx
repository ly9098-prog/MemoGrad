"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useState } from "react";
import { AlertCircle, KeyRound, Loader2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { ManagementPage, ManagementPageHeader } from "@/components/admin/management-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import { isPasswordReady } from "@/lib/admin-user-utils";
import { useAuthStore } from "@/lib/auth/auth-store";
import { safeInternalRedirect } from "@/lib/safe-redirect";

function ChangePasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const displayName =
    user && "display_name" in user
      ? user.display_name || ("username" in user ? user.username : "管理员")
      : "管理员";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (!isPasswordReady(newPassword)) {
      setError("新密码需至少 12 位，并同时包含大写字母、小写字母和数字");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await apiRequest("/auth/change-password", {
        method: "POST",
        exposeErrorDetail: true,
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
        }),
      });
      useAuthStore.getState().clear();
      const next = safeInternalRedirect(searchParams.get("next"));
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "密码更新失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function exitWorkspace() {
    await logout().catch(() => undefined);
    router.replace("/login");
  }

  return (
    <ManagementPage className="mx-auto max-w-3xl py-6">
      <ManagementPageHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title="首次登录需更新密码"
        description="临时密码只能用于完成本次安全更新；更新前不能访问其他管理功能。"
        actions={
          <Button variant="secondary" onClick={exitWorkspace} className="gap-2">
            <LogOut className="h-4 w-4" />
            退出
          </Button>
        }
        meta={<span>当前账号：{displayName}</span>}
      />
      <Card className="mt-5 rounded-2xl">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-5 w-5 text-primary" />
            设置你的正式密码
          </h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-5" aria-busy={loading}>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              临时密码
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  disabled={loading}
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  autoComplete="current-password"
                  className="h-11 pl-10"
                  required
                />
              </div>
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              新密码
              <Input
                disabled={loading}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                className="h-11"
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-foreground">
              再次输入新密码
              <Input
                disabled={loading}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                className="h-11"
                required
              />
            </label>
            <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs leading-6 text-muted-foreground">
              至少 12 位，同时包含大写字母、小写字母和数字。更新后所有旧会话都会失效，需要重新登录。
            </p>
            {error ? (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-light px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            <Button type="submit" disabled={loading} className="h-11 gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {loading ? "正在更新" : "更新密码并退出全部会话"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </ManagementPage>
  );
}

export default function ChangePasswordPage() {
  return <Suspense fallback={null}><ChangePasswordContent /></Suspense>;
}
