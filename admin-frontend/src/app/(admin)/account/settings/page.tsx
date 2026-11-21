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
  Copy,
  GitBranch,
  KeyRound,
  Loader2,
  Mail,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { apiRequest } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type {
  GithubStartResponse,
  LearnerAuthResponse,
  LearnerOtpStartResponse,
  UserIdentity,
  WechatBindStartResponse,
  WechatBindStatusResponse,
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

function Countdown({
  seconds,
  busy,
  label,
  onExpire,
}: {
  seconds: number;
  busy: boolean;
  label: string;
  onExpire?: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);
  useEffect(() => {
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) onExpireRef.current?.();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  if (busy) return null;
  return <span className="text-xs text-muted-foreground">{label} {remaining} 秒</span>;
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
  const stepUpInputRef = useRef<HTMLInputElement>(null);

  const [emailBindOpen, setEmailBindOpen] = useState(false);
  const [targetEmail, setTargetEmail] = useState("");
  const [emailChallenge, setEmailChallenge] = useState("");
  const [emailCode, setEmailCode] = useState("");

  const [wechatBind, setWechatBind] = useState<WechatBindStartResponse | null>(null);
  const [wechatStatus, setWechatStatus] = useState<WechatBindStatusResponse | null>(null);
  const wechatStatusRef = useRef<WechatBindStatusResponse | null>(null);
  const wechatBindIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (accessMode === "admin") router.replace("/profile");
  }, [accessMode, router]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("verified") !== "github" || !accessToken) return;
    let active = true;
    void apiRequest<{ step_up_token: string }>(
      "/users/me/identities/github/step-up/result",
      {
        method: "POST",
        scope: "user",
        skipRefresh: true,
      },
    ).then((response) => {
      if (!active) return;
      setStepUpToken(response.step_up_token);
      setStepUpProvider("github");
      setMessage("GitHub 安全验证已通过。");
      window.history.replaceState(null, "", "/account/settings");
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [accessToken]);

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

  useEffect(() => {
    const bind = wechatBind;
    if (!bind) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (!active || polling) return;
      if (
        wechatStatusRef.current?.status !== undefined
        && wechatStatusRef.current.status !== "pending"
      ) {
        return;
      }
      polling = true;
      try {
        const status = await apiRequest<WechatBindStatusResponse>(
          `/users/me/identities/wechat/bind/status/${encodeURIComponent(bind.challenge_id)}`,
          {
            scope: "user",
            skipRefresh: true,
            headers: { "X-Wechat-Bind-Token": bind.poll_token },
          },
        );
        if (!active || wechatBindIdRef.current !== bind.challenge_id) return;
        wechatStatusRef.current = status;
        setWechatStatus(status);
        if (status.status === "completed") {
          clear();
          router.replace("/account/login?wechat_bound=1");
        } else if (status.status === "conflict" || status.status === "expired") {
          wechatBindIdRef.current = null;
          setError(status.message || "微信绑定未完成，请重新生成绑定码");
          setWechatBind(null);
        }
      } catch (reason) {
        if (!active || wechatBindIdRef.current !== bind.challenge_id) return;
        setError(errorMessage(reason));
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [clear, router, wechatBind]);

  useEffect(() => {
    const bind = wechatBind;
    if (!bind) return;
    return () => {
      void apiRequest(
        `/users/me/identities/wechat/bind/${encodeURIComponent(bind.challenge_id)}/cancel`,
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          headers: { "X-Wechat-Bind-Token": bind.poll_token },
        },
      ).catch(() => undefined);
    };
  }, [wechatBind]);

  if (accessMode === "admin") return null;
  if (!user || !accessToken) return null;

  const emailIdentity = user.identities.find((identity) => identity.provider === "email");
  const githubIdentity = user.identities.find((identity) => identity.provider === "github");
  const wechatIdentity = user.identities.find((identity) => identity.provider === "wechat");
  const canUnlink = user.identities.length > 1;

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
        { method: "POST", scope: "user", skipRefresh: true },
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
          skipRefresh: true,
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
      setMessage("安全验证已通过，可以继续解绑身份。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startGithubStepUp() {
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const returnTo = encodeURIComponent("/account/settings");
      const response = await apiRequest<GithubStartResponse>(
        `/users/me/identities/github/step-up/start?return_to=${returnTo}`,
        { method: "POST", scope: "user", skipRefresh: true },
      );
      window.location.assign(response.authorization_url);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }

  async function startGithubLink() {
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<GithubStartResponse>(
        "/users/me/identities/github/start",
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          body: JSON.stringify({ return_to: "/account/settings" }),
        },
      );
      window.location.assign(response.authorization_url);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  }

  async function startEmailBind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !targetEmail.trim()) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<LearnerOtpStartResponse>(
        "/users/me/identities/email/bind/start",
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          body: JSON.stringify({ email: targetEmail.trim() }),
        },
      );
      setEmailChallenge(response.challenge_id);
      setEmailCode("");
      setMessage("验证码已发送到要绑定的邮箱。");
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
        "/users/me/identities/email/bind/verify",
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          body: JSON.stringify({
            challenge_id: emailChallenge,
            code: emailCode,
            client: "web",
          }),
        },
      );
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

  async function startWechatBind() {
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<WechatBindStartResponse>(
        "/users/me/identities/wechat/bind/start",
        { method: "POST", scope: "user", skipRefresh: true },
      );
      wechatBindIdRef.current = response.challenge_id;
      wechatStatusRef.current = { status: "pending" };
      setWechatBind(response);
      setWechatStatus({ status: "pending" });
      if (response.qrcode_error) {
        setMessage("小程序码暂时不可用，可在小程序中手动输入绑定码。");
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancelWechatBind() {
    const bind = wechatBind;
    if (!bind) return;
    try {
      await apiRequest(
        `/users/me/identities/wechat/bind/${encodeURIComponent(bind.challenge_id)}/cancel`,
        {
          method: "POST",
          scope: "user",
          skipRefresh: true,
          headers: { "X-Wechat-Bind-Token": bind.poll_token },
        },
      );
    } catch (reason) {
      if (wechatBindIdRef.current === bind.challenge_id) setError(errorMessage(reason));
      return;
    }
    if (wechatBindIdRef.current !== bind.challenge_id) return;
    wechatBindIdRef.current = null;
    wechatStatusRef.current = null;
    setWechatBind(null);
    setWechatStatus(null);
  }

  async function copyChallenge() {
    if (!wechatBind) return;
    try {
      await navigator.clipboard.writeText(wechatBind.challenge_id);
      setMessage("绑定码已复制，请在小程序确认页输入。");
    } catch {
      setError("浏览器无法自动复制，请手动选择绑定码。");
    }
  }

  const identityIcon = (provider: string) => {
    if (provider === "email") return <Mail className="h-4 w-4" aria-hidden="true" />;
    if (provider === "github") return <GitBranch className="h-4 w-4" aria-hidden="true" />;
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

      {error || message ? (
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
              <article key={identity.id} className="flex flex-wrap items-center gap-3 py-4">
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
              <div className="mt-3 space-y-2">
                {emailIdentity ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full justify-start"
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
                    className="w-full justify-start"
                    disabled={busy}
                    onClick={() => void startGithubStepUp()}
                  >
                    <GitBranch className="h-4 w-4" aria-hidden="true" />
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
            <div className="mt-3 space-y-2">
              {!emailIdentity ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-between"
                  disabled={busy}
                  onClick={() => setEmailBindOpen(true)}
                >
                  <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" />绑定邮箱</span>
                  <span className="text-xs text-muted-foreground">开始</span>
                </Button>
              ) : null}
              {!githubIdentity ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-between"
                  disabled={busy}
                  onClick={() => void startGithubLink()}
                >
                  <span className="inline-flex items-center gap-2"><GitBranch className="h-4 w-4" />绑定 GitHub</span>
                  <span className="text-xs text-muted-foreground">开始</span>
                </Button>
              ) : null}
              {!wechatIdentity ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full justify-between"
                  disabled={busy || Boolean(wechatBind)}
                  onClick={() => void startWechatBind()}
                >
                  <span className="inline-flex items-center gap-2"><MessageCircle className="h-4 w-4" />绑定微信</span>
                  <span className="text-xs text-muted-foreground">{wechatBind ? "等待确认" : "生成小程序码"}</span>
                </Button>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      {emailBindOpen ? (
        <section className="admin-panel rounded-[18px] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">绑定邮箱</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                验证完成后该邮箱可登录 Web 与小程序。
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEmailBindOpen(false);
                setEmailChallenge("");
                setEmailCode("");
              }}
            >
              关闭
            </Button>
          </div>
          {!emailChallenge ? (
            <form className="mt-4 flex max-w-xl gap-2" onSubmit={startEmailBind}>
              <Input
                type="email"
                value={targetEmail}
                onChange={(event) => setTargetEmail(event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                disabled={busy}
              />
              <Button type="submit" disabled={busy || !targetEmail.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                发送验证码
              </Button>
            </form>
          ) : (
            <form className="mt-4 max-w-xl space-y-3" onSubmit={verifyEmailBind}>
              <OtpInput
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
                <span className="text-xs text-muted-foreground">验证码已发送</span>
              </div>
              <Button type="submit" disabled={busy || emailCode.length !== 6}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                验证并绑定
              </Button>
            </form>
          )}
        </section>
      ) : null}

      {wechatBind ? (
        <section className="admin-panel rounded-[18px] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-foreground">在小程序中确认绑定</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                使用微信扫描小程序码，在确认页点击确认以验证当前微信身份。
                扫码本身不会自动绑定，绑定成功后当前网页会话会退出，请重新登录。
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void cancelWechatBind()}>
              取消
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-start gap-5">
            {wechatBind.qrcode_data_url ? (
              <div className="rounded-[16px] border border-border bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- backend-generated WeChat code */}
                <img
                  src={wechatBind.qrcode_data_url}
                  alt="微信小程序绑定码"
                  width={240}
                  height={240}
                  className="h-[240px] w-[240px]"
                />
              </div>
            ) : (
              <div className="grid h-[240px] w-[240px] place-items-center rounded-[16px] border border-dashed border-border bg-secondary/50 p-6 text-center text-xs leading-5 text-muted-foreground">
                {wechatBind.qrcode_error || "小程序码暂不可用"}
              </div>
            )}
            <div className="min-w-[260px] flex-1 space-y-3">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-[11px] font-medium text-muted-foreground">绑定码</p>
                <p className="mt-1 break-all font-mono text-sm text-foreground">
                  {wechatBind.challenge_id}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copyChallenge()}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    复制绑定码
                  </Button>
                  <Countdown
                    seconds={wechatBind.expires_in}
                    busy={false}
                    label="剩余"
                    onExpire={() => {
                      if (wechatBindIdRef.current !== wechatBind.challenge_id) return;
                      wechatBindIdRef.current = null;
                      wechatStatusRef.current = null;
                      setWechatBind(null);
                      setWechatStatus(null);
                      setError("绑定码已过期，请重新生成。");
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl bg-accent/55 px-3 py-2 text-xs text-accent-foreground">
                {wechatStatus?.status === "pending" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    等待小程序确认…
                  </>
                ) : (
                  <>
                    <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                    打开小程序“绑定微信”确认页
                  </>
                )}
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                小程序路径：<code>{wechatBind.miniprogram_path}</code>
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
