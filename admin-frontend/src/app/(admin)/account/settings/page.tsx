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
  ArrowLeft,
  Check,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { GithubMark } from "@/components/icons/github-mark";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type {
  GithubStartResponse,
  LearnerAuthResponse,
  LearnerOtpStartResponse,
  UserIdentity,
} from "@/lib/api/types";
import {
  accountInitial,
  accountName,
  identityDescription,
  providerLabel,
} from "@/lib/account-format";
import { useAuthStore } from "@/lib/auth/auth-store";

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "网络连接失败，请稍后重试";
  return "操作未完成，请稍后重试";
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const accessMode = useAuthStore((state) => state.accessMode);
  const user = useAuthStore((state) => state.learnerUser);
  const accessToken = useAuthStore((state) => state.accessToken);
  const acceptLearnerLogin = useAuthStore((state) => state.acceptLearnerLogin);
  const clear = useAuthStore((state) => state.clear);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [stepUpChallenge, setStepUpChallenge] = useState("");
  const [stepUpCode, setStepUpCode] = useState("");
  const [stepUpToken, setStepUpToken] = useState("");
  const [stepUpProvider, setStepUpProvider] = useState<"email" | "github" | null>(null);
  const [pendingUnlink, setPendingUnlink] = useState<UserIdentity | null>(null);
  const callbackFlight = useRef<Promise<LearnerAuthResponse> | null>(null);
  const verificationFlight = useRef<Promise<{ step_up_token: string }> | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const bindCodeRef = useRef<HTMLInputElement>(null);
  const [resendSeconds, setResendSeconds] = useState(0);
  const stepUpInputRef = useRef<HTMLInputElement>(null);

  const [emailBindOpen, setEmailBindOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [emailChallenge, setEmailChallenge] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordResetMode, setPasswordResetMode] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (accessMode === "admin") router.replace("/profile");
  }, [accessMode, router]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("bind") === "email") {
      setEmailBindOpen(true);
      url.searchParams.delete("bind");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    const callbackError = url.searchParams.get("binding_error") || url.searchParams.get("verification_error");
    if (callbackError) {
      setError(callbackError === "github_cancelled" ? "已取消 GitHub 授权，可重新发起绑定或验证" : callbackError === "identity_already_exists" ? "GitHub 绑定冲突，请确认当前账号和 GitHub 均未绑定其他身份" : "GitHub 操作未完成，请重试；若登录状态失效，请重新登录");
      window.history.replaceState(null, "", "/account/settings");
      return;
    }
    if (url.searchParams.get("verified") !== "github" || !accessToken) return;
    let active = true;
    verificationFlight.current ??= apiRequest<{ step_up_token: string }>(
      "/users/me/identities/github/step-up/result",
      {
        method: "POST",
        scope: "user",
        skipRefresh: true,
        exposeErrorDetail: true,
      },
    );
    void verificationFlight.current.then((response) => {
      if (!active) return;
      setStepUpToken(response.step_up_token);
      setStepUpProvider("github");
      setMessage("GitHub 安全验证已通过。");
      window.history.replaceState(null, "", "/account/settings");
    }).catch((reason: unknown) => {
      if (active) {
        window.history.replaceState(null, "", "/account/settings");
        setError(errorMessage(reason));
      }
    });
    return () => { active = false; };
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || new URL(window.location.href).searchParams.get("linked") !== "github") return;
    callbackFlight.current ??= apiRequest<LearnerAuthResponse>("/auth/web/refresh", {
      method: "POST", scope: "user", skipRefresh: true,
    });
    let active = true;
    void callbackFlight.current.then((response) => {
      if (!active) return;
      window.history.replaceState(null, "", "/account/settings");
      acceptLearnerLogin(response);
      setMessage("GitHub 已绑定到当前账号。");
    }).catch((reason: unknown) => {
      if (active) {
        window.history.replaceState(null, "", "/account/settings");
        setError(errorMessage(reason));
      }
    });
    return () => { active = false; };
  }, [accessToken, acceptLearnerLogin]);

  useEffect(() => {
    if (!emailBindOpen) return;
    if (emailChallenge) bindCodeRef.current?.focus();
    else emailInputRef.current?.focus();
  }, [emailBindOpen, emailChallenge]);

  useEffect(() => {
    if (!resendSeconds) return;
    const timer = window.setTimeout(() => setResendSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  useEffect(() => {
    if (!stepUpToken) return;
    const timer = window.setTimeout(() => {
      setStepUpToken("");
      setStepUpProvider(null);
    }, 5 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [stepUpToken]);

  useEffect(() => {
    if (stepUpChallenge) stepUpInputRef.current?.focus();
  }, [stepUpChallenge]);

  if (accessMode === "admin") return null;
  if (!user || !accessToken) return null;

  const emailIdentity = user.identities.find((identity) => identity.provider === "email");
  const githubIdentity = user.identities.find((identity) => identity.provider === "github");
  const passwordIdentity = user.identities.find((identity) => identity.provider === "password");
  const canUnlink = user.identities.length > 1;

  function passwordReady(value: string) {
    return (
      value.length >= 12
      && /[A-Z]/.test(value)
      && /[a-z]/.test(value)
      && /\d/.test(value)
      && new TextEncoder().encode(value).length <= 72
    );
  }

  function resetFeedback() {
    setError("");
    setMessage("");
  }

  async function startEmailStepUp() {
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<LearnerOtpStartResponse>(
        "/users/me/identities/email/step-up/start",
        { method: "POST", scope: "user", exposeErrorDetail: true },
      );
      setStepUpChallenge(response.challenge_id);
      setStepUpCode("");
      setMessage("安全验证码已发送到当前邮箱。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || stepUpCode.length !== 6) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<{ step_up_token: string }>(
        "/users/me/identities/email/step-up/verify",
        {
          method: "POST",
          scope: "user",
          exposeErrorDetail: true,
          body: JSON.stringify({
            challenge_id: stepUpChallenge,
            code: stepUpCode,
          }),
        },
      );
      setStepUpToken(response.step_up_token);
      setStepUpProvider("email");
      setStepUpChallenge("");
      setStepUpCode("");
      setMessage("安全验证已通过，可以继续更换邮箱或解绑身份。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startGithubStepUp(returnTo = "/account/settings") {
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const target = encodeURIComponent(returnTo);
      const response = await apiRequest<GithubStartResponse>(
        `/users/me/identities/github/step-up/start?return_to=${target}`,
        { method: "POST", scope: "user", exposeErrorDetail: true },
      );
      window.location.assign(response.authorization_url);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }

  async function startGithubLink() {
    if (busy) return;
    if (!stepUpToken) {
      if (emailIdentity) {
        await startEmailStepUp();
        setMessage("请先完成邮箱安全验证，再点击“绑定 GitHub”。");
      } else {
        setError("绑定 GitHub 前需要先完成邮箱或 GitHub 安全验证");
      }
      return;
    }
    resetFeedback();
    setBusy(true);
    const proof = stepUpToken;
    setStepUpToken("");
    setStepUpProvider(null);
    try {
      const response = await apiRequest<GithubStartResponse>(
        "/users/me/identities/github/start",
        {
          method: "POST",
          scope: "user",
          exposeErrorDetail: true,
          body: JSON.stringify({
            return_to: "/account/settings?linked=github",
            step_up_token: proof,
          }),
        },
      );
      window.location.assign(response.authorization_url);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }

  async function openEmailBind() {
    if (busy) return;
    resetFeedback();
    if (!emailIdentity && !stepUpToken) {
      if (githubIdentity) {
        await startGithubStepUp("/account/settings?bind=email");
      } else {
        setError("绑定邮箱前需要先完成 GitHub 安全验证；当前账号暂无可用验证方式");
      }
      return;
    }
    setEmailBindOpen(true);
  }

  async function startEmailBind(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy || resendSeconds > 0 || !targetEmail.trim()) return;
    if (!stepUpToken && !emailChallenge) {
      if (emailIdentity) {
        setError("更换邮箱前，请先完成“敏感操作验证”");
      } else if (githubIdentity) {
        await startGithubStepUp("/account/settings?bind=email");
      } else {
        setError("绑定邮箱前，请先完成“敏感操作验证”");
      }
      return;
    }
    resetFeedback();
    setBusy(true);
    const proof = stepUpToken;
    try {
      const response = await apiRequest<LearnerOtpStartResponse>(
        `/users/me/identities/email/${emailIdentity ? "change" : "bind"}/start`,
        {
          method: "POST",
          scope: "user",
          // A consumed step-up proof must not be retried as a session failure.
          skipRefresh: Boolean(proof),
          exposeErrorDetail: true,
          body: JSON.stringify({
            email: targetEmail.trim(),
            step_up_token: proof || undefined,
            challenge_id: emailChallenge || undefined,
          }),
        },
      );
      setEmailChallenge(response.challenge_id);
      setResendSeconds(response.resend_after);
      if (proof) {
        setStepUpToken("");
        setStepUpProvider(null);
      }
      setEmailCode("");
      setMessage("验证码已发送到要绑定的邮箱。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function startPasswordReset() {
    if (busy) return;
    resetFeedback();
    if (!stepUpToken) {
      setError("请先在“敏感操作验证”中完成邮箱或 GitHub 验证");
      return;
    }
    setPasswordResetMode(true);
    setPasswordOpen(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function submitPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!passwordReady(newPassword)) {
      setError("新密码需至少 12 位，并同时包含大写字母、小写字母和数字");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    resetFeedback();
    setBusy(true);
    try {
      await apiRequest("/auth/password/change", {
        method: "POST",
        scope: "user",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      clear();
      router.replace("/account/login?password_changed=1");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!stepUpToken) {
      setError("安全验证已失效，请重新完成验证");
      return;
    }
    if (!passwordReady(newPassword)) {
      setError("新密码需至少 12 位，并同时包含大写字母、小写字母和数字");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    resetFeedback();
    setBusy(true);
    const proof = stepUpToken;
    try {
      await apiRequest("/auth/password/reset", {
        method: "POST",
        scope: "user",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({
          step_up_token: proof,
          new_password: newPassword,
        }),
      });
      setStepUpToken("");
      setStepUpProvider(null);
      clear();
      router.replace("/account/login?password_changed=1");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailBind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || emailCode.length !== 6) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<LearnerAuthResponse>(
        `/users/me/identities/email/${emailIdentity ? "change" : "bind"}/verify`,
        {
          method: "POST",
          scope: "user",
          exposeErrorDetail: true,
          body: JSON.stringify({
            challenge_id: emailChallenge,
            code: emailCode,
            client: "web",
          }),
        },
      );
      if (emailIdentity) {
        clear();
        router.replace("/account/login?email_changed=1");
        return;
      }
      acceptLearnerLogin(response);
      setEmailBindOpen(false);
      setEmailChallenge("");
      setEmailCode("");
      setTargetEmail("");
      setMessage("邮箱已绑定到当前账号。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function unlinkIdentity(identity: UserIdentity) {
    if (!canUnlink || busy) return;
    if (!stepUpToken) {
      setPendingUnlink(identity);
      if (identity.provider === "email") {
        if (githubIdentity) await startGithubStepUp();
        else setError("解绑邮箱前需要用准备保留的 GitHub 完成安全验证");
      } else if (emailIdentity) {
        await startEmailStepUp();
      } else if (githubIdentity && identity.provider !== "github") {
        await startGithubStepUp();
      } else {
        setError("暂无可用于安全验证的保留身份，请先在网页绑定邮箱或 GitHub");
      }
      return;
    }
    if (
      (stepUpProvider === "github" && identity.provider === "github")
      || (stepUpProvider === "email" && identity.provider === "email")
    ) {
      setError("请使用准备保留的另一种身份完成安全验证");
      return;
    }
    if (!window.confirm(`确认解绑${providerLabel(identity.provider)}？`)) return;
    resetFeedback();
    setBusy(true);
    const proof = stepUpToken;
    setStepUpToken("");
    setStepUpProvider(null);
    try {
      await apiRequest(`/users/me/identities/${identity.id}`, {
        method: "DELETE",
        scope: "user",
        skipRefresh: true,
        exposeErrorDetail: true,
        body: JSON.stringify({ step_up_token: proof }),
      });
      clear();
      router.replace("/account/login?identity_unlinked=1");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const identityIcon = (provider: string) => {
    if (provider === "email") return <Mail className="h-4 w-4" aria-hidden="true" />;
    if (provider === "github") return <GithubMark className="h-4 w-4" />;
    if (provider === "wechat") return <MessageCircle className="h-4 w-4" aria-hidden="true" />;
    return <KeyRound className="h-4 w-4" aria-hidden="true" />;
  };

  return (
    <div className="space-y-5 pb-10">
      <div>
        <Link
          href="/account"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          返回账号中心
        </Link>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-white/70 bg-white/60 font-semibold text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              {accountInitial(user.email, user.nickname, user.id)}
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
                账号安全
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {accountName(user.email, user.nickname, user.id)} · 用户 #{user.id}
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {stepUpToken
              ? `${stepUpProvider === "github" ? "GitHub" : "邮箱"}验证已通过`
              : "敏感操作需再次验证"}
          </span>
        </div>
      </div>

      {(!emailBindOpen && error) || message ? (
        <div
          role={error ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            error
              ? "border-destructive/25 bg-destructive-light text-destructive"
              : "border-success/25 bg-success-light text-success"
          }`}
        >
          {error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{error || message}</span>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="admin-panel rounded-[18px] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">已连接身份</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                所有身份指向同一用户 ID；解绑前必须验证准备保留的另一种身份。
              </p>
            </div>
            <span className="rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
              {user.identities.length} 种
            </span>
          </div>

          <div className="mt-4 divide-y divide-border">
            {user.identities.map((identity) => (
              <article key={identity.id} className="grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3 py-4 sm:flex sm:flex-wrap">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-secondary text-muted-foreground">
                  {identityIcon(identity.provider)}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    {providerLabel(identity.provider)}
                  </h3>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">
                    {identityDescription(identity, user.email)}
                  </p>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-3 sm:ml-auto">
                {identity.provider === "email" ? (
                  <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void openEmailBind()}>更换邮箱</Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy || !canUnlink}
                  onClick={() => void unlinkIdentity(identity)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                  解绑
                </Button>
                </div>
              </article>
            ))}
          </div>

          {!canUnlink ? (
            <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              至少需要保留一种登录方式。
            </p>
          ) : null}
          {pendingUnlink && !stepUpToken ? (
            <p className="mt-3 rounded-lg border border-warning/25 bg-warning-light px-3 py-2 text-xs text-warning-foreground">
              正在等待安全验证；完成验证后再次点击“解绑”即可继续。
            </p>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="admin-panel rounded-[18px] p-5">
            <h2 className="font-semibold text-foreground">敏感操作验证</h2>
            {!stepUpChallenge ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {emailIdentity ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="justify-start"
                    disabled={busy}
                    onClick={() => void startEmailStepUp()}
                  >
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    验证当前邮箱
                  </Button>
                ) : null}
                {githubIdentity ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="justify-start"
                    disabled={busy}
                    onClick={() => void startGithubStepUp()}
                  >
                    <GithubMark className="h-4 w-4" />
                    验证 GitHub
                  </Button>
                ) : null}
                {!emailIdentity && !githubIdentity ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    绑定邮箱或 GitHub 后才可在网页完成敏感操作验证。
                  </p>
                ) : null}
              </div>
            ) : (
              <form className="mt-3 space-y-3" onSubmit={verifyEmailStepUp}>
                <OtpInput
                  id="step-up-code"
                  name="step-up-code"
                  value={stepUpCode}
                  onChange={setStepUpCode}
                  disabled={busy}
                  inputRef={stepUpInputRef}
                />
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setStepUpChallenge("")}
                  >
                    取消验证
                  </button>
                </div>
                <Button type="submit" disabled={busy || stepUpCode.length !== 6} className="w-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  验证并继续
                </Button>
              </form>
            )}
          </section>

          <section className="admin-panel rounded-[18px] p-5">
            <h2 className="font-semibold text-foreground">连接新方式</h2>
            {!emailIdentity || !githubIdentity ? <div className="mt-4 flex flex-wrap gap-3">
              {!emailIdentity ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="justify-start"
                  disabled={busy}
                  onClick={() => void openEmailBind()}
                >
                  <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" />绑定邮箱</span>
                </Button>
              ) : null}
              {!githubIdentity ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="justify-start"
                  disabled={busy}
                  onClick={() => void startGithubLink()}
                >
                  <span className="inline-flex items-center gap-2"><GithubMark className="h-4 w-4" />绑定 GitHub</span>
                </Button>
              ) : null}
            </div> : null}
            {!user.identities.some((identity) => identity.provider === "wechat") ? (
              <div className="mt-4 border-t border-border pt-4">
                <h3 className="flex items-center gap-2 text-sm font-medium"><MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />绑定微信账号</h3>
                <p className="mt-2 text-sm text-muted-foreground">敬请期待</p>
              </div>
            ) : null}
          </section>

          <section className="admin-panel rounded-[18px] p-5">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              登录密码
            </h2>
            {!passwordIdentity ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                当前账号未设置登录密码，可使用邮箱验证码或已绑定的第三方身份登录。
              </p>
            ) : !passwordOpen ? (
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    resetFeedback();
                    setPasswordResetMode(false);
                    setPasswordOpen(true);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                >
                  修改密码
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={startPasswordReset}
                >
                  忘记密码
                </Button>
              </div>
            ) : (
              <form
                className="mt-3 space-y-3"
                onSubmit={passwordResetMode ? submitPasswordReset : submitPasswordChange}
              >
                {passwordResetMode ? (
                  <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                    已通过安全验证，直接设置新密码。验证 5 分钟内有效。
                  </p>
                ) : (
                  <label className="block space-y-1.5 text-sm font-medium">
                    <span>当前密码</span>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      disabled={busy}
                      required
                    />
                  </label>
                )}
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>新密码（至少 12 位，含大小写字母和数字）</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={busy}
                    required
                  />
                </label>
                <label className="block space-y-1.5 text-sm font-medium">
                  <span>确认新密码</span>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={busy}
                    required
                  />
                </label>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setPasswordOpen(false);
                      setPasswordResetMode(false);
                      setCurrentPassword("");
                      setNewPassword("");
                      setConfirmPassword("");
                    }}
                  >
                    取消
                  </button>
                  <Button type="submit" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    {passwordResetMode ? "重置密码" : "更新密码"}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </aside>
      </div>

      {emailBindOpen ? (
        <section className="admin-panel scroll-mt-6 rounded-[16px] p-5" aria-label="邮箱绑定设置">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">{emailIdentity ? "更换邮箱" : "绑定邮箱"}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {emailIdentity ? "先完成敏感操作验证，再验证新邮箱；更换后需要重新登录。" : "验证完成后，该邮箱可用于登录网页端。"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEmailBindOpen(false);
                setEmailChallenge("");
                setEmailCode("");
              }}
            >
              关闭
            </Button>
          </div>
          {error ? <p role="alert" className="mt-4 text-sm leading-6 text-destructive">{error}</p> : null}
          {!emailChallenge ? (
            <form className="mt-4 flex max-w-xl flex-wrap items-end gap-3" onSubmit={startEmailBind}>
              <label className="min-w-0 flex-1 space-y-2 text-sm font-medium">
              <span>要绑定的邮箱</span>
              <Input
                ref={emailInputRef}
                required
                type="email"
                value={targetEmail}
                onChange={(event) => setTargetEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                disabled={busy}
              />
              </label>
              <Button type="submit" disabled={busy || resendSeconds > 0 || !targetEmail.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {resendSeconds > 0 ? `${resendSeconds} 秒后重发` : "发送验证码"}
              </Button>
            </form>
          ) : (
            <form className="mt-4 max-w-xl space-y-3" onSubmit={verifyEmailBind}>
              <p className="break-all text-sm text-muted-foreground">验证码已发送至 {targetEmail.trim()}</p>
              <OtpInput
                inputRef={bindCodeRef}
                id="email-bind-code"
                name="email-bind-code"
                value={emailCode}
                onChange={setEmailCode}
                disabled={busy}
              />
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setEmailChallenge("")}
                >
                  修改邮箱
                </button>
                <Button type="button" variant="ghost" size="sm" disabled={busy || resendSeconds > 0} onClick={() => void startEmailBind()}>
                  {resendSeconds > 0 ? `${resendSeconds} 秒后重发` : "重新发送验证码"}
                </Button>
              </div>
              <Button type="submit" disabled={busy || emailCode.length !== 6}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {emailIdentity ? "验证并更换" : "验证并绑定"}
              </Button>
            </form>
          )}
        </section>
      ) : null}

    </div>
  );
}
