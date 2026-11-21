"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Link2,
  Network,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  accountInitial,
  accountName,
  identityDescription,
  providerLabel,
} from "@/lib/account-format";
import { useAuthStore } from "@/lib/auth/auth-store";

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
      <section className="admin-panel overflow-hidden rounded-[20px] p-6">
        <div className="flex flex-wrap items-center gap-5">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[18px] border border-white/70 bg-white/60 text-xl font-semibold text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            {accountInitial(user.email, user.nickname, user.id)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              LEARNER ACCOUNT
            </p>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em] text-foreground">
              {accountName(user.email, user.nickname, user.id)}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              用户 #{user.id} · {user.identities.length} 种登录身份
            </p>
          </div>
          <Link
            href="/account/settings"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:border-primary/35 hover:bg-accent"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            安全与绑定
          </Link>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <section className="admin-panel rounded-[18px] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">学习入口</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                当前身份可浏览已发布题库和知识点关系。
              </p>
            </div>
            <Link2 className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link
              href="/questions"
              className="group rounded-[14px] border border-border bg-card/75 p-4 transition hover:-translate-y-px hover:border-primary/35 hover:bg-accent/35"
            >
              <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="mt-3 font-semibold text-foreground">题库</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                查看题干、选项、答案与解析。
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                开始浏览
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
            <Link
              href="/knowledge-graph"
              className="group rounded-[14px] border border-border bg-card/75 p-4 transition hover:-translate-y-px hover:border-primary/35 hover:bg-accent/35"
            >
              <Network className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="mt-3 font-semibold text-foreground">知识图谱</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                按科目探索知识点与前后关系。
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                打开图谱
                <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          </div>
        </section>

        <section className="admin-panel rounded-[18px] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">登录身份</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                所有身份共享同一用户 ID 和学习记录。
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
