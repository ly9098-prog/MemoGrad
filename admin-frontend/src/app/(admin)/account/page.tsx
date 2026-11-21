"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Check,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { identityDescription, providerLabel } from "@/lib/account-format";
import { useAuthStore } from "@/lib/auth/auth-store";
import { LearnerProfile } from "@/components/profile/learner-profile";

export default function AccountPage() {
  const user = useAuthStore((state) => state.learnerUser);
  const accessMode = useAuthStore((state) => state.accessMode);
  const router = useRouter();

  useEffect(() => {
    if (accessMode === "admin") router.replace("/profile");
  }, [accessMode, router]);

  if (accessMode === "admin") return null;
  if (!user) return null;

  return (
    <div className="space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">账号资料</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理头像、昵称与登录方式</p>
        </div>
        <Link
          href="/account/settings"
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:border-primary/35 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          安全与绑定
        </Link>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <LearnerProfile key={user.id} user={user} />

        <section className="admin-panel rounded-2xl p-5" aria-labelledby="identity-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 id="identity-heading" className="text-lg font-semibold text-foreground">登录身份</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                用户 #{user.id} · 所有身份共享同一份学习记录
              </p>
            </div>
            <UserRound className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="mt-3 divide-y divide-border">
            {user.identities.map((identity) => (
              <div key={identity.id} className="flex items-center gap-3 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-secondary text-muted-foreground">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {providerLabel(identity.provider)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {identityDescription(identity, user.email)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {identity.verified ? "已连接" : "待验证"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
