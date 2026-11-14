"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useAuthStore } from "@/lib/auth/auth-store";
import { hasPermission } from "@/lib/permissions/permissions";
import {
  adminNavigation,
  adminRoutes,
  getActiveAdminRoute,
  type AdminNavigationGroup,
  type AdminNavigationItem,
  type AdminRoute,
} from "@/lib/routes";
import { cn } from "@/lib/utils";

function canViewRoute(
  route: AdminRoute,
  permissions: ReturnType<typeof useAuthStore.getState>["permissions"],
  isSuperAdmin: boolean,
) {
  if (route.superAdminOnly && !isSuperAdmin) return false;
  return isSuperAdmin || hasPermission(permissions, route.permission);
}

function filterNavigation(
  items: AdminNavigationItem[],
  permissions: ReturnType<typeof useAuthStore.getState>["permissions"],
  isSuperAdmin: boolean,
): AdminNavigationItem[] {
  return items.flatMap<AdminNavigationItem>((item): AdminNavigationItem[] => {
    if (item.type === "route") {
      return canViewRoute(item.route, permissions, isSuperAdmin) ? [item] : [];
    }

    const visibleChildren = item.children.filter((route) =>
      canViewRoute(route, permissions, isSuperAdmin),
    );
    if (visibleChildren.length === 0) return [];

    return [{ ...item, children: visibleChildren }];
  });
}

function findActiveGroupKey(
  activeRoute: AdminRoute | null,
  items: AdminNavigationItem[],
): string | null {
  if (!activeRoute) return null;

  const group = items.find(
    (item): item is AdminNavigationGroup =>
      item.type === "group" && item.children.some((route) => route === activeRoute),
  );
  return group?.key ?? null;
}

export function Sidebar({
  variant = "desktop",
  onNavigate,
}: {
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
} = {}) {
  const pathname = usePathname();
  const permissions = useAuthStore((state) => state.permissions);
  const role = useAuthStore((state) => state.role);
  const isSuperAdmin = role?.name === "super_admin";

  const visibleNavigation = useMemo(
    () => filterNavigation(adminNavigation, permissions, isSuperAdmin),
    [permissions, isSuperAdmin],
  );

  const activeRoute = getActiveAdminRoute(pathname, adminRoutes);
  const activeGroupKey = findActiveGroupKey(activeRoute, visibleNavigation);

  // Accordion semantics: at most one parent group can be expanded at a time.
  // The active route's parent wins on navigation so the current page remains visible.
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(activeGroupKey);

  // Keep the current page visible before paint when the route changes. useLayoutEffect
  // avoids a one-frame collapsed state when navigating directly into a child route.
  // Routes outside every group (e.g. /dashboard) pass null here so the accordion
  // closes instead of leaving the previous page's group open.
  useLayoutEffect(() => {
    setExpandedGroupKey(activeGroupKey);
  }, [activeGroupKey, pathname]);

  const toggleGroup = (key: string) => {
    setExpandedGroupKey((current) => (current === key ? null : key));
  };

  return (
    <aside
      className={cn(
        "h-full w-72 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar px-5 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        variant === "desktop"
          ? "sticky top-0 hidden py-6 lg:block"
          : "flex w-full max-w-none flex-col bg-card py-16",
      )}
    >
      <Link
        href="/dashboard"
        onClick={() => {
          setExpandedGroupKey(null);
          onNavigate?.();
        }}
        className="mb-8 flex items-center gap-3"
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary bg-primary font-display text-xl font-black text-primary-foreground shadow-[var(--shadow-crisp)]">
          MG
        </div>
        <div>
          <div className="font-display text-xl font-bold tracking-tight text-sidebar-foreground">MemoGrad</div>
          <div className="font-mono text-xs uppercase tracking-[0.28em] text-muted-foreground">Admin Lab</div>
        </div>
      </Link>

      <nav className="space-y-2" aria-label="后台主导航">
        {visibleNavigation.map((item) => {
          if (item.type === "route") {
            const route = item.route;
            const Icon = route.icon;
            const active = activeRoute === route;

            return (
              <Link
                key={route.href}
                href={route.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-2xl border px-4 py-3 transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar motion-reduce:transition-none",
                  active
                    ? "border-primary bg-accent text-accent-foreground shadow-[var(--shadow-crisp)]"
                    : "border-transparent text-sidebar-foreground hover:-translate-y-px hover:border-sidebar-border hover:bg-card/70 active:translate-y-0",
                )}
              >
                <Icon className="h-5 w-5 shrink-0 transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{route.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{route.description}</span>
                </span>
              </Link>
            );
          }

          const GroupIcon = item.icon;
          const expanded = expandedGroupKey === item.key;
          const groupActive = activeGroupKey === item.key;

          return (
            <div
              key={item.key}
              className={cn(
                "rounded-2xl transition-[background-color] duration-300 motion-reduce:transition-none",
                expanded && "bg-card/20",
              )}
            >
              <button
                type="button"
                onClick={() => toggleGroup(item.key)}
                aria-expanded={expanded}
                aria-controls={`sidebar-group-${item.key}`}
                className={cn(
                  "group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar active:scale-[0.99] motion-reduce:transition-none",
                  groupActive
                    ? "border-primary/45 bg-accent text-accent-foreground shadow-sm"
                    : expanded
                      ? "border-sidebar-border bg-card/75 text-sidebar-foreground shadow-sm"
                      : "border-transparent text-sidebar-foreground hover:border-sidebar-border hover:bg-card/70",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-2 left-0 w-0.5 origin-center rounded-r-full bg-primary transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
                    groupActive ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0",
                  )}
                />

                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-[background-color,color,transform] duration-200 ease-out motion-reduce:transition-none",
                      groupActive
                        ? "bg-card/75 text-primary"
                        : expanded
                          ? "bg-accent/55 text-sidebar-foreground"
                          : "text-current group-hover:bg-card/70 group-hover:scale-105",
                    )}
                  >
                    <GroupIcon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                  </span>
                </span>

                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition-[background-color,border-color,transform] duration-200 ease-out motion-reduce:transition-none",
                    expanded
                      ? "border-primary/20 bg-accent"
                      : "border-transparent bg-card/35 group-hover:border-sidebar-border group-hover:bg-card/80",
                  )}
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                      expanded && "rotate-90 text-accent-foreground",
                    )}
                  />
                </span>
              </button>

              <div
                id={`sidebar-group-${item.key}`}
                aria-hidden={!expanded}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                  expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="overflow-hidden">
                  <div
                    className={cn(
                      "relative ml-7 py-1.5 pl-5 transition-[transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                      expanded ? "translate-y-0" : "-translate-y-1.5",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute bottom-3 left-0 top-2 w-px origin-top bg-sidebar-border transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
                        expanded ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
                      )}
                    />

                    <div className="space-y-1">
                      {item.children.map((route, index) => {
                        const Icon = route.icon;
                        const active = activeRoute === route;

                        return (
                          <Link
                            key={route.href}
                            href={route.href}
                            onClick={onNavigate}
                            tabIndex={expanded ? undefined : -1}
                            aria-current={active ? "page" : undefined}
                            style={{
                              transitionDelay: expanded ? `${45 + index * 28}ms` : "0ms",
                            }}
                            className={cn(
                              "group/child relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-sidebar motion-reduce:transition-none motion-reduce:delay-0",
                              expanded ? "translate-x-0 opacity-100" : "-translate-x-1.5 opacity-0",
                              active
                                ? "border-primary/35 bg-accent text-accent-foreground shadow-sm"
                                : "border-transparent text-muted-foreground hover:translate-x-0.5 hover:border-sidebar-border hover:bg-card/80 hover:text-sidebar-foreground",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2 transition-colors duration-200 motion-reduce:transition-none",
                                active
                                  ? "bg-primary"
                                  : "bg-sidebar-border group-hover/child:bg-primary/35",
                              )}
                            />
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute -left-[22px] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full border bg-background transition-[background-color,border-color,box-shadow,transform] duration-200 motion-reduce:transition-none",
                                active
                                  ? "scale-125 border-primary bg-primary shadow-[0_0_0_3px_var(--accent)]"
                                  : "border-sidebar-border group-hover/child:scale-110 group-hover/child:border-primary/55",
                              )}
                            />

                            <span
                              className={cn(
                                "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-[background-color,color,transform] duration-200 ease-out motion-reduce:transition-none",
                                active
                                  ? "bg-card/75 text-primary"
                                  : "text-current group-hover/child:bg-card group-hover/child:scale-105",
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </span>

                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{route.label}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{route.description}</span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
