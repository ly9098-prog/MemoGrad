"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Hash,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { SecuritySettings } from "@/components/profile/security-settings";
import styles from "@/components/profile/profile.module.css";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import type { AuthUser, MeResponse } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { formatChinaDate, formatChinaDateTime } from "@/lib/time";

function ProfileForm({ user }: { user: AuthUser }) {
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const changed = displayName.trim() !== (user.display_name ?? "");

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !changed) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest<MeResponse>("/auth/me", {
        method: "PATCH",
        exposeErrorDetail: true,
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
      const current = useAuthStore.getState().user;
      const currentId = current && ("id" in current ? current.id : current.user.id);
      if (!current || currentId !== user.id) return;
      const profile = { display_name: result.user.display_name };
      useAuthStore.setState({
        user: "id" in current
          ? { ...current, ...profile }
          : { ...current, user: { ...current.user, ...profile } },
      });
      setDisplayName(result.user.display_name ?? "");
      setMessage("个人资料已保存");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={saveProfile}
      className={styles.profileForm}
      aria-busy={saving}
    >
      <div className={styles.formGrid}>
        <label className={styles.formField}>
          <span>用户名</span>
          <div className={styles.lockedField}>
            <Input
              value={user.username}
              readOnly
              aria-describedby="username-help"
              className={styles.textInput}
            />
            <LockKeyhole aria-hidden="true" />
          </div>
          <small id="username-help">由超级管理员分配</small>
        </label>
        <label className={styles.formField}>
          <span>显示名称</span>
          <Input
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setMessage("");
              setError("");
            }}
            maxLength={64}
            autoComplete="nickname"
            placeholder={user.username}
            disabled={saving}
            className={styles.textInput}
          />
          <small>显示在侧栏与操作记录中</small>
        </label>
      </div>
      <div className={styles.formActions}>
        <Button
          type="submit"
          disabled={saving || !changed}
          className={styles.actionButton}
        >
          {saving ? <Loader2 aria-hidden="true" className={styles.spinner} /> : null}
          {saving ? "正在保存" : "保存资料"}
        </Button>
        <p
          role={error ? "alert" : "status"}
          className={error ? styles.formError : styles.formStatus}
        >
          {error || message}
        </p>
      </div>
    </form>
  );
}

export default function ProfilePage() {
  const storedUser = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const [activeSection, setActiveSection] = useState<"details" | "security">("details");
  const user = storedUser && ("id" in storedUser ? storedUser : storedUser.user);

  useEffect(() => {
    const updateActiveSection = () => {
      setActiveSection(window.location.hash === "#security" ? "security" : "details");
    };
    updateActiveSection();
    window.addEventListener("hashchange", updateActiveSection);
    return () => window.removeEventListener("hashchange", updateActiveSection);
  }, []);

  if (!user) return null;

  const name = user.display_name || user.username;
  const initial = Array.from(name)[0] || "M";
  const roleName = role?.display_name ?? "管理员";
  const createdAt = user.created_at ? formatChinaDate(user.created_at) : "未记录";
  const lastLogin = user.last_login_at
    ? formatChinaDateTime(user.last_login_at)
    : "尚无登录记录";
  const accountTone = user.is_active ? "success" : "danger";
  const emailBadge = !user.email
    ? { label: "未绑定邮箱", tone: "neutral" as const }
    : user.email_verified
      ? { label: "邮箱已验证", tone: "success" as const }
      : { label: "邮箱未验证", tone: "warning" as const };
  const emailSummary = !user.email
    ? "尚未绑定，无法使用邮箱验证码登录"
    : user.email_verified
      ? "已验证，可用于验证码登录和找回密码"
      : "待验证，完成验证后可用于验证码登录";
  const loginMethodSummary = user.email_verified
    ? "邮箱验证码与密码登录均已启用"
    : "密码登录已启用，绑定并验证邮箱后可启用验证码登录";

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headingGroup}>
          <h1>个人信息</h1>
          <p>维护你的管理员资料、邮箱与登录密码</p>
        </div>
        <div className={styles.accountHealth}>
          <span className={styles.healthPill} data-active={user.is_active}>
            <span aria-hidden="true" />
            {user.is_active ? "账号正常" : "账号已停用"}
          </span>
          <span>最近登录 {lastLogin}</span>
        </div>
      </header>

      <nav aria-label="个人信息分区" className={styles.tabs}>
        <a
          href="#details"
          className={`${styles.tab} ${
            activeSection === "details" ? styles.tabActive : ""
          }`}
          aria-current={activeSection === "details" ? "location" : undefined}
          onClick={() => setActiveSection("details")}
        >
          基本资料
        </a>
        <a
          href="#security"
          className={`${styles.tab} ${
            activeSection === "security" ? styles.tabActive : ""
          }`}
          aria-current={activeSection === "security" ? "location" : undefined}
          onClick={() => setActiveSection("security")}
        >
          登录与安全
        </a>
      </nav>

      <section className={styles.workspace} aria-label="管理员账户">
        <aside className={styles.identityRail}>
          <div className={styles.avatar} aria-hidden="true">
            {initial}
          </div>
          <div className={styles.identityCopy}>
            <h2>{name}</h2>
            <div className={styles.identityMeta}>
              <span>{roleName}</span>
              <StatusBadge tone={emailBadge.tone}>
                {emailBadge.label}
              </StatusBadge>
            </div>
          </div>

          <dl className={styles.metadata}>
            <div>
              <dt>
                <Hash aria-hidden="true" />
                账号 ID
              </dt>
              <dd>{user.id}</dd>
            </div>
            <div>
              <dt>
                <UserRound aria-hidden="true" />
                用户名
              </dt>
              <dd>{user.username}</dd>
            </div>
            <div>
              <dt>
                <CalendarDays aria-hidden="true" />
                加入时间
              </dt>
              <dd>{createdAt}</dd>
            </div>
            <div>
              <dt>
                <CheckCircle2 aria-hidden="true" />
                账号状态
              </dt>
              <dd>
                <StatusBadge tone={accountTone}>
                  {user.is_active ? "正常" : "停用"}
                </StatusBadge>
              </dd>
            </div>
          </dl>

          <div className={styles.railDivider} aria-hidden="true" />

          <div className={styles.securitySummary}>
            <h3>账号安全</h3>
            <div>
              <span className={styles.summaryIcon}>
                <Mail aria-hidden="true" />
              </span>
              <p>
                <strong>邮箱验证</strong>
                <span>{emailSummary}</span>
              </p>
            </div>
            <div>
              <span className={styles.summaryIcon}>
                <ShieldCheck aria-hidden="true" />
              </span>
              <p>
                <strong>登录方式</strong>
                <span>{loginMethodSummary}</span>
              </p>
            </div>
            <div>
              <span className={styles.summaryIcon}>
                <KeyRound aria-hidden="true" />
              </span>
              <p>
                <strong>密码保护</strong>
                <span>修改密码后需要重新登录</span>
              </p>
            </div>
          </div>
        </aside>

        <div className={styles.contentColumn}>
          <section
            id="details"
            className={styles.detailsSection}
            aria-labelledby="details-title"
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionIcon}>
                  <UserRound aria-hidden="true" />
                </span>
                <h2 id="details-title">基本资料</h2>
              </div>
              <p>用户名由超级管理员分配</p>
            </div>
            <ProfileForm key={user.id} user={user} />
          </section>

          <section
            id="security"
            className={styles.securitySection}
            aria-labelledby="security-title"
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionIcon}>
                  <ShieldCheck aria-hidden="true" />
                </span>
                <h2 id="security-title">登录与安全</h2>
              </div>
              <p>敏感操作需重新验证</p>
            </div>
            <SecuritySettings key={user.id} />
          </section>
        </div>
      </section>
    </div>
  );
}
