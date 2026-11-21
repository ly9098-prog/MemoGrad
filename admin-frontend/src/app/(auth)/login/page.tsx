"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type PointerEvent,
  useEffect,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AdminFooter } from "@/components/layout/admin-footer";
import { SliderCaptcha } from "@/components/security/slider-captcha";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { LoginResponse } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { safeInternalRedirect } from "@/lib/safe-redirect";
import styles from "./login.module.css";

type LoginMode = "password" | "email";

type OtpStartResponse = {
  challenge_id: string;
  expires_in: number;
  resend_after: number;
};

function updateCardTilt(event: PointerEvent<HTMLDivElement>) {
  if (
    event.pointerType !== "mouse"
    || !window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches
  ) {
    return;
  }
  const card = event.currentTarget;
  const bounds = (card.parentElement ?? card).getBoundingClientRect();
  const horizontal = Math.max(0, Math.min(1, (event.clientX - bounds.left) / card.offsetWidth));
  const vertical = Math.max(0, Math.min(1, (event.clientY - bounds.top) / card.offsetHeight));
  card.style.setProperty("--login-rotate-x", `${(0.5 - vertical) * 16}deg`);
  card.style.setProperty("--login-rotate-y", `${(horizontal - 0.5) * 20}deg`);
  card.style.setProperty("--login-pointer-x", `${horizontal * 100}%`);
  card.style.setProperty("--login-pointer-y", `${vertical * 100}%`);
}

function resetCardTilt(event: PointerEvent<HTMLDivElement>) {
  event.currentTarget.style.removeProperty("--login-rotate-x");
  event.currentTarget.style.removeProperty("--login-rotate-y");
  event.currentTarget.style.removeProperty("--login-pointer-x");
  event.currentTarget.style.removeProperty("--login-pointer-y");
}

export function loginErrorMessage(
  error: unknown,
  mode: LoginMode = "password",
) {
  if (error instanceof TypeError) return "网络异常，请检查连接后重试";
  if (!(error instanceof ApiError)) return "登录失败，请稍后重试";
  if (error.status === 401) {
    return mode === "email" ? "验证码无效或已过期" : "用户名或密码错误";
  }
  if (error.status === 403) return "当前账号无权访问管理后台";
  if (error.status === 409) return error.message || "账号状态已变化，请刷新后重试";
  if (error.status === 422) return error.message || "请检查填写内容";
  if (error.status === 429) return "尝试次数过多，请稍后再试";
  if (error.status >= 500) return "服务暂时不可用，请稍后再试";
  return error.message || "登录失败，请稍后重试";
}

function ResendCodeButton({
  seconds,
  loading,
  onResend,
}: {
  seconds: number;
  loading: boolean;
  onResend: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  return (
    <button
      type="button"
      className={styles.resendButton}
      disabled={loading || remaining > 0}
      onClick={onResend}
    >
      {remaining > 0 ? `${remaining} 秒后可重发` : "重新发送"}
    </button>
  );
}

function postLoginTarget(response: LoginResponse, next: string | null) {
  const destination = safeInternalRedirect(next);
  if (!response.user.must_change_password) return destination;
  return `/change-password?next=${encodeURIComponent(destination)}`;
}

function LoginForm() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);

  // Keep the credential form's state order stable for interaction tests.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [mode, setMode] = useState<LoginMode>("password");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resendAfter, setResendAfter] = useState(0);
  const [captchaOpen, setCaptchaOpen] = useState(false);

  const hasError = Boolean(error);
  const emailCodeSent = Boolean(challengeId);

  function selectMode(nextMode: LoginMode) {
    if (loading) return;
    setMode(nextMode);
    setError("");
    setChallengeId("");
    setCode("");
    setResendAfter(0);
    setCaptchaOpen(false);
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const response = await login(username, password);
      const next = new URLSearchParams(window.location.search).get("next");
      const target = response?.user?.must_change_password
        ? `/change-password?next=${encodeURIComponent(safeInternalRedirect(next))}`
        : safeInternalRedirect(next);
      router.replace(target);
    } catch (submitError) {
      setError(loginErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  function openEmailCaptcha() {
    if (loading || captchaOpen) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("请输入管理员邮箱");
      return;
    }
    setError("");
    setCaptchaOpen(true);
  }

  async function sendEmailCode(captchaTicket: string) {
    if (loading) return;
    const normalizedEmail = email.trim();
    setCaptchaOpen(false);
    setLoading(true);
    try {
      const response = await apiRequest<OtpStartResponse>("/auth/email/login/start", {
        method: "POST",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({
          email: normalizedEmail,
          captcha_ticket: captchaTicket,
        }),
      });
      setChallengeId(response.challenge_id);
      setResendAfter(response.resend_after);
      setCode("");
    } catch (submitError) {
      setError(loginErrorMessage(submitError, "email"));
    } finally {
      setLoading(false);
    }
  }

  function handleEmailStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openEmailCaptcha();
  }

  async function handleEmailVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || captchaOpen || code.length !== 6) return;
    setError("");
    setLoading(true);
    try {
      const response = await apiRequest<LoginResponse>("/auth/email/login/verify", {
        method: "POST",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({ challenge_id: challengeId, code }),
      });
      useAuthStore.getState().acceptLogin(response);
      router.replace(
        postLoginTarget(
          response,
          new URLSearchParams(window.location.search).get("next"),
        ),
      );
    } catch (submitError) {
      setError(loginErrorMessage(submitError, "email"));
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
        <span className={styles.accessLabel}><span />内部管理工作台</span>
      </header>
      <main className={styles.main}>
        <div className={styles.stage}>
          <div className={styles.cardTilt} onPointerMove={updateCardTilt} onPointerLeave={resetCardTilt}>
            <div className={styles.cardGlow} aria-hidden="true" />
            <div className={styles.edgeLights} aria-hidden="true">
              <span className={styles.edgeTop} /><span className={styles.edgeRight} />
              <span className={styles.edgeBottom} /><span className={styles.edgeLeft} />
            </div>
            <section className={styles.card} aria-labelledby="login-title">
              <div className={styles.cardHeading}>
                <span className={styles.mark} aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path d="M7 23V9l9 9 9-9v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <p className={styles.eyebrow}>MEMOGRAD CONSOLE</p>
                <h1 id="login-title">欢迎回来</h1>
                <p className={styles.subtitle}>选择一种方式，继续进入内容管理工作台</p>
              </div>

              <div className={styles.modeTabs} role="group" aria-label="管理员登录方式">
                <button
                  type="button"
                  aria-pressed={mode === "password"}
                  data-active={mode === "password" || undefined}
                  disabled={loading}
                  onClick={() => selectMode("password")}
                >
                  密码登录
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "email"}
                  data-active={mode === "email" || undefined}
                  disabled={loading}
                  onClick={() => selectMode("email")}
                >
                  邮箱验证码
                </button>
              </div>

              <div className={styles.loginPanel}>
                <form onSubmit={handlePasswordSubmit} className={styles.form} aria-busy={loading}
                  inert={mode !== "password"} aria-hidden={mode !== "password"}>
                  <div className={styles.field}>
                    <label htmlFor="username">用户名</label>
                    <div className={styles.inputShell} data-invalid={hasError || undefined}>
                      <UserRound className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.7} />
                      <Input
                        disabled={loading}
                        id="username" name="username" type="text" variant="ghost" className={styles.input}
                        value={username}
                        onChange={(event) => { setUsername(event.target.value); if (error) setError(""); }}
                        placeholder="请输入管理员用户名" autoComplete="username" autoCapitalize="none" spellCheck={false}
                        aria-invalid={hasError || undefined} aria-describedby={hasError ? "login-error" : undefined} required
                      />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="password">密码</label>
                    <div className={styles.inputShell} data-invalid={hasError || undefined}>
                      <LockKeyhole className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.7} />
                      <Input
                        disabled={loading}
                        id="password" name="password" type={showPassword ? "text" : "password"}
                        variant="ghost" className={styles.input} value={password}
                        onChange={(event) => { setPassword(event.target.value); if (error) setError(""); }}
                        placeholder="请输入登录密码" autoComplete="current-password"
                        aria-invalid={hasError || undefined} aria-describedby={hasError ? "login-error" : undefined} required
                      />
                      <button type="button" className={styles.visibilityToggle}
                        aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} aria-controls="password"
                        onClick={() => setShowPassword((visible) => !visible)}
                      >
                        {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                  <div className={styles.formMeta}>
                    <span>已验证邮箱也可免密码登录</span>
                    <Link href="/forgot-password">忘记密码</Link>
                  </div>
                  <button type="submit" className={styles.submit} disabled={loading} aria-busy={loading}>
                    {loading ? (
                      <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在校验</span></>
                    ) : (
                      <><span>登录工作台</span><ArrowRight aria-hidden="true" /></>
                    )}
                  </button>
                </form>
                <form onSubmit={handleEmailStart} className={styles.form} aria-busy={loading}
                  inert={mode !== "email" || emailCodeSent} aria-hidden={mode !== "email" || emailCodeSent}>
                  <div className={styles.field}>
                    <label htmlFor="admin-email">管理员邮箱</label>
                    <div className={styles.inputShell} data-invalid={hasError || undefined}>
                      <Mail className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.7} />
                      <Input
                        disabled={loading || captchaOpen}
                        id="admin-email"
                        name="email"
                        type="email"
                        variant="ghost"
                        className={styles.input}
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          if (captchaOpen) setCaptchaOpen(false);
                          if (error) setError("");
                        }}
                        placeholder="name@example.com"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-invalid={hasError || undefined}
                        aria-describedby={hasError ? "login-error" : undefined}
                        required
                      />
                    </div>
                  </div>
                  {captchaOpen && !emailCodeSent && (
                    <SliderCaptcha
                      onVerified={(ticket) => void sendEmailCode(ticket)}
                      onCancel={() => setCaptchaOpen(false)}
                    />
                  )}
                  <button type="submit" className={styles.submit} disabled={loading || captchaOpen} aria-busy={loading}>
                    {loading ? (
                      <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在发送</span></>
                    ) : (
                      <><span>发送验证码</span><ArrowRight aria-hidden="true" /></>
                    )}
                  </button>
                </form>
                <form onSubmit={handleEmailVerify} className={styles.form} aria-busy={loading}
                  inert={mode !== "email" || !emailCodeSent} aria-hidden={mode !== "email" || !emailCodeSent}>
                  <div className={styles.field}>
                    <label htmlFor="email-code">6 位验证码</label>
                    <OtpInput
                      id="email-code"
                      name="code"
                      value={code}
                      onChange={(value) => {
                        setCode(value);
                        if (error) setError("");
                      }}
                      disabled={loading}
                      invalid={hasError}
                      describedBy={hasError ? "login-error" : undefined}
                      ariaLabel="6 位邮箱验证码"
                      required
                    />
                  </div>
                  {captchaOpen && emailCodeSent && (
                    <SliderCaptcha
                      onVerified={(ticket) => void sendEmailCode(ticket)}
                      onCancel={() => setCaptchaOpen(false)}
                    />
                  )}
                  <div className={styles.otpActions}>
                    <button type="button" className={styles.backButton} disabled={loading || captchaOpen} onClick={() => {
                      setCaptchaOpen(false);
                      setChallengeId("");
                    }}>
                      <ArrowLeft aria-hidden="true" />
                      修改邮箱
                    </button>
                    <ResendCodeButton
                      key={challengeId}
                      seconds={resendAfter}
                      loading={loading || captchaOpen}
                      onResend={openEmailCaptcha}
                    />
                  </div>
                  <button type="submit" className={styles.submit} disabled={loading || captchaOpen || code.length !== 6} aria-busy={loading}>
                    {loading ? (
                      <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在验证</span></>
                    ) : (
                      <><span>安全登录</span><ArrowRight aria-hidden="true" /></>
                    )}
                  </button>
                </form>
              </div>

              <div
                id={hasError ? "login-error" : undefined}
                role={hasError ? "alert" : undefined}
                aria-live={hasError ? "assertive" : undefined}
                className={styles.cardFooter}
                data-error={hasError || undefined}
              >
                {hasError ? (
                  <><AlertCircle aria-hidden="true" /><p>{error}</p></>
                ) : (
                  <><ShieldCheck aria-hidden="true" /><p>仅限授权管理员访问 · 用户与管理员会话互相隔离</p></>
                )}
              </div>
            </section>
          </div>
          <p className={styles.support}>
            <Link href={`${process.env.NEXT_PUBLIC_USER_WEB_BASE_URL || ""}/account/login`}>
              普通用户登录
            </Link>
            <span aria-hidden="true">·</span>
            管理员问题请<a href="mailto:{{SECRET_d8zo1uvg}}">联系超级管理员</a>
          </p>
        </div>
      </main>
      <div className={styles.footer}><AdminFooter variant="auth" /></div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
