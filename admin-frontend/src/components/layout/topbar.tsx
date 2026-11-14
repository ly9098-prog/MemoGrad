"use client";

import type { Ref } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { adminNavigation, adminRoutes, getActiveAdminRoute } from "@/lib/routes";
import { useAuthStore } from "@/lib/auth/auth-store";
import styles from "./navigation.module.css";

function getUserName(user: unknown) {
  if (user && typeof user === "object" && "username" in user && typeof user.username === "string") return user.username;
  return "Admin";
}

export function Topbar({
  onOpenNavigation,
  isNavigationOpen = false,
  navigationButtonRef,
  onToggleDesktopNavigation,
  isDesktopNavigationCollapsed = false,
}: {
  onOpenNavigation?: () => void;
  isNavigationOpen?: boolean;
  navigationButtonRef?: Ref<HTMLButtonElement>;
  onToggleDesktopNavigation?: () => void;
  isDesktopNavigationCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const activeRoute = getActiveAdminRoute(pathname, adminRoutes);
  const activeGroup = activeRoute && adminNavigation.find((item) => item.type === "group" && item.children.includes(activeRoute));
  const groupLabel = activeGroup?.type === "group" ? activeGroup.label : null;
  const pageLabel = activeRoute?.label ?? "后台管理系统";
  const userName = getUserName(user);
  const DesktopNavigationIcon = isDesktopNavigationCollapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <header className={styles.topbar}>
      <div className="flex h-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="打开后台导航"
            aria-controls="admin-mobile-navigation"
            aria-expanded={isNavigationOpen}
            onClick={onOpenNavigation}
            ref={navigationButtonRef}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={isDesktopNavigationCollapsed ? "展开侧栏" : "收起侧栏"}
            aria-controls="admin-desktop-navigation"
            aria-expanded={!isDesktopNavigationCollapsed}
            onClick={onToggleDesktopNavigation}
            className="hidden h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:grid"
          >
            <DesktopNavigationIcon className="h-4 w-4" aria-hidden="true" />
          </button>
          <span aria-hidden="true" className="hidden h-4 w-px bg-border sm:block" />
          <nav className="min-w-0" aria-label="面包屑">
            <ol className="flex min-w-0 items-center gap-1.5 text-sm sm:gap-2 sm:text-[15px]">
              <li className="hidden shrink-0 text-muted-foreground sm:block">MemoGrad</li>
              <li aria-hidden="true" className="hidden shrink-0 text-border sm:block">/</li>
              {groupLabel && (
                <>
                  <li className="max-w-20 truncate text-muted-foreground sm:max-w-none" title={groupLabel}>{groupLabel}</li>
                  <li aria-hidden="true" className="shrink-0 text-border">/</li>
                </>
              )}
              <li aria-current="page" className="truncate font-medium text-foreground" title={pageLabel}>{pageLabel}</li>
            </ol>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div role="group" className="flex items-center gap-3" aria-label={`${userName} · ${role?.display_name ?? role?.name ?? "管理员"}`} title={`${userName} · ${role?.display_name ?? role?.name ?? "管理员"}`}>
            <span className="hidden max-w-32 truncate text-[13px] text-muted-foreground md:block">{userName}</span>
            <span className={styles.avatar} aria-hidden="true">{Array.from(userName)[0]}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
