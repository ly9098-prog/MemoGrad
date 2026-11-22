"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Blend,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  ListFilter,
  Monitor,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UsersRound,
  UserX,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WechatMark } from "@/components/icons/wechat-mark";
import { apiRequest, toQuery } from "@/lib/api/client";
import type { AppUser, AppUserDetail, PaginatedResponse } from "@/lib/api/types";
import {
  chinaDateString,
  chinaDateToUtcIso,
  formatChinaDate,
  formatChinaDateTime,
} from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  buildPageRange,
  buildPagination,
  buildUserCsvHeader,
  buildUserCsvRow,
  csvEscape,
  endOfChinaDateUtcIso,
  filterBatchActionCandidates,
  identityProviderLabel,
  noCandidatesMessage,
  statusToQueryValue,
  summarizeIdentityProviders,
  userIdentitySubtitle,
  type UserAction,
  type UserStatusFilter,
} from "@/lib/app-user-utils";

type ConfirmState = {
  action: UserAction;
  userIds: number[];
  label: string;
} | null;
type Notice = { tone: "success" | "error"; text: string } | null;
type DetailState = { user: AppUser } | null;
type TypeTab = { value: string; label: string; icon: ReactNode; count?: number };

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "正常用户" },
  { value: "banned", label: "已封禁" },
];

const STATUS_LABELS: Record<UserStatusFilter, string> = {
  all: "全部状态",
  active: "正常用户",
  banned: "已封禁",
};

const CLIENT_LABELS: Record<string, string> = {
  web: "Web",
  miniprogram: "小程序",
};

const PAGE_SIZE_OPTIONS = [
  { value: "10", label: "10 条/页" },
  { value: "20", label: "20 条/页" },
  { value: "50", label: "50 条/页" },
  { value: "100", label: "100 条/页" },
];

function UserAvatar({ user, size = "md" }: { user: AppUser; size?: "md" | "lg" }) {
  const initial = (user.nickname || "用户").trim().charAt(0).toUpperCase() || "U";
  const dimension = size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm";

  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt=""
        className={cn(
          dimension,
          "shrink-0 rounded-full border border-border bg-accent object-cover",
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        dimension,
        "grid shrink-0 place-items-center rounded-full border border-primary/15 bg-accent font-bold text-primary",
      )}
    >
      {initial}
    </div>
  );
}

function TypeBadge({ user }: { user: AppUser }) {
  const type = user.user_type ?? "unknown";
  if (type === "unknown") {
    return (
      <span className="inline-flex items-center rounded-[7px] border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground/80">
        未归类
      </span>
    );
  }

  const label =
    type === "both" ? "Web + 小程序" : type === "web" ? "Web 用户" : "小程序用户";

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center gap-1 rounded-[7px] border px-1.5",
        type === "both"
          ? "border-[#8172a6]/25 bg-[#8172a6]/10"
          : type === "web"
            ? "border-primary/20 bg-accent/70"
            : "border-[#07C160]/25 bg-[#07C160]/10",
      )}
    >
      {type === "web" ? (
        <Monitor className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
      ) : null}
      {type === "miniprogram" ? (
        <WechatMark className="h-3.5 w-3.5 text-[#07C160]" />
      ) : null}
      {type === "both" ? (
        <Blend className="h-3.5 w-3.5 text-[#8172a6]" aria-hidden="true" />
      ) : null}
    </span>
  );
}

function ClientLabel({
  value,
  emptyLabel = "暂无记录",
}: {
  value?: string | null;
  emptyLabel?: string;
}) {
  if (!value) return <span className="text-muted-foreground/60">{emptyLabel}</span>;
  return <span>{CLIENT_LABELS[value] ?? value}</span>;
}

function IdentitySummary({ user }: { user: AppUser }) {
  const labels = summarizeIdentityProviders(user.identities);
  if (!labels.length) {
    return <span className="text-xs text-muted-foreground/60">未绑定登录身份</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-foreground/80">
      {labels.map((label) => (
        <span key={label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-primary/55" />
          {label}
        </span>
      ))}
    </div>
  );
}

function DetailStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "primary";
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/70 px-3.5 py-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-base font-semibold tabular-nums",
          tone === "primary" && "text-primary",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-foreground">{children}</dd>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`移除筛选：${label}`}
      title={`${label} · 点击移除`}
      className="group inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border bg-card/80 px-2 text-[11px] text-foreground/80 transition hover:border-primary/25 hover:bg-accent hover:text-foreground"
    >
      <span className="max-w-[280px] truncate">{label}</span>
      <X className="h-3 w-3 shrink-0 text-muted-foreground/70 group-hover:text-foreground" />
    </button>
  );
}

export default function AppUsersPage() {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<UserStatusFilter>("all");
  const [userType, setUserType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [banReason, setBanReason] = useState("后台人工封禁");
  const [notice, setNotice] = useState<Notice>(null);
  const [detailState, setDetailState] = useState<DetailState>(null);
  const [exporting, setExporting] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const today = chinaDateString();
  const isBanned = statusToQueryValue(status);
  const createdFrom = dateFrom ? chinaDateToUtcIso(dateFrom) : undefined;
  const createdTo = dateTo ? endOfChinaDateUtcIso(dateTo) : undefined;

  const users = useQuery({
    queryKey: ["app-users", page, pageSize, keyword, userType, status, createdFrom, createdTo],
    queryFn: () =>
      apiRequest<PaginatedResponse<AppUser>>(
        `/app-users${toQuery({
          page,
          page_size: pageSize,
          keyword: keyword || undefined,
          user_type: userType === "all" ? undefined : userType,
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
    queryFn: () =>
      apiRequest<PaginatedResponse<AppUser>>(`/app-users${toQuery({ page: 1, page_size: 1 })}`),
    staleTime: 30_000,
  });

  const activeUsers = useQuery({
    queryKey: ["app-users-summary", "active"],
    queryFn: () =>
      apiRequest<PaginatedResponse<AppUser>>(
        `/app-users${toQuery({ page: 1, page_size: 1, is_banned: false })}`,
      ),
    staleTime: 30_000,
  });

  const bannedUsers = useQuery({
    queryKey: ["app-users-summary", "banned"],
    queryFn: () =>
      apiRequest<PaginatedResponse<AppUser>>(
        `/app-users${toQuery({ page: 1, page_size: 1, is_banned: true })}`,
      ),
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

  const typeCounts = useQuery({
    queryKey: ["app-users-summary", "types"],
    queryFn: async () => {
      const fetchTypeTotal = (type: "web" | "miniprogram" | "both") =>
        apiRequest<PaginatedResponse<AppUser>>(
          `/app-users${toQuery({ page: 1, page_size: 1, user_type: type })}`,
        ).then((response) => response.total);
      const [web, miniprogram, both] = await Promise.all([
        fetchTypeTotal("web"),
        fetchTypeTotal("miniprogram"),
        fetchTypeTotal("both"),
      ]);
      return { web, miniprogram, both };
    },
    staleTime: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: ["app-user-detail", detailState?.user.id ?? null],
    queryFn: async () => {
      if (!detailState) throw new Error("未指定用户");
      return apiRequest<AppUserDetail>(`/app-users/${detailState.user.id}`);
    },
    enabled: detailState !== null,
    staleTime: 15_000,
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
              body:
                action === "ban"
                  ? JSON.stringify({ reason: banReason.trim() || null })
                  : undefined,
            }),
          ),
        );
      }
    },
    onSuccess: (_result, variables) => {
      const actionLabel = variables.action === "ban" ? "封禁" : "解封";
      setNotice({
        tone: "success",
        text:
          variables.userIds.length > 1
            ? `已${actionLabel} ${variables.userIds.length} 位用户。`
            : `${actionLabel}成功。`,
      });
      setConfirmState(null);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["app-users"] });
      queryClient.invalidateQueries({ queryKey: ["app-users-summary"] });
      queryClient.invalidateQueries({ queryKey: ["app-user-detail"] });
    },
    onError: (error) => {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "操作失败，请稍后重试。",
      });
    },
  });

  const currentItems = displayedUsers?.items ?? [];
  const totalPages = Math.max(displayedUsers?.total_pages ?? 1, 1);
  const pagination = useMemo(() => buildPagination(page, totalPages), [page, totalPages]);
  const pageRange = useMemo(
    () => buildPageRange(page, pageSize, displayedUsers?.total ?? 0),
    [page, pageSize, displayedUsers?.total],
  );
  const usersEntranceRef = useStaggeredEntrance<HTMLTableSectionElement>({
    ready: currentItems.length > 0,
    itemCount: currentItems.length,
    animationKey: `${page}-${pageSize}-${keyword}-${userType}-${status}-${createdFrom}-${createdTo}`,
  });
  const selectedOnPage = currentItems.filter((user) => selectedIds.has(user.id));
  const allPageSelected = currentItems.length > 0 && selectedOnPage.length === currentItems.length;
  const somePageSelected = selectedOnPage.length > 0 && !allPageSelected;
  const hasActiveFilters =
    Boolean(searchInput.trim() || keyword) ||
    status !== "all" ||
    userType !== "all" ||
    Boolean(dateFrom || dateTo);
  const dateFilterLabel =
    dateFrom && dateTo
      ? `${dateFrom} 至 ${dateTo}`
      : dateFrom
        ? `${dateFrom} 起`
        : dateTo
          ? `${dateTo} 前`
          : "";

  const typeTabs: TypeTab[] = [
    {
      value: "all",
      label: "全部",
      icon: <UsersRound className="h-3.5 w-3.5" />,
      count: totalUsers.data?.total,
    },
    {
      value: "web",
      label: "Web",
      icon: <Monitor className="h-3.5 w-3.5 text-primary" />,
      count: typeCounts.data?.web,
    },
    {
      value: "miniprogram",
      label: "小程序",
      icon: <WechatMark className="h-3.5 w-3.5 text-[#07C160]" />,
      count: typeCounts.data?.miniprogram,
    },
    {
      value: "both",
      label: "双端",
      icon: <Blend className="h-3.5 w-3.5 text-[#8172a6]" />,
      count: typeCounts.data?.both,
    },
  ];

  const detailUser = detailQuery.data ?? detailState?.user;

  useEffect(() => {
    const nextKeyword = searchInput.trim();
    if (nextKeyword === keyword) return;
    const timer = window.setTimeout(() => {
      setKeyword(nextKeyword);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput, keyword]);

  useEffect(() => {
    if (displayedUsers && page > totalPages) setPage(totalPages);
  }, [displayedUsers, page, totalPages]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, keyword, userType, status, createdFrom, createdTo]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const resetFilters = () => {
    setSearchInput("");
    setKeyword("");
    setStatus("all");
    setUserType("all");
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
      label: user.nickname || user.openid || `用户 ${user.id}`,
    });
  };

  const openBatchAction = (action: UserAction) => {
    const candidates = filterBatchActionCandidates(selectedOnPage, action);
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
          user_type: userType === "all" ? undefined : userType,
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
            user_type: userType === "all" ? undefined : userType,
            is_banned: isBanned,
            created_from: createdFrom,
            created_to: createdTo,
          })}`,
        );
        records.push(...result.items);
      }

      const header = buildUserCsvHeader();
      const rows = records.map((user) => buildUserCsvRow(user, formatChinaDateTime));
      const csv = `\uFEFF${[header, ...rows]
        .map((row) => row.map(csvEscape).join(","))
        .join("\n")}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `app-users-${today}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice({
        tone: "success",
        text: `已导出 ${records.length.toLocaleString("zh-CN")} 条用户数据。`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "导出失败，请稍后重试。",
      });
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
        queryClient.invalidateQueries({ queryKey: ["app-user-detail"] }),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  };

  return (
    <ManagementPage className="space-y-5 pb-6">
      <ManagementPageHeader
        icon={<UsersRound className="h-5 w-5" />}
        title={
          <span className="flex flex-wrap items-baseline gap-2.5">
            <span>普通用户</span>
            <span className="text-[13px] font-medium tracking-normal text-muted-foreground tabular-nums">
              {totalUsers.data ? totalUsers.data.total.toLocaleString("zh-CN") : "—"}
            </span>
          </span>
        }
        description="查看 Web 与小程序普通用户的身份、活跃情况，并管理账号使用权限。"
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary/55" />
              类型按已绑定登录身份统计
            </span>
            <span aria-hidden="true" className="h-3 w-px bg-border" />
            <span>封禁只影响使用权限，不删除历史数据</span>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={refreshAll}
              disabled={manualRefreshing}
            >
              <RefreshCw className={cn("h-4 w-4", manualRefreshing && "animate-spin")} />
              刷新
            </Button>
            <Button variant="primary" size="md" onClick={exportUsers} disabled={exporting}>
              <Download className="h-4 w-4" />
              {exporting ? "导出中…" : "导出 CSV"}
            </Button>
          </>
        }
      />

      {manualRefreshing ? (
        <div
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/60 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
          aria-label="正在刷新数据"
        >
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-popover/95 px-5 py-3.5 text-sm font-medium text-muted-foreground shadow-[0_18px_50px_rgba(35,49,42,0.14)]">
            <RefreshCw className="h-5 w-5 animate-spin text-primary" />
            <span>正在刷新…</span>
          </div>
        </div>
      ) : null}

      <MetricStrip className="grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="用户总数"
          value={totalUsers.data?.total ?? 0}
          hint="全部普通用户"
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
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm",
            notice.tone === "success"
              ? "border-success/25 bg-success-light text-success"
              : "border-destructive/25 bg-destructive-light text-destructive",
          )}
        >
          {notice.tone === "success" ? (
            <ShieldCheck className="h-4 w-4 shrink-0" />
          ) : (
            <UserX className="h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">{notice.text}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-current/70 transition hover:bg-current/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-[18px]">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-secondary/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-5">
          <div
            role="group"
            aria-label="按用户类型筛选"
            className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border/70 bg-secondary/35 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {typeTabs.map((tab) => {
              const active = userType === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setUserType(tab.value);
                    setPage(1);
                  }}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none",
                    active
                      ? "bg-card text-foreground shadow-[0_2px_10px_rgba(31,72,100,0.09)]"
                      : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "transition-opacity",
                      active ? "opacity-100" : "opacity-60",
                    )}
                  >
                    {tab.icon}
                  </span>
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "hidden text-[10px] font-medium tabular-nums sm:inline",
                      active ? "text-primary/80" : "text-muted-foreground/60",
                    )}
                  >
                    {tab.count === undefined ? "—" : tab.count.toLocaleString("zh-CN")}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hidden text-[11px] text-muted-foreground/80 sm:block">
            数量按全量身份统计；未绑定身份仅计入“全部”
          </p>
        </div>

        <div className="border-b border-border/70 px-4 py-3.5 lg:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="group relative min-w-0 flex-1 xl:max-w-[400px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70 transition-colors group-focus-within:text-primary" />
              <Input
                ref={searchInputRef}
                aria-label="搜索普通用户"
                aria-keyshortcuts="/"
                autoComplete="off"
                spellCheck={false}
                className="h-10 bg-card pl-9 pr-9 placeholder:text-muted-foreground/70"
                placeholder="输入昵称、OpenID 或邮箱"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              {searchInput ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={() => {
                    setSearchInput("");
                    setKeyword("");
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground/70 transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {!searchInput ? (
                <kbd
                  aria-hidden="true"
                  className="pointer-events-none absolute right-2.5 top-1/2 hidden h-5 min-w-5 -translate-y-1/2 place-items-center rounded border border-border bg-secondary/60 px-1 font-mono text-[10px] text-muted-foreground/70 transition-opacity group-focus-within:opacity-0 sm:grid"
                >
                  /
                </kbd>
              ) : null}
            </div>

            <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center xl:ml-auto">
              <CustomSelect
                aria-label="筛选用户状态"
                value={status}
                onChange={(value) => {
                  setStatus(value as UserStatusFilter);
                  setPage(1);
                }}
                options={STATUS_OPTIONS}
                clearable={false}
                className="w-full sm:w-36"
              />

              <DateRangePicker
                from={dateFrom}
                to={dateTo}
                onChange={({ from, to }) => {
                  setDateFrom(from);
                  setDateTo(to);
                  setPage(1);
                }}
                placeholder="选择注册日期范围"
              />

              <div className="flex items-center justify-between gap-2 sm:justify-start">
                <span className="inline-flex items-baseline gap-1 text-[11px] text-muted-foreground">
                  共
                  <strong className="font-semibold tabular-nums text-foreground">
                    {displayedUsers ? displayedUsers.total.toLocaleString("zh-CN") : "—"}
                  </strong>
                  位
                </span>
                <span aria-hidden="true" className="hidden h-3 w-px bg-border sm:block" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  disabled={!hasActiveFilters}
                  className="h-10 justify-center px-3 text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置
                </Button>
              </div>
            </div>
          </div>

          {hasActiveFilters ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <ListFilter className="h-3.5 w-3.5" />
                筛选条件
              </span>
              {keyword ? (
                <FilterChip
                  label={`关键词：${keyword}`}
                  onRemove={() => {
                    setSearchInput("");
                    setKeyword("");
                    setPage(1);
                  }}
                />
              ) : null}
              {status !== "all" ? (
                <FilterChip
                  label={`状态：${STATUS_LABELS[status]}`}
                  onRemove={() => {
                    setStatus("all");
                    setPage(1);
                  }}
                />
              ) : null}
              {dateFilterLabel ? (
                <FilterChip
                  label={`注册：${dateFilterLabel}`}
                  onRemove={() => {
                    setDateFrom("");
                    setDateTo("");
                    setPage(1);
                  }}
                />
              ) : null}
              <button
                type="button"
                onClick={resetFilters}
                className="ml-auto inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                清除全部
              </button>
            </div>
          ) : null}
        </div>

        {selectedIds.size ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-primary/15 bg-accent/55 px-4 py-3 lg:px-5">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
              <span className="grid h-6 min-w-6 place-items-center rounded-md bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
                {selectedIds.size}
              </span>
              位用户已选择
            </span>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              仅操作当前页选中用户
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="dangerOutline"
                size="sm"
                disabled={actionMutation.isPending}
                onClick={() => openBatchAction("ban")}
              >
                <Ban className="h-3.5 w-3.5" />
                批量封禁
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={actionMutation.isPending}
                onClick={() => openBatchAction("unban")}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                批量解封
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={actionMutation.isPending}
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="h-3.5 w-3.5" />
                取消
              </Button>
            </div>
          </div>
        ) : null}

        <CardContent className="p-0">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead className="bg-secondary/40 text-left">
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
                    ["用户", "min-w-[260px]"],
                    ["类型", "w-24"],
                    ["登录身份", "min-w-[140px]"],
                    ["最近活跃", "w-40"],
                    ["注册", "w-36"],
                    ["状态", "w-32"],
                    ["操作", "w-40 text-right"],
                  ].map(([label, width]) => (
                    <th
                      key={label}
                      className={cn(
                        "px-4 py-3 text-[11px] font-medium tracking-[0.06em] text-muted-foreground",
                        width,
                      )}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody ref={usersEntranceRef}>
                {users.isLoading && !hasDisplayedUsers ? (
                  Array.from({ length: Math.min(pageSize, 8) }, (_, index) => (
                    <tr key={index} className="border-b border-border/70 last:border-b-0">
                      <td className="px-4 py-3.5 lg:px-5">
                        <div className="h-[18px] w-[18px] animate-pulse rounded bg-border" />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 animate-pulse rounded-full bg-border" />
                          <div className="space-y-1.5">
                            <div className="h-3.5 w-28 animate-pulse rounded bg-border" />
                            <div className="h-2.5 w-40 animate-pulse rounded bg-border" />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5"><div className="h-5 w-12 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3.5"><div className="h-3 w-24 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3.5"><div className="h-8 w-28 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3.5"><div className="h-8 w-24 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3.5"><div className="h-6 w-16 animate-pulse rounded bg-border" /></td>
                      <td className="px-4 py-3.5"><div className="ml-auto h-8 w-28 animate-pulse rounded bg-border" /></td>
                    </tr>
                  ))
                ) : users.isError && !hasDisplayedUsers ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-16 text-center">
                      <p className="text-sm font-medium text-destructive">用户列表加载失败</p>
                      <p className="mt-1 text-xs text-muted-foreground">请检查网络或稍后重新加载。</p>
                      <Button variant="secondary" size="sm" className="mt-4" onClick={refreshAll}>
                        <RefreshCw className="h-3.5 w-3.5" />
                        重新加载
                      </Button>
                    </td>
                  </tr>
                ) : currentItems.length ? (
                  currentItems.map((user) => (
                    <tr
                      key={user.id}
                      data-selected={selectedIds.has(user.id)}
                      className="border-b border-border/70 transition-colors last:border-b-0 hover:bg-accent/35 data-[selected=true]:bg-accent/25"
                    >
                      <td className="px-4 py-3.5 lg:px-5">
                        <CustomCheckbox
                          checked={selectedIds.has(user.id)}
                          onCheckedChange={(checked) => toggleUserSelection(user.id, checked)}
                          aria-label={`选择用户 ${user.nickname || user.openid || user.id}`}
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <UserAvatar user={user} />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-foreground">
                                {user.nickname || "未设置昵称"}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/55">
                                #{user.id}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                              {userIdentitySubtitle(user.identities, user.openid)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <TypeBadge user={user} />
                      </td>
                      <td className="px-4 py-3.5">
                        <IdentitySummary user={user} />
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        <div className="flex items-center gap-1.5 text-foreground/80">
                          <ClientLabel
                            value={user.last_active_client}
                            emptyLabel="暂无活跃端"
                          />
                        </div>
                        <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground/70">
                          {user.last_active_at
                            ? formatChinaDateTime(user.last_active_at)
                            : "暂无活跃记录"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        <div className="flex items-center gap-1.5 text-foreground/80">
                          <ClientLabel
                            value={user.registration_source}
                            emptyLabel="未记录来源"
                          />
                        </div>
                        <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground/70">
                          {user.created_at ? formatChinaDate(user.created_at) : "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge tone={user.is_banned ? "danger" : "success"}>
                            {user.is_banned ? "已封禁" : "正常"}
                          </StatusBadge>
                          {user.is_banned && user.banned_reason ? (
                            <span
                              className="line-clamp-1 max-w-[180px] text-[11px] text-muted-foreground/70"
                              title={user.banned_reason}
                            >
                              {user.banned_reason}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDetailState({ user })}
                            className="h-8 rounded-lg px-2.5 text-xs shadow-none"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            详情
                          </Button>
                          <Button
                            variant={user.is_banned ? "secondary" : "dangerOutline"}
                            size="sm"
                            disabled={actionMutation.isPending}
                            onClick={() => openSingleAction(user)}
                            className="h-8 rounded-lg px-2.5 text-xs shadow-none"
                          >
                            {user.is_banned ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Ban className="h-3.5 w-3.5" />
                            )}
                            {user.is_banned ? "解封" : "封禁"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="px-5 py-20 text-center">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-border bg-secondary/50 text-muted-foreground/60">
                        <UsersRound className="h-5 w-5" />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-foreground">
                        {hasActiveFilters ? "没有匹配的用户" : "尚无普通用户"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {hasActiveFilters
                          ? "调整搜索词、类型、状态或日期范围后重新查询。"
                          : "用户首次登录后会自动出现在这里。"}
                      </p>
                      {hasActiveFilters ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-4"
                          onClick={resetFilters}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          清除筛选
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between lg:px-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span>
                共{" "}
                <strong className="font-semibold tabular-nums text-foreground">
                  {(displayedUsers?.total ?? 0).toLocaleString("zh-CN")}
                </strong>{" "}
                位用户
              </span>
              <span aria-hidden="true" className="hidden h-3 w-px bg-border sm:block" />
              <span className="tabular-nums text-muted-foreground/80">
                {pageRange.start}–{pageRange.end}
              </span>
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
              <span className="mr-2 hidden text-xs text-muted-foreground sm:inline">
                第 {page} / {totalPages} 页
              </span>
              <button
                type="button"
                aria-label="上一页"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="grid h-8 w-8 place-items-center rounded-lg border border-transparent text-muted-foreground transition hover:border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pagination.map((item) =>
                typeof item === "number" ? (
                  <button
                    type="button"
                    key={item}
                    aria-current={page === item ? "page" : undefined}
                    onClick={() => setPage(item)}
                    className={cn(
                      "grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-xs font-semibold tabular-nums transition",
                      page === item
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-transparent text-muted-foreground hover:border-border hover:bg-accent",
                    )}
                  >
                    {item}
                  </button>
                ) : (
                  <span
                    key={item}
                    className="grid h-8 w-7 place-items-center text-xs text-muted-foreground/60"
                  >
                    …
                  </span>
                ),
              )}
              <button
                type="button"
                aria-label="下一页"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                className="grid h-8 w-8 place-items-center rounded-lg border border-transparent text-muted-foreground transition hover:border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
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
            ? `即将${confirmState.action === "unban" ? "解封" : "封禁"} ${confirmState.label}${
                confirmState.userIds.length > 1 ? `（共 ${confirmState.userIds.length} 位）` : ""
              }。`
            : undefined
        }
        confirmText={confirmState?.action === "unban" ? "确认解封" : "确认封禁"}
        danger={confirmState?.action === "ban"}
        loading={actionMutation.isPending}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return;
          actionMutation.mutate(confirmState);
        }}
      >
        {confirmState?.action === "ban" ? (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-muted-foreground">
              封禁原因
            </span>
            <Textarea
              placeholder="例如：多次发布违规内容"
              value={banReason}
              maxLength={256}
              onChange={(event) => setBanReason(event.target.value)}
            />
            <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px] text-muted-foreground/70">
              <span>将记录到审计日志，供后续复核</span>
              <span className="shrink-0 tabular-nums">{banReason.length}/256</span>
            </div>
          </label>
        ) : null}
      </ConfirmDialog>

      <Dialog open={detailState !== null} onOpenChange={(open) => !open && setDetailState(null)}>
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          {detailUser ? (
            <>
              <div className="border-b border-border/70 bg-secondary/35 px-6 py-6 pr-14">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <UserAvatar user={detailUser} size="lg" />
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="truncate text-xl font-semibold">
                      {detailUser.nickname || "未设置昵称"}
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-xs">
                      用户 #{detailUser.id} · 加入于{" "}
                      {detailUser.created_at ? formatChinaDate(detailUser.created_at) : "未知"}
                    </DialogDescription>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <TypeBadge user={detailUser} />
                      <StatusBadge tone={detailUser.is_banned ? "danger" : "success"}>
                        {detailUser.is_banned ? "已封禁" : "正常"}
                      </StatusBadge>
                    </div>
                  </div>
                  <Button
                    variant={detailUser.is_banned ? "secondary" : "dangerOutline"}
                    size="sm"
                    className="self-start sm:ml-auto"
                    disabled={actionMutation.isPending}
                    onClick={() => {
                      setDetailState(null);
                      openSingleAction(detailUser);
                    }}
                  >
                    {detailUser.is_banned ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Ban className="h-3.5 w-3.5" />
                    )}
                    {detailUser.is_banned ? "解封此用户" : "封禁此用户"}
                  </Button>
                </div>
              </div>

              <div className="max-h-[calc(100dvh-16rem)] overflow-y-auto p-6">
                {detailQuery.isError ? (
                  <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/25 bg-destructive-light px-4 py-3 text-xs text-destructive">
                    <span>详情加载失败，当前显示列表摘要，统计数据暂不可用。</span>
                    <Button variant="secondary" size="sm" onClick={() => detailQuery.refetch()}>
                      重试
                    </Button>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <DetailStat
                    label="练习记录"
                    value={
                      detailQuery.data
                        ? detailQuery.data.practice_count.toLocaleString("zh-CN")
                        : "—"
                    }
                    tone="primary"
                  />
                  <DetailStat
                    label="错题数"
                    value={
                      detailQuery.data
                        ? detailQuery.data.wrong_count.toLocaleString("zh-CN")
                        : "—"
                    }
                  />
                  <DetailStat
                    label="最近活跃"
                    value={
                      detailUser.last_active_at
                        ? formatChinaDate(detailUser.last_active_at)
                        : "暂无活跃记录"
                    }
                  />
                  <DetailStat
                    label="注册端"
                    value={
                      <ClientLabel
                        value={detailUser.registration_source}
                        emptyLabel="未记录来源"
                      />
                    }
                  />
                </div>

                <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
                  <section>
                    <h3 className="text-xs font-semibold text-foreground">登录身份</h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      仅展示安全摘要，不显示完整登录凭据。
                    </p>
                    {detailUser.identities?.length ? (
                      <ul className="mt-3 space-y-2">
                        {detailUser.identities.map((identity, index) => (
                          <li
                            key={`${identity.provider}-${index}`}
                            className="flex items-start justify-between gap-3 rounded-xl border border-border/70 bg-card/70 px-3.5 py-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-semibold text-foreground">
                                  {identityProviderLabel(identity.provider)}
                                </span>
                                <span
                                  className={cn(
                                    "text-[10px] font-medium",
                                    identity.verified
                                      ? "text-success"
                                      : "text-muted-foreground/70",
                                  )}
                                >
                                  {identity.verified ? "已验证" : "未验证"}
                                </span>
                              </div>
                              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                {identity.masked_subject}
                              </p>
                            </div>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                              {identity.created_at
                                ? formatChinaDate(identity.created_at)
                                : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 rounded-xl border border-border/70 bg-secondary/30 px-3.5 py-3 text-xs text-muted-foreground">
                        暂无可展示的登录身份。
                      </p>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-semibold text-foreground">账号信息</h3>
                    <dl className="mt-3 divide-y divide-border/60 rounded-xl border border-border/70 bg-card/70 px-4">
                      <DetailRow label="用户编号">
                        <span className="font-mono tabular-nums">#{detailUser.id}</span>
                      </DetailRow>
                      <DetailRow label="OpenID">
                        <span
                          className="block max-w-[220px] truncate font-mono text-[11px]"
                          title={detailUser.openid || undefined}
                        >
                          {detailUser.openid || "未绑定微信 OpenID"}
                        </span>
                      </DetailRow>
                      <DetailRow label="注册来源">
                        <ClientLabel
                          value={detailUser.registration_source}
                          emptyLabel="未记录来源"
                        />
                      </DetailRow>
                      <DetailRow label="注册时间">
                        {detailUser.created_at
                          ? formatChinaDateTime(detailUser.created_at)
                          : "—"}
                      </DetailRow>
                      <DetailRow label="最近活跃端">
                        <ClientLabel
                          value={detailUser.last_active_client}
                          emptyLabel="暂无活跃端"
                        />
                      </DetailRow>
                      <DetailRow label="最近活跃时间">
                        {detailUser.last_active_at
                          ? formatChinaDateTime(detailUser.last_active_at)
                          : "暂无活跃时间"}
                      </DetailRow>
                      {detailUser.is_banned ? (
                        <DetailRow label="封禁时间">
                          {detailUser.banned_at
                            ? formatChinaDateTime(detailUser.banned_at)
                            : "—"}
                        </DetailRow>
                      ) : null}
                    </dl>

                    {detailUser.is_banned ? (
                      <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive-light/60 px-3.5 py-3">
                        <p className="text-[11px] font-semibold text-destructive">封禁原因</p>
                        <p className="mt-1 text-xs leading-5 text-destructive/90">
                          {detailUser.banned_reason || "管理员未填写封禁原因"}
                        </p>
                      </div>
                    ) : null}
                  </section>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </ManagementPage>
  );
}
