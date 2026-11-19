"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { ManagementPage, ManagementPageHeader } from "@/components/admin/management-ui";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import { isPasswordReady } from "@/lib/admin-user-utils";
import type { LoginResponse } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";

type OtpStartResponse = {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
};

export default function SecurityPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const email = user && "email" in user ? user.email ?? "" : "";
  const emailVerified = Boolean(user && "email_verified" in user && user.email_verified);
  const [activationEmail, setActivationEmail] = useState(email);
  const [activationPassword, setActivationPassword] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [activationLoading, setActivationLoading] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => {
      setResendIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function startActivation(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (activationLoading) return;
    setError("");
    setMessage("");
    setActivationLoading(true);
    try {
      const response = await apiRequest<OtpStartResponse>("/auth/email/activate/start", {
        method: "POST",
        exposeErrorDetail: true,
        body: JSON.stringify({
          email: activationEmail.trim(), current_password: activationPassword,
        }),
      });
      setChallengeId(response.challenge_id);
      setResendIn(response.resend_after);
      setCode("");
      setMessage("验证码已发送，请检查该邮箱。");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "验证码发送失败");
    } finally {
      setActivationLoading(false);
    }
  }

  async function verifyActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activationLoading || code.length !== 6) return;
    setError("");
    setMessage("");
    setActivationLoading(true);
    try {
      const response = await apiRequest<LoginResponse>("/auth/email/activate/verify", {
        method: "POST",
        exposeErrorDetail: true,
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      useAuthStore.getState().acceptLogin(response);
      setChallengeId("");
      setCode("");
      setMessage("邮箱已验证，现在可以使用邮箱验证码登录。");
      setActivationPassword("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "邮箱验证失败");
    } finally {
      setActivationLoading(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordLoading) return;
    if (!isPasswordReady(newPassword)) {
      setError("新密码需至少 12 位，并同时包含大写字母、小写字母和数字");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setError("");
    setMessage("");
    setPasswordLoading(true);
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
      router.replace("/login?password_changed=1");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "密码更新失败");
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <ManagementPage className="mx-auto max-w-5xl space-y-5">
      <ManagementPageHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title="账号安全"
        description="维护当前管理员的已验证邮箱和登录密码。邮箱验证状态与用户端账号完全隔离。"
        meta={
          <span className="inline-flex items-center gap-2">
            邮箱状态
            <StatusBadge tone={emailVerified ? "success" : "warning"}>
              {emailVerified ? "已验证" : "未验证"}
            </StatusBadge>
          </span>
        }
      />

      {(error || message) ? (
        <div
          role={error ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            error
              ? "border-destructive/20 bg-destructive-light text-destructive"
              : "border-success/20 bg-success-light text-success"
          }`}
        >
          {error ? <AlertCircle className="mt-0.5 h-4 w-4" /> : <CheckCircle2 className="mt-0.5 h-4 w-4" />}
          <span>{error || message}</span>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Mail className="h-5 w-5 text-primary" />
              邮箱验证码登录
            </h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              只有完成邮箱验证后，该地址才能用于免密码登录和忘记密码恢复。历史资料中的邮箱不会被视为已验证。
            </p>
            {emailVerified ? (
              <div className="rounded-xl border border-success/20 bg-success-light px-4 py-3 text-sm text-success">
                当前邮箱 <strong className="break-all">{email}</strong> 已验证。
              </div>
            ) : null}
            {!challengeId ? (
              <form onSubmit={startActivation} className="grid gap-3">
                <label className="grid gap-2 text-sm font-medium">
                  当前密码
                  <Input
                    disabled={activationLoading}
                    type="password" value={activationPassword}
                    onChange={(event) => setActivationPassword(event.target.value)}
                    autoComplete="current-password" required
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  {emailVerified ? "更换并验证新邮箱" : "验证管理员邮箱"}
                  <Input
                    disabled={activationLoading}
                    type="email"
                    value={activationEmail}
                    onChange={(event) => setActivationEmail(event.target.value)}
                    placeholder="name@example.com"
                    autoComplete="email"
                    required
                  />
                </label>
                <Button type="submit" disabled={activationLoading} className="gap-2">
                  {activationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  发送验证码
                </Button>
              </form>
            ) : (
              <form onSubmit={verifyActivation} className="grid gap-3">
                <label className="grid gap-2 text-sm font-medium">
                  6 位验证码
                  <Input
                    disabled={activationLoading}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="font-mono text-lg tracking-[0.3em]"
                    required
                  />
                </label>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setChallengeId("")}>
                    修改邮箱
                  </Button>
                  <button
                    type="button"
                    disabled={activationLoading || resendIn > 0}
                    onClick={() => void startActivation()}
                    className="text-primary disabled:text-muted-foreground"
                  >
                    {resendIn > 0 ? `${resendIn} 秒后可重发` : "重新发送"}
                  </button>
                </div>
                <Button type="submit" disabled={activationLoading || code.length !== 6} className="gap-2">
                  {activationLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  验证邮箱
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <KeyRound className="h-5 w-5 text-primary" />
              修改登录密码
            </h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="grid gap-4">
              <label className="grid gap-2 text-sm font-medium">
                当前密码
                <Input
                  disabled={passwordLoading}
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                新密码
                <Input
                  disabled={passwordLoading}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                再次输入新密码
                <Input
                  disabled={passwordLoading}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  required
                />
              </label>
              <p className="text-xs leading-6 text-muted-foreground">
                至少 12 位，同时包含大写字母、小写字母和数字。修改后需要重新登录。
              </p>
              <Button type="submit" disabled={passwordLoading} className="gap-2">
                {passwordLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                更新密码
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </ManagementPage>
  );
}
