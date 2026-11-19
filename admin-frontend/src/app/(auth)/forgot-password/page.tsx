"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { AdminFooter } from "@/components/layout/admin-footer";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import { isPasswordReady } from "@/lib/admin-user-utils";
import { loginErrorMessage } from "@/app/(auth)/login/page";
import styles from "@/app/(auth)/login/login.module.css";

type OtpStartResponse = {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
};

type RecoveryVerifyResponse = {
  reset_token: string;
  expires_in: number;
};

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const stage = resetToken ? "reset" : challengeId ? "verify" : "email";
  const hasError = Boolean(error);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => {
      setResendIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  async function startRecovery(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const response = await apiRequest<OtpStartResponse>("/auth/email/recover/start", {
        method: "POST",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({ email: email.trim() }),
      });
      setChallengeId(response.challenge_id);
      setResendIn(response.resend_after);
      setCode("");
    } catch (submitError) {
      setError(loginErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || code.length !== 6) return;
    setError("");
    setLoading(true);
    try {
      const response = await apiRequest<RecoveryVerifyResponse>("/auth/email/recover/verify", {
        method: "POST",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      setResetToken(response.reset_token);
    } catch (submitError) {
      setError(loginErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
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
      await apiRequest("/auth/recover-password", {
        method: "POST",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({
          reset_token: resetToken,
          new_password: newPassword,
        }),
      });
      router.replace("/login?reset=1");
    } catch (submitError) {
      setError(loginErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.surface}>
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.upperGlow} />
        <div className={styles.lowerGlow} />
      </div>
      <header className={styles.header}>
        <span className={styles.wordmark}>MemoGrad<span>ADMIN</span></span>
        <span className={styles.accessLabel}><span />受保护的账号恢复</span>
      </header>
      <main className={styles.main}>
        <div className={styles.stage}>
          <section className={styles.card} aria-labelledby="recovery-title">
            <div className={styles.cardHeading}>
              <span className={styles.mark} aria-hidden="true"><ShieldCheck /></span>
              <p className={styles.eyebrow}>ACCOUNT RECOVERY</p>
              <h1 id="recovery-title">恢复管理员密码</h1>
              <p className={styles.subtitle}>
                {stage === "email" && "验证已激活的管理员邮箱后，可独立设置新密码。"}
                {stage === "verify" && "输入邮件中的 6 位验证码。页面不会提示邮箱是否存在。"}
                {stage === "reset" && "验证成功。设置新密码后，此前管理员会话将全部失效。"}
              </p>
            </div>

            {stage === "email" ? (
              <form onSubmit={startRecovery} className={styles.form} aria-busy={loading}>
                <div className={styles.emailIntro}>
                  <Mail aria-hidden="true" />
                  <p>仅已验证邮箱可用于自助恢复；没有已验证邮箱的普通管理员请联系超级管理员。</p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="recovery-email">管理员邮箱</label>
                  <div className={styles.inputShell} data-invalid={hasError || undefined}>
                    <Mail className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      disabled={loading}
                      id="recovery-email"
                      type="email"
                      variant="ghost"
                      className={styles.input}
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (error) setError("");
                      }}
                      placeholder="name@example.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>
                <button className={styles.submit} type="submit" disabled={loading}>
                  {loading ? <><Loader2 className={styles.spinner} /><span>正在发送</span></> : <><span>发送恢复验证码</span><ArrowRight /></>}
                </button>
              </form>
            ) : stage === "verify" ? (
              <form onSubmit={verifyCode} className={styles.form} aria-busy={loading}>
                <div className={styles.emailIntro} data-success>
                  <Mail aria-hidden="true" />
                  <p>如果该邮箱可用，验证码已发送至 <strong>{email}</strong>。</p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="recovery-code">6 位验证码</label>
                  <div className={styles.inputShell} data-invalid={hasError || undefined}>
                    <ShieldCheck className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      disabled={loading}
                      id="recovery-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      variant="ghost"
                      className={`${styles.input} ${styles.codeInput}`}
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                        if (error) setError("");
                      }}
                      placeholder="000000"
                      required
                    />
                  </div>
                </div>
                <div className={styles.otpActions}>
                  <button type="button" className={styles.backButton} disabled={loading} onClick={() => setChallengeId("")}>
                    <ArrowLeft /> 修改邮箱
                  </button>
                  <button type="button" className={styles.resendButton} disabled={loading || resendIn > 0} onClick={() => void startRecovery()}>
                    {resendIn > 0 ? `${resendIn} 秒后可重发` : "重新发送"}
                  </button>
                </div>
                <button className={styles.submit} type="submit" disabled={loading || code.length !== 6}>
                  {loading ? <><Loader2 className={styles.spinner} /><span>正在验证</span></> : <><span>继续重置</span><ArrowRight /></>}
                </button>
              </form>
            ) : (
              <form onSubmit={resetPassword} className={styles.form} aria-busy={loading}>
                <div className={styles.field}>
                  <label htmlFor="new-password">新密码</label>
                  <div className={styles.inputShell} data-invalid={hasError || undefined}>
                    <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      disabled={loading}
                      id="new-password"
                      type="password"
                      variant="ghost"
                      className={styles.input}
                      value={newPassword}
                      onChange={(event) => {
                        setNewPassword(event.target.value);
                        if (error) setError("");
                      }}
                      autoComplete="new-password"
                      minLength={12}
                      required
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="confirm-password">再次输入新密码</label>
                  <div className={styles.inputShell} data-invalid={hasError || undefined}>
                    <CheckCircle2 className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      disabled={loading}
                      id="confirm-password"
                      type="password"
                      variant="ghost"
                      className={styles.input}
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                        if (error) setError("");
                      }}
                      autoComplete="new-password"
                      minLength={12}
                      required
                    />
                  </div>
                </div>
                <p className={styles.formMeta}>至少 12 位，同时包含大写字母、小写字母和数字。</p>
                <button className={styles.submit} type="submit" disabled={loading}>
                  {loading ? <><Loader2 className={styles.spinner} /><span>正在更新</span></> : <><span>设置新密码</span><ArrowRight /></>}
                </button>
              </form>
            )}

            <div
              className={styles.cardFooter}
              data-error={hasError || undefined}
              role={hasError ? "alert" : undefined}
              aria-live={hasError ? "assertive" : undefined}
            >
              {hasError ? <><AlertCircle /><p>{error}</p></> : <><ShieldCheck /><p>恢复操作会记录安全审计，但不会保存验证码或密码。</p></>}
            </div>
          </section>
          <p className={styles.support}><Link href="/login">返回管理员登录</Link></p>
        </div>
      </main>
      <div className={styles.footer}><AdminFooter variant="auth" /></div>
    </div>
  );
}
