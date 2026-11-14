"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ManagementPage,
  ManagementPageHeader,
  MetricCard,
  MetricStrip,
} from "@/components/admin/management-ui";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomCheckbox } from "@/components/ui/custom-checkbox";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import { apiRequest, toQuery } from "@/lib/api/client";
import type {
  AdminUserCreateRequest,
  AdminUserPatchRequest,
  AdminUserSummary,
  PaginatedResponse,
  Role,
} from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { hasPermission, type PermissionKey } from "@/lib/permissions/permissions";
import {
  ADMIN_ROLE_NAMES,
  checkPassword,
  isPasswordReady,
  isFormReady,
  filterManagedRoles,
  filterEditableRoles,
  buildRoleOptions,
  findSelectedFormRole,
  isSuperAdminUser,
  buildPagination,
  endOfChinaDateUtcIso,
  statusToQuery,
  type PaginationItem,
  type StatusFilter,
} from "@/lib/admin-user-utils";
import { chinaDateString, chinaDateToUtcIso, formatChinaDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

type ConfirmState = {
  action: "delete" | "force-logout" | "reset-password";
  userId: number;
  userName: string;
} | null;

type FormState = {
  id?: number;
  username: string;
  password: string;
  display_name: string;
  email: string;
  role_id: string;
  is_active: boolean;
};


const emptyForm: FormState = {
  username: "",
  password: "",
  display_name: "",
  email: "",
  role_id: "",
  is_active: true,
};

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "启用中" },
  { value: "inactive", label: "停用中" },
];

const PAGE_SIZE_OPTIONS = [
  { value: "10", label: "10 条/页" },
  { value: "20", label: "20 条/页" },
  { value: "50", label: "50 条/页" },
  { value: "100", label: "100 条/页" },
];


function RoleBadge({ role }: { role?: Role }) {
  if (!role) return <span className="text-xs text-muted-foreground/70">—</span>;
  const className = role.name === "super_admin"
    ? "border-primary/20 bg-accent text-primary"
    : role.name.includes("system")
      ? "border-success/20 bg-success-light text-success"
      : role.name.includes("content")
        ? "border-warning/25 bg-warning-light text-warning-foreground"
        : "border-border bg-muted/50 text-muted-foreground";

  return (
    <span className={cn("inline-flex rounded-lg border px-2.5 py-1 text-xs font-semibold", className)}>
      {role.display_name}
    </span>
  );
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((state) => state.permissions);
  const currentRole = useAuthStore((state) => state.role);

  const [searchInput, setSearchInput] = useState("");

  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const createdFrom = dateFrom ? chinaDateToUtcIso(dateFrom) : undefined;
  const createdTo = dateTo ? endOfChinaDateUtcIso(dateTo) : undefined;
  const isActive = statusToQuery(statusFilter);

  const users = useQuery({
    queryKey: ["admin-users", page, pageSize, keyword, roleFilter, statusFilter, createdFrom, createdTo],
    queryFn: () =>
      apiRequest<PaginatedResponse<AdminUserSummary>>(
        `/admin-users${toQuery({
          page,
          page_size: pageSize,
          keyword: keyword || undefined,
          role_id: roleFilter ? Number(roleFilter) : undefined,
          is_active: isActive,
          created_from: createdFrom,
          created_to: createdTo,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => apiRequest<{ items: Role[] }>("/roles"),
  });

  const totalUsers = useQuery({
    queryKey: ["admin-users-summary", "total"],
    queryFn: () => apiRequest<PaginatedResponse<AdminUserSummary>>(`/admin-users${toQuery({ page: 1, page_size: 1 })}`),
    staleTime: 30_000,
  });
  const activeUsers = useQuery({
    queryKey: ["admin-users-summary", "active"],
    queryFn: () => apiRequest<PaginatedResponse<AdminUserSummary>>(`/admin-users${toQuery({ page: 1, page_size: 1, is_active: true })}`),
    staleTime: 30_000,
  });
  const inactiveUsers = useQuery({
    queryKey: ["admin-users-summary", "inactive"],
    queryFn: () => apiRequest<PaginatedResponse<AdminUserSummary>>(`/admin-users${toQuery({ page: 1, page_size: 1, is_active: false })}`),
    staleTime: 30_000,
  });

  const today = chinaDateString();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthUsers = useQuery({
    queryKey: ["admin-users-summary", "month", monthStart],
    queryFn: () =>
      apiRequest<PaginatedResponse<AdminUserSummary>>(
        `/admin-users${toQuery({ page: 1, page_size: 1, created_from: chinaDateToUtcIso(monthStart) })}`,
      ),
    staleTime: 30_000,
  });

  const managedRoles = useMemo(
    () => filterManagedRoles(roles.data?.items ?? []),
    [roles.data?.items],
  );
  const editableRoles = useMemo(
    () => filterEditableRoles(managedRoles),
    [managedRoles],
  );
  const roleOptions = useMemo(
    () => buildRoleOptions(managedRoles),
    [managedRoles],
  );
  const selectedFormRole = useMemo(
    () => findSelectedFormRole(editableRoles, form.role_id),
    [editableRoles, form.role_id],
  );
  const passwordChecks = useMemo(
    () => checkPassword(form.password),
    [form.password],
  );
  const passwordReady = isPasswordReady(form.password);
  const formReady = isFormReady(form);

  const isSuperAdmin = useCallback(
    (user: AdminUserSummary) => {
      return isSuperAdminUser(user, managedRoles);
    },
    [managedRoles],
  );

  const hasActionPermission = useCallback(
    (permission: PermissionKey) => currentRole?.name === "super_admin" || hasPermission(permissions, permission),
    [currentRole?.name, permissions],
  );

  const actionMutation = useMutation({
    mutationFn: async (state: Exclude<ConfirmState, null>) => {
      if (state.action === "force-logout") {
        return apiRequest(`/admin-users/${state.userId}/force-logout`, { method: "POST" });
      }
      if (state.action === "reset-password") {
        return apiRequest(`/admin-users/${state.userId}/reset-password`, {
          method: "POST",
          body: JSON.stringify({ new_password: "ChangeMe!2026" }),
        });
      }
      return apiRequest(`/admin-users/${state.userId}`, { method: "DELETE" });
    },
    onSuccess: (_result, variables) => {
      const labels: Record<Exclude<ConfirmState, null>["action"], string> = {
        "force-logout": "已强制登出",
        "reset-password": "密码已重置",
        delete: "账号已停用",
      };
      setMessage(`${variables.userName}：${labels[variables.action]}`);
      setConfirmState(null);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users-summary"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。"),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.role_id) throw new Error("请选择角色");
      if (form.id) {
        const payload: AdminUserPatchRequest = {
          display_name: form.display_name.trim() || null,
          email: form.email.trim() || null,
          role_id: Number(form.role_id),
          is_active: form.is_active,
        };
        return apiRequest(`/admin-users/${form.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      if (!form.username.trim()) throw new Error("请输入用户名");
      if (!passwordReady) throw new Error("初始密码需至少 12 位，并包含大小写字母和数字");
      const payload: AdminUserCreateRequest = {
        username: form.username.trim(),
        password: form.password,
        display_name: form.display_name.trim() || null,
        email: form.email.trim() || null,
        role_id: Number(form.role_id),
        is_active: form.is_active,
      };
      return apiRequest("/admin-users", { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      setMessage(form.id ? "管理员已更新" : "管理员已创建");
      setForm(emptyForm);
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users-summary"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试。"),
  });

  const displayedUsers = users.data;
  const hasDisplayedUsers = displayedUsers !== undefined;

  const currentItems = displayedUsers?.items ?? [];
  const totalPages = Math.max(displayedUsers?.total_pages ?? 1, 1);
  const pagination = useMemo(() => buildPagination(page, totalPages), [page, totalPages]);
  const selectedOnPage = currentItems.filter((user) => selectedIds.has(user.id));
  const allPageSelected = currentItems.length > 0 && selectedOnPage.length === currentItems.length;
  const somePageSelected = selectedOnPage.length > 0 && !allPageSelected;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, keyword, roleFilter, statusFilter, createdFrom, createdTo]);

  const closeForm = useCallback(() => {
    if (saveMutation.isPending) return;
    setShowForm(false);
    setShowPassword(false);
    setForm(emptyForm);
    saveMutation.reset();
  }, [saveMutation]);

  useEffect(() => {
    if (!showForm) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeForm();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showForm, closeForm]);

  const openCreateForm = () => {
    setForm(emptyForm);
    setShowPassword(false);
    saveMutation.reset();
    setShowForm(true);
  };

  const startEdit = (user: AdminUserSummary) => {
    setForm({
      id: user.id,
      username: user.username,
      password: "",
      display_name: user.display_name ?? "",
      email: user.email ?? "",
      role_id: String(user.role_id),
      is_active: user.is_active,
    });
    setShowPassword(false);
    saveMutation.reset();
    setShowForm(true);
  };

  const clearFilters = () => {
    setSearchInput("");
    setKeyword("");
    setRoleFilter("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const refreshAll = async () => {
    setMessage(null);
    setManualRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["roles"] }),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  };

  const togglePageSelection = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      currentItems.forEach((user) => {
        if (checked) next.add(user.id);
        else next.delete(user.id);
      });
      return next;
    });
  };

  const toggleUserSelection = (userId: number, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const canSubmitForm: PermissionKey = form.id ? "admin-user:update" : "admin-user:create";
  const canUseForm = hasActionPermission(canSubmitForm);
  const canCreate = hasActionPermission("admin-user:create");
  const canUpdate = hasActionPermission("admin-user:update");
  const canForceLogout = hasActionPermission("admin-user:force-logout");
  const canResetPassword = hasActionPermission("admin-user:reset-password");
  const canDelete = hasActionPermission("admin-user:delete");

  const confirmDescription = confirmState
    ? {
        "force-logout": `确认强制登出 ${confirmState.userName}？当前会话将立即失效。`,
        "reset-password": `确认将 ${confirmState.userName} 的密码重置为 ChangeMe!2026？`,
        delete: `确认停用管理员 ${confirmState.userName}？停用后该账号将无法登录。`,
      }[confirmState.action]
    : "";

  const hasFilters = Boolean(searchInput.trim() || roleFilter || statusFilter !== "all" || dateFrom || dateTo);

  return (
    <ManagementPage className="space-y-5 pb-6">
      <ManagementPageHeader
        icon={<ShieldCheck className="h-5 w-5" />}
        title="后台管理员"
        description="管理后台账号、角色归属与登录安全操作；保护账号继续遵循前后端双重限制。"
        actions={
          <Button
            onClick={openCreateForm}
            disabled={!canCreate}
            className="h-11 gap-2 rounded-xl px-5 shadow-none"
          >
            <Plus className="h-4 w-4" />
            新建管理员
          </Button>
        }
        meta={<span>超级管理员账号不可在此页面降级、停用或重置密码。</span>}
      />
      {(manualRefreshing || (users.isLoading && !hasDisplayedUsers)) ? (
        <div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/60 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
          aria-label="正在加载数据"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-popover/95 px-5 py-3.5 text-sm font-medium text-muted-foreground shadow-[0_18px_50px_rgba(35,49,42,0.14)]">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <span>加载中…</span>
          </div>
        </div>
      ) : null}
      <MetricStrip className="sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="管理员总数"
          value={totalUsers.data?.total ?? 0}
          hint="全部后台管理员账号"
          icon={<UsersRound className="h-5 w-5" />}
          tone="accent"
          loading={totalUsers.isLoading}
        />
        <MetricCard
          label="启用中"
          value={activeUsers.data?.total ?? 0}
          hint="当前可正常登录"
          icon={<UserRoundCheck className="h-5 w-5" />}
          tone="success"
          loading={activeUsers.isLoading}
        />
        <MetricCard
          label="本月新增"
          value={monthUsers.data?.total ?? 0}
          hint={`北京时间 ${today.slice(0, 7)}`}
          icon={<Plus className="h-5 w-5" />}
          tone="warning"
          loading={monthUsers.isLoading}
        />
        <MetricCard
          label="停用中"
          value={inactiveUsers.data?.total ?? 0}
          hint="当前不可登录"
          icon={<UserRoundX className="h-5 w-5" />}
          tone="danger"
          loading={inactiveUsers.isLoading}
        />
      </MetricStrip>

      {message ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/85 px-4 py-3 text-sm shadow-sm">
          {message.includes("失败") || message.includes("error") ? (
            <ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <UserRoundCheck className="h-4 w-4 shrink-0 text-success" />
          )}
          <span className="text-foreground">{message}</span>
        </div>
      ) : null}

      <Card className="overflow-visible rounded-2xl">
        <CardContent className="p-4 lg:p-5">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
            <label className="relative min-w-0 flex-1 2xl:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                className="h-11 bg-card pl-9"
                placeholder="搜索用户名 / 显示名 / 邮箱"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[160px_160px_minmax(300px,1fr)] 2xl:flex 2xl:items-center">
              <CustomSelect
                value={roleFilter}
                onChange={(value) => {
                  setRoleFilter(value);
                  setPage(1);
                }}
                options={roleOptions}
                placeholder="全部角色"
                className="w-full 2xl:w-40"
              />
              <CustomSelect
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value as StatusFilter);
                  setPage(1);
                }}
                options={STATUS_OPTIONS}
                clearable={false}
                className="w-full 2xl:w-40"
              />
              <div className="flex h-11 items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 2xl:w-[310px]">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                <input
                  type="date"
                  aria-label="创建开始日期"
                  className="h-9 min-w-0 flex-1 bg-transparent text-xs text-muted-foreground outline-none"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDateFrom(value);
                    if (dateTo && value && value > dateTo) setDateTo(value);
                    setPage(1);
                  }}
                />
                <span className="text-muted-foreground/70">—</span>
                <input
                  type="date"
                  aria-label="创建结束日期"
                  className="h-9 min-w-0 flex-1 bg-transparent text-xs text-muted-foreground outline-none"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDateTo(value);
                    if (dateFrom && value && value < dateFrom) setDateFrom(value);
                    setPage(1);
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 2xl:ml-auto">
              {hasFilters ? (
                <Button variant="secondary" onClick={clearFilters} className="h-11 px-3 shadow-none">
                  清除
                </Button>
              ) : null}
              <Button variant="secondary" onClick={refreshAll} disabled={manualRefreshing} className="h-11 w-11 p-0 shadow-none" title="刷新">
                <RefreshCw className={cn("h-4 w-4", manualRefreshing && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl">
        <CardContent className="p-0">
          {users.isError ? (
            <div className="m-4 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive-light px-4 py-3 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              {users.error instanceof Error ? users.error.message : "管理员列表接口暂不可用"}
            </div>
          ) : null}

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[1060px] border-collapse text-sm">
              <thead className="bg-secondary/50 text-left">
                <tr className="border-b border-border">
                  <th className="w-12 px-5 py-3.5">
                    <CustomCheckbox
                      checked={allPageSelected}
                      indeterminate={somePageSelected}
                      onCheckedChange={togglePageSelection}
                      aria-label="选择当前页全部管理员"
                    />
                  </th>
                  {[
                    ["ID", "w-20"],
                    ["用户信息", "min-w-72"],
                    ["角色", "w-36"],
                    ["状态", "w-28"],
                    ["最后登录", "min-w-56"],
                    ["操作", "w-48"],
                  ].map(([label, width]) => (
                    <th key={label} className={cn("px-4 py-3.5 text-xs font-semibold text-muted-foreground", width)}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.isLoading && !hasDisplayedUsers ? (
                  Array.from({ length: Math.min(pageSize, 7) }, (_, index) => (
                    <tr key={index} className="border-b border-border last:border-0">
                      <td className="px-5 py-4"><div className="h-[18px] w-[18px] animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-4"><div className="h-4 w-8 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-4"><div className="h-10 w-52 animate-pulse rounded-lg bg-border" /></td>
                      <td className="px-4 py-4"><div className="h-7 w-20 animate-pulse rounded-lg bg-border" /></td>
                      <td className="px-4 py-4"><div className="h-7 w-16 animate-pulse rounded-full bg-border" /></td>
                      <td className="px-4 py-4"><div className="h-9 w-44 animate-pulse rounded-lg bg-border" /></td>
                      <td className="px-4 py-4"><div className="h-9 w-36 animate-pulse rounded-lg bg-border" /></td>
                    </tr>
                  ))
                ) : currentItems.length ? (
                  currentItems.map((user) => {
                    const userRole = roles.data?.items?.find((item) => item.id === user.role_id);
                    const protectedRow = isSuperAdmin(user);
                    const primaryName = user.display_name || user.username;
                    return (
                      <tr key={user.id} className="border-b border-border transition-colors last:border-0 hover:bg-accent/40">
                        <td className="px-5 py-4">
                          <CustomCheckbox
                            checked={selectedIds.has(user.id)}
                            onCheckedChange={(checked) => toggleUserSelection(user.id, checked)}
                            aria-label={`选择管理员 ${user.username}`}
                          />
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-muted-foreground tabular-nums">{user.id}</td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-primary ring-1 ring-primary/20">
                              {primaryName.charAt(0).toUpperCase() || "A"}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-foreground">{primaryName}</div>
                              <div className="mt-0.5 max-w-[300px] truncate text-xs text-muted-foreground/70">
                                {user.email || (user.display_name ? user.username : "未设置邮箱")}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4"><RoleBadge role={userRole} /></td>
                        <td className="px-4 py-4">
                          <StatusBadge tone={user.is_active ? "success" : "warning"}>{user.is_active ? "启用中" : "停用中"}</StatusBadge>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-xs font-medium text-muted-foreground">{formatChinaDateTime(user.last_login_at)}</div>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">{user.last_login_ip || "—"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              title="编辑管理员"
                              disabled={protectedRow || !canUpdate}
                              onClick={() => startEdit(user)}
                              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-primary transition hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="强制登出"
                              disabled={protectedRow || !canForceLogout}
                              onClick={() => setConfirmState({ action: "force-logout", userId: user.id, userName: user.username })}
                              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-primary transition hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
                            >
                              <LogOut className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="重置密码"
                              disabled={protectedRow || !canResetPassword}
                              onClick={() => setConfirmState({ action: "reset-password", userId: user.id, userName: user.username })}
                              className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-primary transition hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-35"
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="停用账号"
                              disabled={protectedRow || !canDelete || !user.is_active}
                              onClick={() => setConfirmState({ action: "delete", userId: user.id, userName: user.username })}
                              className="grid h-9 w-9 place-items-center rounded-xl border border-destructive/15 bg-card text-destructive transition hover:border-destructive/30 hover:bg-destructive-light disabled:pointer-events-none disabled:opacity-30"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-20 text-center">
                      <UsersRound className="mx-auto h-8 w-8 text-muted-foreground/70" />
                      <p className="mt-3 text-sm font-medium text-muted-foreground">暂无符合条件的管理员</p>
                      <p className="mt-1 text-xs text-muted-foreground/70">调整关键词、角色、状态或日期范围，列表会自动更新。</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>共 <strong className="font-semibold text-foreground">{(displayedUsers?.total ?? 0).toLocaleString("zh-CN")}</strong> 条数据</span>
              {selectedIds.size ? <span className="text-primary">已选 {selectedIds.size} 条</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <nav className="flex items-center gap-1" aria-label="管理员列表分页">
                <button
                  type="button"
                  aria-label="上一页"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-sm text-muted-foreground transition hover:border-primary disabled:pointer-events-none disabled:opacity-30"
                >
                  ‹
                </button>
                {pagination.map((item) =>
                  typeof item === "number" ? (
                    <button
                      type="button"
                      key={item}
                      aria-current={page === item ? "page" : undefined}
                      onClick={() => setPage(item)}
                      className={cn(
                        "grid h-9 min-w-9 place-items-center rounded-xl border px-2 text-xs font-semibold transition",
                        page === item
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-accent",
                      )}
                    >
                      {item}
                    </button>
                  ) : (
                    <span key={item} className="grid h-9 w-7 place-items-center text-xs text-muted-foreground/70">…</span>
                  ),
                )}
                <button
                  type="button"
                  aria-label="下一页"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-card text-sm text-muted-foreground transition hover:border-primary disabled:pointer-events-none disabled:opacity-30"
                >
                  ›
                </button>
              </nav>
              <CustomSelect
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
                options={PAGE_SIZE_OPTIONS}
                clearable={false}
                className="w-28"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {showForm
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4 py-6 backdrop-blur-[3px]"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeForm();
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-user-form-title"
                className="flex max-h-[min(92vh,780px)] w-full max-w-[620px] flex-col overflow-hidden rounded-[28px] border border-border bg-card/95 shadow-[0_28px_90px_rgba(29,37,34,0.24)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-start gap-4 border-b border-border px-6 py-5 sm:px-7">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-primary/15 bg-accent text-primary">
                    {form.id ? <Edit3 className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <h3 id="admin-user-form-title" className="font-display text-[22px] font-bold leading-tight text-foreground">
                      {form.id ? "编辑管理员" : "新建管理员"}
                    </h3>
                    <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                      {form.id ? "更新账号资料、角色和登录状态。" : "创建一个后台登录账号并分配管理角色。"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeForm}
                    disabled={saveMutation.isPending}
                    aria-label="关闭"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground/70 transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {canUseForm ? (
                  <>
                    <div className="overflow-y-auto px-6 py-5 sm:px-7">
                      <div className="space-y-6">
                        <section>
                          <div className="mb-3 flex items-center gap-2">
                            <LockKeyhole className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-semibold text-foreground">登录凭据</h4>
                          </div>
                          <div className="grid gap-4">
                            <div>
                              <div className="mb-1.5 flex items-center justify-between gap-3">
                                <label className="text-xs font-semibold text-muted-foreground" htmlFor="admin-username">
                                  用户名 <span className="text-destructive">*</span>
                                </label>
                                {form.id ? <span className="text-[11px] text-muted-foreground/70">创建后不可修改</span> : null}
                              </div>
                              <Input
                                id="admin-username"
                                autoFocus={!form.id}
                                autoComplete="off"
                                maxLength={64}
                                placeholder="例如 zhangsan.admin"
                                value={form.username}
                                disabled={Boolean(form.id) || saveMutation.isPending}
                                onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                                className="h-11 bg-card"
                              />
                            </div>

                            {!form.id ? (
                              <div>
                                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="admin-password">
                                  初始密码 <span className="text-destructive">*</span>
                                </label>
                                <div className="relative">
                                  <Input
                                    id="admin-password"
                                    autoComplete="new-password"
                                    maxLength={128}
                                    placeholder="输入安全的初始密码"
                                    type={showPassword ? "text" : "password"}
                                    disabled={saveMutation.isPending}
                                    value={form.password}
                                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                                    className="h-11 bg-card pr-11"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowPassword((value) => !value)}
                                    disabled={saveMutation.isPending}
                                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                                    className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground/70 transition hover:bg-muted hover:text-muted-foreground"
                                  >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {[
                                    ["length", "12 位以上"],
                                    ["uppercase", "大写字母"],
                                    ["lowercase", "小写字母"],
                                    ["digit", "数字"],
                                  ].map(([key, label]) => {
                                    const passed = passwordChecks[key as keyof typeof passwordChecks];
                                    return (
                                      <span
                                        key={key}
                                        className={cn(
                                          "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                                          passed
                                            ? "border-success/20 bg-success-light text-success"
                                            : "border-border bg-muted/50 text-muted-foreground/70",
                                        )}
                                      >
                                        <span className="text-[10px]">{passed ? "✓" : "·"}</span>{label}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </section>

                        <div className="h-px bg-border" />

                        <section>
                          <div className="mb-3 flex items-center gap-2">
                            <Mail className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-semibold text-foreground">展示信息</h4>
                            <span className="text-[11px] text-muted-foreground/70">可选</span>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="admin-display-name">显示名</label>
                              <Input
                                id="admin-display-name"
                                maxLength={64}
                                placeholder="例如 张三"
                                disabled={saveMutation.isPending}
                                value={form.display_name}
                                onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                                className="h-11 bg-card"
                              />
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor="admin-email">邮箱</label>
                              <Input
                                id="admin-email"
                                type="email"
                                autoComplete="email"
                                maxLength={128}
                                placeholder="name@example.com"
                                disabled={saveMutation.isPending}
                                value={form.email}
                                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                                className="h-11 bg-card"
                              />
                            </div>
                          </div>
                        </section>

                        <div className="h-px bg-border" />

                        <section>
                          <div className="mb-3 flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-semibold text-foreground">权限与状态</h4>
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                              角色 <span className="text-destructive">*</span>
                            </label>
                            <CustomSelect
                              value={form.role_id}
                              onChange={(value) => setForm((current) => ({ ...current, role_id: value }))}
                              options={editableRoles.map((item) => ({ value: String(item.id), label: item.display_name }))}
                              placeholder="选择管理员角色"
                              disabled={saveMutation.isPending}
                              className="w-full"
                            />
                            {selectedFormRole ? (
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground/70">
                                <RoleBadge role={selectedFormRole} />
                                <span>{selectedFormRole.description || (selectedFormRole.is_system ? "系统内置角色" : "自定义角色")}</span>
                              </div>
                            ) : null}
                          </div>

                          <button
                            type="button"
                            role="switch"
                            aria-checked={form.is_active}
                            disabled={saveMutation.isPending}
                            onClick={() => setForm((current) => ({ ...current, is_active: !current.is_active }))}
                            className="mt-4 flex w-full items-center justify-between gap-4 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-left transition hover:border-primary/30 hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="min-w-0">
                              <strong className="block text-sm font-semibold text-foreground">{form.id ? "启用账号" : "创建后立即启用"}</strong>
                              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground/70">
                                {form.is_active ? "账号创建后可直接登录后台。" : "账号将保持停用，需后续启用后才能登录。"}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
                                form.is_active
                                  ? "border-success bg-success"
                                  : "border-border bg-card",
                              )}
                            >
                              <span
                                className={cn(
                                  "absolute top-0.5 h-[18px] w-[18px] rounded-full bg-card shadow-sm transition-transform",
                                  form.is_active ? "translate-x-[21px]" : "translate-x-[3px]",
                                )}
                              />
                            </span>
                          </button>
                        </section>

                        <div className="flex items-start gap-2.5 rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-xs leading-5 text-muted-foreground">
                          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>超级管理员账号受保护，不提供角色修改、停用、强退或密码重置入口。</span>
                        </div>

                        {saveMutation.isError ? (
                          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-light px-4 py-3 text-xs leading-5 text-destructive">
                            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{saveMutation.error instanceof Error ? saveMutation.error.message : "保存失败，请检查输入后重试。"}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4 sm:px-7">
                      <span className="hidden text-xs text-muted-foreground/70 sm:block">按 Esc 可关闭</span>
                      <div className="ml-auto flex items-center gap-2.5">
                        <Button
                          variant="secondary"
                          onClick={closeForm}
                          disabled={saveMutation.isPending}
                          className="h-11 min-w-20 px-5 text-sm shadow-none"
                        >
                          取消
                        </Button>
                        <Button
                          disabled={saveMutation.isPending || !formReady}
                          onClick={() => saveMutation.mutate()}
                          className="h-11 min-w-32 px-5 text-sm shadow-none"
                        >
                          {saveMutation.isPending ? "保存中..." : form.id ? "保存修改" : "创建管理员"}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="m-6 flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground sm:m-7">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    当前账号没有{form.id ? "编辑管理员" : "创建管理员"}权限。
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.action === "delete" ? "确认停用账号" : "确认操作"}
        description={confirmDescription}
        confirmText={confirmState?.action === "delete" ? "确认停用" : "确认"}
        danger={confirmState?.action === "delete"}
        loading={actionMutation.isPending}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return;
          actionMutation.mutate(confirmState);
        }}
      />
    </ManagementPage>
  );
}
