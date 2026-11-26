"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
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
import { SliderCaptcha } from "@/components/security/slider-captcha";
import { AuthToast, type AuthToastState, type AuthToastTone } from "@/components/auth/auth-toast";
import { EmailOtpLoginForm } from "@/components/auth/email-otp-login-form";
import { LoginCard } from "@/components/auth/login-card";
import { ResendCodeButton } from "@/components/auth/resend-code-button";
import { GithubMark } from "@/components/icons/github-mark";
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
type PendingAction = "password" | "register" | "github";

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

export default function LearnerLoginPage() {
  const router = useRouter();
  const accessMode = useAuthStore((state) => state.accessMode);
  const acceptLearnerLogin = useAuthStore((state) => state.acceptLearnerLogin);
  const consentRef = useRef<HTMLInputElement>(null);
  const loginFinishingRef = useRef(false);
  useAuthBootstrap();

  const [mode, setMode] = useState<LoginMode>("password");
  const [registering, setRegistering] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [toast, setToast] = useState<AuthToastState | null>(null);
  const pendingConsentRef = useRef<(() => void) | null>(null);
  const showToast = useCallback(
    (message: string, tone: AuthToastTone = "info") => {
      setToast({ id: Date.now(), message, tone });
    },
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);

  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [sentEmail, setSentEmail] = useState("");
  const [registerChallengeId, setRegisterChallengeId] = useState("");
  const [registerCode, setRegisterCode] = useState("");
  const [registerResendAfter, setRegisterResendAfter] = useState(0);
  const [emailBusy, setEmailBusy] = useState(false);

  const [captchaOpen, setCaptchaOpen] = useState(false);

  const registrationCodeSent = Boolean(registerChallengeId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = AUTH_ERRORS[params.get("auth_error") || ""];
    if (authError) showToast(authError, "danger");
    if (params.has("identity_unlinked")) {
      showToast("登录身份已解绑，请重新登录。", "info");
    }
    if (params.has("email_changed")) {
      showToast("邮箱已更换，请使用新的登录方式重新登录。", "info");
    }
  }, [showToast]);

  useEffect(() => {
    if (loginFinishingRef.current) return;
    if (accessMode === "user") {
      router.replace(
        safeLearnerNext(new URLSearchParams(window.location.search).get("next")),
      );
    } else if (accessMode === "admin") {
      router.replace("/dashboard");
    }
  }, [accessMode, router]);

  function requireConsent(resume?: () => void) {
    if (agreed) return true;
    pendingConsentRef.current = resume ?? null;
    setConsentOpen(true);
    return false;
  }

  function begin(action: PendingAction) {
    setPending(action);
    setBusy(true);
  }

  function finish() {
    setPending(null);
    setBusy(false);
  }

  function finishLogin(response: LearnerAuthResponse) {
    loginFinishingRef.current = true;
    setFinishing(true);
    acceptLearnerLogin(response);
    showToast("登录成功，正在进入学习中心", "success");
    window.setTimeout(() => {
      router.replace(
        safeLearnerNext(new URLSearchParams(window.location.search).get("next")),
      );
    }, 900);
  }

  function switchMode(nextMode: LoginMode) {
    if (busy) return;
    setMode(nextMode);
    setRegistering(false);
    setCaptchaOpen(false);
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
      finishLogin(response);
    } catch (submitError) {
      showToast(messageFor(submitError, "password"), "danger");
    } finally {
      finish();
    }
  }

  function openRegisterCaptcha(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || captchaOpen) return;
    if (!username.trim()) return showToast("请输入账号名称", "danger");
    if (!registerEmail.trim()) return showToast("请输入邮箱地址", "danger");
    if (registerPassword.length < 12) return showToast("密码至少需要 12 位", "danger");
    if (registerPassword !== confirmPassword) return showToast("两次输入的密码不一致", "danger");
    if (!requireConsent()) return;
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
      showToast("注册验证码已发送，5 分钟内有效。请勿转发给他人。", "info");
    } catch (submitError) {
      showToast(messageFor(submitError, "email"), "danger");
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
      finishLogin(response);
    } catch (submitError) {
      showToast(messageFor(submitError, "email"), "danger");
    } finally {
      finish();
    }
  }

  function startEmailCode(input: { email: string; captchaTicket: string }) {
    return apiRequest<LearnerOtpStartResponse>("/auth/email/start", {
      method: "POST",
      scope: "user",
      skipRefresh: true,
      exposeErrorDetail: true,
      body: JSON.stringify({
        email: input.email,
        captcha_ticket: input.captchaTicket,
        client: "web",
        accepted_terms: true,
        agreement_version: USER_AGREEMENT_VERSION,
        privacy_version: PRIVACY_POLICY_VERSION,
      }),
    });
  }

  function verifyEmailCode(input: { challengeId: string; code: string }) {
    return apiRequest<LearnerAuthResponse>("/auth/email/verify", {
      method: "POST",
      scope: "user",
      skipRefresh: true,
      exposeErrorDetail: true,
      body: JSON.stringify({
        challenge_id: input.challengeId,
        code: input.code,
        client: "web",
      }),
    });
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
      showToast(messageFor(submitError), "danger");
      finish();
    }
  }

  const disabled = busy || captchaOpen || emailBusy || finishing;

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
            {registering ? null : (
              <span className={styles.mark} aria-hidden="true">
                <ShieldCheck />
              </span>
            )}
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
            {!registering ? (
              <form
                className={styles.form}
                onSubmit={loginWithPassword}
                inert={mode !== "password"}
                aria-hidden={mode !== "password"}
              >
                <div className={styles.field}>
                  <label htmlFor="learner-account">账号名称或邮箱</label>
                  <div className={styles.inputShell}>
                    <UserRound className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="learner-account"
                      variant="ghost"
                      className={styles.input}
                      value={account}
                      onChange={(event) => setAccount(event.target.value)}
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
                      onChange={(event) => setPassword(event.target.value)}
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
                    onClick={() => setRegistering(true)}
                  >
                    注册学习账号
                  </button>
                </div>
              </form>
            ) : null}

            {mode === "password" && registering && !registrationCodeSent ? (
              <form
                className={`${styles.form} ${styles.registerForm}`}
                onSubmit={openRegisterCaptcha}
              >
                <div className={styles.field}>
                  <label htmlFor="register-username">账号名称</label>
                  <div className={styles.inputShell}>
                    <UserRound className={styles.fieldIcon} aria-hidden="true" />
                    <Input
                      id="register-username"
                      variant="ghost"
                      className={styles.input}
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
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
                      onChange={(event) => setRegisterEmail(event.target.value)}
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
                      onChange={(event) => setRegisterPassword(event.target.value)}
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
                      onChange={(event) => setConfirmPassword(event.target.value)}
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
              <form
                className={`${styles.form} ${styles.registerForm}`}
                onSubmit={verifyRegistration}
              >
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
                  <ResendCodeButton
                    key={registerChallengeId}
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

            {!registering ? (
              <EmailOtpLoginForm<LearnerAuthResponse>
                idPrefix="learner"
                emailLabel="邮箱地址"
                scope="user"
                active={mode === "email"}
                disabled={busy || captchaOpen || finishing}
                ensureConsent={requireConsent}
                start={startEmailCode}
                verify={verifyEmailCode}
                onVerified={finishLogin}
                formatError={(error) => messageFor(error, "email")}
                onError={(message) => showToast(message, "danger")}
                onInfo={(message) => showToast(message, "info")}
                onBusyChange={setEmailBusy}
              />
            ) : null}

            {registering ? null : (
              <>
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
                    <><GithubMark /><span>使用 GitHub 登录</span></>
                  )}
                </button>
              </>
            )}

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

          </div>
        </LoginCard>
      </main>
      <Dialog
        open={consentOpen}
        onOpenChange={(open) => {
          setConsentOpen(open);
          if (!open) pendingConsentRef.current = null;
        }}
      >
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
            <Button
              onClick={() => {
                const resume = pendingConsentRef.current;
                pendingConsentRef.current = null;
                setAgreed(true);
                setConsentOpen(false);
                resume?.();
              }}
            >
              同意并勾选
            </Button>
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
            purpose="register"
            email={registerEmail.trim()}
            onCancel={() => setCaptchaOpen(false)}
            onVerified={(ticket) => {
              setCaptchaOpen(false);
              void sendRegisterCode(ticket);
            }}
          />
        </DialogContent>
      </Dialog>
      <AuthToast toast={toast} onClose={closeToast} />
    </div>
  );
}
