"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  FileQuestion,
  FileText,
  Images,
  UploadCloud,
  Wrench,
} from "lucide-react";
import { ManagementPage } from "@/components/admin/management-ui";
import { cn } from "@/lib/utils";
import {
  WorkspacePage,
  workspaceStyles as ws,
} from "@/components/admin/workspace";

const importTabs = [
  { href: "/imports/questions", label: "题目列表", icon: FileQuestion },
  { href: "/imports/tasks", label: "导入任务", icon: UploadCloud },
  { href: "/imports/batch-image", label: "批量导题", icon: Images },
  { href: "/imports/text-import", label: "文本导入", icon: FileText },
  { href: "/imports/review", label: "待审核题目", icon: ClipboardCheck },
  { href: "/imports/maintenance", label: "运维", icon: Wrench },
];

export default function ImportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const revealCurrentTab = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const item = active.getBoundingClientRect();
      const viewport = nav.getBoundingClientRect();
      if (item.left < viewport.left || item.right > viewport.right) {
        nav.scrollLeft +=
          (item.left + item.right - viewport.left - viewport.right) / 2;
      }
    };
    revealCurrentTab();
    const observer = new ResizeObserver(revealCurrentTab);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);

  const isClearWorkspace =
    pathname === "/imports/questions" || pathname === "/imports/maintenance";
  if (isClearWorkspace) {
    return (
      <WorkspacePage>
        <nav ref={navRef} aria-label="导入工作区导航" className={ws.importNav}>
          {importTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={pathname === tab.href ? "page" : undefined}
              >
                <Icon aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </WorkspacePage>
    );
  }

  return (
    <ManagementPage className="pb-10">
      <nav
        aria-label="导入工作区导航"
        className="admin-premium-panel admin-premium-inset relative isolate flex flex-wrap gap-1 rounded-[20px] p-2"
      >
        {importTabs.map((tab) => {
          const Icon = tab.icon;
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-[10px] border px-3.5 text-[13px] font-semibold transition-colors",
                active
                  ? "border-white/72 bg-white/82 text-[#1b4f70] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_20px_rgba(31,72,100,0.05)]"
                  : "border-transparent text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </ManagementPage>
  );
}
