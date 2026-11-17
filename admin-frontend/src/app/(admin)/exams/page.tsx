"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Plus, RefreshCw, Search, X } from "lucide-react";

import {
  EmptyState,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import type {
  AdminExamPaperDetail,
  AdminExamPaperListItem,
  AdminExamPaperType,
} from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import {
  statusMeta,
  paperTypeLabel,
  computePaperSummary,
  filterPapers,
  buildStatusSegments,
  stableDesktopListHeight,
  stableMobileListHeight,
} from "@/lib/exam-paper-utils";
import { hasPermission } from "@/lib/permissions/permissions";
import {
  DEFAULT_EXAM_YEAR,
  EXAM_YEAR_OPTIONS,
  isSupportedExamYear,
} from "@/lib/exam-years";

const typeOptions = [
  { label: "历年真题 · 选择题", value: "past_exam_choice" },
  { label: "模拟卷 · 选择题", value: "mock_choice" },
];

export default function ExamPapersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const permissions = useAuthStore((state) => state.permissions);
  const canWrite = hasPermission(permissions, "question:write");
  const [title, setTitle] = useState("");
  const [paperType, setPaperType] =
    useState<AdminExamPaperType>("past_exam_choice");
  const [year, setYear] = useState(DEFAULT_EXAM_YEAR);
  const [durationMin, setDurationMin] = useState("75");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [settledKeyword, setSettledKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [displayStatusFilter, setDisplayStatusFilter] = useState("");
  const [displayKeyword, setDisplayKeyword] = useState("");
  const [resultsTransitionPhase, setResultsTransitionPhase] = useState<
    "idle" | "leaving" | "pre-enter" | "entering"
  >("idle");
  const displayedFilterRef = useRef({ status: "", keyword: "" });
  const targetFilterRef = useRef({ status: "", keyword: "" });
  const resultsTransitionPhaseRef = useRef<
    "idle" | "leaving" | "pre-enter" | "entering"
  >("idle");
  const leaveFallbackTimerRef = useRef<number | null>(null);
  const enterFallbackTimerRef = useRef<number | null>(null);
  const enterFrameRef = useRef<number | null>(null);
  const enterFrame2Ref = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledKeyword(keyword), 160);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const query = useQuery({
    queryKey: ["exam-papers"],
    queryFn: () => apiRequest<AdminExamPaperListItem[]>("/exams/papers"),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest<AdminExamPaperDetail>("/exams/papers", {
        method: "POST",
        exposeErrorDetail: true,
        body: JSON.stringify({
          title: title.trim(),
          paper_type: paperType,
          year:
            paperType === "past_exam_choice"
              ? Number(year)
              : year
                ? Number(year)
                : null,
          duration_sec: durationMin
            ? Math.max(1, Number(durationMin)) * 60
            : null,
        }),
      }),
    onSuccess: async (paper) => {
      await queryClient.invalidateQueries({ queryKey: ["exam-papers"] });
      router.push(`/exams/${paper.public_id}`);
    },
  });

  const papers = query.data ?? [];
  const summary = useMemo(() => computePaperSummary(papers), [papers]);
  const normalizedKeyword = settledKeyword.trim().toLowerCase();

  const updateResultsTransitionPhase = useCallback(
    (phase: "idle" | "leaving" | "pre-enter" | "entering") => {
      resultsTransitionPhaseRef.current = phase;
      setResultsTransitionPhase(phase);
    },
    [],
  );

  const clearLeaveFallback = useCallback(() => {
    if (leaveFallbackTimerRef.current !== null) {
      window.clearTimeout(leaveFallbackTimerRef.current);
      leaveFallbackTimerRef.current = null;
    }
  }, []);

  const clearEnterFallback = useCallback(() => {
    if (enterFallbackTimerRef.current !== null) {
      window.clearTimeout(enterFallbackTimerRef.current);
      enterFallbackTimerRef.current = null;
    }
  }, []);

  const clearEnterFrames = useCallback(() => {
    if (enterFrameRef.current !== null) {
      window.cancelAnimationFrame(enterFrameRef.current);
      enterFrameRef.current = null;
    }
    if (enterFrame2Ref.current !== null) {
      window.cancelAnimationFrame(enterFrame2Ref.current);
      enterFrame2Ref.current = null;
    }
  }, []);

  const commitDisplayedFilter = useCallback(
    (nextFilter: { status: string; keyword: string }) => {
      displayedFilterRef.current = nextFilter;
      setDisplayStatusFilter(nextFilter.status);
      setDisplayKeyword(nextFilter.keyword);
    },
    [],
  );

  const startResultsEnter = useCallback(() => {
    clearEnterFrames();
    clearEnterFallback();
    updateResultsTransitionPhase("pre-enter");
    enterFrameRef.current = window.requestAnimationFrame(() => {
      enterFrameRef.current = null;
      enterFrame2Ref.current = window.requestAnimationFrame(() => {
        enterFrame2Ref.current = null;
        if (resultsTransitionPhaseRef.current !== "pre-enter") return;
        updateResultsTransitionPhase("entering");
        enterFallbackTimerRef.current = window.setTimeout(() => {
          enterFallbackTimerRef.current = null;
          if (resultsTransitionPhaseRef.current === "entering")
            updateResultsTransitionPhase("idle");
        }, 260);
      });
    });
  }, [clearEnterFallback, clearEnterFrames, updateResultsTransitionPhase]);

  const finishResultsLeave = useCallback(() => {
    if (resultsTransitionPhaseRef.current !== "leaving") return;
    clearLeaveFallback();
    commitDisplayedFilter(targetFilterRef.current);
    startResultsEnter();
  }, [clearLeaveFallback, commitDisplayedFilter, startResultsEnter]);

  useEffect(() => {
    const nextFilter = { status: statusFilter, keyword: normalizedKeyword };
    targetFilterRef.current = nextFilter;
    const currentFilter = displayedFilterRef.current;
    const isSameAsDisplayed =
      currentFilter.status === nextFilter.status &&
      currentFilter.keyword === nextFilter.keyword;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      clearLeaveFallback();
      clearEnterFallback();
      clearEnterFrames();
      if (!isSameAsDisplayed) commitDisplayedFilter(nextFilter);
      updateResultsTransitionPhase("idle");
      return undefined;
    }

    if (isSameAsDisplayed) {
      if (resultsTransitionPhaseRef.current === "leaving") {
        clearLeaveFallback();
        clearEnterFallback();
        updateResultsTransitionPhase("entering");
        enterFallbackTimerRef.current = window.setTimeout(() => {
          enterFallbackTimerRef.current = null;
          if (resultsTransitionPhaseRef.current === "entering")
            updateResultsTransitionPhase("idle");
        }, 260);
      }
      return undefined;
    }

    if (resultsTransitionPhaseRef.current === "pre-enter") {
      commitDisplayedFilter(nextFilter);
      return undefined;
    }

    if (resultsTransitionPhaseRef.current === "leaving") return undefined;

    clearEnterFallback();
    clearEnterFrames();
    updateResultsTransitionPhase("leaving");
    clearLeaveFallback();
    leaveFallbackTimerRef.current = window.setTimeout(finishResultsLeave, 180);
    return undefined;
  }, [
    clearEnterFallback,
    clearEnterFrames,
    clearLeaveFallback,
    commitDisplayedFilter,
    finishResultsLeave,
    normalizedKeyword,
    statusFilter,
    updateResultsTransitionPhase,
  ]);

  useEffect(
    () => () => {
      clearLeaveFallback();
      clearEnterFallback();
      clearEnterFrames();
    },
    [clearEnterFallback, clearEnterFrames, clearLeaveFallback],
  );

  const filteredPapers = useMemo(
    () => filterPapers(papers, displayStatusFilter, displayKeyword),
    [displayKeyword, displayStatusFilter, papers],
  );
  const isSearchSettling = settledKeyword !== keyword;
  const isResultsTransitioning =
    isSearchSettling || resultsTransitionPhase !== "idle";
  const stableDesktopHeight = stableDesktopListHeight(papers.length);
  const stableMobileHeight = stableMobileListHeight(papers.length);
  const statusSegments = buildStatusSegments(papers, summary);
  const queryFailed = query.isError;

  return (
    <WorkspacePage>
      <WorkspaceHeader
        title="试卷管理"
        description="整理历年真题与模拟卷，维护题序、分值和发布状态"
        meta={
          <span>
            仅支持单选题 · 发布后冻结题序与题目版本，后续题库编辑不影响历史作答
          </span>
        }
        actions={
          <>
            {canWrite ? (
              <Button
                onClick={() => setShowCreateForm((value) => !value)}
                aria-expanded={showCreateForm}
                aria-controls="exam-create-form"
              >
                {showCreateForm ? (
                  <X size={16} aria-hidden="true" />
                ) : (
                  <Plus size={16} aria-hidden="true" />
                )}
                {showCreateForm ? "收起新建" : "新建试卷"}
              </Button>
            ) : null}
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
          </>
        }
      />
      <WorkspaceSurface>
        <WorkspaceMetrics>
          <WorkspaceMetric
            label="全部试卷"
            value={queryFailed ? "—" : summary.total}
            hint="草稿、已发布与已归档"
            loading={query.isLoading}
          />
          <WorkspaceMetric
            label="待整理草稿"
            value={queryFailed ? "—" : summary.draft}
            hint="可调整题目与基础信息"
            tone={summary.draft ? "attention" : "default"}
            loading={query.isLoading}
          />
          <WorkspaceMetric
            label="已发布"
            value={queryFailed ? "—" : summary.published}
            hint="题目版本已冻结"
            loading={query.isLoading}
          />
          <WorkspaceMetric
            label="历史作答"
            value={queryFailed ? "—" : summary.attempts.toLocaleString()}
            hint="所有试卷累计作答次数"
            loading={query.isLoading}
          />
        </WorkspaceMetrics>
        {canWrite ? (
          <div
            id="exam-create-form"
            aria-hidden={!showCreateForm}
            inert={!showCreateForm}
            className={`grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none ${showCreateForm ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
          >
            <div className="overflow-hidden">
              <section className={ws.createForm} aria-label="新建试卷">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-medium">新建试卷</h2>
                    <p className={`${ws.caption} mt-1`}>
                      先创建草稿，再补充题目、分值和来源
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCreateForm(false)}
                  >
                    收起
                    <X size={14} aria-hidden="true" />
                  </Button>
                </div>
                <div className={ws.createGrid}>
                  <label className={ws.field}>
                    <span>试卷名称</span>
                    <Input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="例如：2025 年真题选择题"
                    />
                  </label>
                  <label className={ws.field}>
                    <span>类型</span>
                    <WorkspaceSelect
                      value={paperType}
                      options={typeOptions}
                      onChange={(value) =>
                        setPaperType(value as AdminExamPaperType)
                      }
                      clearable={false}
                    />
                  </label>
                  <label className={ws.field}>
                    <span>年份</span>
                    <WorkspaceSelect
                      value={year}
                      options={EXAM_YEAR_OPTIONS}
                      onChange={setYear}
                      placeholder="选择年份"
                      clearable={paperType !== "past_exam_choice"}
                    />
                  </label>
                  <label className={ws.field}>
                    <span>建议时长（分钟）</span>
                    <Input
                      inputMode="numeric"
                      value={durationMin}
                      onChange={(event) =>
                        setDurationMin(event.target.value.replace(/\D/g, ""))
                      }
                      placeholder="75"
                    />
                  </label>
                </div>
                <div className={ws.actions}>
                  <Button
                    onClick={() => createMutation.mutate()}
                    disabled={
                      !title.trim() ||
                      createMutation.isPending ||
                      (paperType === "past_exam_choice" &&
                        !isSupportedExamYear(year)) ||
                      (paperType === "mock_choice" &&
                        Boolean(year) &&
                        !isSupportedExamYear(year))
                    }
                  >
                    <Plus size={16} aria-hidden="true" />
                    {createMutation.isPending ? "创建中…" : "创建草稿"}
                  </Button>
                  <span className={ws.caption}>草稿创建后进入组卷详情</span>
                </div>
                {createMutation.isError ? (
                  <div className="mt-4" role="alert">
                    <WorkspaceNotice tone="danger">
                      {createMutation.error instanceof Error
                        ? createMutation.error.message
                        : "创建失败，请检查名称、年份和时长后重试。"}
                    </WorkspaceNotice>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        ) : null}
        <WorkspaceSectionHeader
          title="试卷目录"
          description={
            query.isError
              ? "试卷读取失败，现有筛选条件已保留"
              : query.isLoading
                ? "正在读取试卷"
                : `显示 ${filteredPapers.length} / ${papers.length} 份 · 通过试卷名称进入组卷详情`
          }
        />
        <div className={ws.examControls}>
          <div className={ws.segments} role="group" aria-label="按状态筛选试卷">
            {statusSegments.map((segment) => (
              <button
                key={segment.value || "all"}
                type="button"
                onClick={() => setStatusFilter(segment.value)}
                aria-pressed={statusFilter === segment.value}
              >
                {segment.label}
                <span>{query.isError ? "—" : segment.count}</span>
              </button>
            ))}
          </div>
          <label className={ws.search}>
            <Search aria-hidden="true" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索名称、来源或年份"
              aria-label="搜索试卷"
            />
          </label>
        </div>
        {query.isError ? (
          <WorkspaceNotice tone="danger" title="试卷列表读取失败">
            请使用右上角刷新重试。
          </WorkspaceNotice>
        ) : query.isLoading ? (
          <ManagementSkeletonRows rows={4} />
        ) : (
          <div
            aria-busy={isResultsTransitioning}
            onTransitionEnd={(event) => {
              if (
                event.currentTarget !== event.target ||
                event.propertyName !== "opacity"
              )
                return;
              if (resultsTransitionPhaseRef.current === "leaving")
                finishResultsLeave();
              else if (resultsTransitionPhaseRef.current === "entering") {
                clearEnterFallback();
                updateResultsTransitionPhase("idle");
              }
            }}
            className={`transition-opacity motion-reduce:transition-none motion-reduce:opacity-100 ${resultsTransitionPhase === "leaving" ? "pointer-events-none opacity-0 duration-[110ms]" : resultsTransitionPhase === "pre-enter" ? "pointer-events-none opacity-0 duration-0" : resultsTransitionPhase === "entering" ? "opacity-100 duration-[190ms]" : "opacity-100 duration-0"}`}
          >
            <div
              className={`${ws.paperDesktop} ${ws.tableScroll} max-h-[680px]`}
              style={{ minHeight: stableDesktopHeight }}
              tabIndex={0}
              role="region"
              aria-label="试卷目录，可横向滚动"
            >
              {filteredPapers.length ? (
                <table className={`${ws.table} min-w-[880px]`}>
                  <caption className="sr-only">试卷目录与发布状态</caption>
                  <thead>
                    <tr>
                      <th scope="col">年份</th>
                      <th scope="col">试卷 / 来源</th>
                      <th scope="col" className="text-right">
                        题目 / 分值
                      </th>
                      <th scope="col" className="text-right">
                        建议时长
                      </th>
                      <th scope="col" className="text-right">
                        历史作答
                      </th>
                      <th scope="col">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPapers.map((paper) => {
                      const status = statusMeta(paper.status);
                      return (
                        <tr key={paper.id}>
                          <td>
                            <span className={ws.yearNumber}>
                              {paper.year ?? "—"}
                            </span>
                          </td>
                          <td className="max-w-[440px]">
                            <Link
                              href={`/exams/${paper.public_id}`}
                              className={ws.paperLink}
                            >
                              {paper.title}
                            </Link>
                            <p className={ws.caption}>
                              {paperTypeLabel(paper)} · v{paper.version}
                              {paper.source ? ` · ${paper.source}` : ""}
                            </p>
                          </td>
                          <td className="text-right">
                            <span className="font-medium">
                              {paper.question_count}
                            </span>
                            <span className={ws.muted}>
                              {" "}
                              / {paper.total_choice_score} 分
                            </span>
                          </td>
                          <td className={`text-right ${ws.muted}`}>
                            {paper.duration_sec
                              ? `${Math.round(paper.duration_sec / 60)} 分钟`
                              : "不限时"}
                          </td>
                          <td className={`text-right ${ws.muted}`}>
                            {paper.attempt_count.toLocaleString()}
                          </td>
                          <td>
                            <StatusBadge tone={status.tone}>
                              {status.label}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <EmptyState>
                  {papers.length === 0
                    ? "还没有试卷。创建一份草稿后即可开始组卷。"
                    : "当前筛选没有匹配的试卷。清空搜索或切换状态后再试。"}
                </EmptyState>
              )}
            </div>
            <div
              className={ws.paperMobile}
              style={{ minHeight: stableMobileHeight }}
            >
              {filteredPapers.length ? (
                filteredPapers.map((paper) => {
                  const status = statusMeta(paper.status);
                  return (
                    <article key={paper.id}>
                      <div>
                        <Link
                          href={`/exams/${paper.public_id}`}
                          className={ws.paperLink}
                        >
                          {paper.title}
                          <ChevronRight
                            size={14}
                            className="ml-1 inline"
                            aria-hidden="true"
                          />
                        </Link>
                        <StatusBadge tone={status.tone}>
                          {status.label}
                        </StatusBadge>
                      </div>
                      <p>
                        {paper.year ? `${paper.year} 年 · ` : ""}
                        {paperTypeLabel(paper)} · {paper.question_count} 题 /{" "}
                        {paper.total_choice_score} 分<br />
                        {paper.duration_sec
                          ? `${Math.round(paper.duration_sec / 60)} 分钟`
                          : "不限时"}{" "}
                        · v{paper.version} · 历史作答{" "}
                        {paper.attempt_count.toLocaleString()} 次
                        {paper.source ? ` · ${paper.source}` : ""}
                      </p>
                    </article>
                  );
                })
              ) : (
                <EmptyState>
                  {papers.length === 0
                    ? "还没有试卷。创建一份草稿后即可开始组卷。"
                    : "当前筛选没有匹配的试卷。清空搜索或切换状态后再试。"}
                </EmptyState>
              )}
            </div>
          </div>
        )}
      </WorkspaceSurface>
    </WorkspacePage>
  );
}
