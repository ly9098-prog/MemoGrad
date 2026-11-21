"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useState,
} from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AdminFooter } from "@/components/layout/admin-footer";
import { AuthToast, type AuthToastState, type AuthToastTone } from "@/components/auth/auth-toast";
import {
  EmailOtpLoginForm,
  type EmailOtpStartResult,
} from "@/components/auth/email-otp-login-form";
import { LoginCard } from "@/components/auth/login-card";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { LoginResponse } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { safeInternalRedirect } from "@/lib/safe-redirect";
import styles from "./login.module.css";

type LoginMode = "password" | "email";

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
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<LoginMode>("password");
  const [emailBusy, setEmailBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [toast, setToast] = useState<AuthToastState | null>(null);
  const showToast = useCallback(
    (message: string, tone: AuthToastTone = "info") => {
      setToast({ id: Date.now(), message, tone });
    },
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);
  const disabled = loading || emailBusy || finishing;

  function selectMode(nextMode: LoginMode) {
    if (disabled) return;
    setMode(nextMode);
  }

  function finishLogin(destination: string) {
    setFinishing(true);
    showToast("登录成功，正在进入管理工作台", "success");
    window.setTimeout(() => {
      router.replace(destination);
    }, 900);
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setLoading(true);
    try {
      const response = await login(username, password);
      finishLogin(
        postLoginTarget(
          response,
          new URLSearchParams(window.location.search).get("next"),
        ),
      );
    } catch (submitError) {
      showToast(loginErrorMessage(submitError), "danger");
    } finally {
      setLoading(false);
    }
  }

  function startEmailCode(input: { email: string; captchaTicket: string }) {
    return apiRequest<EmailOtpStartResult>("/auth/email/login/start", {
      method: "POST",
      scope: "admin",
      skipRefresh: true,
      exposeErrorDetail: true,
      body: JSON.stringify({
        email: input.email,
        captcha_ticket: input.captchaTicket,
      }),
    });
  }

  function verifyEmailCode(input: { challengeId: string; code: string }) {
    return apiRequest<LoginResponse>("/auth/email/login/verify", {
      method: "POST",
      scope: "admin",
      skipRefresh: true,
      exposeErrorDetail: true,
      body: JSON.stringify({
        challenge_id: input.challengeId,
        code: input.code,
      }),
    });
  }

  function handleEmailVerified(response: LoginResponse) {
    useAuthStore.getState().acceptLogin(response);
    finishLogin(
      postLoginTarget(
        response,
        new URLSearchParams(window.location.search).get("next"),
      ),
    );
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
        <LoginCard titleId="login-title" support={
          <p className={styles.support}>
            <Link href={`${process.env.NEXT_PUBLIC_USER_WEB_BASE_URL || ""}/account/login`}>
              普通用户登录
            </Link>
            <span aria-hidden="true">·</span>
            管理员问题请<a href="mailto:{{SECRET_d8zo1uvg}}">联系超级管理员</a>
          </p>
        }>
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
                  disabled={disabled}
                  onClick={() => selectMode("password")}
                >
                  密码登录
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "email"}
                  data-active={mode === "email" || undefined}
                  disabled={disabled}
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
                    <div className={styles.inputShell}>
                      <UserRound className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.7} />
                      <Input
                        disabled={loading}
                        id="username" name="username" type="text" variant="ghost" className={styles.input}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="请输入管理员用户名" autoComplete="username" autoCapitalize="none" spellCheck={false}
                        required
                      />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="password">密码</label>
                    <div className={styles.inputShell}>
                      <LockKeyhole className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.7} />
                      <Input
                        disabled={loading}
                        id="password" name="password" type={showPassword ? "text" : "password"}
                        variant="ghost" className={styles.input} value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="请输入登录密码" autoComplete="current-password"
                        required
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
                  <button type="submit" className={styles.submit} disabled={disabled} aria-busy={loading || finishing}>
                    {loading ? (
                      <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在校验</span></>
                    ) : (
                      <><span>登录工作台</span><ArrowRight aria-hidden="true" /></>
                    )}
                  </button>
                </form>
                <EmailOtpLoginForm<LoginResponse>
                  idPrefix="admin"
                  emailLabel="管理员邮箱"
                  scope="admin"
                  active={mode === "email"}
                  disabled={disabled}
                  start={startEmailCode}
                  verify={verifyEmailCode}
                  onVerified={handleEmailVerified}
                  formatError={(submitError) =>
                    loginErrorMessage(submitError, "email")
                  }
                  onError={(message) => showToast(message, "danger")}
                  onInfo={(message) => showToast(message, "info")}
                  onBusyChange={setEmailBusy}
                />
              </div>

              <div className={styles.cardFooter}>
                <ShieldCheck aria-hidden="true" />
                <p>仅限授权管理员访问 · 用户与管理员会话互相隔离</p>
              </div>
        </LoginCard>
      </main>
      <div className={styles.footer}><AdminFooter variant="auth" /></div>
      <AuthToast toast={toast} onClose={closeToast} />
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
