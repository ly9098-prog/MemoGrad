"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { SliderCaptcha } from "@/components/slider-captcha";
import { OtpInput } from "@/components/otp-input";
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

type LoginMode = "password" | "email" | "github";
type PendingAction = "password" | "register" | "email" | "github";
type LoginErrorField =
  | "account"
  | "username"
  | "email"
  | "password"
  | "confirmPassword"
  | "code"
  | "consent";

type LoginError = {
  message: string;
  field?: LoginErrorField;
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
  const accountInput = useRef<HTMLInputElement>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const registerEmailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const registerPasswordInput = useRef<HTMLInputElement>(null);
  const confirmPasswordInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const consentInput = useRef<HTMLInputElement>(null);
  const applyAuth = useUserAuth((state) => state.applyAuth);

  const [mode, setMode] = useState<LoginMode>("password");
  const [registering, setRegistering] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resendAfter, setResendAfter] = useState(0);
  const [registerChallengeId, setRegisterChallengeId] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [registerResendAfter, setRegisterResendAfter] = useState(0);

  const [sentEmail, setSentEmail] = useState("");
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<LoginError | null>(null);
  const [urlNotice, setUrlNotice] = useState("");
  const [urlError, setUrlError] = useState("");

  const emailCodeSent = Boolean(challengeId);
  const registrationCodeSent = Boolean(registerChallengeId);
  const busy = pending !== null;
  const visibleError = error?.message || urlError || urlNotice;
  const hasError = Boolean(error?.message || urlError);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const params = new URLSearchParams(window.location.search);
      setUrlError(AUTH_ERRORS[params.get("auth_error") ?? ""] ?? "");
      setUrlNotice(
        params.has("email_changed")
          ? "邮箱已更新，请重新登录"
          : params.has("identity_unlinked")
            ? "登录方式已解绑，请重新登录"
            : "",
      );
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (busy || !error?.field) return;
    const input = error.field === "consent"
      ? consentInput
      : error.field === "code"
        ? codeInput
        : error.field === "account"
          ? accountInput
          : error.field === "username"
            ? usernameInput
            : error.field === "email"
              ? registering
                ? registerEmailInput
                : emailInput
              : error.field === "password"
                ? registering
                  ? registerPasswordInput
                  : passwordInput
                : confirmPasswordInput;
    input.current?.focus();
  }, [busy, error, registering]);

  function clearError() {
    setError(null);
  }

  function selectMode(nextMode: LoginMode) {
    if (busy) return;
    setMode(nextMode);
    setRegistering(false);
    setChallengeId("");
    setCode("");
    setResendAfter(0);
    setRegisterChallengeId("");
    setRegisterCode("");
    setRegisterResendAfter(0);
    setCaptchaOpen(false);
    clearError();
  }

  function requireConsent() {
    if (agreed) return true;
    setError({ message: "请先阅读并同意用户协议和隐私政策", field: "consent" });
    return false;
  }

  async function startGithub() {
    if (busy || !requireConsent()) return;
    clearError();
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
      setError({ message: messageFor(submitError) });
      setPending(null);
    }
  }

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !account.trim() || !password) return;
    clearError();
    setPending("password");
    try {
      const response = await apiRequest<WebAuthResponse>("/auth/password/login", {
        method: "POST",
        skipRefresh: true,
        body: JSON.stringify({ account: account.trim(), password, client: "web" }),
      });
      applyAuth(response);
      router.replace("/");
    } catch (submitError) {
      setError({
        message: messageFor(submitError),
        field: submitError instanceof ApiError && submitError.status === 401
          ? "password"
          : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  function openRegistrationCaptcha(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || captchaOpen) return;
    if (!username.trim()) {
      setError({ message: "请输入账号名称", field: "username" });
      return;
    }
    if (!registerEmail.trim()) {
      setError({ message: "请输入邮箱地址", field: "email" });
      return;
    }
    if (!registerPassword) {
      setError({ message: "请设置登录密码", field: "password" });
      return;
    }
    if (registerPassword !== confirmPassword) {
      setError({ message: "两次输入的密码不一致", field: "confirmPassword" });
      return;
    }
    if (!requireConsent()) return;
    clearError();
    setCaptchaOpen(true);
  }

  async function sendRegistrationCode(captchaTicket: string) {
    if (busy || !requireConsent()) {
      setCaptchaOpen(false);
      return;
    }
    setCaptchaOpen(false);
    clearError();
    setPending("register");
    try {
      const response = await apiRequest<OtpStartResponse>(
        "/auth/password/register/start",
        {
          method: "POST",
          skipRefresh: true,
          body: JSON.stringify({
            username: username.trim(),
            email: registerEmail.trim(),
            password: registerPassword,
            captcha_ticket: captchaTicket,
            accepted_terms: true,
            agreement_version: USER_AGREEMENT_VERSION,
            privacy_version: PRIVACY_POLICY_VERSION,
          }),
        },
      );
      setRegisterChallengeId(response.challenge_id);
      setRegisterResendAfter(response.resend_after);
      setRegisterCode("");
      setSentEmail(registerEmail.trim());
    } catch (submitError) {
      setError({ message: messageFor(submitError) });
    } finally {
      setPending(null);
    }
  }

  async function verifyRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || captchaOpen || registerCode.length !== 6) return;
    clearError();
    setPending("register");
    try {
      const response = await apiRequest<WebAuthResponse>(
        "/auth/password/register/verify",
        {
          method: "POST",
          skipRefresh: true,
          body: JSON.stringify({
            challenge_id: registerChallengeId,
            code: registerCode,
            client: "web",
          }),
        },
      );
      applyAuth(response);
      router.replace("/");
    } catch (submitError) {
      setError({
        message: messageFor(submitError),
        field: submitError instanceof ApiError && [400, 422].includes(submitError.status)
          ? "code"
          : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  function openEmailCaptcha() {
    if (busy || captchaOpen) return;
    if (!email.trim()) {
      setError({ message: "请输入邮箱地址", field: "email" });
      return;
    }
    if (!requireConsent()) return;
    clearError();
    setCaptchaOpen(true);
  }

  async function sendEmail(captchaTicket: string) {
    if (busy || !requireConsent()) {
      setCaptchaOpen(false);
      return;
    }
    setCaptchaOpen(false);
    clearError();
    setPending("email");
    try {
      const response = await apiRequest<OtpStartResponse>("/auth/email/start", {
        method: "POST",
        skipRefresh: true,
        body: JSON.stringify({
          email: email.trim(),
          captcha_ticket: captchaTicket,
          client: "web",
          accepted_terms: true,
          agreement_version: USER_AGREEMENT_VERSION,
          privacy_version: PRIVACY_POLICY_VERSION,
        }),
      });
      setChallengeId(response.challenge_id);
      setResendAfter(response.resend_after);
      setCode("");
      setSentEmail(email.trim());
    } catch (submitError) {
      setError({ message: messageFor(submitError) });
    } finally {
      setPending(null);
    }
  }

  async function verifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || captchaOpen || code.length !== 6 || !requireConsent()) return;
    clearError();
    setPending("email");
    try {
      const response = await apiRequest<WebAuthResponse>("/auth/email/verify", {
        method: "POST",
        skipRefresh: true,
        body: JSON.stringify({
          challenge_id: challengeId,
          code,
          client: "web",
        }),
      });
      applyAuth(response);
      router.replace("/");
    } catch (submitError) {
      setError({
        message: messageFor(submitError),
        field: submitError instanceof ApiError && [400, 422].includes(submitError.status)
          ? "code"
          : undefined,
      });
    } finally {
      setPending(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (mode === "github") {
      event.preventDefault();
      void startGithub();
      return;
    }
    if (mode === "password") {
      if (!registering) {
        void loginWithPassword(event);
      } else if (!registrationCodeSent) {
        openRegistrationCaptcha(event);
      } else {
        void verifyRegistration(event);
      }
      return;
    }
    if (!emailCodeSent) {
      event.preventDefault();
      openEmailCaptcha();
    } else {
      void verifyEmail(event);
    }
  }

  const title = mode === "password" && registering
    ? registrationCodeSent
      ? "验证注册邮箱"
      : "创建账号"
    : mode === "email" && emailCodeSent
      ? "验证邮箱"
      : "登录账户";
  const subtitle = mode === "github"
    ? "使用 GitHub 授权，继续进入你的学习账号"
    : mode === "password" && registering
      ? registrationCodeSent
        ? "输入验证码完成账号创建"
        : "验证邮箱后创建账号密码登录方式"
      : mode === "password"
        ? "使用账号名称或已验证邮箱登录"
        : "使用已验证邮箱接收一次性验证码";

  const submitDisabled = mode === "password"
    ? registering
      ? registrationCodeSent
        ? busy || captchaOpen || registerCode.length !== 6
        : busy || captchaOpen
      : busy || !account.trim() || !password
    : mode === "email"
      ? busy || captchaOpen || (emailCodeSent && code.length !== 6)
      : busy;

  return (
    <div className={styles.surface} data-user-auth-shell>
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.upperGlow} />
        <div className={styles.lowerGlow} />
      </div>
      <header className={styles.header}>
        <span className={styles.wordmark}>MemoGrad<span>USER</span></span>
        <span className={styles.accessLabel}><span />用户账户中心</span>
      </header>
      <main className={styles.main}>
        <div className={styles.stage}>
          <div
            className={styles.cardTilt}
            onPointerMove={updateCardTilt}
            onPointerLeave={resetCardTilt}
          >
            <div className={styles.cardGlow} aria-hidden="true" />
            <div className={styles.edgeLights} aria-hidden="true">
              <span className={styles.edgeTop} /><span className={styles.edgeRight} />
              <span className={styles.edgeBottom} /><span className={styles.edgeLeft} />
            </div>
            <section className={styles.card} aria-labelledby="user-login-title">
              <div className={styles.cardHeading}>
                <span className={styles.mark} aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path
                      d="M7 23V9l9 9 9-9v14"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <p className={styles.eyebrow}>MEMOGRAD ACCOUNT</p>
                <h1 id="user-login-title">{title}</h1>
                <p className={styles.subtitle}>{subtitle}</p>
              </div>

              <div className={styles.modeTabs} role="group" aria-label="用户登录方式">
                {([
                  ["password", "账号密码"],
                  ["email", "邮箱验证码"],
                  ["github", "GitHub"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    data-active={mode === value || undefined}
                    disabled={busy}
                    onClick={() => selectMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form className={styles.form} onSubmit={handleSubmit} aria-busy={busy}>
                {mode === "github" ? (
                  <>
                    <div className={styles.githubIntro}>
                      <Image
                        src="/github-invertocat-white.svg"
                        alt=""
                        width={24}
                        height={24}
                      />
                      <div>
                        <strong>GitHub 安全登录</strong>
                        <span>使用 GitHub 数字账号 ID 识别你的身份</span>
                      </div>
                    </div>
                    <div className={styles.githubFacts}>
                      <p><ShieldCheck aria-hidden="true" />仅申请 read:user 权限读取身份信息</p>
                      <p><Check aria-hidden="true" />GitHub 邮箱不会自动成为本站已验证邮箱</p>
                    </div>
                  </>
                ) : null}

                {mode === "password" && !registering ? (
                  <>
                    <div className={styles.field}>
                      <label htmlFor="user-account">账号名称或邮箱</label>
                      <div
                        className={styles.inputShell}
                        data-invalid={error?.field === "account" || error?.field === "password" || undefined}
                      >
                        <UserRound className={styles.fieldIcon} aria-hidden="true" />
                        <input
                          id="user-account"
                          ref={accountInput}
                          type="text"
                          className={styles.input}
                          value={account}
                          onChange={(event) => {
                            setAccount(event.target.value);
                            clearError();
                          }}
                          placeholder="name 或 name@example.com"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          disabled={busy}
                          required
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="user-password">密码</label>
                      <div
                        className={styles.inputShell}
                        data-invalid={error?.field === "password" || undefined}
                      >
                        <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
                        <input
                          id="user-password"
                          ref={passwordInput}
                          type={showPassword ? "text" : "password"}
                          className={styles.input}
                          value={password}
                          onChange={(event) => {
                            setPassword(event.target.value);
                            clearError();
                          }}
                          placeholder="请输入登录密码"
                          autoComplete="current-password"
                          disabled={busy}
                          required
                        />
                        <button
                          type="button"
                          className={styles.visibilityToggle}
                          aria-label={showPassword ? "隐藏密码" : "显示密码"}
                          aria-pressed={showPassword}
                          onClick={() => setShowPassword((visible) => !visible)}
                        >
                          {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                    <div className={styles.accountSwitch}>
                      <span>还没有账号？</span>
                      <button
                        type="button"
                        onClick={() => {
                          setRegistering(true);
                          clearError();
                          window.setTimeout(() => usernameInput.current?.focus(), 0);
                        }}
                      >
                        创建账号
                      </button>
                    </div>
                  </>
                ) : null}

                {mode === "password" && registering && !registrationCodeSent ? (
                  <>
                    <div className={styles.emailIntro}>
                      <Mail aria-hidden="true" />
                      <p>账号名称用于密码登录；邮箱验证通过后不可被其他账号重复使用。</p>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="register-username">账号名称</label>
                      <div className={styles.inputShell} data-invalid={error?.field === "username" || undefined}>
                        <UserRound className={styles.fieldIcon} aria-hidden="true" />
                        <input
                          id="register-username"
                          ref={usernameInput}
                          type="text"
                          className={styles.input}
                          value={username}
                          onChange={(event) => {
                            setUsername(event.target.value);
                            clearError();
                          }}
                          placeholder="3 至 32 个字符"
                          autoComplete="username"
                          autoCapitalize="none"
                          spellCheck={false}
                          disabled={busy || captchaOpen}
                          required
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="register-email">邮箱地址</label>
                      <div className={styles.inputShell} data-invalid={error?.field === "email" || undefined}>
                        <Mail className={styles.fieldIcon} aria-hidden="true" />
                        <input
                          id="register-email"
                          ref={registerEmailInput}
                          type="email"
                          className={styles.input}
                          value={registerEmail}
                          onChange={(event) => {
                            setRegisterEmail(event.target.value);
                            clearError();
                          }}
                          placeholder="name@example.com"
                          autoComplete="email"
                          autoCapitalize="none"
                          spellCheck={false}
                          disabled={busy || captchaOpen}
                          required
                        />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="register-password">设置密码</label>
                      <div className={styles.inputShell} data-invalid={error?.field === "password" || undefined}>
                        <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
                        <input
                          id="register-password"
                          ref={registerPasswordInput}
                          type={showPassword ? "text" : "password"}
                          className={styles.input}
                          value={registerPassword}
                          onChange={(event) => {
                            setRegisterPassword(event.target.value);
                            clearError();
                          }}
                          placeholder="至少 12 位，含大小写字母和数字"
                          autoComplete="new-password"
                          disabled={busy || captchaOpen}
                          required
                        />
                        <button
                          type="button"
                          className={styles.visibilityToggle}
                          aria-label={showPassword ? "隐藏密码" : "显示密码"}
                          aria-pressed={showPassword}
                          onClick={() => setShowPassword((visible) => !visible)}
                        >
                          {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="register-password-confirm">确认密码</label>
                      <div className={styles.inputShell} data-invalid={error?.field === "confirmPassword" || undefined}>
                        <ShieldCheck className={styles.fieldIcon} aria-hidden="true" />
                        <input
                          id="register-password-confirm"
                          ref={confirmPasswordInput}
                          type={showPassword ? "text" : "password"}
                          className={styles.input}
                          value={confirmPassword}
                          onChange={(event) => {
                            setConfirmPassword(event.target.value);
                            clearError();
                          }}
                          placeholder="再次输入密码"
                          autoComplete="new-password"
                          disabled={busy || captchaOpen}
                          required
                        />
                      </div>
                    </div>
                    <div className={styles.accountSwitch}>
                      <span>已有账号？</span>
                      <button
                        type="button"
                        disabled={busy || captchaOpen}
                        onClick={() => {
                          setCaptchaOpen(false);
                          setRegisterChallengeId("");
                          setRegisterCode("");
                          setRegistering(false);
                          clearError();
                          window.setTimeout(() => accountInput.current?.focus(), 0);
                        }}
                      >
                        返回登录
                      </button>
                    </div>
                  </>
                ) : null}

                {mode === "password" && registering && registrationCodeSent ? (
                  <>
                    <div className={styles.emailIntro} data-success>
                      <ShieldCheck aria-hidden="true" />
                      <p>
                        验证码已发送至
                        <strong className={styles.sentEmail}>{sentEmail || "注册邮箱"}</strong>
                        ，验证后将自动登录。
                      </p>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="register-code">6 位验证码</label>
                      <OtpInput
                        id="register-code"
                        name="register-code"
                        value={registerCode}
                        onChange={(value) => {
                          setRegisterCode(value);
                          clearError();
                        }}
                        disabled={busy || captchaOpen}
                        invalid={error?.field === "code"}
                        describedBy={hasError ? "user-login-feedback" : undefined}
                        inputRef={codeInput}
                        ariaLabel="6 位注册验证码"
                        required
                      />
                    </div>
                    <div className={styles.otpActions}>
                      <button
                        type="button"
                        className={styles.backButton}
                        disabled={busy || captchaOpen}
                        onClick={() => {
                          setRegisterChallengeId("");
                          setRegisterCode("");
                        }}
                      >
                        <ArrowLeft aria-hidden="true" />
                        修改信息
                      </button>
                      <ResendButton
                        key={`${registerChallengeId}-${registerResendAfter}`}
                        seconds={registerResendAfter}
                        busy={busy || captchaOpen}
                        onResend={() => setCaptchaOpen(true)}
                      />
                    </div>
                  </>
                ) : null}

                {mode === "email" && !emailCodeSent ? (
                  <>
                    <div className={styles.field}>
                      <label htmlFor="user-email">邮箱地址</label>
                      <div className={styles.inputShell} data-invalid={error?.field === "email" || undefined}>
                        <Mail className={styles.fieldIcon} aria-hidden="true" />
                        <input
                          id="user-email"
                          ref={emailInput}
                          type="email"
                          className={styles.input}
                          value={email}
                          onChange={(event) => {
                            setEmail(event.target.value);
                            clearError();
                          }}
                          placeholder="name@example.com"
                          autoComplete="email"
                          autoCapitalize="none"
                          spellCheck={false}
                          disabled={busy || captchaOpen}
                          required
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                {mode === "email" && emailCodeSent ? (
                  <>
                    <div className={styles.emailIntro} data-success>
                      <ShieldCheck aria-hidden="true" />
                      <p>
                        验证码已发送至
                        <strong className={styles.sentEmail}>{sentEmail || "用户邮箱"}</strong>
                        ，5 分钟内有效。
                      </p>
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="user-code">6 位验证码</label>
                      <OtpInput
                        id="user-code"
                        name="user-code"
                        value={code}
                        onChange={(value) => {
                          setCode(value);
                          clearError();
                        }}
                        disabled={busy || captchaOpen}
                        invalid={error?.field === "code"}
                        describedBy={hasError ? "user-login-feedback" : undefined}
                        inputRef={codeInput}
                        ariaLabel="6 位邮箱验证码"
                        required
                      />
                    </div>
                    <div className={styles.otpActions}>
                      <button
                        type="button"
                        className={styles.backButton}
                        disabled={busy || captchaOpen}
                        onClick={() => {
                          setChallengeId("");
                          setCode("");
                        }}
                      >
                        <ArrowLeft aria-hidden="true" />
                        修改邮箱
                      </button>
                      <ResendButton
                        key={`${challengeId}-${resendAfter}`}
                        seconds={resendAfter}
                        busy={busy || captchaOpen}
                        onResend={openEmailCaptcha}
                      />
                    </div>
                  </>
                ) : null}

                {captchaOpen ? (
                  <SliderCaptcha
                    onVerified={(ticket) => {
                      if (mode === "password" && registering) void sendRegistrationCode(ticket);
                      else void sendEmail(ticket);
                    }}
                    onCancel={() => setCaptchaOpen(false)}
                  />
                ) : null}

                <button
                  type="submit"
                  className={styles.submit}
                  disabled={submitDisabled}
                  aria-busy={busy}
                >
                  {busy ? (
                    <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在处理</span></>
                  ) : (
                    <>
                      <span>
                        {mode === "github"
                          ? "使用 GitHub 继续"
                          : mode === "password"
                            ? registering
                              ? registrationCodeSent
                                ? "完成注册"
                                : "验证邮箱并注册"
                              : "登录账户"
                            : emailCodeSent
                              ? "验证并登录"
                              : "发送验证码"}
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>

              {mode !== "password" || registering ? (
                <label className={styles.consentRow}>
                  <input
                    ref={consentInput}
                    type="checkbox"
                    checked={agreed}
                    disabled={busy || captchaOpen}
                    onChange={(event) => {
                      setAgreed(event.target.checked);
                      clearError();
                    }}
                    aria-invalid={error?.field === "consent" || undefined}
                    aria-describedby={error?.field === "consent" ? "user-login-feedback" : undefined}
                  />
                  <span className={styles.consentCheck} aria-hidden="true" />
                  <span>
                    同意
                    <Link href="/agreements/user" target="_blank" rel="noopener noreferrer">用户协议</Link>
                    、
                    <Link href="/agreements/privacy" target="_blank" rel="noopener noreferrer">隐私政策</Link>
                    和
                    <Link href="/agreements/ai" target="_blank" rel="noopener noreferrer">AI 免责声明</Link>
                  </span>
                </label>
              ) : null}

              <div
                id={hasError ? "user-login-feedback" : undefined}
                role={hasError ? "alert" : visibleError ? "status" : undefined}
                aria-live={hasError || visibleError ? "polite" : undefined}
                className={styles.cardFooter}
                data-error={hasError || undefined}
                data-notice={!hasError && visibleError ? true : undefined}
              >
                {hasError ? (
                  <><AlertCircle aria-hidden="true" /><p>{visibleError}</p></>
                ) : visibleError ? (
                  <><Check aria-hidden="true" /><p>{visibleError}</p></>
                ) : (
                  <><ShieldCheck aria-hidden="true" /><p>普通用户与管理员账号使用独立会话</p></>
                )}
              </div>
            </section>
          </div>
          <p className={styles.support}>一个账号，连接 GitHub、邮箱与微信学习身份</p>
        </div>
      </main>
      <div className={styles.footer}>
        <footer className={styles.footerInner}>
          <span>© {new Date().getFullYear()} MemoGrad</span>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
          >
            桂ICP备2026003057号-1
          </a>
        </footer>
      </div>
    </div>
  );
}

export function LoginWorkspace() {
  return <LoginForm />;
}
