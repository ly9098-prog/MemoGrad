"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, LogOut, Search } from "lucide-react";
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
import styles from "./navigation.module.css";

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
  collapsed = false,
  onHoverChange,
  onFocusWithinChange,
}: {
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
  collapsed?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  onFocusWithinChange?: (focused: boolean) => void;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);
  const role = useAuthStore((state) => state.role);
  const isSuperAdmin = role?.name === "super_admin";
  const userName = user && typeof user === "object" && "username" in user && typeof user.username === "string"
    ? user.username
    : "Admin";
  const roleLabel = role?.display_name ?? role?.name ?? "管理员";

  const visibleNavigation = useMemo(
    () => filterNavigation(adminNavigation, permissions, isSuperAdmin),
    [permissions, isSuperAdmin],
  );

  const activeRoute = getActiveAdminRoute(pathname, adminRoutes);
  const activeGroupKey = findActiveGroupKey(activeRoute, visibleNavigation);

  const [groupInteraction, setGroupInteraction] = useState<{ hovered: string | null; open: string | null }>({
    hovered: null,
    open: null,
  });
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const groupHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGroupKey = useRef<string | null>(null);
  const isRail = variant === "desktop" && collapsed;
  const query = search.trim().toLocaleLowerCase();
  const searchedNavigation = visibleNavigation.flatMap<AdminNavigationItem>((item) => {
    if (!query) return [item];
    if (item.type === "route") {
      return `${item.route.label} ${item.route.description}`.toLocaleLowerCase().includes(query) ? [item] : [];
    }
    if (item.label.toLocaleLowerCase().includes(query)) return [item];
    const children = item.children.filter((route) =>
      `${route.label} ${route.description}`.toLocaleLowerCase().includes(query),
    );
    return children.length ? [{ ...item, children }] : [];
  });

  const interactingGroupKey = groupInteraction.hovered ?? groupInteraction.open;
  const searchingGroup = searchedNavigation.find(
    (item): item is AdminNavigationGroup => item.type === "group" && item.key === interactingGroupKey,
  ) ?? searchedNavigation.find((item): item is AdminNavigationGroup => item.type === "group");
  const expandedGroupKey = query ? searchingGroup?.key ?? null : interactingGroupKey;

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace("/login");
  }

  function navigate() {
    setSearch("");
    onNavigate?.();
  }

  function clearGroupHoverTimer() {
    if (groupHoverTimer.current) {
      clearTimeout(groupHoverTimer.current);
      groupHoverTimer.current = null;
    }
    pendingGroupKey.current = null;
  }

  function armGroupHoverTimer(key: string) {
    if (groupHoverTimer.current) clearTimeout(groupHoverTimer.current);
    groupHoverTimer.current = setTimeout(() => {
      pendingGroupKey.current = null;
      setGroupInteraction((current) => ({ ...current, hovered: key }));
    }, 220);
  }

  function scheduleGroupHover(key: string) {
    clearGroupHoverTimer();
    pendingGroupKey.current = key;
    armGroupHoverTimer(key);
  }

  function rescheduleGroupHover(key: string) {
    if (pendingGroupKey.current === key) armGroupHoverTimer(key);
  }

  function scheduleGroupLeave(key: string) {
    clearGroupHoverTimer();
    groupHoverTimer.current = setTimeout(() => {
      setGroupInteraction((current) => (
        (current.hovered ?? current.open) === key
          ? { hovered: null, open: null }
          : current
      ));
    }, 140);
  }

  const groupId = (key: string) => "sidebar-" + (variant === "mobile" ? "mobile-" : "") + "group-" + key;
  const rowClass = styles.row;

  return (
    <aside
      id={variant === "desktop" ? "admin-desktop-navigation" : undefined}
      data-collapsed={isRail ? "true" : undefined}
      data-variant={variant}
      onPointerEnter={variant === "desktop" ? () => onHoverChange?.(true) : undefined}
      onPointerLeave={variant === "desktop" ? (event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerStillInside = event.clientX >= bounds.left
          && event.clientX <= bounds.right
          && event.clientY >= bounds.top
          && event.clientY <= bounds.bottom;
        if (!pointerStillInside) onHoverChange?.(false);
      } : undefined}
      onFocusCapture={variant === "desktop" ? (event) => {
        const target = event.target as { matches?: (selector: string) => boolean } | null;
        if (target?.matches?.(":focus-visible")) {
          onFocusWithinChange?.(true);
        }
      } : undefined}
      onBlurCapture={variant === "desktop" ? (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onFocusWithinChange?.(false);
        }
      } : undefined}
      className={cn(
        styles.sidebar,
        variant === "desktop" ? "hidden lg:flex" : "flex border-r-0 bg-card",
      )}
    >
      <div className={cn(styles.brand, variant === "mobile" && "pr-12")}>
        <Link
          href="/dashboard"
          aria-label="MemoGrad 管理工作台"
          onClick={() => {
            setSearch("");
            navigate();
          }}
          className={styles.brandLink}
          title={isRail ? "MemoGrad 管理工作台" : undefined}
        >
          <span className={styles.brandMark}>MG</span>
          <span className={styles.copy}>
            <span className="block truncate text-sm font-semibold tracking-tight">MemoGrad</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">管理工作台</span>
          </span>
        </Link>
      </div>

      <div className={styles.searchArea}>
        {isRail ? (
          <button type="button" aria-label="搜索导航" title="搜索导航" className={rowClass} onClick={() => {
            requestAnimationFrame(() => searchRef.current?.focus());
          }}>
            <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          </button>
        ) : (
        <label className={styles.searchField}>
          <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <input
            type="search"
            ref={searchRef}
            aria-label="搜索导航"
            placeholder="搜索导航…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-full w-full min-w-0 bg-transparent text-sm text-foreground caret-primary outline-none placeholder:text-muted-foreground"
          />
        </label>
        )}
      </div>

      <nav className={styles.navigation} aria-label="后台主导航">
        <div className={styles.navigationItems}>
          {searchedNavigation.map((item) => {
            if (item.type === "route") {
              const route = item.route;
              const Icon = route.icon;
              const active = activeRoute === route;
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  onClick={navigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={route.label}
                  title={isRail ? route.label : undefined}
                  className={cn(rowClass, active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-sidebar-foreground")}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className={styles.copy}>{route.label}</span>
                </Link>
              );
            }

            const GroupIcon = item.icon;
            const expanded = !isRail && expandedGroupKey === item.key;
            const groupActive = activeGroupKey === item.key;
            return (
              <div
                key={item.key}
                className={styles.navigationGroup}
                onPointerEnter={variant === "desktop" ? () => scheduleGroupHover(item.key) : undefined}
                onPointerMove={variant === "desktop" ? () => rescheduleGroupHover(item.key) : undefined}
                onPointerLeave={variant === "desktop" ? (event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const pointerStillInside = event.clientX >= bounds.left
                    && event.clientX <= bounds.right
                    && event.clientY >= bounds.top
                    && event.clientY <= bounds.bottom;
                  if (!pointerStillInside) scheduleGroupLeave(item.key);
                } : undefined}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (query) {
                      setSearch("");
                    }
                    clearGroupHoverTimer();
                    setGroupInteraction((current) => {
                      if (current.hovered === item.key) {
                        return { hovered: null, open: item.key };
                      }
                      return {
                        hovered: current.hovered,
                        open: current.open === item.key ? null : item.key,
                      };
                    });
                  }}
                  aria-expanded={expanded}
                  aria-controls={groupId(item.key)}
                  aria-label={item.label}
                  title={isRail ? item.label : undefined}
                  className={cn(rowClass, "w-full text-left", groupActive ? "font-medium text-primary" : "text-muted-foreground", "hover:bg-accent/60 hover:text-sidebar-foreground")}
                >
                  <GroupIcon className="h-5 w-5 shrink-0" />
                  <span className={cn(styles.copy, "flex-1")}>{item.label}</span>
                  <ChevronRight aria-hidden="true" className={cn(styles.chevron, expanded && "rotate-90")} />
                </button>
                <div id={groupId(item.key)} inert={!expanded} aria-hidden={!expanded} data-expanded={expanded ? "true" : "false"} className={styles.groupPanel}>
                  <div className={styles.groupClip}>
                  <div className={styles.children}>
                    {item.children.map((route) => {
                      const Icon = route.icon;
                      const active = activeRoute === route;
                      return (
                        <Link
                          key={route.href}
                          href={route.href}
                          onClick={navigate}
                          aria-current={active ? "page" : undefined}
                          tabIndex={expanded ? undefined : -1}
                          className={cn(rowClass, styles.childRow, active ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-sidebar-foreground")}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className={cn(styles.labelText, "truncate")}>{route.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {searchedNavigation.length === 0 && <p role="status" className="px-2.5 py-6 text-center text-xs leading-5 text-muted-foreground">未找到匹配的导航</p>}
      </nav>

      <div className={styles.footer}>
        <div
          className={styles.account}
          title={isRail ? `${userName} · ${roleLabel}` : undefined}
          aria-label={`当前用户：${userName}，${roleLabel}`}
        >
          <span className={styles.avatar} aria-hidden="true">{Array.from(userName)[0]}</span>
          <span className={cn(styles.copy, styles.accountCopy)}>
            <span className={styles.accountName}>{userName}</span>
            <span className={styles.accountRole}>{roleLabel}</span>
          </span>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="登出"
            title="退出登录"
            className={styles.logoutButton}
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
