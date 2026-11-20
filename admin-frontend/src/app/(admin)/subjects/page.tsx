"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  EmptyState,
  ManagementSkeletonRows,
  StatusBadge,
} from "@/components/admin/management-ui";
import { useStaggeredEntrance } from "@/components/motion/staggered-entrance";
import {
  WorkspacePage,
  WorkspaceHeader,
  WorkspaceSurface,
  WorkspaceSectionHeader,
  WorkspaceMetrics,
  WorkspaceMetric,
  WorkspaceNotice,
  workspaceStyles as ws,
} from "@/components/admin/workspace";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { apiRequest } from "@/lib/api/client";
import type {
  AdminSubjectListResponse,
  AdminSubjectNode,
  AdminSubjectUpdateRequest,
} from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { hasPermission } from "@/lib/permissions/permissions";
import {
  flattenSubjects,
  visibleSubjects,
  buildSubjectRelations,
  summarizeSubjects,
  scopeLabel,
  scopeTone,
  updateSubjectTreeStatus,
} from "@/lib/subject-tree-utils";

type PendingToggle = {
  subject: AdminSubjectNode;
  nextActive: boolean;
} | null;

type ActionNotice = {
  tone: "success" | "warning" | "danger";
  title: string;
  message: string;
} | null;

export default function SubjectsPage() {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((state) => state.permissions);
  const canWrite = hasPermission(permissions, "subject:write");
  const [pendingToggle, setPendingToggle] = useState<PendingToggle>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice>(null);
  const [blockedSubjectId, setBlockedSubjectId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

  const query = useQuery({
    queryKey: ["subjects", "include-inactive"],
    queryFn: () =>
      apiRequest<AdminSubjectListResponse>("/subjects?include_inactive=true"),
  });

  const mutation = useMutation({
    mutationFn: async ({
      subject,
      nextActive,
    }: Exclude<PendingToggle, null>) => {
      const body: AdminSubjectUpdateRequest = { is_active: nextActive };
      if (subject.is_product_root && !nextActive)
        body.confirm_core_disable = true;
      return apiRequest<AdminSubjectNode>(`/subjects/${subject.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onMutate: async ({ subject, nextActive }) => {
      await queryClient.cancelQueries({
        queryKey: ["subjects", "include-inactive"],
      });
      const previous = queryClient.getQueryData<AdminSubjectListResponse>([
        "subjects",
        "include-inactive",
      ]);
      const inactiveAncestors = previous
        ? buildSubjectRelations(previous.items).inactiveAncestorsById.get(
            subject.id,
          ) || []
        : [];

      if (previous) {
        queryClient.setQueryData<AdminSubjectListResponse>(
          ["subjects", "include-inactive"],
          {
            ...previous,
            items: updateSubjectTreeStatus(
              previous.items,
              subject.id,
              nextActive,
            ),
          },
        );
      }
      return { previous, inactiveAncestors };
    },
    onError: (_error, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["subjects", "include-inactive"],
          context.previous,
        );
      }
      setPendingToggle(null);
      setActionNotice({
        tone: "danger",
        title: `未能${variables.nextActive ? "启用" : "停用"}「${variables.subject.name}」`,
        message:
          "界面状态已恢复，请刷新数据后重试；如果问题持续，请检查当前账号权限与接口状态。",
      });
    },
    onSuccess: (_data, variables, context) => {
      setPendingToggle(null);
      const autoEnabledAncestors = variables.nextActive
        ? context?.inactiveAncestors || []
        : [];
      setActionNotice({
        tone: "success",
        title: `已${variables.nextActive ? "启用" : "停用"}「${variables.subject.name}」`,
        message:
          autoEnabledAncestors.length > 0
            ? `同时自动启用了上级科目：${summarizeSubjects(autoEnabledAncestors)}。`
            : variables.nextActive
              ? "科目已恢复到可用范围。"
              : "该节点已停用，历史题目与学习记录不会被删除。",
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subjects"] });
    },
  });

  const flat = useMemo(
    () => flattenSubjects(query.data?.items || []),
    [query.data],
  );
  const productRoot = flat.find((item) => item.is_product_root);
  const coreSubjects = flat.filter(
    (item) => item.product_scope === "exam408" && !item.is_product_root,
  );
  const activeCoreCount = coreSubjects.filter((item) => item.is_active).length;
  const inactiveSubjectCount = flat.filter((item) => !item.is_active).length;
  const scopeReady = Boolean(productRoot?.is_active) && activeCoreCount >= 4;
  const debouncedKeyword = useDebouncedValue(keyword, 200);
  const normalizedKeyword = debouncedKeyword.trim().toLowerCase();
  const filteredFlat = useMemo(() => {
    return visibleSubjects(flat, normalizedKeyword, collapsedIds);
  }, [flat, normalizedKeyword, collapsedIds]);
  const subjectListRef = useStaggeredEntrance<HTMLTableSectionElement>({
    ready: filteredFlat.length > 0,
    itemCount: filteredFlat.length,
    animationKey: normalizedKeyword,
  });
  const { activeDescendantsById } = useMemo(
    () => buildSubjectRelations(query.data?.items || []),
    [query.data],
  );

  useEffect(() => {
    if (!actionNotice) return;

    const dismissDelay =
      actionNotice.tone === "danger"
        ? 6500
        : actionNotice.tone === "warning"
          ? 5200
          : 3600;
    const timer = window.setTimeout(() => setActionNotice(null), dismissDelay);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (blockedSubjectId === null) return;
    const timer = window.setTimeout(() => setBlockedSubjectId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [blockedSubjectId]);

  function requestToggle(subject: AdminSubjectNode) {
    if (!canWrite || mutation.isPending) return;
    const nextActive = !subject.is_active;
    const activeDescendants = activeDescendantsById.get(subject.id) || [];

    setActionNotice(null);

    if (!nextActive && activeDescendants.length > 0) {
      setBlockedSubjectId(subject.id);
      setActionNotice({
        tone: "warning",
        title: `暂时不能停用「${subject.name}」`,
        message: `请先停用其全部下级科目。当前仍有 ${activeDescendants.length} 个下级处于启用状态：${summarizeSubjects(activeDescendants)}。`,
      });
      return;
    }

    if (subject.is_product_root && !nextActive) {
      setPendingToggle({ subject, nextActive });
      return;
    }
    mutation.mutate({ subject, nextActive });
  }

  return (
    <WorkspacePage>
      <WorkspaceHeader
        title="科目治理"
        description="维护科目目录与产品范围，启停状态不影响历史题目和学习记录"
        meta={
          <>
            <StatusBadge
              tone={
                query.isLoading || query.isError
                  ? "neutral"
                  : scopeReady
                    ? "success"
                    : "warning"
              }
            >
              {query.isLoading
                ? "正在读取目录"
                : query.isError
                  ? "目录读取失败"
                  : scopeReady
                    ? "产品范围完整"
                    : "范围需要检查"}
            </StatusBadge>
            <span>{canWrite ? "可调整启停状态" : "当前账号仅可查看"}</span>
          </>
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={query.isFetching ? "animate-spin" : ""}
            />
            刷新
          </Button>
        }
      />
      <WorkspaceSurface>
        <WorkspaceMetrics columns={3}>
          <WorkspaceMetric
            label="核心科目启用"
            value={query.isError ? "—" : `${activeCoreCount} / 4`}
            hint="数据结构、组成原理、操作系统、计算机网络"
            loading={query.isLoading}
            tone={!scopeReady && !query.isError ? "attention" : "default"}
          />
          <WorkspaceMetric
            label="产品根科目"
            value={
              query.isError ? "—" : productRoot?.is_active ? "启用" : "关闭"
            }
            hint={
              query.isError
                ? "目录数据不可用"
                : (productRoot?.name ?? "未找到产品根科目")
            }
            loading={query.isLoading}
          />
          <WorkspaceMetric
            label="当前停用科目"
            value={query.isError ? "—" : inactiveSubjectCount}
            hint="历史数据保留，可重新启用"
            loading={query.isLoading}
          />
        </WorkspaceMetrics>
        {!scopeReady && !query.isLoading && !query.isError ? (
          <WorkspaceNotice tone="warning" title="产品科目范围不完整">
            请确认根科目和四个核心科目已全部启用。
          </WorkspaceNotice>
        ) : null}
        <WorkspaceSectionHeader
          title="科目目录"
          description={
            normalizedKeyword
              ? `显示 ${filteredFlat.length} / ${flat.length} 个节点`
              : `${flat.length} 个节点 · 按产品层级排列`
          }
          actions={
            <div className={ws.search}>
              <Search aria-hidden="true" />
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索科目、编码或路径"
                aria-label="搜索科目"
                className="pr-10"
              />
              {keyword ? (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md"
                  aria-label="清空搜索"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          }
        />
        <div className={ws.subjectLayout}>
          <div className="min-w-0">
            {query.isLoading ? (
              <ManagementSkeletonRows rows={6} />
            ) : query.isError ? (
              <WorkspaceNotice tone="danger" title="科目目录加载失败">
                请使用右上角刷新重试。
              </WorkspaceNotice>
            ) : !filteredFlat.length ? (
              <EmptyState>
                没有匹配的科目。尝试缩短关键词或清空搜索。
              </EmptyState>
            ) : (
              <table className={ws.subjectTable}>
                <caption className="sr-only">
                  科目目录、所属范围与启停状态
                </caption>
                <thead>
                  <tr>
                    <th scope="col">科目与层级</th>
                    <th scope="col" className={ws.subjectScope}>
                      范围
                    </th>
                    <th scope="col" className="text-right">
                      状态
                    </th>
                  </tr>
                </thead>
                <tbody ref={subjectListRef}>
                  {filteredFlat.map((subject) => {
                    const isUpdating =
                      mutation.isPending &&
                      mutation.variables?.subject.id === subject.id;
                    const activeDescendants =
                      activeDescendantsById.get(subject.id) || [];
                    const hasActiveDescendants =
                      subject.is_active && activeDescendants.length > 0;
                    const toggleHint = !canWrite
                      ? "当前账号没有科目写入权限"
                      : mutation.isPending && !isUpdating
                        ? "正在保存另一项科目变更"
                        : hasActiveDescendants
                          ? `需先停用全部下级科目（${activeDescendants.length} 个下级在线）`
                          : subject.is_active
                            ? "停用该科目"
                            : "启用该科目";
                    return (
                      <tr
                        key={subject.id}
                        className={ws.subjectRow}
                        data-root={subject.is_product_root}
                        data-blocked={blockedSubjectId === subject.id}
                        data-depth={subject.depth}
                      >
                        <td>
                          <div
                            className={ws.subjectName}
                            style={
                              {
                                "--subject-depth": subject.depth,
                              } as CSSProperties
                            }
                          >
                            <div>
                              {subject.children?.length ? (
                                <button
                                  type="button"
                                  className={ws.subjectBranch}
                                  aria-label={`${normalizedKeyword || !collapsedIds.has(subject.id) ? "收起" : "展开"}${subject.name}`}
                                  aria-expanded={
                                    Boolean(normalizedKeyword) ||
                                    !collapsedIds.has(subject.id)
                                  }
                                  disabled={Boolean(normalizedKeyword)}
                                  onClick={() =>
                                    setCollapsedIds((current) => {
                                      const next = new Set(current);
                                      if (next.has(subject.id))
                                        next.delete(subject.id);
                                      else next.add(subject.id);
                                      return next;
                                    })
                                  }
                                >
                                  <ChevronDown
                                    size={14}
                                    aria-hidden="true"
                                    className={
                                      !normalizedKeyword &&
                                      collapsedIds.has(subject.id)
                                        ? "-rotate-90"
                                        : ""
                                    }
                                  />
                                  {!normalizedKeyword &&
                                  collapsedIds.has(subject.id) ? (
                                    <Folder size={16} aria-hidden="true" />
                                  ) : (
                                    <FolderOpen size={16} aria-hidden="true" />
                                  )}
                                </button>
                              ) : (
                                <span
                                  className={ws.subjectLeaf}
                                  aria-hidden="true"
                                />
                              )}
                              <strong>{subject.name}</strong>
                              {subject.children?.length ? (
                                <span className={ws.caption}>
                                  {subject.children.length} 个下级
                                </span>
                              ) : null}
                              {isUpdating ? (
                                <LoaderCircle
                                  size={14}
                                  className="animate-spin"
                                  aria-label="正在更新"
                                />
                              ) : !subject.is_active ? (
                                <StatusBadge tone="neutral">已停用</StatusBadge>
                              ) : null}
                            </div>
                            <small>
                              {subject.code} · L{subject.level} · 排序{" "}
                              {subject.sort_order}
                            </small>
                            <small title={subject.path}>{subject.path}</small>
                          </div>
                        </td>
                        <td className={ws.subjectScope}>
                          <StatusBadge tone={scopeTone(subject)}>
                            {scopeLabel(subject)}
                          </StatusBadge>
                        </td>
                        <td>
                          <div className={ws.subjectState}>
                            <label
                              title={toggleHint}
                              className={ws.switchTarget}
                            >
                              <span className="sr-only">
                                {subject.name}启用状态
                              </span>
                              <Toggle
                                checked={subject.is_active}
                                disabled={!canWrite || mutation.isPending}
                                onChange={() => requestToggle(subject)}
                                color="var(--ws-blue)"
                              />
                            </label>
                          </div>
                          <span className="sr-only">{toggleHint}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <aside className={ws.subjectAside} aria-label="科目范围与治理规则">
            <section>
              <h3>408 核心范围</h3>
              {query.isLoading ? (
                <p>正在读取科目状态…</p>
              ) : query.isError ? (
                <p>目录数据不可用</p>
              ) : (
                coreSubjects.slice(0, 4).map((subject) => (
                  <div
                    key={subject.id}
                    className="flex items-center justify-between gap-3 py-3 text-xs"
                  >
                    <span>{subject.name}</span>
                    <span className={ws.caption}>
                      {subject.is_active ? "已启用" : "已停用"}
                    </span>
                  </div>
                ))
              )}
            </section>
            <section>
              <h3>启停规则</h3>
              <p>
                <strong>从下级开始停用</strong>仍有下级启用时，父科目不能关闭。
              </p>
              <p className="mt-4">
                <strong>启用子级会补齐上级</strong>
                系统自动启用父级及祖先，保持目录可达。
              </p>
              <p className="mt-4">
                <strong>产品根科目需确认</strong>
                关闭后会隐藏相关刷题入口，历史数据保留。
              </p>
              <p className="mt-6">
                {canWrite
                  ? "状态修改立即保存，失败时恢复原状态。"
                  : "需要 subject:write 权限才能调整启停状态。"}
              </p>
            </section>
          </aside>
        </div>
      </WorkspaceSurface>
      {actionNotice ? (
        <div
          className={ws.toast}
          role={
            actionNotice.tone === "danger" || actionNotice.tone === "warning"
              ? "alert"
              : "status"
          }
        >
          <WorkspaceNotice tone={actionNotice.tone} title={actionNotice.title}>
            {actionNotice.message}
          </WorkspaceNotice>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            aria-label="关闭操作提示"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingToggle)}
        title="确认停用产品根科目？"
        description="停用后，相关刷题与主入口将整体隐藏。历史数据不会删除，可随时重新启用。"
        confirmText="确认停用"
        danger
        loading={mutation.isPending}
        onCancel={() => setPendingToggle(null)}
        onConfirm={() => pendingToggle && mutation.mutate(pendingToggle)}
      />
    </WorkspacePage>
  );
}
