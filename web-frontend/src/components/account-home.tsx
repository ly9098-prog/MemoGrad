"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  Smartphone,
  UserRound,
} from "lucide-react";
import { BrandHeader } from "@/components/brand-header";
import { ProviderIcon } from "@/components/provider-icon";
import { accountInitial, accountName, identityDescription, providerLabel } from "@/lib/auth-format";
import { useUserAuth } from "@/lib/auth-store";

export function AccountHome() {
  const user = useUserAuth((state) => state.user);
  if (!user) return null;
  const identities = user.identities;
  const username = accountName(user);
  return (
    <div className="app-surface">
      <BrandHeader authenticated />
      <main className="account-page">
        <section className="account-intro">
          <div className="account-avatar">{accountInitial(user)}</div>
          <div>
            <h1 title={username}>{username}</h1>
            <p className="account-id">MemoGrad 用户 #{user.id}</p>
          </div>
          <div className="account-actions">
            <Link href="/settings" className="secondary-action">
              管理登录方式
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        <div className="account-grid">
          <section className="identity-ledger" aria-labelledby="identity-title">
            <header className="section-heading">
              <div>
                <h2 id="identity-title">登录身份</h2>
                <p>当前已连接 {identities.length} 种方式，学习记录共用同一个用户 ID。</p>
              </div>
              <span className="identity-count">{identities.length}</span>
            </header>
            <div className="identity-list">
              {identities.map((identity) => {
                return (
                  <article key={identity.id} className="identity-item">
                    <span className="identity-icon">
                      <ProviderIcon provider={identity.provider} />
                    </span>
                    <div className="identity-copy">
                      <h3>{providerLabel(identity.provider)}</h3>
                      <p>{identityDescription(identity, user)}</p>
                    </div>
                    <span className="verified-state">
                      <Check aria-hidden="true" />
                      {identity.verified ? "已连接" : "待验证"}
                    </span>
                  </article>
                );
              })}
            </div>
            <footer className="ledger-footer">
              <UserRound aria-hidden="true" />
              <p>绑定新身份前会先确认当前账号；邮箱相同也不会自动合并另一个学习账号。</p>
            </footer>
          </section>

          <aside className="account-side">
            <section className="mini-bridge">
              <div className="mini-bridge-visual" aria-hidden="true">
                <span className="mini-phone">
                  <Smartphone />
                </span>
                <span className="mini-line" />
                <span className="mini-mark">MG</span>
              </div>
              <h2>继续在微信小程序学习</h2>
              <p>
                刷题、错题与复习仍在 MemoGrad 小程序中完成。使用已绑定邮箱或微信进入，
                会回到当前账号。
              </p>
              <ol>
                <li>打开 MemoGrad 微信小程序</li>
                <li>选择邮箱验证码或微信登录</li>
                <li>继续刷题和复习</li>
              </ol>
            </section>

            <section className="security-brief">
              <h2>账号安全</h2>
              <div className="security-line">
                <span>已验证邮箱</span>
                <strong>{user.email_verified ? "是" : "否"}</strong>
              </div>
              <div className="security-line">
                <span>浏览器会话</span>
                <strong>已登录</strong>
              </div>
              <Link href="/settings" className="text-link">
                查看与更新安全设置
                <ArrowRight aria-hidden="true" />
              </Link>
            </section>
          </aside>
        </div>
      </main>
      <footer className="site-footer">
        <span>MemoGrad · 一个账号，一份学习记录</span>
        <span>桂ICP备2026003057号-2X</span>
      </footer>
    </div>
  );
}
