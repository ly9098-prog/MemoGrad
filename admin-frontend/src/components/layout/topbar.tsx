"use client";

import type { Ref } from "react";
import { LogOut, Menu, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/auth/auth-store";
import { adminRoutes, getActiveAdminRoute } from "@/lib/routes";

function getUserName(user: unknown) {
  if (user && typeof user === "object" && "username" in user && typeof user.username === "string") return user.username;
  return "Admin";
}

export function Topbar({
  onOpenNavigation,
  isNavigationOpen = false,
  navigationButtonRef,
}: {
  onOpenNavigation?: () => void;
  isNavigationOpen?: boolean;
  navigationButtonRef?: Ref<HTMLButtonElement>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const role = useAuthStore((state) => state.role);
  const logout = useAuthStore((state) => state.logout);
  const activeRoute = getActiveAdminRoute(pathname, adminRoutes);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 px-4 py-3.5 backdrop-blur-xl lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="打开后台导航"
            aria-controls="admin-mobile-navigation"
            aria-expanded={isNavigationOpen}
            onClick={onOpenNavigation}
            ref={navigationButtonRef}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card/70 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Operations Console
              {activeRoute ? <span className="text-primary"> / {activeRoute.label}</span> : null}
            </p>
            <h1 className="truncate font-display text-xl font-bold text-foreground sm:text-2xl">
              {activeRoute?.label ?? "后台管理系统"}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-3 rounded-2xl border border-border bg-card/70 px-4 py-2 md:flex">
            <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <div className="max-w-40 truncate text-sm font-semibold text-foreground">{getUserName(user)}</div>
              <div className="max-w-40 truncate text-xs text-muted-foreground">
                {role?.display_name ?? role?.name ?? "会话内存态"}
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="h-10" aria-label="登出">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">登出</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
