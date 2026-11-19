"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { useUserAuth } from "@/lib/auth-store";
import type {
  GithubStartResponse,
  OtpStartResponse,
  WebAuthResponse,
} from "@/lib/types";
import styles from "@/styles/user-login.module.css";
import { useOtpCountdown } from "@/lib/use-otp-countdown";

const USER_AGREEMENT_VERSION =
  process.env.NEXT_PUBLIC_USER_AGREEMENT_VERSION || "2026-11-20";
const PRIVACY_POLICY_VERSION =
  process.env.NEXT_PUBLIC_PRIVACY_POLICY_VERSION || "2026-11-20";

const AUTH_ERRORS: Record<string, string> = {
  github_cancelled: "GitHub 授权已取消",
  github_failed: "GitHub 登录未能完成，请重试",
  account_unavailable: "该身份关联的账号当前不可用",
  identity_already_exists: "该 GitHub 身份已绑定到其他账号",
  github_verification_failed: "请使用当前账号已绑定的 GitHub 完成验证",
};

function messageFor(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "网络连接异常，请检查后重试";
  return "操作未完成，请稍后重试";
}

function ResendButton({
  seconds,
  busy,
  onResend,
}: {
  seconds: number;
  busy: boolean;
  onResend: () => void;
}) {
  const remaining = useOtpCountdown(seconds);

  return (
    <button
      type="button"
      className={styles.resendButton}
      disabled={busy || remaining > 0}
      onClick={onResend}
    >
      {remaining > 0 ? `${remaining} 秒后可重发` : "重新发送"}
    </button>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const codeInput = useRef<HTMLInputElement>(null);
  const applyAuth = useUserAuth((state) => state.applyAuth);
  const [agreed, setAgreed] = useState(false);
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resendAfter, setResendAfter] = useState(0);
  const [sentEmail, setSentEmail] = useState("");
  const [pending, setPending] = useState<"email" | "github" | null>(null);
  const [error, setError] = useState("");
  const authError = AUTH_ERRORS[params.get("auth_error") ?? ""] ?? "";
  const visibleError = error || authError;
  const notice = params.has("email_changed") ? "邮箱已更新，请重新登录"
    : params.has("identity_unlinked") ? "登录方式已解绑，请重新登录" : "";
  const busy = pending !== null;

  useEffect(() => {
    if (challengeId) codeInput.current?.focus();
  }, [challengeId]);

  function requireConsent() {
    if (agreed) return true;
    setError("请先阅读并同意用户协议和隐私政策");
    return false;
  }

  async function startEmail() {
    if (!requireConsent() || busy) return;
    const normalized = email.trim();
    if (!normalized) {
      setError("请输入邮箱地址");
      return;
    }
    setError("");
    setPending("email");
    try {
      const response = await apiRequest<OtpStartResponse>("/auth/email/start", {
        method: "POST",
        body: JSON.stringify({
          email: normalized,
          client: "web",
          accepted_terms: true,
          agreement_version: USER_AGREEMENT_VERSION,
          privacy_version: PRIVACY_POLICY_VERSION,
        }),
      });
      setChallengeId(response.challenge_id);
      setResendAfter(response.resend_after);
      setCode("");
      setSentEmail(normalized);
    } catch (submitError) {
      setError(messageFor(submitError));
    } finally {
      setPending(null);
    }
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challengeId) {
      await startEmail();
      return;
    }
    if (code.length !== 6 || busy || !requireConsent()) return;
    setError("");
    setPending("email");
    try {
      const response = await apiRequest<WebAuthResponse>("/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({
          challenge_id: challengeId,
          code,
          client: "web",
        }),
      });
      applyAuth(response);
      router.replace("/");
    } catch (submitError) {
      setError(messageFor(submitError));
    } finally {
      setPending(null);
    }
  }

  async function startGithub() {
    if (!requireConsent() || busy) return;
    setError("");
    setPending("github");
    try {
      const response = await apiRequest<GithubStartResponse>("/auth/github/start", {
        method: "POST",
        body: JSON.stringify({
          accepted_terms: true,
          agreement_version: USER_AGREEMENT_VERSION,
          privacy_version: PRIVACY_POLICY_VERSION,
          return_to: "/",
        }),
      });
      window.location.assign(response.authorization_url);
    } catch (submitError) {
      setError(messageFor(submitError));
      setPending(null);
    }
  }

  return (
    <div className={styles.surface}>
      <div className={styles.atmosphere} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.wordmark}>MemoGrad</span>
      </header>
      <main className={styles.main}>
        <div className={styles.stage}>
          <section className={styles.card} aria-labelledby="user-login-title">
            <h1 id="user-login-title">{challengeId ? "验证邮箱" : "登录"}</h1>

            {!challengeId && (
              <>
                <button
                  type="button"
                  className={styles.githubButton}
                  onClick={() => void startGithub()}
                  disabled={busy}
                  aria-busy={pending === "github"}
                >
                  {pending === "github" ? (
                    <Loader2 className={styles.spinner} aria-hidden="true" />
                  ) : (
                    <Image
                      className={styles.githubIcon}
                      src="/github-invertocat-white.svg"
                      alt=""
                      width={18}
                      height={18}
                    />
                  )}
                  <span>{pending === "github" ? "正在跳转" : "使用 GitHub 继续"}</span>
                </button>
                <div className={styles.divider}><span>或</span></div>
              </>
            )}

            <form onSubmit={submitEmail} className={styles.form} aria-busy={pending === "email"}>
              {!challengeId ? (
                <div className={styles.field}>
                  <label htmlFor="user-email">邮箱</label>
                  <input
                    id="user-email"
                    type="email"
                    className={styles.input}
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (error) setError("");
                    }}
                    placeholder="name@example.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    aria-invalid={Boolean(visibleError) || undefined}
                    aria-describedby={visibleError ? "user-login-feedback" : undefined}
                    required
                  />
                </div>
              ) : (
                <>
                  <div className={styles.sentRow}>
                    <span>验证码已发送至 <strong>{sentEmail}</strong></span>
                    <button
                      type="button"
                      className={styles.quietButton}
                      disabled={busy}
                      onClick={() => {
                        setChallengeId("");
                        setCode("");
                        setResendAfter(0);
                        if (error) setError("");
                      }}
                    >
                      更换
                    </button>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="user-code">6 位验证码</label>
                    <input
                      id="user-code"
                      ref={codeInput}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="\d{6}"
                      maxLength={6}
                      className={`${styles.input} ${styles.codeInput}`}
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                        if (error) setError("");
                      }}
                      placeholder="000000"
                      required
                      disabled={busy}
                      aria-invalid={Boolean(visibleError) || undefined}
                      aria-describedby={visibleError ? "user-login-feedback" : undefined}
                    />
                  </div>
                  <div className={styles.otpActions}>
                    <span>5 分钟内有效</span>
                    <ResendButton
                      key={`${challengeId}-${resendAfter}`}
                      seconds={resendAfter}
                      busy={busy}
                      onResend={() => void startEmail()}
                    />
                  </div>
                </>
              )}
              <button
                type="submit"
                className={styles.submit}
                disabled={busy || (Boolean(challengeId) && code.length !== 6)}
              >
                {pending === "email" && <Loader2 className={styles.spinner} aria-hidden="true" />}
                <span>
                  {pending === "email"
                    ? "正在处理"
                    : challengeId
                      ? "验证并登录"
                      : "使用邮箱继续"}
                </span>
              </button>
            </form>

            <label className={styles.consentRow}>
              <input
                type="checkbox"
                checked={agreed}
                disabled={busy}
                onChange={(event) => {
                  setAgreed(event.target.checked);
                  if (error) setError("");
                }}
              />
              <span className={styles.consentCheck} aria-hidden="true" />
              <span>
                同意<Link href="/agreements/user" target="_blank" rel="noopener noreferrer">用户协议</Link>、
                <Link href="/agreements/privacy" target="_blank" rel="noopener noreferrer">隐私政策</Link>和
                <Link href="/agreements/ai" target="_blank" rel="noopener noreferrer">AI 免责声明</Link>
              </span>
            </label>

            {(visibleError || notice) && (
              <div id="user-login-feedback" className={styles.error} data-error={Boolean(visibleError)} role={visibleError ? "alert" : "status"}>
                {visibleError ? <AlertCircle aria-hidden="true" /> : <Check aria-hidden="true" />}
                <span>{visibleError || notice}</span>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export function LoginWorkspace() {
  return <Suspense fallback={<main className={styles.surface} aria-busy="true" />}><LoginForm /></Suspense>;
}
