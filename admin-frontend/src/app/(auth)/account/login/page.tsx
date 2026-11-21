"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  GitBranch,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { SliderCaptcha } from "@/components/security/slider-captcha";
import { LoginCard } from "@/components/auth/login-card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type {
  GithubStartResponse,
  LearnerAuthResponse,
  LearnerOtpStartResponse,
} from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { safeLearnerNext } from "@/lib/auth/learner-next";
import { useAuthBootstrap } from "@/lib/auth/use-auth-bootstrap";
import styles from "../../login/login.module.css";

const USER_AGREEMENT_VERSION =
  process.env.NEXT_PUBLIC_USER_AGREEMENT_VERSION || "2026-11-20";
const PRIVACY_POLICY_VERSION =
  process.env.NEXT_PUBLIC_PRIVACY_POLICY_VERSION || "2026-11-20";

const AUTH_ERRORS: Record<string, string> = {
  github_cancelled: "GitHub 授权已取消",
  github_failed: "GitHub 登录未能完成，请重试",
  account_unavailable: "该身份关联的账号当前不可用",
  identity_already_exists: "该 GitHub 身份已绑定到其他账号",
};

type LoginMode = "password" | "email";
type PendingAction = "password" | "register" | "email" | "github";

function messageFor(error: unknown, mode: LoginMode = "password") {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return mode === "email" ? "验证码不正确或已过期" : "账号或密码不正确";
    }
    if (error.status === 409) return error.message || "账号状态已变化，请刷新后重试";
    if (error.status === 429) return "尝试次数过多，请稍后再试";
    if (error.status >= 500) return "服务暂时不可用，请稍后再试";
    return error.message;
  }
  if (error instanceof TypeError) return "网络连接失败，请检查后重试";
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
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

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

export default function LearnerLoginPage() {
  const router = useRouter();
  const accessMode = useAuthStore((state) => state.accessMode);
  const acceptLearnerLogin = useAuthStore((state) => state.acceptLearnerLogin);
  const consentRef = useRef<HTMLInputElement>(null);
  useAuthBootstrap();

  const [mode, setMode] = useState<LoginMode>("password");
  const [registering, setRegistering] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resendAfter, setResendAfter] = useState(0);
  const [registerChallengeId, setRegisterChallengeId] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [registerResendAfter, setRegisterResendAfter] = useState(0);

  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [captchaPurpose, setCaptchaPurpose] = useState<
    "login-email" | "register"
  >("login-email");

  const emailCodeSent = Boolean(challengeId);
  const registrationCodeSent = Boolean(registerChallengeId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = AUTH_ERRORS[params.get("auth_error") || ""];
    if (authError) setError(authError);
    if (params.has("identity_unlinked")) {
      setNotice("登录身份已解绑，请重新登录。");
    }
  }, []);

  useEffect(() => {
    if (accessMode === "user") {
      router.replace(
        safeLearnerNext(new URLSearchParams(window.location.search).get("next")),
      );
    } else if (accessMode === "admin") {
      router.replace("/dashboard");
    }
  }, [accessMode, router]);

  function requireConsent() {
    if (agreed) return true;
    setConsentOpen(true);
    return false;
  }

  function begin(action: PendingAction) {
    setError("");
    setPending(action);
    setBusy(true);
  }

  function finish() {
    setPending(null);
    setBusy(false);
  }

  function switchMode(nextMode: LoginMode) {
    if (busy) return;
    setMode(nextMode);
    setRegistering(false);
    setCaptchaOpen(false);
    setError("");
  }

  function clearError() {
    if (error) setError("");
  }

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !account.trim() || !password) return;
    if (!requireConsent()) return;
    begin("password");
    try {
      const response = await apiRequest<LearnerAuthResponse>(
        "/auth/password/login",
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          exposeErrorDetail: true,
          body: JSON.stringify({
            account: account.trim(),
            password,
            client: "web",
          }),
        },
      );
      acceptLearnerLogin(response);
      router.replace(
        safeLearnerNext(new URLSearchParams(window.location.search).get("next")),
      );
    } catch (submitError) {
      setError(messageFor(submitError, "password"));
    } finally {
      finish();
    }
  }

  function openRegisterCaptcha(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || captchaOpen) return;
    if (!username.trim()) return setError("请输入账号名称");
    if (!registerEmail.trim()) return setError("请输入邮箱地址");
    if (registerPassword.length < 12) return setError("密码至少需要 12 位");
    if (registerPassword !== confirmPassword) return setError("两次输入的密码不一致");
    if (!requireConsent()) return;
    setError("");
    setCaptchaPurpose("register");
    setCaptchaOpen(true);
  }

  async function sendRegisterCode(ticket: string) {
    setCaptchaOpen(false);
    if (!requireConsent()) return;
    begin("register");
    try {
      const response = await apiRequest<LearnerOtpStartResponse>(
        "/auth/password/register/start",
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          exposeErrorDetail: true,
          body: JSON.stringify({
            username: username.trim(),
            email: registerEmail.trim(),
            password: registerPassword,
            captcha_ticket: ticket,
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
      setError(messageFor(submitError, "email"));
    } finally {
      finish();
    }
  }

  async function verifyRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || registerCode.length !== 6) return;
    if (!requireConsent()) return;
    begin("register");
    try {
      const response = await apiRequest<LearnerAuthResponse>(
        "/auth/password/register/verify",
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          exposeErrorDetail: true,
          body: JSON.stringify({
            challenge_id: registerChallengeId,
            code: registerCode,
            client: "web",
          }),
        },
      );
      acceptLearnerLogin(response);
      router.replace(
        safeLearnerNext(new URLSearchParams(window.location.search).get("next")),
      );
    } catch (submitError) {
      setError(messageFor(submitError, "email"));
    } finally {
      finish();
    }
  }

  function openEmailCaptcha(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || captchaOpen) return;
    if (!email.trim()) return setError("请输入邮箱地址");
    if (!requireConsent()) return;
    setError("");
    setCaptchaPurpose("login-email");
    setCaptchaOpen(true);
  }

  async function sendEmailCode(ticket: string) {
    setCaptchaOpen(false);
    if (!requireConsent()) return;
    begin("email");
    try {
      const response = await apiRequest<LearnerOtpStartResponse>(
        "/auth/email/start",
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          exposeErrorDetail: true,
          body: JSON.stringify({
            email: email.trim(),
            captcha_ticket: ticket,
            client: "web",
            accepted_terms: true,
            agreement_version: USER_AGREEMENT_VERSION,
            privacy_version: PRIVACY_POLICY_VERSION,
          }),
        },
      );
      setChallengeId(response.challenge_id);
      setResendAfter(response.resend_after);
      setCode("");
      setSentEmail(email.trim());
    } catch (submitError) {
      setError(messageFor(submitError, "email"));
    } finally {
      finish();
    }
  }

  async function verifyEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || code.length !== 6 || !requireConsent()) return;
    begin("email");
    try {
      const response = await apiRequest<LearnerAuthResponse>("/auth/email/verify", {
        method: "POST",
        scope: "user",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({
          challenge_id: challengeId,
          code,
          client: "web",
        }),
      });
      acceptLearnerLogin(response);
      router.replace(
        safeLearnerNext(new URLSearchParams(window.location.search).get("next")),
      );
    } catch (submitError) {
      setError(messageFor(submitError, "email"));
    } finally {
      finish();
    }
  }

  async function startGithub() {
    if (busy || !requireConsent()) return;
    begin("github");
    try {
      const response = await apiRequest<GithubStartResponse>("/auth/github/start", {
        method: "POST",
        scope: "user",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({
          accepted_terms: true,
          agreement_version: USER_AGREEMENT_VERSION,
          privacy_version: PRIVACY_POLICY_VERSION,
          return_to: safeLearnerNext(
            new URLSearchParams(window.location.search).get("next"),
          ),
        }),
      });
      window.location.assign(response.authorization_url);
    } catch (submitError) {
      setError(messageFor(submitError));
      finish();
    }
  }

  const disabled = busy || captchaOpen;

  return (
    <div className={styles.surface}>
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.upperGlow} />
        <div className={styles.lowerGlow} />
      </div>
      <header className={styles.header}>
        <span className={styles.wordmark}>
          MemoGrad<span>LEARN</span>
        </span>
        <span className={styles.accessLabel}><span />学习账号</span>
      </header>
      <main className={styles.main}>
        <LoginCard titleId="learner-login-title" className={styles.learnerCard}>
          <div className={styles.cardHeading}>
            <span className={styles.mark} aria-hidden="true">
              <ShieldCheck />
            </span>
            <h1 id="learner-login-title">
              {registering ? "创建学习账号" : "登录学习中心"}
            </h1>
            <p className={styles.subtitle}>
              {registering
                ? "验证邮箱后创建账号，学习记录与小程序保持同步。"
                : "继续你的学习记录，Web 与小程序共用同一个账号。"}
            </p>
          </div>

          <div className={styles.modeTabs} role="group" aria-label="普通用户登录方式">
            <button
              type="button"
              aria-pressed={mode === "password"}
              data-active={mode === "password" || undefined}
              disabled={disabled}
              onClick={() => switchMode("password")}
            >
              账号密码
            </button>
            <button
              type="button"
              aria-pressed={mode === "email"}
              data-active={mode === "email" || undefined}
              disabled={disabled}
              onClick={() => switchMode("email")}
            >
              邮箱验证码
            </button>
          </div>

          <div className={styles.loginPanel}>
            {mode === "password" && !registering ? (
              <form className={styles.form} onSubmit={loginWithPassword}>
                <div className={styles.field}>
                  <label htmlFor="learner-account">账号名称或邮箱</label>
                  <div className={styles.inputShell}>
                    <UserRound className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="learner-account"
                      variant="ghost"
                      className={styles.input}
                      value={account}
                      onChange={(event) => {
                        setAccount(event.target.value);
                        clearError();
                      }}
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="请输入账号名称或邮箱"
                      required
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="learner-password">密码</label>
                  <div className={styles.inputShell}>
                    <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="learner-password"
                      variant="ghost"
                      className={styles.input}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        clearError();
                      }}
                      autoComplete="current-password"
                      placeholder="请输入登录密码"
                      required
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      className={styles.visibilityToggle}
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={disabled || !account.trim() || !password}
                  aria-busy={pending === "password"}
                >
                  {pending === "password" ? (
                    <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在登录</span></>
                  ) : (
                    <><span>登录学习中心</span><ArrowRight aria-hidden="true" /></>
                  )}
                </button>
                <div className={styles.formMeta}>
                  <span>还没有账号？</span>
                  <button
                    type="button"
                    className={styles.inlineAction}
                    disabled={disabled}
                    onClick={() => {
                      setRegistering(true);
                      setError("");
                    }}
                  >
                    注册学习账号
                  </button>
                </div>
              </form>
            ) : null}

            {mode === "password" && registering && !registrationCodeSent ? (
              <form className={styles.form} onSubmit={openRegisterCaptcha}>
                <div className={styles.field}>
                  <label htmlFor="register-username">账号名称</label>
                  <div className={styles.inputShell}>
                    <UserRound className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="register-username"
                      variant="ghost"
                      className={styles.input}
                      value={username}
                      onChange={(event) => {
                        setUsername(event.target.value);
                        clearError();
                      }}
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="3–32 个字符"
                      minLength={3}
                      maxLength={32}
                      required
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="register-email">邮箱地址</label>
                  <div className={styles.inputShell}>
                    <Mail className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="register-email"
                      variant="ghost"
                      className={styles.input}
                      type="email"
                      value={registerEmail}
                      onChange={(event) => {
                        setRegisterEmail(event.target.value);
                        clearError();
                      }}
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="name@example.com"
                      required
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="register-password">设置密码（至少 12 位）</label>
                  <div className={styles.inputShell}>
                    <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="register-password"
                      variant="ghost"
                      className={styles.input}
                      type={showPassword ? "text" : "password"}
                      value={registerPassword}
                      onChange={(event) => {
                        setRegisterPassword(event.target.value);
                        clearError();
                      }}
                      autoComplete="new-password"
                      placeholder="至少 12 位"
                      minLength={12}
                      required
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="register-password-confirm">确认密码</label>
                  <div className={styles.inputShell}>
                    <LockKeyhole className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="register-password-confirm"
                      variant="ghost"
                      className={styles.input}
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value);
                        clearError();
                      }}
                      autoComplete="new-password"
                      placeholder="再次输入密码"
                      minLength={12}
                      required
                      disabled={disabled}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={disabled || !username.trim() || !registerEmail.trim() || !registerPassword || !confirmPassword}
                  aria-busy={pending === "register"}
                >
                  {pending === "register" ? (
                    <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在发送</span></>
                  ) : (
                    <><span>验证邮箱并创建账号</span><Mail aria-hidden="true" /></>
                  )}
                </button>
                <div className={styles.formMeta}>
                  <button
                    type="button"
                    className={styles.inlineAction}
                    disabled={disabled}
                    onClick={() => setRegistering(false)}
                  >
                    返回登录
                  </button>
                </div>
              </form>
            ) : null}

            {mode === "password" && registering && registrationCodeSent ? (
              <form className={styles.form} onSubmit={verifyRegistration}>
                <div className={styles.otpIntro}>
                  <Mail aria-hidden="true" />
                  <p>验证码已发送至 <strong>{sentEmail}</strong></p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="register-code">6 位邮箱验证码</label>
                  <OtpInput
                    id="register-code"
                    name="register-code"
                    value={registerCode}
                    onChange={setRegisterCode}
                    disabled={disabled}
                    required
                  />
                </div>
                <div className={styles.otpActions}>
                  <button
                    type="button"
                    className={styles.backButton}
                    disabled={disabled}
                    onClick={() => {
                      setRegisterChallengeId("");
                      setRegisterCode("");
                    }}
                  >
                    修改资料
                  </button>
                  <ResendButton
                    seconds={registerResendAfter}
                    busy={disabled}
                    onResend={() => {
                      setRegisterChallengeId("");
                      setRegisterCode("");
                    }}
                  />
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={disabled || registerCode.length !== 6}
                  aria-busy={pending === "register"}
                >
                  {pending === "register" ? (
                    <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在验证</span></>
                  ) : (
                    <><span>完成注册</span><Check aria-hidden="true" /></>
                  )}
                </button>
              </form>
            ) : null}

            {mode === "email" && !emailCodeSent ? (
              <form className={styles.form} onSubmit={openEmailCaptcha}>
                <div className={styles.field}>
                  <label htmlFor="learner-email">邮箱地址</label>
                  <div className={styles.inputShell}>
                    <Mail className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="learner-email"
                      variant="ghost"
                      className={styles.input}
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        clearError();
                      }}
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="name@example.com"
                      required
                      disabled={disabled}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={disabled || !email.trim()}
                  aria-busy={pending === "email"}
                >
                  {pending === "email" ? (
                    <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在发送</span></>
                  ) : (
                    <><span>发送登录验证码</span><Mail aria-hidden="true" /></>
                  )}
                </button>
              </form>
            ) : null}

            {mode === "email" && emailCodeSent ? (
              <form className={styles.form} onSubmit={verifyEmail}>
                <div className={styles.otpIntro}>
                  <Mail aria-hidden="true" />
                  <p>验证码已发送至 <strong>{sentEmail}</strong></p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="learner-email-code">6 位邮箱验证码</label>
                  <OtpInput
                    id="learner-email-code"
                    name="learner-email-code"
                    value={code}
                    onChange={setCode}
                    disabled={disabled}
                    required
                  />
                </div>
                <div className={styles.otpActions}>
                  <button
                    type="button"
                    className={styles.backButton}
                    disabled={disabled}
                    onClick={() => {
                      setChallengeId("");
                      setCode("");
                    }}
                  >
                    修改邮箱
                  </button>
                  <ResendButton
                    seconds={resendAfter}
                    busy={disabled}
                    onResend={() => {
                      setChallengeId("");
                      setCode("");
                    }}
                  />
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={disabled || code.length !== 6}
                  aria-busy={pending === "email"}
                >
                  {pending === "email" ? (
                    <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在验证</span></>
                  ) : (
                    <><span>验证并登录</span><Check aria-hidden="true" /></>
                  )}
                </button>
              </form>
            ) : null}

            <div className={styles.divider}>
              <span />
              <p>或使用 GitHub</p>
              <span />
            </div>
            <button
              type="button"
              className={styles.githubButton}
              disabled={disabled}
              aria-busy={pending === "github"}
              onClick={() => void startGithub()}
            >
              {pending === "github" ? (
                <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在前往 GitHub</span></>
              ) : (
                <><GitBranch aria-hidden="true" /><span>使用 GitHub 登录</span></>
              )}
            </button>

            <label className={styles.consent}>
              <input
                ref={consentRef}
                type="checkbox"
                className={styles.consentCheckbox}
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                disabled={disabled}
              />
              <span>
                我已阅读并同意
                <Link href="/agreements/user" className={styles.consentLink}>
                  用户协议
                </Link>
                和
                <Link href="/agreements/privacy" className={styles.consentLink}>
                  隐私政策
                </Link>
              </span>
            </label>

            {error ? (
              <div className={styles.errorNotice} role="alert">
                <CircleAlert aria-hidden="true" />
                <p>{error}</p>
                <button type="button" aria-label="关闭错误提示" onClick={() => setError("")}>
                  <X aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {notice ? (
              <div className={styles.notice} role="status">
                <Check aria-hidden="true" />
                <p>{notice}</p>
              </div>
            ) : null}

          </div>
        </LoginCard>
      </main>
      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent
          overlayClassName={styles.loginDialogOverlay}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            consentRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>请先阅读并同意协议</DialogTitle>
            <DialogDescription>
              登录前，请阅读
              <Link href="/agreements/user" target="_blank" rel="noopener noreferrer" className="mx-1 text-primary underline underline-offset-4">用户协议</Link>
              和
              <Link href="/agreements/privacy" target="_blank" rel="noopener noreferrer" className="mx-1 text-primary underline underline-offset-4">隐私政策</Link>
              。同意后可继续登录或创建学习账号。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="secondary">暂不登录</Button></DialogClose>
            <Button onClick={() => { setAgreed(true); setConsentOpen(false); }}>同意并勾选</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={captchaOpen} onOpenChange={setCaptchaOpen}>
        <DialogContent
          className={styles.captchaDialog}
          overlayClassName={styles.loginDialogOverlay}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">完成安全验证</DialogTitle>
          <DialogDescription className="sr-only">拖动滑块，将拼图移到图片缺口处。</DialogDescription>
            <SliderCaptcha
              scope="user"
              onCancel={() => setCaptchaOpen(false)}
              onVerified={(ticket) => {
                setCaptchaOpen(false);
                if (captchaPurpose === "register") {
                  void sendRegisterCode(ticket);
                } else {
                  void sendEmailCode(ticket);
                }
              }}
            />
        </DialogContent>
      </Dialog>
    </div>
  );
}
