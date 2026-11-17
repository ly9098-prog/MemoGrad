"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";

import {
  EmptyState,
  ManagementProgress,
  ManagementSkeletonRows,
  StatusBadge,
} from "@/components/admin/management-ui";
import {
  WorkspacePage,
  WorkspaceHeader,
  WorkspaceSurface,
  WorkspaceSectionHeader,
  WorkspaceMetrics,
  WorkspaceMetric,
  WorkspaceNotice,
  WorkspaceSelect,
  workspaceStyles as ws,
} from "@/components/admin/workspace";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KnowledgeLabelEditor } from "@/components/admin/knowledge-label-editor";
import { ScrollToTop } from "@/components/admin/scroll-to-top";
import { KnowledgeCatalogTree } from "@/components/admin/knowledge-catalog-tree";
import { withOutlineAncestors } from "@/lib/knowledge-outline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { apiRequest } from "@/lib/api/client";
import type {
  SyllabusCatalogItem,
  SyllabusCatalogResponse,
  SyllabusCoverageResponse,
  SyllabusMappingItem,
  SyllabusVersionDetail,
  SyllabusVersionSummary,
} from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { hasPermission } from "@/lib/permissions/permissions";
import {
  filterCatalogItems,
  groupCatalogBySubject,
  extractIncludedIds,
  isMembershipDirty,
  STATUS_LABEL,
  RELATION_LABEL,
  statusTone,
} from "@/lib/syllabus-utils";

export default function SyllabusPage() {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((state) => state.permissions);
  const canWrite = hasPermission(permissions, "knowledge:write");
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(
    null,
  );
  const [selectedKnowledgePointIds, setSelectedKnowledgePointIds] = useState<
    Set<number>
  >(new Set());
  const [createForm, setCreateForm] = useState({
    code: "",
    name: "",
    effective_year: new Date().getFullYear() + 1,
    description: "",
  });
  const [mappingSourceVersionId, setMappingSourceVersionId] = useState<
    number | null
  >(null);
  const [mappingForm, setMappingForm] = useState({
    from_syllabus_knowledge_point_id: 0,
    to_syllabus_knowledge_point_id: 0,
    relation_type: "replaced" as "merged" | "split" | "replaced",
    note: "",
  });
  const [catalogKeyword, setCatalogKeyword] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [collapsedSubjects, setCollapsedSubjects] = useState<Set<string>>(
    new Set(),
  );
  const [pendingAction, setPendingAction] = useState<{
    kind: "activate" | "archive" | "delete-mapping";
    mappingId?: number;
  } | null>(null);
  const [chapterExpansion, setChapterExpansion] = useState({
    open: false,
    revision: 0,
  });

  const [labelEditor, setLabelEditor] = useState<{item: SyllabusCatalogItem | null; parent?: SyllabusCatalogItem} | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(null);
  const initializedVersion = useRef<number | null>(null);

  const versionsQuery = useQuery({
    queryKey: ["syllabus", "versions"],
    queryFn: () =>
      apiRequest<SyllabusVersionSummary[]>("/knowledge/syllabus/versions"),
  });

  useEffect(() => {
    if (selectedVersionId || !versionsQuery.data?.length) return;
    const preferred =
      versionsQuery.data.find((item) => item.status === "draft") ??
      versionsQuery.data.find((item) => item.status === "active") ??
      versionsQuery.data[0];
    setSelectedVersionId(preferred.id);
  }, [selectedVersionId, versionsQuery.data]);

  const detailQuery = useQuery({
    queryKey: ["syllabus", "detail", selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: () =>
      apiRequest<SyllabusVersionDetail>(
        `/knowledge/syllabus/versions/${selectedVersionId}`,
      ),
  });

  const catalogQuery = useQuery({
    queryKey: ["syllabus", "catalog", selectedVersionId],
    enabled: Boolean(selectedVersionId),
    refetchOnWindowFocus: false,
    queryFn: () =>
      apiRequest<SyllabusCatalogResponse>(
        `/knowledge/syllabus/versions/${selectedVersionId}/catalog?include_inactive=true`,
      ),
  });

  const coverageQuery = useQuery({
    queryKey: ["syllabus", "coverage", selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: () =>
      apiRequest<SyllabusCoverageResponse>(
        `/knowledge/syllabus/versions/${selectedVersionId}/coverage`,
      ),
  });

  const mappingsQuery = useQuery({
    queryKey: ["syllabus", "mappings", selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: () =>
      apiRequest<SyllabusMappingItem[]>(
        `/knowledge/syllabus/versions/${selectedVersionId}/mappings`,
      ),
  });

  const sourceDetailQuery = useQuery({
    queryKey: ["syllabus", "mapping-source", mappingSourceVersionId],
    enabled: Boolean(mappingSourceVersionId),
    queryFn: () =>
      apiRequest<SyllabusVersionDetail>(
        `/knowledge/syllabus/versions/${mappingSourceVersionId}`,
      ),
  });

  useEffect(() => {
    const data = catalogQuery.data;
    if (!data || data.syllabus_version_id !== selectedVersionId) return;
    const enabled = new Set(data.items.filter(item=>item.is_active !== false).map(item=>item.knowledge_point_id));
    if (initializedVersion.current !== selectedVersionId) {
      initializedVersion.current = selectedVersionId;
      setSelectedKnowledgePointIds(new Set(data.items.filter(item=>item.included && (detailQuery.data?.status !== "draft" || item.is_active !== false)).map(item=>item.knowledge_point_id)));
    } else if (detailQuery.data?.status === "draft") {
      // A label refresh must not erase the current unsaved member selection.
      setSelectedKnowledgePointIds(current=>new Set([...current].filter(id=>enabled.has(id))));
    }
  }, [catalogQuery.data, selectedVersionId, detailQuery.data?.status]);

  useEffect(() => {
    if (!catalogKeyword.trim()) return;
    setCollapsedSubjects(new Set());
  }, [catalogKeyword]);

  useEffect(() => {
    if (!detailQuery.data || detailQuery.data.status !== "draft") return;
    const source =
      (versionsQuery.data ?? []).find(
        (item) => item.status === "active" && item.id !== detailQuery.data?.id,
      ) ??
      (versionsQuery.data ?? []).find(
        (item) =>
          item.status === "archived" && item.id !== detailQuery.data?.id,
      ) ??
      null;
    setMappingSourceVersionId(source?.id ?? null);
  }, [detailQuery.data, versionsQuery.data]);

  useEffect(() => {
    const fromId = sourceDetailQuery.data?.knowledge_points?.[0]?.id ?? 0;
    const toId = detailQuery.data?.knowledge_points?.[0]?.id ?? 0;
    setMappingForm((value) => ({
      ...value,
      from_syllabus_knowledge_point_id: fromId,
      to_syllabus_knowledge_point_id: toId,
    }));
  }, [sourceDetailQuery.data, detailQuery.data]);

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["syllabus", "versions"] }),
      queryClient.invalidateQueries({ queryKey: ["syllabus", "detail"] }),
      queryClient.invalidateQueries({ queryKey: ["syllabus", "catalog"] }),
      queryClient.invalidateQueries({ queryKey: ["syllabus", "coverage"] }),
      queryClient.invalidateQueries({ queryKey: ["syllabus", "mappings"] }),
      queryClient.invalidateQueries({
        queryKey: ["syllabus", "mapping-source"],
      }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<SyllabusVersionDetail>("/knowledge/syllabus/versions", {
        method: "POST",
        body: JSON.stringify({
          ...createForm,
          code: createForm.code.trim(),
          name: createForm.name.trim(),
          description: createForm.description.trim() || null,
        }),
      }),
    onSuccess: async (data) => {
      setSelectedVersionId(data.id);
      setCreateForm((value) => ({
        ...value,
        code: "",
        name: "",
        description: "",
      }));
      setShowCreateForm(false);
      await refreshAll();
    },
  });

  const membershipMutation = useMutation({
    mutationFn: () =>
      apiRequest<SyllabusVersionDetail>(
        `/knowledge/syllabus/versions/${selectedVersionId}/knowledge-points`,
        {
          method: "PUT",
          body: JSON.stringify({
            knowledge_point_ids: [...selectedKnowledgePointIds].sort(
              (a, b) => a - b,
            ),
          }),
        },
      ),
    onSuccess: async (data) => {
      setSelectedKnowledgePointIds(new Set(data.knowledge_points.map(item=>item.knowledge_point_id)));
      await refreshAll();
    },
  });

  const activateMutation = useMutation({
    mutationFn: () =>
      apiRequest<SyllabusVersionDetail>(
        `/knowledge/syllabus/versions/${selectedVersionId}/activate`,
        { method: "POST" },
      ),
    onSuccess: async () => {
      setPendingAction(null);
      await refreshAll();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      apiRequest<SyllabusVersionDetail>(
        `/knowledge/syllabus/versions/${selectedVersionId}/archive`,
        { method: "POST" },
      ),
    onSuccess: async () => {
      setPendingAction(null);
      await refreshAll();
    },
  });

  const mappingMutation = useMutation({
    mutationFn: () =>
      apiRequest<SyllabusMappingItem>("/knowledge/syllabus/mappings", {
        method: "POST",
        body: JSON.stringify({
          ...mappingForm,
          note: mappingForm.note.trim() || null,
        }),
      }),
    onSuccess: async () => {
      setMappingForm((value) => ({ ...value, note: "" }));
      await refreshAll();
    },
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (mappingId: number) =>
      apiRequest<{ success: boolean; id: number }>(
        `/knowledge/syllabus/mappings/${mappingId}`,
        { method: "DELETE" },
      ),
    onSuccess: async () => {
      setPendingAction(null);
      await refreshAll();
    },
  });

  const detail = detailQuery.data;
  const catalog = catalogQuery.data?.items ?? [];
  const settledCatalogKeyword = useDebouncedValue(catalogKeyword, 200);
  const normalizedCatalogKeyword = settledCatalogKeyword.trim().toLowerCase();
  const visibleCatalog = useMemo(() => {
    return withOutlineAncestors(catalog, filterCatalogItems(catalog, normalizedCatalogKeyword));
  }, [catalog, normalizedCatalogKeyword]);
  const groupedCatalog = useMemo(() => {
    return groupCatalogBySubject(visibleCatalog);
  }, [visibleCatalog]);
  const subjectShortcuts = useMemo(() => groupCatalogBySubject(catalog), [catalog]);
  useEffect(() => {
    if (!jumpTarget || normalizedCatalogKeyword) return;
    const element = document.getElementById(`syllabus-group-${encodeURIComponent(jumpTarget)}`);
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      setJumpTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpTarget, normalizedCatalogKeyword]);
  const activeVersion = versionsQuery.data?.find(
    (item) => item.status === "active",
  );
  const coveragePct = Math.round(
    (coverageQuery.data?.coverage_ratio ?? 0) * 100,
  );
  const saving =
    membershipMutation.isPending ||
    activateMutation.isPending ||
    archiveMutation.isPending ||
    mappingMutation.isPending ||
    deleteMappingMutation.isPending;
  const includedIds = useMemo(() => extractIncludedIds(catalog), [catalog]);
  const membershipDirty = isMembershipDirty(
    selectedKnowledgePointIds,
    includedIds,
  );

  function toggleSubjectGroup(subjectKey: string) {
    setCollapsedSubjects((current) => {
      const next = new Set(current);
      if (next.has(subjectKey)) next.delete(subjectKey);
      else next.add(subjectKey);
      return next;
    });
  }

  function expandAllSubjects() {
    setCollapsedSubjects(new Set());
    setChapterExpansion((current) => ({
      open: true,
      revision: current.revision + 1,
    }));
  }

  function collapseAllSubjects() {
    setChapterExpansion((current) => ({
      open: false,
      revision: current.revision + 1,
    }));
    setCollapsedSubjects(
      new Set(groupedCatalog.map(([subjectKey]) => subjectKey)),
    );
  }

  const error =
    createMutation.isError ||
    membershipMutation.isError ||
    activateMutation.isError ||
    archiveMutation.isError ||
    mappingMutation.isError ||
    deleteMappingMutation.isError;
  const confirmationMutation =
    pendingAction?.kind === "activate"
      ? activateMutation
      : pendingAction?.kind === "archive"
        ? archiveMutation
        : pendingAction?.kind === "delete-mapping"
          ? deleteMappingMutation
          : null;

  return (
    <WorkspacePage className={ws.syllabusPage}>
      <WorkspaceHeader
        title="考纲版本"
        description="维护各年度知识点范围，让成员调整与跨版本变化清楚可追溯"
        meta={
          <>
            <StatusBadge
              tone={
                versionsQuery.isError || versionsQuery.isLoading
                  ? "neutral"
                  : activeVersion
                    ? "success"
                    : "warning"
              }
            >
              {versionsQuery.isError
                ? "版本读取失败"
                : versionsQuery.isLoading
                  ? "正在读取版本"
                  : activeVersion
                    ? `当前生效 ${activeVersion.effective_year}`
                    : "尚未设置当前版本"}
            </StatusBadge>
            <span>成员范围在草稿中编辑，规范标签可单独管理</span>
          </>
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => refreshAll()}
            disabled={versionsQuery.isFetching}
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={versionsQuery.isFetching ? "animate-spin" : ""}
            />
            刷新
          </Button>
        }
      />
      <WorkspaceSurface className={ws.syllabusOverview}>
        <WorkspaceMetrics>
          <WorkspaceMetric
            label="当前生效版本"
            value={
              versionsQuery.isError
                ? "—"
                : (activeVersion?.effective_year ?? "未设置")
            }
            hint={activeVersion?.name ?? "激活草稿后生效"}
            loading={versionsQuery.isLoading}
          />
          <WorkspaceMetric
            label="所选知识点"
            value={
              detailQuery.isError || !detail
                ? "—"
                : detail.knowledge_point_count
            }
            hint={detail?.name ?? "选择版本查看范围"}
            loading={detailQuery.isLoading && Boolean(selectedVersionId)}
          />
          <WorkspaceMetric
            label="基础题库覆盖"
            value={
              coverageQuery.isError || !coverageQuery.data
                ? "—"
                : `${coveragePct}%`
            }
            hint={
              coverageQuery.data
                ? `${coverageQuery.data.covered_knowledge_points} / ${coverageQuery.data.total_knowledge_points} 个知识点有题`
                : "按所选版本统计"
            }
            loading={coverageQuery.isLoading && Boolean(selectedVersionId)}
            tone={coveragePct > 0 && coveragePct < 90 ? "attention" : "default"}
          />
          <WorkspaceMetric
            label="跨版本映射"
            value={
              mappingsQuery.isError || !mappingsQuery.data
                ? "—"
                : mappingsQuery.data.length
            }
            hint="自动关系与手工补充"
            loading={mappingsQuery.isLoading && Boolean(selectedVersionId)}
          />
        </WorkspaceMetrics>
      </WorkspaceSurface>
      <WorkspaceSurface className={ws.versionLayout}>
        <aside className={ws.versionIndex} aria-label="考纲版本索引">
          <div className={ws.versionIndexHeader}>
            <h2>版本索引</h2>
            {canWrite ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCreateForm((value) => !value)}
                aria-expanded={showCreateForm}
                aria-controls="syllabus-create-form"
              >
                <Plus size={14} aria-hidden="true" />
                {showCreateForm ? "收起" : "新建"}
              </Button>
            ) : null}
          </div>
          {versionsQuery.data?.length ? (
            <div className={ws.versionMobileSelect}>
              <WorkspaceSelect
                aria-label="选择考纲版本"
                value={selectedVersionId ? String(selectedVersionId) : ""}
                onChange={(value) => setSelectedVersionId(Number(value))}
                clearable={false}
                options={versionsQuery.data.map((item) => ({
                  value: String(item.id),
                  label: `${item.name} · ${STATUS_LABEL[item.status]}`,
                }))}
              />
            </div>
          ) : null}
          <div className={ws.versionList}>
            {(versionsQuery.data ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedVersionId(item.id)}
                className={ws.versionButton}
                aria-pressed={selectedVersionId === item.id}
              >
                <span className={ws.versionYear}>{item.effective_year}</span>
                <span className={ws.versionCopy}>
                  <strong>{item.name}</strong>
                  <span>
                    <StatusBadge tone={statusTone(item.status)}>
                      {STATUS_LABEL[item.status]}
                    </StatusBadge>
                  </span>
                  <small>
                    {item.code}
                    <br />
                    {item.knowledge_point_count} 个知识点
                  </small>
                </span>
              </button>
            ))}
          </div>
          {versionsQuery.isLoading ? (
            <ManagementSkeletonRows rows={3} />
          ) : versionsQuery.isError ? (
            <WorkspaceNotice tone="danger">
              版本索引读取失败，请刷新重试。
            </WorkspaceNotice>
          ) : !versionsQuery.data?.length ? (
            <EmptyState>暂无版本。新建草稿后即可维护考纲。</EmptyState>
          ) : null}
          {canWrite ? (
            <div
              id="syllabus-create-form"
              hidden={!showCreateForm}
              className="px-4 pb-5"
            >
              <p className={`${ws.caption} mb-4`}>
                创建年度草稿，再调整知识点范围与映射
              </p>
              <div className="grid gap-4">
                <label className={ws.field}>
                  <span>版本编码</span>
                  <Input
                    id="syllabus-create-code"
                    placeholder="例如 syllabus-2027"
                    value={createForm.code}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, code: event.target.value })
                    }
                  />
                </label>
                <label className={ws.field}>
                  <span>版本名称</span>
                  <Input
                    placeholder="例如 2027 考纲"
                    value={createForm.name}
                    onChange={(event) =>
                      setCreateForm({ ...createForm, name: event.target.value })
                    }
                  />
                </label>
                <label className={ws.field}>
                  <span>生效年份</span>
                  <Input
                    type="number"
                    min={2000}
                    max={2200}
                    value={createForm.effective_year}
                    onChange={(event) =>
                      setCreateForm({
                        ...createForm,
                        effective_year:
                          Number(event.target.value) ||
                          new Date().getFullYear(),
                      })
                    }
                  />
                </label>
                <label className={ws.field}>
                  <span>说明（可选）</span>
                  <Input
                    placeholder="本次版本变化"
                    value={createForm.description}
                    onChange={(event) =>
                      setCreateForm({
                        ...createForm,
                        description: event.target.value,
                      })
                    }
                  />
                </label>
                <Button
                  disabled={
                    !createForm.code.trim() ||
                    !createForm.name.trim() ||
                    createMutation.isPending
                  }
                  onClick={() => createMutation.mutate()}
                >
                  <Plus size={14} aria-hidden="true" />
                  {createMutation.isPending ? "创建中…" : "创建草稿"}
                </Button>
              </div>
            </div>
          ) : null}
        </aside>
        <div className={ws.versionEditor}>
          {detailQuery.isLoading && selectedVersionId ? (
            <ManagementSkeletonRows rows={6} />
          ) : detailQuery.isError ? (
            <WorkspaceNotice tone="danger" title="版本详情读取失败">
              请刷新重试，或选择其他版本。
            </WorkspaceNotice>
          ) : !detail ? (
            <EmptyState>在版本索引中选择考纲，查看成员范围与映射。</EmptyState>
          ) : (
            <>
              <div className={ws.versionEditorHeader}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2>{detail.name}</h2>
                    <StatusBadge tone={statusTone(detail.status)}>
                      {STATUS_LABEL[detail.status]}
                    </StatusBadge>
                  </div>
                  <p className={`${ws.caption} mt-2`}>
                    {detail.code} · 生效年份 {detail.effective_year}
                  </p>
                </div>
                {canWrite && detail.status === "draft" ? (
                  <div className={ws.actions}>
                    <Button
                      variant="secondary"
                      disabled={
                        saving ||
                        selectedKnowledgePointIds.size === 0 ||
                        membershipDirty
                      }
                      onClick={() => setPendingAction({ kind: "activate" })}
                      title={
                        membershipDirty ? "请先保存范围，再激活版本" : undefined
                      }
                    >
                      <ShieldCheck size={14} aria-hidden="true" />
                      设为当前版本
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() => setPendingAction({ kind: "archive" })}
                    >
                      归档
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className={ws.selectionBar}>
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    已选{" "}
                    <strong className="font-medium text-foreground">
                      {selectedKnowledgePointIds.size}
                    </strong>{" "}
                    项
                  </span>
                  <StatusBadge
                    tone={
                      detail.status !== "draft"
                        ? "neutral"
                        : membershipDirty
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {detail.status !== "draft"
                      ? "只读版本"
                      : membershipDirty
                        ? "有未保存变更"
                        : "范围已保存"}
                  </StatusBadge>
                </div>
                {detail.status === "draft" && canWrite ? (
                  <div className={ws.actions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        saving || catalogQuery.isLoading || catalogQuery.isError
                      }
                      onClick={() =>
                        setSelectedKnowledgePointIds(
                          new Set(
                            catalog.filter(item => item.is_active !== false).map((item) => item.knowledge_point_id),
                          ),
                        )
                      }
                    >
                      全选
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        saving ||
                        catalogQuery.isLoading ||
                        catalogQuery.isError ||
                        selectedKnowledgePointIds.size === 0 ||
                        !membershipDirty
                      }
                      onClick={() => membershipMutation.mutate()}
                    >
                      <Save size={14} aria-hidden="true" />
                      {membershipMutation.isPending ? "保存中…" : "保存范围"}
                    </Button>
                  </div>
                ) : null}
              </div>
              {detail.status !== "draft" || !canWrite ? (
                <div className={ws.readonlyBar}>
                  <p>
                    {!canWrite
                      ? "当前账号没有知识点写入权限，可查看成员范围"
                      : `${detail.status === "active" ? "当前生效" : "已归档"}版本的范围已固定。切换草稿后可勾选知识点，历史版本保持可追溯。`}
                  </p>
                  {canWrite ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const draft = versionsQuery.data?.find(
                          (item) => item.status === "draft",
                        );
                        if (draft) setSelectedVersionId(draft.id);
                        else {
                          setShowCreateForm(true);
                          window.requestAnimationFrame(() =>
                            document
                              .getElementById("syllabus-create-code")
                              ?.focus(),
                          );
                        }
                      }}
                    >
                      {versionsQuery.data?.some(
                        (item) => item.status === "draft",
                      )
                        ? "切换到可编辑草稿"
                        : "新建可编辑草稿"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className={ws.toolbar}>
                <label className={ws.search}>
                  <Search aria-hidden="true" />
                  <Input
                    value={catalogKeyword}
                    onChange={(event) => setCatalogKeyword(event.target.value)}
                    placeholder="搜索知识点或科目"
                    aria-label="搜索知识点"
                    className="pr-10"
                  />
                  {catalogKeyword ? (
                    <button
                      type="button"
                      onClick={() => setCatalogKeyword("")}
                      aria-label="清空知识点搜索"
                      className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                <div className={ws.actions}>
                  {canWrite ? <Button variant="secondary" size="sm" onClick={()=>setLabelEditor({item:null})}><Plus size={14} aria-hidden="true" />新增标签</Button> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={expandAllSubjects}
                    disabled={!groupedCatalog.length}
                  >
                    全部展开
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={collapseAllSubjects}
                    disabled={
                      !groupedCatalog.length ||
                      groupedCatalog.every(([key]) =>
                        collapsedSubjects.has(key),
                      )
                    }
                  >
                    全部收起
                  </Button>
                </div>
                <p className={ws.caption}>
                  {groupedCatalog.length} 科目 · {visibleCatalog.length} /{" "}
                  {catalog.length}
                </p>
              </div>
              <nav className={ws.subjectShortcuts} aria-label="快速跳转科目">
                <span className={ws.caption}>跳转科目</span>
                {subjectShortcuts.map(([key, items])=><Button key={key} size="sm" variant="ghost" onClick={()=>{
                  setCatalogKeyword("");
                  setCollapsedSubjects(current=>{const next=new Set(current);next.delete(key);return next;});
                  setJumpTarget(key);
                }}>{items[0].subject_name}</Button>)}
              </nav>
              {catalogQuery.isError ? (
                <WorkspaceNotice tone="danger">
                  知识点目录读取失败，请刷新重试。
                </WorkspaceNotice>
              ) : catalogQuery.isLoading ? (
                <ManagementSkeletonRows rows={6} />
              ) : (
                groupedCatalog.map(([subjectKey, items]) => {
                  const subjectName = items[0]?.subject_name ?? "未分类科目";
                  const subjectCode = items[0]?.subject_code ?? "unknown";
                  const isCore = [
                    "data_structure",
                    "computer_organization",
                    "operating_system",
                    "computer_network",
                  ].includes(subjectCode);
                  const selectedCount = items.filter((item) =>
                    selectedKnowledgePointIds.has(item.knowledge_point_id),
                  ).length;
                  const collapsed = collapsedSubjects.has(subjectKey);
                  const groupId = `syllabus-subject-${encodeURIComponent(subjectKey)}`;
                  return (
                    <section key={subjectKey} id={`syllabus-group-${encodeURIComponent(subjectKey)}`} className={ws.catalogGroup}>
                      <button
                        type="button"
                        className={ws.catalogGroupHeader}
                        onClick={() => toggleSubjectGroup(subjectKey)}
                        aria-expanded={!collapsed}
                        aria-controls={groupId}
                      >
                        <span>
                          <span className="flex flex-wrap items-center gap-3">
                            <strong>{subjectName}</strong>
                            <span className={ws.caption}>
                              {isCore ? "核心科目" : "扩展科目"}
                            </span>
                          </span>
                          <small>
                            {subjectCode} · 已选 {selectedCount} /{" "}
                            {items.length}
                          </small>
                        </span>
                        <ChevronDown
                          size={16}
                          aria-hidden="true"
                          className={`shrink-0 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
                        />
                      </button>
                      <div id={groupId} hidden={collapsed}>
                        <KnowledgeCatalogTree
                          key={`${subjectKey}:${normalizedCatalogKeyword}:${chapterExpansion.revision}`}
                          items={items}
                          selected={selectedKnowledgePointIds}
                          editable={detail.status === "draft" && canWrite}
                          canWrite={canWrite}
                          busy={saving}
                          initiallyOpen={Boolean(normalizedCatalogKeyword) || chapterExpansion.open}
                          onSelect={(ids, checked) => setSelectedKnowledgePointIds(current => {
                            const next = new Set(current);
                            for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
                            return next;
                          })}
                          onAdd={parent => setLabelEditor({item:null, parent})}
                          onEdit={item => setLabelEditor({item})}
                          onSaved={refreshAll}
                        />
                      </div>
                    </section>
                  );
                })
              )}
              {!catalogQuery.isLoading &&
              !catalogQuery.isError &&
              !groupedCatalog.length ? (
                <EmptyState>
                  {catalogKeyword
                    ? "没有匹配的知识点。尝试缩短关键词或清空搜索。"
                    : "当前版本没有可展示的知识点目录。"}
                </EmptyState>
              ) : null}
            </>
          )}
        </div>
      </WorkspaceSurface>
      <ScrollToTop />
      {labelEditor ? <KnowledgeLabelEditor item={labelEditor.item} parent={labelEditor.parent} catalog={catalog} onClose={()=>setLabelEditor(null)} onSaved={refreshAll} /> : null}
      {detail ? (
        <WorkspaceSurface>
          <WorkspaceSectionHeader
            title="覆盖与版本映射"
            description="基础覆盖按已审核且启用的题目统计；映射记录不同考纲版本间的语义关系"
            actions={
              <Link href="/coverage" className={ws.textLink}>
                查看覆盖报告
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            }
          />
          <div className={ws.qualityGrid}>
            <section>
              <h3>基础题库覆盖</h3>
              {coverageQuery.isError ? (
                <WorkspaceNotice tone="danger">
                  基础覆盖读取失败，请刷新重试。
                </WorkspaceNotice>
              ) : (
                <>
                  <p className={`${ws.caption} mb-4`}>
                    {coverageQuery.data
                      ? `${coverageQuery.data.covered_knowledge_points} / ${coverageQuery.data.total_knowledge_points} 个知识点有题 · 覆盖率 ${coveragePct}%`
                      : "正在读取覆盖数据…"}
                  </p>
                  <ManagementProgress value={coveragePct} tone="accent" />
                  <p className={`${ws.caption} mt-4`}>
                    至少 1 道已审核且启用的题目即视为覆盖
                  </p>
                  {coverageQuery.data?.items.some((item) => !item.covered) ? (
                    <div className={`${ws.meta} mt-3`}>
                      {coverageQuery.data.items
                        .filter((item) => !item.covered)
                        .slice(0, 8)
                        .map((item) => (
                          <span
                            key={item.syllabus_knowledge_point_id}
                            className="text-warning-foreground"
                          >
                            缺题 · {item.name}
                          </span>
                        ))}
                    </div>
                  ) : null}
                </>
              )}
            </section>
            <section>
              <h3>跨版本映射</h3>
              <p className={ws.caption}>
                激活时自动生成不变、更名、新增与移除关系。合并、拆分、替换可在草稿阶段手工补充。
              </p>
              <p className={`${ws.caption} mt-4`}>
                {mappingsQuery.isError
                  ? "映射读取失败，请刷新重试"
                  : `当前版本 ${mappingsQuery.data?.length ?? 0} 条关系`}
              </p>
            </section>
          </div>
          {detail.status === "draft" && canWrite ? (
            <section
              className={`${ws.sectionBody} ${ws.divider}`}
              aria-label="手工跨版本映射"
            >
              <h3 className="text-sm font-medium">手工跨版本映射</h3>
              <p className={`${ws.caption} mt-2`}>
                补充无法由同一知识点 ID 自动表达的合并、拆分或替换
              </p>
              <div className={ws.mappingGrid}>
                <label className={ws.field}>
                  <span>来源版本</span>
                  <WorkspaceSelect
                    aria-label="来源版本"
                    value={
                      mappingSourceVersionId
                        ? String(mappingSourceVersionId)
                        : ""
                    }
                    onChange={(value) =>
                      setMappingSourceVersionId(Number(value) || null)
                    }
                    placeholder="请选择来源版本"
                    clearable={false}
                    options={(versionsQuery.data ?? [])
                      .filter((item) => item.id !== detail.id)
                      .map((item) => ({
                        value: String(item.id),
                        label: `${item.name} · ${STATUS_LABEL[item.status]}`,
                      }))}
                  />
                </label>
                <label className={ws.field}>
                  <span>关系类型</span>
                  <WorkspaceSelect
                    aria-label="关系类型"
                    value={mappingForm.relation_type}
                    onChange={(value) =>
                      setMappingForm({
                        ...mappingForm,
                        relation_type: value as "merged" | "split" | "replaced",
                      })
                    }
                    clearable={false}
                    options={[
                      { value: "replaced", label: "替换 replaced" },
                      { value: "merged", label: "合并 merged" },
                      { value: "split", label: "拆分 split" },
                    ]}
                  />
                </label>
                <label className={ws.field}>
                  <span>旧版知识点</span>
                  <WorkspaceSelect
                    aria-label="旧版知识点"
                    value={
                      mappingForm.from_syllabus_knowledge_point_id
                        ? String(mappingForm.from_syllabus_knowledge_point_id)
                        : ""
                    }
                    onChange={(value) =>
                      setMappingForm({
                        ...mappingForm,
                        from_syllabus_knowledge_point_id: Number(value),
                      })
                    }
                    options={(
                      sourceDetailQuery.data?.knowledge_points ?? []
                    ).map((item) => ({
                      value: String(item.id),
                      label: `${item.subject_name} · ${item.name}`,
                    }))}
                  />
                </label>
                <label className={ws.field}>
                  <span>新版知识点</span>
                  <WorkspaceSelect
                    aria-label="新版知识点"
                    value={
                      mappingForm.to_syllabus_knowledge_point_id
                        ? String(mappingForm.to_syllabus_knowledge_point_id)
                        : ""
                    }
                    onChange={(value) =>
                      setMappingForm({
                        ...mappingForm,
                        to_syllabus_knowledge_point_id: Number(value),
                      })
                    }
                    options={(detail.knowledge_points ?? []).map((item) => ({
                      value: String(item.id),
                      label: `${item.subject_name} · ${item.name}`,
                    }))}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-4">
                <label className={`${ws.field} min-w-0 flex-1`}>
                  <span>映射说明（可选）</span>
                  <Input
                    placeholder="说明本次语义变化"
                    value={mappingForm.note}
                    onChange={(event) =>
                      setMappingForm({
                        ...mappingForm,
                        note: event.target.value,
                      })
                    }
                  />
                </label>
                <Button
                  disabled={
                    !mappingForm.from_syllabus_knowledge_point_id ||
                    !mappingForm.to_syllabus_knowledge_point_id ||
                    mappingMutation.isPending
                  }
                  onClick={() => mappingMutation.mutate()}
                >
                  <Link2 size={14} aria-hidden="true" />
                  {mappingMutation.isPending ? "添加中…" : "新增映射"}
                </Button>
              </div>
            </section>
          ) : null}
          {(mappingsQuery.data?.length ?? 0) > 0 ? (
            <section className={ws.divider}>
              <WorkspaceSectionHeader
                title="映射明细"
                description={`显示前 ${Math.min(mappingsQuery.data?.length ?? 0, 60)} 条关系`}
              />
              <div
                className={ws.tableScroll}
                tabIndex={0}
                role="region"
                aria-label="跨版本映射明细，可横向滚动"
              >
                <table className={`${ws.table} min-w-[640px]`}>
                  <caption className="sr-only">所选版本的跨版本映射</caption>
                  <thead>
                    <tr>
                      <th scope="col">关系</th>
                      <th scope="col">旧版知识点</th>
                      <th scope="col">新版知识点</th>
                      <th scope="col">说明</th>
                      <th scope="col">
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(mappingsQuery.data ?? []).slice(0, 60).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <StatusBadge
                            tone={
                              ["merged", "split", "replaced"].includes(
                                item.relation_type,
                              )
                                ? "accent"
                                : "neutral"
                            }
                          >
                            {RELATION_LABEL[item.relation_type] ??
                              item.relation_type}
                          </StatusBadge>
                        </td>
                        <td>{item.from_name ?? "无"}</td>
                        <td>{item.to_name ?? "无"}</td>
                        <td className={ws.muted}>{item.note || "—"}</td>
                        <td>
                          {detail.status === "draft" &&
                          canWrite &&
                          ["merged", "split", "replaced"].includes(
                            item.relation_type,
                          ) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deleteMappingMutation.isPending}
                              onClick={() =>
                                setPendingAction({
                                  kind: "delete-mapping",
                                  mappingId: item.id,
                                })
                              }
                              aria-label={`删除映射 ${item.from_name ?? "无"} 到 ${item.to_name ?? "无"}`}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </WorkspaceSurface>
      ) : null}
      {error && !pendingAction ? (
        <div role="alert" className="mt-6">
          <WorkspaceNotice tone="danger" title="操作未完成">
            当前输入已保留。请检查写入权限与接口状态后重试。
          </WorkspaceNotice>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={
          pendingAction?.kind === "activate"
            ? "设为当前考纲版本？"
            : pendingAction?.kind === "archive"
              ? "归档此草稿版本？"
              : "删除这条手工映射？"
        }
        description={
          pendingAction?.kind === "activate"
            ? `将「${detail?.name ?? "所选版本"}」设为当前版本，原生效版本将归档，成员范围会固定。`
            : pendingAction?.kind === "archive"
              ? "归档后此版本不再可编辑，已有历史数据保留。"
              : "将移除这条手工语义关系，知识点和考纲版本保留。"
        }
        confirmText={
          pendingAction?.kind === "activate"
            ? "确认设为当前"
            : pendingAction?.kind === "archive"
              ? "确认归档"
              : "确认删除"
        }
        danger={pendingAction?.kind !== "activate"}
        loading={saving}
        onCancel={() => {
          confirmationMutation?.reset();
          setPendingAction(null);
        }}
        onConfirm={() => {
          if (pendingAction?.kind === "activate") activateMutation.mutate();
          else if (pendingAction?.kind === "archive") archiveMutation.mutate();
          else if (pendingAction?.mappingId)
            deleteMappingMutation.mutate(pendingAction.mappingId);
        }}
      >
        {confirmationMutation?.isError ? (
          <div role="alert">
            <WorkspaceNotice tone="danger" title="操作未完成">
              请检查写入权限与接口状态后重试，或取消返回。当前确认内容已保留。
            </WorkspaceNotice>
          </div>
        ) : null}
      </ConfirmDialog>
    </WorkspacePage>
  );
}
