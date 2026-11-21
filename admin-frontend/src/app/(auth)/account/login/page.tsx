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
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  GitBranch,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { SliderCaptcha } from "@/components/security/slider-captcha";
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

function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "账号或验证码不正确";
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
    if (params.has("wechat_bound")) {
      setNotice("微信已绑定，原网页会话已安全退出。请使用邮箱、GitHub 或微信重新登录。");
    } else if (params.has("identity_unlinked")) {
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
    setError("请先阅读并同意用户协议和隐私政策");
    consentRef.current?.focus();
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

  async function loginWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !account.trim() || !password) return;
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
      setError(messageFor(submitError));
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
      setError(messageFor(submitError));
    } finally {
      finish();
    }
  }

  async function verifyRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || registerCode.length !== 6) return;
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
      setError(messageFor(submitError));
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
      setError(messageFor(submitError));
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
      setError(messageFor(submitError));
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
        <section className={styles.card} aria-labelledby="learner-login-title">
          <div className={styles.cardHeading}>
            <span className={styles.mark} aria-hidden="true">
              <ShieldCheck />
            </span>
            <p className={styles.eyebrow}>ONE ACCOUNT · ONE LEARNING RECORD</p>
            <h1 id="learner-login-title">
              {registering ? "创建学习账号" : "登录学习中心"}
            </h1>
            <p className={styles.subtitle}>
              {registering
                ? "验证邮箱后即可进入题库，并继续在 Web 与小程序使用同一份数据。"
                : "登录后可直接浏览题库和知识图谱。"}
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
                      value={account}
                      onChange={(event) => setAccount(event.target.value)}
                      autoComplete="username"
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
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      className={styles.visibilityToggle}
                      aria-label={showPassword ? "隐藏密码" : "显示密码"}
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
                >
                  {pending === "password" ? <Loader2 className={styles.spinner} /> : <ArrowRight />}
                  登录并进入题库
                </button>
                <div className={styles.formMeta}>
                  <span>还没有账号？</span>
                  <button
                    type="button"
                    className={styles.resendButton}
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
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
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
                      type="email"
                      value={registerEmail}
                      onChange={(event) => setRegisterEmail(event.target.value)}
                      autoComplete="email"
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
                      type={showPassword ? "text" : "password"}
                      value={registerPassword}
                      onChange={(event) => setRegisterPassword(event.target.value)}
                      autoComplete="new-password"
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
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      disabled={disabled}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={disabled}
                >
                  {pending === "register" ? <Loader2 className={styles.spinner} /> : <Mail />}
                  验证邮箱并创建账号
                </button>
                <div className={styles.formMeta}>
                  <button
                    type="button"
                    className={styles.resendButton}
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
                <p className={styles.subtitle}>验证码已发送至 {sentEmail}</p>
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
                >
                  {pending === "register" ? <Loader2 className={styles.spinner} /> : <Check />}
                  完成注册
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
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                      disabled={disabled}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={disabled || !email.trim()}
                >
                  {pending === "email" ? <Loader2 className={styles.spinner} /> : <Mail />}
                  发送登录验证码
                </button>
              </form>
            ) : null}

            {mode === "email" && emailCodeSent ? (
              <form className={styles.form} onSubmit={verifyEmail}>
                <p className={styles.subtitle}>验证码已发送至 {sentEmail}</p>
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
                >
                  {pending === "email" ? <Loader2 className={styles.spinner} /> : <Check />}
                  验证并登录
                </button>
              </form>
            ) : null}

            <div className="my-5 flex items-center gap-3 text-[11px] text-[#7f99ad]">
              <span className="h-px flex-1 bg-white/10" />
              或使用 GitHub
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <button
              type="button"
              className={`${styles.submit} !bg-white/[0.06] !text-[#d7e7f0] shadow-none hover:!bg-white/[0.1]`}
              disabled={disabled}
              onClick={() => void startGithub()}
            >
              {pending === "github" ? <Loader2 className={styles.spinner} /> : <GitBranch />}
              使用 GitHub 登录
            </button>

            <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-[11px] leading-5 text-[#8fa8ba]">
              <input
                ref={consentRef}
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#9bdcff]"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                disabled={disabled}
              />
              <span>
                我已阅读并同意
                <Link href="/agreements/user" className="mx-1 text-[#ccebff] underline underline-offset-2">
                  用户协议
                </Link>
                和
                <Link href="/agreements/privacy" className="mx-1 text-[#ccebff] underline underline-offset-2">
                  隐私政策
                </Link>
              </span>
            </label>

            {error ? (
              <div className={`${styles.cardFooter} mt-4`} data-error="true" role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}
            {notice ? (
              <div className={`${styles.cardFooter} mt-4`} role="status">
                <Check aria-hidden="true" />
                <span>{notice}</span>
              </div>
            ) : null}

            <div className={styles.support}>
              <Link href={`${process.env.NEXT_PUBLIC_ADMIN_WEB_BASE_URL || ""}/login`}>
                管理员登录
                <ArrowRight className="ml-1 inline h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      {captchaOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0b1722] p-1 shadow-2xl">
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
