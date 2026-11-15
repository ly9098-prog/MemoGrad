"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, FileQuestion, FileText, Images, UploadCloud, Wrench } from "lucide-react";
import { ManagementPage } from "@/components/admin/management-ui";
import { cn } from "@/lib/utils";

const importTabs = [
  { href: "/imports/questions", label: "题目列表", icon: FileQuestion },
  { href: "/imports/tasks", label: "导入任务", icon: UploadCloud },
  { href: "/imports/batch-image", label: "批量导题", icon: Images },
  { href: "/imports/text-import", label: "文本导入", icon: FileText },
  { href: "/imports/review", label: "待审核题目", icon: ClipboardCheck },
  { href: "/imports/maintenance", label: "运维", icon: Wrench },
];

export default function ImportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <ManagementPage className="space-y-6">
      <nav
        aria-label="导入工作区导航"
        className="flex flex-wrap gap-1 rounded-[14px] border border-border bg-card p-1.5"
      >
        {importTabs.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-[10px] border px-3.5 text-[13px] font-semibold transition-colors",
                active
                  ? "border-primary/25 bg-accent text-accent-foreground"
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
