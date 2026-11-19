"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Link2,
  Loader2,
  LogOut,
  Mail,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Unlink,
} from "lucide-react";
import { BrandHeader } from "@/components/brand-header";
import { ProviderIcon } from "@/components/provider-icon";
import { accountInitial, accountName, identityDescription, providerLabel } from "@/lib/auth-format";
import { ApiError, apiRequest } from "@/lib/api";
import { useUserAuth } from "@/lib/auth-store";
import { useOtpCountdown } from "@/lib/use-otp-countdown";
import type {
  GithubStartResponse,
  OtpStartResponse,
  UserIdentity,
  WebAuthResponse,
} from "@/lib/types";

type EmailMode = "bind" | "change";

function actionError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return "网络连接失败，请稍后重试";
  return "操作未完成，请稍后重试";
}

function OtpCountdown({
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
      className="settings-text-button"
      disabled={busy || remaining > 0}
      onClick={onResend}
    >
      {remaining > 0 ? `${remaining} 秒后可重发` : "重新发送"}
    </button>
  );
}

export function SecuritySettings() {
  const router = useRouter();
  const user = useUserAuth((state) => state.user);
  const accessToken = useUserAuth((state) => state.accessToken);
  const applyAuth = useUserAuth((state) => state.applyAuth);
  const logout = useUserAuth((state) => state.logout);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [stepUpChallenge, setStepUpChallenge] = useState("");
  const [stepUpCode, setStepUpCode] = useState("");
  const [stepUpResend, setStepUpResend] = useState(0);
  const [stepUpToken, setStepUpToken] = useState("");
  const [stepUpProvider, setStepUpProvider] = useState<"email" | "github" | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("verified") !== "github") return;
    let active = true;
    void apiRequest<{ step_up_token: string }>(
      "/users/me/identities/github/step-up/result", { method: "POST", token: accessToken },
    ).then((response) => {
      if (!active) return;
      setStepUpToken(response.step_up_token);
      setStepUpProvider("github");
      window.history.replaceState(null, "", "/settings");
    }).catch((error: unknown) => { if (active) setError(actionError(error)); });
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

  const [emailMode, setEmailMode] = useState<EmailMode | null>(null);
  const [targetEmail, setTargetEmail] = useState("");
  const [emailChallenge, setEmailChallenge] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailResend, setEmailResend] = useState(0);
  const emailPanel = useRef<HTMLElement>(null);
  const stepUpInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (emailMode) {
      emailPanel.current?.scrollIntoView({ block: "nearest" });
      emailPanel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }
  }, [emailMode, emailChallenge]);

  useEffect(() => {
    if (stepUpChallenge) stepUpInput.current?.focus();
  }, [stepUpChallenge]);

  const [pendingUnlink, setPendingUnlink] = useState<UserIdentity | null>(null);

  if (!user || !accessToken) return null;
  const emailIdentity = user.identities.find((identity) => identity.provider === "email");
  const githubIdentity = user.identities.find((identity) => identity.provider === "github");
  const wechatIdentity = user.identities.find((identity) => identity.provider === "wechat");
  const hasEmail = Boolean(emailIdentity);
  const canRemove = user.identities.length > 1;

  function resetFeedback() {
    setError("");
    setMessage("");
  }

  async function startStepUp() {
    if (busy) return;
    if (!hasEmail) {
      setError("当前账号没有已验证邮箱，无法在网页上完成安全验证");
      return;
    }
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<OtpStartResponse>(
        "/users/me/identities/email/step-up/start",
        { method: "POST", token: accessToken },
      );
      setStepUpChallenge(response.challenge_id);
      setStepUpResend(response.resend_after);
      setStepUpCode("");
      setMessage(`安全验证码已发送至 ${user?.email ?? "当前邮箱"}`);
    } catch (submitError) {
      setError(actionError(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyStepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stepUpCode.length !== 6 || busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<{ step_up_token: string }>(
        "/users/me/identities/email/step-up/verify",
        {
          method: "POST",
          token: accessToken,
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
    } catch (submitError) {
      setError(actionError(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function startEmailFlow() {
    if (busy) return;
    const normalized = targetEmail.trim();
    if (!normalized) {
      setError("请输入邮箱地址");
      return;
    }
    if (emailMode === "change" && !stepUpToken && !emailChallenge) {
      setError("更换邮箱前需要先完成安全验证");
      return;
    }
    resetFeedback();
    setBusy(true);
    const proof = stepUpToken;
    if (emailMode === "change" && !emailChallenge) {
      setStepUpToken("");
      setStepUpProvider(null);
    }
    try {
      const path = emailMode === "bind"
        ? "/users/me/identities/email/bind/start"
        : "/users/me/identities/email/change/start";
      const response = await apiRequest<OtpStartResponse>(path, {
        method: "POST",
        token: accessToken,
        body: JSON.stringify(
          emailMode === "bind"
            ? { email: normalized }
            : { email: normalized, ...(emailChallenge
              ? { challenge_id: emailChallenge }
              : { step_up_token: proof }) },
        ),
      });
      setEmailChallenge(response.challenge_id);
      setEmailResend(response.resend_after);
      setEmailCode("");
      setMessage(`验证码已发送至 ${normalized}`);
    } catch (submitError) {
      setError(actionError(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmailFlow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (emailCode.length !== 6 || busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const path = emailMode === "bind"
        ? "/users/me/identities/email/bind/verify"
        : "/users/me/identities/email/change/verify";
      const response = await apiRequest<WebAuthResponse | { status: string; reauthentication_required: boolean }>(
        path,
        {
          method: "POST",
          token: accessToken,
          body: JSON.stringify({ challenge_id: emailChallenge, code: emailCode }),
        },
      );
      if (emailMode === "bind" && "access_token" in response) {
        applyAuth(response);
        setEmailMode(null);
        setEmailChallenge("");
        setEmailCode("");
        setMessage("邮箱已绑定。现在可以使用该邮箱登录 Web 和小程序。");
      } else {
        useUserAuth.getState().clear();
        router.replace("/?email_changed=1");
      }
    } catch (submitError) {
      setError(actionError(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function unlinkIdentity(identity: UserIdentity) {
    if (busy) return;
    if (!canRemove) {
      setError("至少需要保留一种可用登录方式");
      return;
    }
    if (!stepUpToken || stepUpProvider === identity.provider) {
      setPendingUnlink(identity);
      if (identity.provider !== "email" && hasEmail) await startStepUp();
      else setError("请先使用准备保留的 GitHub 完成安全验证，再解绑邮箱");
      return;
    }
    if (identity.provider === "email") {
      const confirmed = window.confirm("解绑邮箱后，小程序需通过已绑定的微信登录；网页可继续使用 GitHub。是否继续？");
      if (!confirmed) return;
    }
    if (identity.provider === "wechat") {
      const confirmed = window.confirm("解绑微信后将无法使用微信进入当前账号，是否继续？");
      if (!confirmed) return;
    }
    resetFeedback();
    setBusy(true);
    const proof = stepUpToken;
    setStepUpToken("");
    setStepUpProvider(null);
    try {
      await apiRequest(`/users/me/identities/${identity.id}`, {
        method: "DELETE",
        token: accessToken,
        body: JSON.stringify({ step_up_token: proof }),
      });
      useUserAuth.getState().clear();
      router.replace("/?identity_unlinked=1");
    } catch (submitError) {
      setError(actionError(submitError));
    } finally {
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
          token: accessToken,
          body: JSON.stringify({ return_to: "/settings" }),
        },
      );
      window.location.assign(response.authorization_url);
    } catch (submitError) {
      setError(actionError(submitError));
      setBusy(false);
    }
  }

  async function startGithubVerification() {
    if (busy) return;
    resetFeedback();
    setBusy(true);
    try {
      const response = await apiRequest<GithubStartResponse>(
        "/users/me/identities/github/step-up/start", { method: "POST", token: accessToken },
      );
      window.location.assign(response.authorization_url);
    } catch (error) {
      setError(actionError(error));
      setBusy(false);
    }
  }

  async function signOut() {
    await logout().catch(() => undefined);
    router.replace("/");
  }

  return (
    <div className="app-surface">
      <BrandHeader authenticated />
      <main className="settings-page">
        <Link href="/" className="back-link">
          <ArrowLeft aria-hidden="true" />
          返回账号首页
        </Link>

        <header className="settings-header">
          <div className="settings-avatar">{accountInitial(user)}</div>
          <div>
            <h1>账号安全</h1>
            <p>{accountName(user)} · 用户 #{user.id}</p>
          </div>
          <button type="button" className="settings-logout" disabled={busy} onClick={signOut}>
            <LogOut aria-hidden="true" />
            退出登录
          </button>
        </header>

        {(error || message) ? (
          <div
            className={`settings-feedback${error ? " is-error" : ""}`}
            role={error ? "alert" : "status"}
          >
            {error ? <AlertCircle aria-hidden="true" /> : <Check aria-hidden="true" />}
            <span>{error || message}</span>
          </div>
        ) : null}

        <div className="settings-layout">
          <div className="identity-workspace">
            <section className="identity-settings" aria-labelledby="identity-settings-title">
              <header>
                <div>
                  <h2 id="identity-settings-title">已连接身份</h2>
                  <p>所有可用身份指向同一个用户 ID 和学习记录。</p>
                </div>
                <span>{user.identities.length} 种</span>
              </header>

              <div className="settings-identity-list">
                {user.identities.map((identity) => {
                  return (
                    <article key={identity.id} className="settings-identity">
                      <span className="settings-provider-icon"><ProviderIcon provider={identity.provider} /></span>
                      <div>
                        <h3>{providerLabel(identity.provider)}</h3>
                        <p>{identityDescription(identity, user)}</p>
                      </div>
                      <div className="identity-actions">
                        {identity.provider === "email" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEmailMode("change");
                              setTargetEmail("");
                              setEmailChallenge("");
                              resetFeedback();
                            }}
                          >
                            更换
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="identity-remove"
                          disabled={busy || !canRemove}
                          onClick={() => void unlinkIdentity(identity)}
                        >
                          <Unlink aria-hidden="true" />
                          解绑
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            {emailMode ? (
              <section ref={emailPanel} className="email-change-panel" aria-labelledby="email-flow-title">
                <header>
                  <div>
                    <h2 id="email-flow-title">{emailMode === "bind" ? "绑定邮箱" : "更换邮箱"}</h2>
                    <p>
                      {emailMode === "bind"
                        ? "验证完成后立即成为当前账号的邮箱登录方式。"
                        : "先验证已有身份，再验证新邮箱；完成后需要重新登录"}
                    </p>
                  </div>
                  <button type="button" disabled={busy} onClick={() => setEmailMode(null)}>关闭</button>
                </header>
                {!emailChallenge ? (
                  <form
                    className="email-change-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void startEmailFlow();
                    }}
                  >
                    <label>
                      <span>{emailMode === "bind" ? "要绑定的邮箱" : "新邮箱地址"}</span>
                      <input
                        type="email"
                        disabled={busy}
                        value={targetEmail}
                        onChange={(event) => setTargetEmail(event.target.value)}
                        placeholder="name@example.com"
                        autoComplete="email"
                        required
                      />
                    </label>
                    <button
                      type={emailMode === "change" && !stepUpToken ? "button" : "submit"}
                      className="settings-primary"
                      disabled={busy}
                      onClick={emailMode === "change" && !stepUpToken ? () => void startStepUp() : undefined}
                    >
                      {busy ? <Loader2 className="spin" /> : emailMode === "change" && !stepUpToken ? <ShieldCheck /> : <Mail />}
                      {emailMode === "change" && !stepUpToken ? "先验证当前邮箱" : "发送验证码"}
                    </button>
                  </form>
                ) : (
                  <form className="email-change-form" onSubmit={verifyEmailFlow}>
                    <label>
                      <span>发送至 {targetEmail} 的验证码</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        disabled={busy}
                        value={emailCode}
                        onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        maxLength={6}
                        required
                      />
                    </label>
                    <div className="email-change-actions">
                      <button type="button" className="settings-text-button" disabled={busy} onClick={() => setEmailChallenge("")}>
                        修改邮箱
                      </button>
                      <OtpCountdown
                        key={emailChallenge}
                        seconds={emailResend}
                        busy={busy}
                        onResend={() => void startEmailFlow()}
                      />
                    </div>
                    <button type="submit" className="settings-primary" disabled={busy || emailCode.length !== 6}>
                      {busy ? <Loader2 className="spin" /> : <Check />}
                      验证并完成
                    </button>
                  </form>
                )}
              </section>
            ) : null}
          </div>

          <aside className="settings-side">
            <section className="security-verify">
              <span className={stepUpToken ? "verify-icon is-complete" : "verify-icon"}>
                {stepUpToken ? <Check aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              </span>
              <div>
                <h2>敏感操作验证</h2>
                <p>
                  {stepUpToken
                    ? `${stepUpProvider === "github" ? "GitHub" : "邮箱"}验证已通过，可用于一次安全操作`
                    : "更换邮箱前验证已有身份；解绑前验证准备保留的登录方式"}
                </p>
              </div>
              {!stepUpChallenge ? (
                <div className="verification-methods">
                  {hasEmail && <button
                  type="button"
                  className="settings-primary"
                  disabled={busy || !hasEmail}
                  onClick={() => void startStepUp()}
                >
                  {busy ? <Loader2 className="spin" /> : <Mail />}
                  验证邮箱
                </button>}
                  {githubIdentity && <button
                    type="button" className="settings-text-button" disabled={busy}
                    onClick={() => void startGithubVerification()}
                  >验证 GitHub</button>}
                </div>
              ) : (
                <form className="inline-otp" onSubmit={verifyStepUp}>
                  <label>
                    <span>6 位验证码</span>
                    <input
                      ref={stepUpInput}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      disabled={busy}
                      value={stepUpCode}
                      onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                    />
                  </label>
                  <div>
                    <button type="button" className="settings-text-button" disabled={busy} onClick={() => setStepUpChallenge("")}>
                      取消
                    </button>
                    <OtpCountdown
                      key={stepUpChallenge}
                      seconds={stepUpResend}
                      busy={busy}
                      onResend={() => void startStepUp()}
                    />
                  </div>
                  <button type="submit" className="settings-primary" disabled={busy || stepUpCode.length !== 6}>
                    {busy ? <Loader2 className="spin" /> : <ShieldCheck />}
                    验证并继续
                  </button>
                </form>
              )}
            </section>

            <section className="connect-panel">
              <h2>连接新方式</h2>
              {!hasEmail ? (
                <div className="connect-action">
                  <span><Mail aria-hidden="true" /></span>
                  <div>
                    <strong>绑定邮箱</strong>
                    <p>用于 Web 与小程序登录，也用于网页安全验证。</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEmailMode("bind");
                      setTargetEmail("");
                      setEmailChallenge("");
                      resetFeedback();
                    }}
                  >
                    开始
                  </button>
                </div>
              ) : null}
              {!githubIdentity ? (
                <div className="connect-action">
                  <span><ProviderIcon provider="github" /></span>
                  <div>
                    <strong>绑定 GitHub</strong>
                    <p>使用 GitHub 账号登录</p>
                  </div>
                  <button type="button" onClick={() => void startGithubLink()} disabled={busy}>
                    开始
                  </button>
                </div>
              ) : null}
              {!wechatIdentity ? (
                <div className="connect-action is-instruction">
                  <span><MessageCircle aria-hidden="true" /></span>
                  <div>
                    <strong>绑定微信</strong>
                    <p>微信授权只能在 MemoGrad 小程序内完成。先使用当前邮箱进入小程序，再绑定微信。</p>
                  </div>
                  <Smartphone aria-hidden="true" />
                </div>
              ) : null}
              {hasEmail && githubIdentity && wechatIdentity ? (
                <p className="all-connected"><Check aria-hidden="true" />三种登录方式均已连接。</p>
              ) : null}
            </section>
          </aside>
        </div>

        {pendingUnlink && !stepUpToken ? (
          <div className="pending-note">
            <Link2 aria-hidden="true" />
            <p>要解绑 {providerLabel(pendingUnlink.provider)}，请先验证准备保留的登录方式，再点击解绑</p>
          </div>
        ) : null}
      </main>
      <footer className="site-footer">
        <span>MemoGrad · 一个账号，一份学习记录</span>
        <span>桂ICP备2026003057号-2X</span>
      </footer>
    </div>
  );
}
