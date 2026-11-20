"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UsersRound,
  UserX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ManagementPage,
  ManagementPageHeader,
  MetricCard,
  MetricStrip,
} from "@/components/admin/management-ui";
import { StatusBadge } from "@/components/status-badge";
import { useStaggeredEntrance } from "@/components/motion/staggered-entrance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomCheckbox } from "@/components/ui/custom-checkbox";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, toQuery } from "@/lib/api/client";
import type { AppUser, PaginatedResponse } from "@/lib/api/types";
import { chinaDateString, chinaDateToUtcIso, formatChinaDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  csvEscape,
  buildUserCsvHeader,
  buildUserCsvRow,
  filterBatchActionCandidates,
  noCandidatesMessage,
  buildPagination,
  statusToQueryValue,
  endOfChinaDateUtcIso,
  type UserAction,
  type UserStatusFilter,
} from "@/lib/app-user-utils";

type ConfirmState = {
  action: UserAction;
  userIds: number[];
  label: string;
} | null;
type Notice = { tone: "success" | "error"; text: string } | null;

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "正常用户" },
  { value: "banned", label: "已封禁" },
];

const PAGE_SIZE_OPTIONS = [
  { value: "10", label: "10 条/页" },
  { value: "20", label: "20 条/页" },
  { value: "50", label: "50 条/页" },
  { value: "100", label: "100 条/页" },
];


function UserAvatar({ user }: { user: AppUser }) {
  const initial = (user.nickname || "用户").trim().charAt(0).toUpperCase() || "U";

  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full border border-border bg-accent object-cover"
      />
    );
  }

  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-primary/15 bg-accent text-sm font-bold text-primary">
      {initial}
    </div>
  );
}

export default function AppUsersPage() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<UserStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchAction, setBatchAction] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [banReason, setBanReason] = useState("后台人工封禁");
  const [notice, setNotice] = useState<Notice>(null);
  const [exporting, setExporting] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const today = chinaDateString();
  const isBanned = statusToQueryValue(status);
  const createdFrom = dateFrom ? chinaDateToUtcIso(dateFrom) : undefined;
  const createdTo = dateTo ? endOfChinaDateUtcIso(dateTo) : undefined;

  const users = useQuery({
    queryKey: ["app-users", page, pageSize, keyword, status, createdFrom, createdTo],
    queryFn: () =>
      apiRequest<PaginatedResponse<AppUser>>(
        `/app-users${toQuery({
          page,
          page_size: pageSize,
          keyword: keyword || undefined,
          is_banned: isBanned,
          created_from: createdFrom,
          created_to: createdTo,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const displayedUsers = users.data;
  const hasDisplayedUsers = displayedUsers !== undefined;

  const totalUsers = useQuery({
    queryKey: ["app-users-summary", "total"],
    queryFn: () => apiRequest<PaginatedResponse<AppUser>>(`/app-users${toQuery({ page: 1, page_size: 1 })}`),
    staleTime: 30_000,
  });

  const activeUsers = useQuery({
    queryKey: ["app-users-summary", "active"],
    queryFn: () => apiRequest<PaginatedResponse<AppUser>>(`/app-users${toQuery({ page: 1, page_size: 1, is_banned: false })}`),
    staleTime: 30_000,
  });

  const bannedUsers = useQuery({
    queryKey: ["app-users-summary", "banned"],
    queryFn: () => apiRequest<PaginatedResponse<AppUser>>(`/app-users${toQuery({ page: 1, page_size: 1, is_banned: true })}`),
    staleTime: 30_000,
  });

  const todayUsers = useQuery({
    queryKey: ["app-users-summary", "today", today],
    queryFn: () =>
      apiRequest<PaginatedResponse<AppUser>>(
        `/app-users${toQuery({
          page: 1,
          page_size: 1,
          created_from: chinaDateToUtcIso(today),
          created_to: endOfChinaDateUtcIso(today),
        })}`,
      ),
    staleTime: 30_000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ action, userIds }: Exclude<ConfirmState, null>) => {
      // There is no bulk endpoint today. Use small chunks instead of firing up to
      // 100 admin writes at once when the operator selects an entire page.
      for (let index = 0; index < userIds.length; index += 5) {
        const chunk = userIds.slice(index, index + 5);
        await Promise.all(
          chunk.map((id) =>
            apiRequest(`/app-users/${id}/${action}`, {
              method: "POST",
              body: action === "ban" ? JSON.stringify({ reason: banReason.trim() || null }) : undefined,
            }),
          ),
        );
      }
    },
    onSuccess: (_result, variables) => {
      const actionLabel = variables.action === "ban" ? "封禁" : "解封";
      setNotice({ tone: "success", text: `${variables.userIds.length > 1 ? `已${actionLabel} ${variables.userIds.length} 位用户` : `${actionLabel}成功`}。` });
      setConfirmState(null);
      setSelectedIds(new Set());
      setBatchAction("");
      queryClient.invalidateQueries({ queryKey: ["app-users"] });
      queryClient.invalidateQueries({ queryKey: ["app-users-summary"] });
    },
    onError: (error) => {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "操作失败，请稍后重试。" });
    },
  });

  const currentItems = displayedUsers?.items ?? [];
  const totalPages = Math.max(displayedUsers?.total_pages ?? 1, 1);
  const pagination = useMemo(() => buildPagination(page, totalPages), [page, totalPages]);
  const usersEntranceRef = useStaggeredEntrance<HTMLTableSectionElement>({
    ready: currentItems.length > 0,
    itemCount: currentItems.length,
    animationKey: `${page}-${pageSize}-${keyword}-${status}-${createdFrom}-${createdTo}`,
  });
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
    setBatchAction("");
  }, [page, pageSize, keyword, status, createdFrom, createdTo]);

  const resetFilters = () => {
    setSearchInput("");
    setKeyword("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
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

  const openSingleAction = (user: AppUser) => {
    setConfirmState({
      action: user.is_banned ? "unban" : "ban",
      userIds: [user.id],
      label: user.nickname || user.openid,
    });
  };

  const openBatchAction = (action: UserAction) => {
    const candidates = filterBatchActionCandidates(selectedOnPage, action);
    setBatchAction("");
    if (!candidates.length) {
      setNotice({
        tone: "error",
        text: noCandidatesMessage(action),
      });
      return;
    }
    setConfirmState({
      action,
      userIds: candidates.map((user) => user.id),
      label: `${candidates.length} 位已选用户`,
    });
  };

  const exportUsers = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const first = await apiRequest<PaginatedResponse<AppUser>>(
        `/app-users${toQuery({
          page: 1,
          page_size: 100,
          keyword: keyword || undefined,
          is_banned: isBanned,
          created_from: createdFrom,
          created_to: createdTo,
        })}`,
      );
      const records = [...first.items];
      for (let currentPage = 2; currentPage <= first.total_pages; currentPage += 1) {
        const result = await apiRequest<PaginatedResponse<AppUser>>(
          `/app-users${toQuery({
            page: currentPage,
            page_size: 100,
            keyword: keyword || undefined,
            is_banned: isBanned,
            created_from: createdFrom,
            created_to: createdTo,
          })}`,
        );
        records.push(...result.items);
      }

      const header = buildUserCsvHeader();
      const rows = records.map((user) => buildUserCsvRow(user, formatChinaDateTime));
      const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `app-users-${today}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", text: `已导出 ${records.length.toLocaleString("zh-CN")} 条用户数据。` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "导出失败，请稍后重试。" });
    } finally {
      setExporting(false);
    }
  };

  const refreshAll = async () => {
    setNotice(null);
    setManualRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["app-users"] }),
        queryClient.invalidateQueries({ queryKey: ["app-users-summary"] }),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  };

  return (
    <ManagementPage className="space-y-5 pb-6">
      <ManagementPageHeader
        icon={<UsersRound className="h-5 w-5" />}
        title="小程序用户"
        description="查询、筛选并管理小程序用户的账号状态与封禁记录。"
        meta={<span>用户身份以微信 openid 为准；封禁只影响使用权限，不删除历史数据。</span>}
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
      <MetricStrip className="grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="用户总数"
          value={totalUsers.data?.total ?? 0}
          hint="全部小程序用户"
          icon={<UsersRound className="h-4 w-4" />}
          loading={totalUsers.isLoading}
        />
        <MetricCard
          label="正常用户"
          value={activeUsers.data?.total ?? 0}
          hint="当前可正常使用"
          icon={<UserCheck className="h-4 w-4" />}
          tone="success"
          loading={activeUsers.isLoading}
        />
        <MetricCard
          label="封禁用户"
          value={bannedUsers.data?.total ?? 0}
          hint="当前限制使用"
          icon={<UserX className="h-4 w-4" />}
          tone="danger"
          loading={bannedUsers.isLoading}
        />
        <MetricCard
          label="今日新增"
          value={todayUsers.data?.total ?? 0}
          hint={`北京时间 ${today}`}
          icon={<UserPlus className="h-4 w-4" />}
          loading={todayUsers.isLoading}
        />
      </MetricStrip>

      {notice ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
            notice.tone === "success"
              ? "border-success/25 bg-success-light text-success"
              : "border-destructive/25 bg-destructive-light text-destructive",
          )}
        >
          {notice.tone === "success" ? <ShieldCheck className="h-4 w-4 shrink-0" /> : <UserX className="h-4 w-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-2xl">
        <div className="border-b border-border/70 bg-secondary/20 p-4 lg:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="relative min-w-0 flex-1 xl:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                className="h-10 bg-card pl-9"
                placeholder="搜索 OpenID / 昵称"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:items-center">
              <CustomSelect
                value={status}
                onChange={(value) => {
                  setStatus(value as UserStatusFilter);
                  setPage(1);
                }}
                options={STATUS_OPTIONS}
                clearable={false}
                className="w-full sm:min-w-32 xl:w-36"
              />

              <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3">
                <input
                  type="date"
                  aria-label="开始日期"
                  className="h-[38px] min-w-0 bg-transparent text-xs text-muted-foreground outline-none"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPage(1);
                  }}
                />
                <span className="text-muted-foreground/70">—</span>
                <input
                  type="date"
                  aria-label="结束日期"
                  className="h-[38px] min-w-0 bg-transparent text-xs text-muted-foreground outline-none"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 xl:ml-auto">
              <Button size="sm" variant="secondary" onClick={resetFilters} className="h-10 px-3">
                重置
              </Button>
              <Button size="sm" variant="secondary" onClick={exportUsers} disabled={exporting} className="h-10 px-3">
                <Download className="h-4 w-4" />
                {exporting ? "导出中" : "导出"}
              </Button>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-5">
            <div className="flex items-center gap-3">
              <CustomSelect
                value={batchAction}
                onChange={(value) => {
                  setBatchAction(value);
                  if (value === "ban" || value === "unban") openBatchAction(value);
                }}
                options={[
                  { value: "ban", label: "批量封禁" },
                  { value: "unban", label: "批量解封" },
                ]}
                placeholder={selectedIds.size ? `批量操作 · 已选 ${selectedIds.size}` : "批量操作"}
                clearable={false}
                disabled={!selectedIds.size || actionMutation.isPending}
                className="w-44"
              />
              {selectedIds.size ? <span className="text-xs text-muted-foreground/70">仅操作当前页选中用户</span> : null}
            </div>
            <Button variant="ghost" size="sm" onClick={refreshAll} disabled={manualRefreshing} className="self-start sm:self-auto">
              <RefreshCw className={cn("h-4 w-4", manualRefreshing && "animate-spin")} />
              刷新
            </Button>
          </div>

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-sm">
              <thead className="bg-secondary/50 text-left">
                <tr className="border-b border-border">
                  <th className="w-12 px-4 py-3 lg:px-5">
                    <CustomCheckbox
                      checked={allPageSelected}
                      indeterminate={somePageSelected}
                      onCheckedChange={togglePageSelection}
                      aria-label="选择当前页全部用户"
                    />
                  </th>
                  {[
                    ["ID", "w-20"],
                    ["用户信息", "min-w-72"],
                    ["封禁原因", "min-w-48"],
                    ["状态", "w-28"],
                    ["操作", "w-36"],
                  ].map(([label, width]) => (
                    <th key={label} className={cn("px-4 py-3 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground", width)}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody ref={usersEntranceRef}>
                {users.isLoading && !hasDisplayedUsers ? (
                  Array.from({ length: Math.min(pageSize, 8) }, (_, index) => (
                    <tr key={index} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-3 lg:px-5"><div className="h-[18px] w-[18px] animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-10 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3"><div className="h-10 w-56 animate-pulse rounded-lg bg-border" /></td>
                      <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3"><div className="h-6 w-14 animate-pulse rounded-full bg-border" /></td>
                      <td className="px-4 py-3"><div className="h-8 w-20 animate-pulse rounded-lg bg-border" /></td>
                    </tr>
                  ))
                ) : users.isError && !hasDisplayedUsers ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center text-sm text-destructive">用户列表加载失败，请点击刷新后重试。</td>
                  </tr>
                ) : currentItems.length ? (
                  currentItems.map((user) => (
                    <tr key={user.id} className="border-b border-border transition-colors last:border-b-0 hover:bg-accent/40">
                      <td className="px-4 py-3 lg:px-5">
                        <CustomCheckbox
                          checked={selectedIds.has(user.id)}
                          onCheckedChange={(checked) => toggleUserSelection(user.id, checked)}
                          aria-label={`选择用户 ${user.nickname || user.openid}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-muted-foreground tabular-nums">{user.id}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <UserAvatar user={user} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-foreground">{user.nickname || "未设置昵称"}</div>
                            <div className="mt-0.5 max-w-[320px] truncate font-mono text-[11px] text-muted-foreground/70">{user.openid}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {user.banned_reason ? (
                          <span className="line-clamp-2 max-w-sm text-xs leading-5 text-muted-foreground" title={user.banned_reason}>{user.banned_reason}</span>
                        ) : (
                          <span className="text-muted-foreground/70">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={user.is_banned ? "danger" : "success"}>{user.is_banned ? "已封禁" : "正常"}</StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant={user.is_banned ? "secondary" : "ghost"}
                          size="sm"
                          disabled={actionMutation.isPending}
                          onClick={() => openSingleAction(user)}
                          className={cn(
                            "h-8 min-w-20 rounded-lg px-2.5 text-xs shadow-none",
                            !user.is_banned && "border border-destructive/20 text-destructive hover:border-destructive/35 hover:bg-destructive-light hover:text-destructive",
                          )}
                        >
                          {user.is_banned ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                          {user.is_banned ? "解封" : "封禁"}
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-16 text-center">
                      <UsersRound className="mx-auto h-8 w-8 text-muted-foreground/70" />
                      <p className="mt-3 text-sm font-medium text-muted-foreground">暂无符合条件的用户</p>
                      <p className="mt-1 text-xs text-muted-foreground/70">可调整搜索词、状态或日期范围后重新查询。</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between lg:px-5">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>共 <strong className="font-semibold text-foreground">{(displayedUsers?.total ?? 0).toLocaleString("zh-CN")}</strong> 条</span>
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

            <nav className="flex items-center gap-1" aria-label="用户列表分页">
              <button
                type="button"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="grid h-8 w-8 place-items-center rounded-lg border border-transparent text-sm text-muted-foreground transition hover:border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
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
                      "grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-xs font-semibold transition",
                      page === item
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-accent",
                    )}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={item} className="grid h-8 w-7 place-items-center text-xs text-muted-foreground/70">…</span>
                ),
              )}
              <button
                type="button"
                aria-label="下一页"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                className="grid h-8 w-8 place-items-center rounded-lg border border-transparent text-sm text-muted-foreground transition hover:border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
              >
                ›
              </button>
            </nav>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmState !== null}
        title={confirmState?.action === "unban" ? "确认解封用户" : "确认封禁用户"}
        description={
          confirmState
            ? `即将${confirmState.action === "unban" ? "解封" : "封禁"} ${confirmState.label}${confirmState.userIds.length > 1 ? `（共 ${confirmState.userIds.length} 位）` : ""}。`
            : undefined
        }
        confirmText={confirmState?.action === "unban" ? "确认解封" : "确认封禁"}
        danger={confirmState?.action === "ban"}
        loading={actionMutation.isPending}
        onCancel={() => {
          setConfirmState(null);
          setBatchAction("");
        }}
        onConfirm={() => {
          if (!confirmState) return;
          actionMutation.mutate(confirmState);
        }}
      >
        {confirmState?.action === "ban" ? (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-muted-foreground">封禁原因</span>
            <Textarea
              placeholder="请输入封禁原因"
              value={banReason}
              maxLength={256}
              onChange={(event) => setBanReason(event.target.value)}
            />
            <span className="mt-1.5 block text-right text-[10px] text-muted-foreground/70">{banReason.length}/256</span>
          </label>
        ) : null}
      </ConfirmDialog>
    </ManagementPage>
  );
}
