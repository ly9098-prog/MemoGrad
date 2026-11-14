"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useAuthBootstrap } from "@/lib/auth/use-auth-bootstrap";
import { useAuthStore } from "@/lib/auth/auth-store";

function SidebarSkeleton() {
  return (
      <aside className="hidden h-full w-72 shrink-0 border-r border-sidebar-border bg-sidebar px-5 py-6 lg:block">
      {/* Logo skeleton */}
      <div className="mb-8 flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-border" />
        <div className="space-y-1.5">
            <div className="h-5 w-28 rounded bg-border" />
            <div className="h-3 w-20 rounded bg-border" />
        </div>
      </div>
      {/* Nav links skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl px-4 py-3">
              <div className="h-5 w-5 rounded bg-border" />
            <div className="space-y-1">
                <div className="h-3.5 w-24 rounded bg-border" />
                <div className="h-3 w-16 rounded bg-border" />
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function TopbarSkeleton() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-xl lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="h-3 w-36 rounded bg-border" />
          <div className="h-6 w-44 rounded bg-border" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-10 w-32 rounded-2xl bg-border" />
          <div className="h-10 w-16 rounded-xl bg-border" />
        </div>
      </div>
    </header>
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
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const [mobileNavigationPath, setMobileNavigationPath] = useState<string | null>(null);
  const navigationButtonRef = useRef<HTMLButtonElement | null>(null);
  useAuthBootstrap();

  const redirectPath = useMemo(() => {
    if (pathname === "/login") return "";
    return `?next=${encodeURIComponent(pathname)}`;
  }, [pathname]);

  // Formula create/edit pages provide their own sticky navigation/action header.
  // Keep the global topbar out of those focused workspaces so sticky regions
  // never stack, overlap the form, or reveal scrolled fields behind the header.
  const isFormulaEditRoute = /^\/formulas\/\d+$/.test(pathname);
  const isFocusedFormulaEditor = pathname === "/formulas/new" || pathname.startsWith("/formulas/new/") || isFormulaEditRoute;
  const isMobileNavigationOpen = mobileNavigationPath === pathname;

  useEffect(() => {
    if (!isBootstrapping && !isAuthenticated) {
      router.replace(`/login${redirectPath}`);
    }
  }, [isAuthenticated, isBootstrapping, router, redirectPath]);

  // Bootstrapping: render skeleton layout matching real structure
  if (isBootstrapping) {
    return (
      <div className="flex h-dvh min-h-dvh overflow-hidden">
        <SidebarSkeleton />
        <div className="flex min-w-0 flex-1 flex-col">
          {!isFocusedFormulaEditor && <TopbarSkeleton />}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <MainContentSkeleton />
          </main>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="flex h-dvh min-h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {!isFocusedFormulaEditor && (
          <Topbar
            onOpenNavigation={() => setMobileNavigationPath(pathname)}
            isNavigationOpen={isMobileNavigationOpen}
            navigationButtonRef={navigationButtonRef}
          />
        )}
        <main
          className={
            isFocusedFormulaEditor
              ? "min-h-0 flex-1 overflow-y-auto p-0"
              : "min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-[1680px]"
          }
          data-focused-editor={isFocusedFormulaEditor ? "true" : undefined}
        >
          {children}
        </main>
      </div>
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
          className="left-0 top-0 h-dvh max-h-none w-[min(88vw,20rem)] max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-y-0 border-l-0 p-0"
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
