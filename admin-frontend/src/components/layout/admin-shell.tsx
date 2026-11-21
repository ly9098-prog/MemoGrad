"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./sidebar";
import { OcrImportSessionProvider } from "./ocr-import-session-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuthBootstrap } from "@/lib/auth/use-auth-bootstrap";
import { useAuthStore } from "@/lib/auth/auth-store";
import { isLearnerPath } from "@/lib/routes";
import styles from "./navigation.module.css";

function SidebarSkeleton() {
  return (
    <aside className={`${styles.sidebar} hidden lg:flex`} data-collapsed="true">
      <div className={styles.brand}>
        <div className={styles.brandMark}>MG</div>
      </div>
      <div className="space-y-2 px-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex h-9 items-center justify-center">
            <div className="h-5 w-5 rounded bg-border" />
          </div>
        ))}
      </div>
    </aside>
  );
}

function MainContentSkeleton() {
  return (
    <div className="space-y-5 p-6 lg:px-8">
      {/* Filter bar skeleton */}
      <div className="flex flex-wrap gap-3">
        <div className="h-11 w-full max-w-xs rounded-xl bg-border" />
        <div className="h-11 w-32 rounded-xl bg-border" />
        <div className="h-11 w-28 rounded-xl bg-border" />
        <div className="h-11 w-24 rounded-xl bg-border" />
      </div>
      {/* List skeleton */}
      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-border bg-card/70 p-4 motion-reduce:animate-none"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-5 w-16 rounded-full bg-border" />
              <div className="h-5 w-14 rounded-full bg-border" />
              <div className="h-4 w-36 rounded bg-border" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div className="h-3 w-32 rounded bg-border" />
              <div className="h-3 w-20 rounded bg-border" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const accessMode = useAuthStore((state) => state.accessMode);
  const learnerUser = useAuthStore((state) => state.learnerUser);
  const adminId = useAuthStore(({ user }) => user && ("id" in user ? user.id : user.user.id));
  const mustChangepassword = useAuthStore(({ user }) =>
    Boolean(user && "must_change_password" in user && user.must_change_password),
  );
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const [mobileNavigationPath, setMobileNavigationPath] = useState<string | null>(null);
  const [isNavigationHovered, setNavigationHovered] = useState(false);
  const [isNavigationFocused, setNavigationFocused] = useState(false);
  const navigationButtonRef = useRef<HTMLButtonElement | null>(null);
  useAuthBootstrap();

  const redirectPath = useMemo(() => {
    if (pathname === "/login") return "";
    return `?next=${encodeURIComponent(pathname)}`;
  }, [pathname]);

  // Formula create/edit pages provide their own sticky navigation/action header.
  // Keep the floating mobile navigation trigger out of those focused workspaces
  // so it never overlaps their header.
  const isFormulaEditRoute = /^\/formulas\/\d+$/.test(pathname);
  const isFocusedFormulaEditor = pathname === "/formulas/new" || pathname.startsWith("/formulas/new/") || isFormulaEditRoute;
  const isMobileNavigationOpen = mobileNavigationPath === pathname;
  const isDesktopNavigationExpanded = isNavigationHovered || isNavigationFocused;
  const isLearnerRoute = isLearnerPath(pathname);
  const isLearnerAllowed = accessMode !== "user" || isLearnerRoute;
  const sessionUserId = adminId ?? learnerUser?.id ?? "anonymous";

  useEffect(() => {
    if (!isBootstrapping && !isAuthenticated) {
      const loginPath = isLearnerRoute ? "/account/login" : "/login";
      router.replace(`${loginPath}${redirectPath}`);
      return;
    }
    if (!isBootstrapping && accessMode === "user" && !isLearnerRoute) {
      router.replace("/questions");
      return;
    }
    if (
      !isBootstrapping
      && isAuthenticated
      && accessMode === "admin"
      && mustChangepassword
      && pathname !== "/change-password"
    ) {
      const next = pathname === "/login" ? "" : `?next=${encodeURIComponent(pathname)}`;
      router.replace(`/change-password${next}`);
    }
  }, [
    isAuthenticated,
    isBootstrapping,
    isLearnerRoute,
    mustChangepassword,
    accessMode,
    pathname,
    router,
    redirectPath,
  ]);

  // Bootstrapping: render skeleton layout matching real structure
  if (isBootstrapping) {
    return (
      <div className={styles.shell}>
        <SidebarSkeleton />
        <main className={`${styles.workspace} admin-content-theme`}>
          <MainContentSkeleton />
        </main>
      </div>
    );
  }

  if (!isAuthenticated) return null;
  if (!isLearnerAllowed) return null;

  return (
    <div className={styles.shell} data-navigation-expanded={isDesktopNavigationExpanded ? "true" : undefined}>
      <Sidebar
        collapsed={!isDesktopNavigationExpanded}
        onHoverChange={setNavigationHovered}
        onFocusWithinChange={setNavigationFocused}
      />
      {!isFocusedFormulaEditor && (
        <button
          type="button"
          ref={navigationButtonRef}
          aria-label="打开后台导航"
          aria-controls="admin-mobile-navigation"
          aria-expanded={isMobileNavigationOpen}
          onClick={() => setMobileNavigationPath(pathname)}
          className={styles.mobileNavigationButton}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <main
        className={`${styles.workspace} admin-content-theme ${
          isFocusedFormulaEditor
            ? "p-0"
            : "px-4 pb-6 pt-16 lg:px-8 lg:py-8 [&>*]:min-w-0 [&>*]:w-full"
        }`}
        data-focused-editor={isFocusedFormulaEditor ? "true" : undefined}
      >
        <OcrImportSessionProvider key={`${sessionUserId}:${accessMode ?? "anonymous"}`}>
          {children}
        </OcrImportSessionProvider>
      </main>
      <Dialog
        open={isMobileNavigationOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setMobileNavigationPath(null);
        }}
      >
        <DialogContent
          showCloseButton
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            navigationButtonRef.current?.focus();
          }}
          className={`${styles.drawer} left-0 top-0 h-dvh max-h-none w-[min(88vw,18rem)] max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-y-0 border-l-0 p-0`}
        >
          <DialogTitle className="sr-only">后台导航</DialogTitle>
          <div id="admin-mobile-navigation" className="h-full">
            <Sidebar variant="mobile" onNavigate={() => setMobileNavigationPath(null)} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
