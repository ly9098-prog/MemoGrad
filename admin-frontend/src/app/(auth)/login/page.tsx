"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, type PointerEvent, Suspense, useState } from "react";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { AdminFooter } from "@/components/layout/admin-footer";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/lib/auth/auth-store";
import { safeInternalRedirect } from "@/lib/safe-redirect";
import styles from "./login.module.css";

function updateCardTilt(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) return;
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

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const hasError = Boolean(error);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      router.replace(safeInternalRedirect(searchParams.get("next")));
    } catch {
      setError("用户名或密码错误");
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
                <p className={styles.subtitle}>登录，继续管理你的内容工作台</p>
              </div>
              <form onSubmit={handleSubmit} className={styles.form} aria-busy={loading}>
                <div className={styles.field}>
                  <label htmlFor="username">用户名</label>
                  <div className={styles.inputShell} data-invalid={hasError || undefined}>
                    <UserRound className={styles.fieldIcon} aria-hidden="true" strokeWidth={1.7} />
                    <Input
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
                {error ? (
                  <div id="login-error" role="alert" className={styles.error}>
                    <AlertCircle aria-hidden="true" /><span>{error}</span>
                  </div>
                ) : null}
                <button type="submit" className={styles.submit} disabled={loading} aria-busy={loading}>
                  {loading ? (
                    <><Loader2 className={styles.spinner} aria-hidden="true" /><span>正在校验</span></>
                  ) : (
                    <><span>登录工作台</span><ArrowRight aria-hidden="true" /></>
                  )}
                </button>
              </form>
              <div className={styles.cardFooter}><ShieldCheck aria-hidden="true" /><p>仅限授权管理员访问</p></div>
            </section>
          </div>
          <p className={styles.support}>需要访问权限？<a href="mailto:{{SECRET_d8zo1uvg}}">联系管理员</a></p>
        </div>
      </main>
      <div className={styles.footer}><AdminFooter variant="auth" /></div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
