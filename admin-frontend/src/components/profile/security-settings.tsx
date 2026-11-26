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
import styles from "@/components/profile/profile.module.css";
import { SliderCaptcha } from "@/components/security/slider-captcha";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { apiRequest } from "@/lib/api/client";
import { isPasswordReady } from "@/lib/admin-user-utils";
import type { LoginResponse } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";

type OtpStartResponse = {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
};

export function SecuritySettings() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const email = user && "email" in user ? user.email ?? "" : "";
  const username = user && "username" in user ? user.username : "";
  const emailVerified = Boolean(user && "email_verified" in user && user.email_verified);
  const emailBadge = !email
    ? { label: "未绑定", tone: "neutral" as const }
    : emailVerified
      ? { label: "已验证", tone: "success" as const }
      : { label: "待验证", tone: "warning" as const };
  const [activationEmail, setActivationEmail] = useState(email);
  const [activationPassword, setActivationPassword] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [activationLoading, setActivationLoading] = useState(false);
  const [captchaOpen, setCaptchaOpen] = useState(false);
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

  function openActivationCaptcha(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (activationLoading || captchaOpen) return;
    if (!activationPassword) {
      setError("请输入当前密码");
      return;
    }
    if (!activationEmail.trim()) {
      setError("请输入邮箱地址");
      return;
    }
    setError("");
    setMessage("");
    setCaptchaOpen(true);
  }

  async function sendActivationCode(captchaTicket: string) {
    if (activationLoading) return;
    setCaptchaOpen(false);
    setError("");
    setMessage("");
    setActivationLoading(true);
    try {
      const response = await apiRequest<OtpStartResponse>("/auth/email/activate/start", {
        method: "POST",
        exposeErrorDetail: true,
        body: JSON.stringify({
          email: activationEmail.trim(),
          current_password: activationPassword,
          captcha_ticket: captchaTicket,
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
    if (activationLoading || captchaOpen || code.length !== 6) return;
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
      setCaptchaOpen(false);
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
    <div className={styles.securityContent}>
      {(error || message) ? (
        <div
          role={error ? "alert" : "status"}
          className={`${styles.feedback} ${
            error ? styles.feedbackError : styles.feedbackSuccess
          }`}
        >
          {error ? <AlertCircle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          <span>{error || message}</span>
        </div>
      ) : null}

      <div className={styles.securityGrid}>
        <section
          className={`${styles.securityPane} ${styles.emailPane}`}
          id="email-settings"
          aria-labelledby="email-settings-title"
        >
          <div className={styles.securityPaneHeader}>
            <Mail aria-hidden="true" />
            <h3 id="email-settings-title">邮箱绑定</h3>
            <StatusBadge tone={emailBadge.tone}>
              {emailBadge.label}
            </StatusBadge>
          </div>
          <p className={styles.paneDescription}>
            验证后可使用邮箱验证码登录和找回密码。更换邮箱需先验证当前密码。
          </p>
          {emailVerified ? (
            <div className={styles.currentEmail}>
              <CheckCircle2 aria-hidden="true" />
              <div>
                <span>当前邮箱</span>
                <strong>{email}</strong>
              </div>
            </div>
          ) : null}
          {!challengeId ? (
            <form onSubmit={openActivationCaptcha} className={styles.securityForm}>
              <input
                type="hidden"
                autoComplete="username"
                value={username}
                readOnly
              />
              <label>
                当前密码
                <Input
                  disabled={activationLoading || captchaOpen}
                  type="password"
                  value={activationPassword}
                  onChange={(event) => setActivationPassword(event.target.value)}
                  autoComplete="current-password"
                  className={styles.textInput}
                  required
                />
              </label>
              <label>
                {emailVerified ? "新邮箱" : "邮箱地址"}
                <Input
                  disabled={activationLoading || captchaOpen}
                  type="email"
                  value={activationEmail}
                  onChange={(event) => setActivationEmail(event.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  className={styles.textInput}
                  required
                />
              </label>
              <Button
                type="submit"
                disabled={activationLoading || captchaOpen}
                className={styles.actionButton}
              >
                {activationLoading ? (
                  <Loader2 aria-hidden="true" className={styles.spinner} />
                ) : (
                  <Mail aria-hidden="true" className="h-4 w-4" />
                )}
                发送验证码
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyActivation} className={styles.securityForm}>
              <input
                type="hidden"
                autoComplete="username"
                value={username}
                readOnly
              />
              <label>
                6 位验证码
                <OtpInput
                  id="admin-activation-code"
                  name="admin-activation-code"
                  disabled={activationLoading || captchaOpen}
                  value={code}
                  onChange={setCode}
                  invalid={Boolean(error)}
                  theme="light"
                  ariaLabel="6 位邮箱验证码"
                  required
                />
              </label>
              <p className={styles.otpMeta}>
                验证码已发送至 {activationEmail}，5 分钟内有效。
              </p>
              <div className={styles.formUtilityRow}>
                <button
                  type="button"
                  className={styles.textButton}
                  disabled={activationLoading || captchaOpen}
                  onClick={() => {
                    setCaptchaOpen(false);
                    setChallengeId("");
                  }}
                >
                  修改邮箱
                </button>
                <button
                  type="button"
                  disabled={activationLoading || captchaOpen || resendIn > 0}
                  onClick={() => openActivationCaptcha()}
                  className={styles.resendButton}
                >
                  {resendIn > 0 ? `${resendIn} 秒后可重发` : "重新发送"}
                </button>
              </div>
              <Button
                type="submit"
                disabled={activationLoading || captchaOpen || code.length !== 6}
                className={styles.actionButton}
              >
                {activationLoading ? (
                  <Loader2 aria-hidden="true" className={styles.spinner} />
                ) : (
                  <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                )}
                验证邮箱
              </Button>
            </form>
          )}
          {captchaOpen ? (
            <SliderCaptcha
              purpose="activate"
              email={activationEmail.trim()}
              onVerified={(ticket) => void sendActivationCode(ticket)}
              onCancel={() => setCaptchaOpen(false)}
            />
          ) : null}
        </section>

        <section
          className={`${styles.securityPane} ${styles.passwordPane}`}
          aria-labelledby="password-settings-title"
        >
          <div className={styles.securityPaneHeader}>
            <KeyRound aria-hidden="true" />
            <h3 id="password-settings-title">修改登录密码</h3>
          </div>
          <p className={styles.paneDescription}>
            密码用于管理员登录。更新后所有会话立即失效。
          </p>
          <form onSubmit={changePassword} className={styles.securityForm}>
            <input
              type="hidden"
              autoComplete="username"
              value={username}
              readOnly
            />
            <label>
              当前密码
              <Input
                disabled={passwordLoading}
                type="password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                autoComplete="current-password"
                className={styles.textInput}
                required
              />
            </label>
            <label>
              新密码
              <Input
                disabled={passwordLoading}
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                className={styles.textInput}
                required
              />
            </label>
            <label>
              再次输入新密码
              <Input
                disabled={passwordLoading}
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                className={styles.textInput}
                required
              />
            </label>
            <small>至少 12 位，同时包含大写字母、小写字母和数字</small>
            <Button
              type="submit"
              disabled={passwordLoading}
              className={styles.actionButton}
            >
              {passwordLoading ? (
                <Loader2 aria-hidden="true" className={styles.spinner} />
              ) : (
                <KeyRound aria-hidden="true" className="h-4 w-4" />
              )}
              更新密码
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
