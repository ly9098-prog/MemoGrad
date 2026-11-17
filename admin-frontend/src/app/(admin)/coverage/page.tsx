"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Search, RotateCcw } from "lucide-react";
import {
  EmptyState,
  ManagementSkeletonRows,
  StatusBadge,
} from "@/components/admin/management-ui";
import {
  WorkspacePage,
  WorkspaceHeader,
  WorkspaceSurface,
  WorkspaceFilters,
  WorkspaceSectionHeader,
  WorkspaceMetrics,
  WorkspaceMetric,
  WorkspaceNotice,
  WorkspaceSelect,
  workspaceStyles as ws,
} from "@/components/admin/workspace";
import { groupKnowledgeChapters, outlineLabel } from "@/lib/knowledge-outline";
import { getQuestionTypeLabel } from "@/lib/question-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { apiRequest, toQuery } from "@/lib/api/client";
import type {
  CoverageMatrixItem,
  CoverageReportResponse,
  CoverageStatus,
  KnowledgeGraphSubject,
  SyllabusVersionSummary,
} from "@/lib/api/types";
import {
  computeStatusCounts,
  filterCoverageItems,
  computeIntegrityIssueCount,
  computeQualitySampleCount,
  hasGraphIssues,
  COVERAGE_STATUS_LABEL as STATUS_LABEL,
  EXAM_STATUS_LABEL,
  coverageTone,
  examStatusTone,
  questionBankHref,
  questionIdHref,
} from "@/lib/coverage-utils";

export default function CoveragePage() {
  const [versionId, setVersionId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [minQuestionsInput, setMinQuestionsInput] = useState("10");
  const [minQuestions, setMinQuestions] = useState(10);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<CoverageStatus | "">("");

  const [collapsedChapters, setCollapsedChapters] = useState<Set<string>>(
    new Set(),
  );

  const versionsQuery = useQuery({
    queryKey: ["syllabus", "versions", "coverage"],
    queryFn: () =>
      apiRequest<SyllabusVersionSummary[]>("/knowledge/syllabus/versions"),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (versionId || !versionsQuery.data?.length) return;
    const active =
      versionsQuery.data.find((item) => item.status === "active") ??
      versionsQuery.data[0];
    if (active) setVersionId(String(active.id));
  }, [versionId, versionsQuery.data]);

  const selectedVersionId = versionId ? Number(versionId) : undefined;
  const subjectsQuery = useQuery({
    queryKey: ["knowledge-graph", "subjects", "coverage"],
    queryFn: () => apiRequest<KnowledgeGraphSubject[]>("/knowledge/subjects"),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const subjectOptions = useMemo(
    () =>
      (subjectsQuery.data ?? []).map((item) => ({
        label: item.name,
        value: String(item.id),
      })),
    [subjectsQuery.data],
  );

  useEffect(() => {
    if (!subjectId) return;
    if (!subjectOptions.some((item) => item.value === subjectId))
      setSubjectId("");
  }, [subjectId, subjectOptions]);

  const reportParams = useMemo(
    () => ({
      syllabus_version_id: selectedVersionId,
      subject_id: subjectId ? Number(subjectId) : undefined,
      min_questions: minQuestions,
      year_from: yearFrom.length === 4 ? Number(yearFrom) : undefined,
      year_to: yearTo.length === 4 ? Number(yearTo) : undefined,
    }),
    [selectedVersionId, subjectId, minQuestions, yearFrom, yearTo],
  );

  const reportQuery = useQuery({
    queryKey: ["coverage", "report", reportParams],
    queryFn: () =>
      apiRequest<CoverageReportResponse>(
        `/coverage/report${toQuery(reportParams)}`,
      ),
    enabled: Boolean(selectedVersionId),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const debouncedKeyword = useDebouncedValue(keyword, 200);
  const filteredItems = useMemo(() => {
    return filterCoverageItems(reportQuery.data?.items ?? [], debouncedKeyword, status);
  }, [debouncedKeyword, reportQuery.data?.items, status]);

  const chapters = useMemo(
    () => groupKnowledgeChapters(filteredItems),
    [filteredItems],
  );
  const isSearching = Boolean(keyword.trim() || status);
  function toggleChapter(key: string) {
    setCollapsedChapters((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const summary = reportQuery.data?.summary;
  const quality = reportQuery.data?.quality_issues;
  const graph = reportQuery.data?.knowledge_graph_quality;

  const applyMinQuestions = () => {
    const parsed = Number(minQuestionsInput);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 500)
      setMinQuestions(Math.floor(parsed));
  };

  const qualityIssueCount = summary
    ? summary.missing_analysis_questions +
      summary.image_reference_anomaly_questions +
      summary.duplicate_suspect_questions
    : 0;
  const lowCoverageCount = summary
    ? summary.empty_knowledge_points +
      summary.insufficient_knowledge_points +
      summary.imbalanced_knowledge_points
    : 0;
  const healthyRate = summary?.total_knowledge_points
    ? Math.round(
        (summary.healthy_knowledge_points / summary.total_knowledge_points) *
          100,
      )
    : 0;
  const mappedRate = summary?.total_questions
    ? Math.round((summary.mapped_questions / summary.total_questions) * 100)
    : 0;
  const statusCounts = useMemo(() => {
    return computeStatusCounts(reportQuery.data?.items ?? []);
  }, [reportQuery.data?.items]);
  const hasLocalFilters = Boolean(keyword.trim() || status);
  const hasScopeFilters = Boolean(
    subjectId ||
    yearFrom ||
    yearTo ||
    minQuestions !== 10 ||
    minQuestionsInput !== "10",
  );
  const integrityIssueCount = computeIntegrityIssueCount(summary, graph);
  const qualitySampleCount = computeQualitySampleCount(quality);
  const hasGraphIssuesResult = hasGraphIssues(graph);
  const examYears = reportQuery.data?.exam_years ?? [];

  const resetScope = () => {
    setSubjectId("");
    setMinQuestionsInput("10");
    setMinQuestions(10);
    setYearFrom("");
    setYearTo("");
  };

  return (
    <WorkspacePage>
      <WorkspaceHeader
        title="题库覆盖"
        description="按考纲检查题量、难度与内容质量，找到最需要补题的区域"
        meta={
          reportQuery.data ? (
            <>
              <StatusBadge tone="accent">
                {reportQuery.data.syllabus.name}
              </StatusBadge>
              <span>生效年份 {reportQuery.data.syllabus.effective_year}</span>
              <span>题量阈值 {reportQuery.data.summary.min_questions}</span>
            </>
          ) : (
            <span>选择考纲版本后生成覆盖报告</span>
          )
        }
        actions={
          hasScopeFilters ? (
            <Button variant="secondary" onClick={resetScope}>
              <RotateCcw size={14} aria-hidden="true" />
              重置范围
            </Button>
          ) : undefined
        }
      />
      <WorkspaceSurface>
        <WorkspaceFilters
          title="报告范围与阈值"
          summary={`${minQuestions} 题 · ${yearFrom || yearTo ? "自定义年份" : "自动年份"}`}
        >
          <div className={ws.coverageFilters}>
            <label className={ws.field}>
              <span>考纲版本</span>
              <WorkspaceSelect
                aria-label="考纲版本"
                value={versionId}
                onChange={(value) => {
                  setVersionId(value);
                  setSubjectId("");
                }}
                options={(versionsQuery.data ?? []).map((item) => ({
                  label: `${item.name} · ${item.status === "active" ? "当前生效" : item.status === "draft" ? "草稿" : "已归档"}`,
                  value: String(item.id),
                }))}
                placeholder="选择考纲版本"
                clearable={false}
              />
            </label>
            <label className={ws.field}>
              <span>科目范围</span>
              <WorkspaceSelect
                aria-label="科目范围"
                value={subjectId}
                onChange={setSubjectId}
                options={[
                  { label: "全部核心科目", value: "" },
                  ...subjectOptions,
                ]}
              />
            </label>
            <div className={ws.field}>
              <label htmlFor="coverage-min-questions">题量不足阈值</label>
              <span className="flex min-w-0 gap-2">
                <Input
                  id="coverage-min-questions"
                  className="w-0 min-w-0 flex-1"
                  inputMode="numeric"
                  value={minQuestionsInput}
                  onChange={(event) =>
                    setMinQuestionsInput(
                      event.target.value.replace(/\D/g, "").slice(0, 3),
                    )
                  }
                  onBlur={applyMinQuestions}
                />
                <Button variant="secondary" onClick={applyMinQuestions}>
                  应用
                </Button>
              </span>
            </div>
            <label className={ws.field}>
              <span>起始年份</span>
              <Input
                inputMode="numeric"
                placeholder="自动"
                value={yearFrom}
                onChange={(event) =>
                  setYearFrom(event.target.value.replace(/\D/g, "").slice(0, 4))
                }
              />
            </label>
            <label className={ws.field}>
              <span>结束年份</span>
              <Input
                inputMode="numeric"
                placeholder="自动"
                value={yearTo}
                onChange={(event) =>
                  setYearTo(event.target.value.replace(/\D/g, "").slice(0, 4))
                }
              />
            </label>
          </div>
          <p className={ws.scopeHint}>
            年份留空时按已收录真题区间检查；填写范围后，缺失年份也会列入完整性检查。年份范围仅约束真题年份报告。
            当前题量来自有效题库，真题与模拟题计数来自试卷固定的题目版本快照。
          </p>
        </WorkspaceFilters>
        {versionsQuery.isError || subjectsQuery.isError ? (
          <WorkspaceNotice tone="danger" title="报告范围读取失败">
            请刷新页面重试，当前无法读取
            {versionsQuery.isError ? "考纲版本" : "科目目录"}。
          </WorkspaceNotice>
        ) : null}
        {reportQuery.isError ? (
          <WorkspaceNotice tone="danger" title="覆盖报告加载失败">
            {reportQuery.data
              ? "下方保留最近一次成功报告，可能与当前范围不同。"
              : "请确认读取权限与考纲版本。"}
            <Button variant="ghost" onClick={() => reportQuery.refetch()}>
              重新读取
            </Button>
          </WorkspaceNotice>
        ) : reportQuery.isPlaceholderData ? (
          <div role="status">
            <WorkspaceNotice>
              正在更新报告，下方暂时显示上一范围的数据。
            </WorkspaceNotice>
          </div>
        ) : null}
        <WorkspaceMetrics>
          <WorkspaceMetric
            label="有效题目"
            value={summary ? summary.total_questions.toLocaleString() : "—"}
            hint={
              summary
                ? `已映射 ${summary.mapped_questions.toLocaleString()} · 未映射 ${summary.unmapped_questions}`
                : "按当前有效题库统计"
            }
            loading={reportQuery.isLoading}
          />
          <WorkspaceMetric
            label="考纲知识点"
            value={summary?.total_knowledge_points ?? "—"}
            hint={
              summary
                ? `健康 ${summary.healthy_knowledge_points} · 无题 ${summary.empty_knowledge_points} · 健康率 ${healthyRate}%`
                : "按所选考纲范围统计"
            }
            loading={reportQuery.isLoading}
          />
          <WorkspaceMetric
            label="题目映射率"
            value={summary ? `${mappedRate}%` : "—"}
            hint={
              summary
                ? `${summary.mapped_questions.toLocaleString()} / ${summary.total_questions.toLocaleString()} 道有效题目`
                : "知识点归属完整度"
            }
            loading={reportQuery.isLoading}
          />
          <WorkspaceMetric
            label="待治理知识点"
            value={summary ? lowCoverageCount : "—"}
            hint={
              summary
                ? `无题 ${summary.empty_knowledge_points} · 不足 ${summary.insufficient_knowledge_points} · 失衡 ${summary.imbalanced_knowledge_points}`
                : "定位题量和结构缺口"
            }
            tone={lowCoverageCount ? "attention" : "default"}
            loading={reportQuery.isLoading}
          />
        </WorkspaceMetrics>
        {integrityIssueCount > 0 && summary ? (
          <div className={ws.integrity}>
            <h3>完整性诊断</h3>
            {[
              ["题目版本缺口", summary.unversioned_questions],
              ["考纲快照缺口", summary.syllabus_snapshot_missing_questions],
              ["图谱孤立点", Number(graph?.summary?.isolated_count ?? 0)],
              ["图谱循环", Number(graph?.summary?.cycle_count ?? 0)],
            ]
              .filter(([, value]) => Number(value) > 0)
              .map(([label, value]) => (
                <span key={String(label)}>
                  {label}{" "}
                  <strong className="font-medium">{Number(value)}</strong>
                </span>
              ))}
          </div>
        ) : null}
        <WorkspaceSectionHeader
          title="知识点覆盖矩阵"
          description={`${chapters.length} 个章节分组 · ${filteredItems.length} 个知识点 · 按章节顺序排列`}
          actions={
            <div className={ws.coverageLocalFilters}>
              <label className={ws.search}>
                <Search aria-hidden="true" />
                <Input
                  placeholder="搜索知识点"
                  aria-label="搜索覆盖知识点"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </label>
              <label className={ws.coverageStatusSelect}>
                <span className="sr-only">覆盖状态</span>
                <WorkspaceSelect
                  aria-label="覆盖状态"
                  value={status}
                  onChange={(value) => setStatus(value as CoverageStatus | "")}
                  clearable={false}
                  options={[
                    {
                      value: "",
                      label: `全部 ${reportQuery.data?.items.length ?? "—"}`,
                    },
                    ...(
                      [
                        "healthy",
                        "insufficient",
                        "imbalanced",
                        "empty",
                      ] as const
                    ).map((value) => ({
                      value,
                      label: `${STATUS_LABEL[value]} ${summary ? statusCounts[value] : "—"}`,
                    })),
                  ]}
                />
              </label>
            </div>
          }
        />
        <div
          className={ws.coverageStates}
          role="group"
          aria-label="按覆盖状态筛选"
        >
          <button
            type="button"
            onClick={() => setStatus("")}
            aria-pressed={status === ""}
          >
            全部<strong>{reportQuery.data?.items.length ?? "—"}</strong>
          </button>
          {(
            [
              ["healthy", "健康"],
              ["insufficient", "题量不足"],
              ["imbalanced", "结构失衡"],
              ["empty", "无题"],
            ] as Array<[CoverageStatus, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                setStatus((current) => (current === value ? "" : value))
              }
              aria-pressed={status === value}
            >
              {label}
              <strong>{summary ? statusCounts[value] : "—"}</strong>
            </button>
          ))}
          {hasLocalFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setKeyword("");
                setStatus("");
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              清除
            </Button>
          ) : null}
        </div>
        {reportQuery.isLoading ? (
          <ManagementSkeletonRows rows={5} />
        ) : !reportQuery.data && !reportQuery.isError ? (
          <EmptyState>
            {versionsQuery.isLoading
              ? "正在读取考纲版本…"
              : "选择一个考纲版本后，即可查看覆盖矩阵。"}
          </EmptyState>
        ) : filteredItems.length === 0 ? (
          <EmptyState>
            {reportQuery.isError
              ? "报告尚未成功读取，请重试。"
              : "当前筛选没有知识点。调整关键词或切换覆盖状态。"}
          </EmptyState>
        ) : (
          <>
            <div
              className={`${ws.tableScroll} ${ws.paperDesktop} max-h-[680px]`}
              tabIndex={0}
              role="region"
              aria-label="知识点覆盖矩阵，可横向滚动"
            >
              <table className={`${ws.table} ${ws.matrix}`}>
                <caption className="sr-only">
                  知识点题源、难度与质量覆盖矩阵
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={ws.knowledgeCell}>
                      知识点
                    </th>
                    <th scope="col" className="text-right">
                      总题量
                    </th>
                    <th scope="col" className="text-right">
                      真题
                    </th>
                    <th scope="col" className="text-right">
                      模拟
                    </th>
                    <th scope="col" className="text-right">
                      简单
                    </th>
                    <th scope="col" className="text-right">
                      中等
                    </th>
                    <th scope="col" className="text-right">
                      困难
                    </th>
                    <th scope="col" className="text-right">
                      缺解析
                    </th>
                    <th scope="col">状态</th>
                    <th scope="col" className="text-right">
                      处理
                    </th>
                  </tr>
                </thead>
                {chapters.map((chapter) => (
                  <tbody key={chapter.key}>
                    <tr className={ws.matrixChapterRow}>
                      <th colSpan={10} scope="rowgroup">
                        <button
                          type="button"
                          aria-expanded={
                            isSearching || !collapsedChapters.has(chapter.key)
                          }
                          onClick={() => toggleChapter(chapter.key)}
                          disabled={isSearching}
                        >
                          <ChevronDown
                            size={14}
                            aria-hidden="true"
                            className={
                              !isSearching && collapsedChapters.has(chapter.key)
                                ? "-rotate-90"
                                : ""
                            }
                          />
                          <span>{chapter.subject}</span>
                          <strong>{chapter.name}</strong>
                          <small>{chapter.items.length} 项</small>
                        </button>
                      </th>
                    </tr>
                    {(isSearching || !collapsedChapters.has(chapter.key)) &&
                      chapter.items.map((item: CoverageMatrixItem) => (
                        <tr key={item.syllabus_knowledge_point_id}>
                          <td
                            className={ws.knowledgeCell}
                            style={{
                              paddingInlineStart: `${24 + Math.min(item.outline_depth ?? 0, 5) * 12}px`,
                            }}
                          >
                            <p>{outlineLabel(item)}</p>
                            <p className={ws.caption}>
                              {item.subject_name} · KP #
                              {item.knowledge_point_id}
                            </p>
                            {item.years.length ? (
                              <p className={ws.caption}>
                                年份 {item.years.slice(0, 6).join(" / ")}
                              </p>
                            ) : null}
                            {Object.keys(item.question_type_counts).length ? (
                              <p className={ws.caption}>
                                {Object.entries(item.question_type_counts)
                                  .map(
                                    ([type, count]) =>
                                      `${getQuestionTypeLabel(type)} ${count}`,
                                  )
                                  .join(" · ")}
                              </p>
                            ) : null}
                            {item.sources.length ? (
                              <p
                                className={ws.caption}
                                title={item.sources.join(" / ")}
                              >
                                来源 {item.sources.join(" / ")}
                              </p>
                            ) : null}
                            {item.issues.length ? (
                              <p className="mt-2 text-xs leading-5 text-warning-foreground">
                                {item.issues.join("；")}
                              </p>
                            ) : null}
                          </td>
                          <td className="text-right font-medium">
                            {item.total_question_count}
                          </td>
                          <td className="text-right">
                            {item.past_exam_choice_count}
                          </td>
                          <td className="text-right">
                            {item.mock_choice_count}
                          </td>
                          <td className="text-right">
                            {item.difficulty_easy_count}
                          </td>
                          <td className="text-right">
                            {item.difficulty_medium_count}
                          </td>
                          <td className="text-right">
                            {item.difficulty_hard_count}
                          </td>
                          <td className="text-right">
                            {item.missing_analysis_count}
                          </td>
                          <td>
                            <StatusBadge tone={coverageTone(item.status)}>
                              {STATUS_LABEL[item.status]}
                            </StatusBadge>
                          </td>
                          <td>
                            <div className={ws.matrixAction}>
                              <Link
                                href={questionBankHref(item.knowledge_point_id)}
                                className={ws.textLink}
                              >
                                看题库
                              </Link>
                              <Link
                                href="/imports/text-import"
                                className={ws.textLink}
                              >
                                去导题
                                <ArrowUpRight size={12} aria-hidden="true" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                ))}
              </table>
            </div>
            <div className={ws.matrixMobile}>
              {chapters.map((chapter) => (
                <section key={chapter.key}>
                  <button
                    type="button"
                    className={ws.mobileChapterHeader}
                    aria-expanded={
                      isSearching || !collapsedChapters.has(chapter.key)
                    }
                    onClick={() => toggleChapter(chapter.key)}
                    disabled={isSearching}
                  >
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={
                        !isSearching && collapsedChapters.has(chapter.key)
                          ? "-rotate-90"
                          : ""
                      }
                    />
                    <span>
                      <small>{chapter.subject}</small>
                      <strong>{chapter.name}</strong>
                    </span>
                    <small>{chapter.items.length} 项</small>
                  </button>
                  {(isSearching || !collapsedChapters.has(chapter.key)) &&
                    chapter.items.map((item) => (
                      <details key={item.syllabus_knowledge_point_id}>
                        <summary>
                          <span>
                            <strong>{outlineLabel(item)}</strong>
                            <small>
                              {item.subject_name} · {item.total_question_count}{" "}
                              道题
                            </small>
                          </span>
                          <StatusBadge tone={coverageTone(item.status)}>
                            {STATUS_LABEL[item.status]}
                          </StatusBadge>
                          <ChevronDown size={16} aria-hidden="true" />
                        </summary>
                        <div className={ws.matrixMobileBody}>
                          <dl>
                            {[
                              ["真题选择", item.past_exam_choice_count],
                              ["模拟选择", item.mock_choice_count],
                              ["简单", item.difficulty_easy_count],
                              ["中等", item.difficulty_medium_count],
                              ["困难", item.difficulty_hard_count],
                              ["缺解析", item.missing_analysis_count],
                            ].map(([label, value]) => (
                              <div key={String(label)}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                          </dl>
                          <p className={ws.caption}>
                            KP #{item.knowledge_point_id}
                            {item.years.length
                              ? ` · 年份 ${item.years.join(" / ")}`
                              : ""}
                          </p>
                          {item.sources.length ? (
                            <p className={ws.caption}>
                              来源 {item.sources.join(" / ")}
                            </p>
                          ) : null}
                          {Object.keys(item.question_type_counts).length ? (
                            <p className={ws.caption}>
                              {Object.entries(item.question_type_counts)
                                .map(
                                  ([type, count]) =>
                                    `${getQuestionTypeLabel(type)} ${count}`,
                                )
                                .join(" · ")}
                            </p>
                          ) : null}
                          {item.issues.length ? (
                            <p className="mt-2 text-xs leading-5 text-warning-foreground">
                              {item.issues.join("；")}
                            </p>
                          ) : null}
                          <div className={`${ws.actions} mt-3`}>
                            <Link
                              href={questionBankHref(item.knowledge_point_id)}
                              className={ws.actionLink}
                            >
                              看题库
                            </Link>
                            <Link
                              href="/imports/text-import"
                              className={ws.textLink}
                            >
                              去导题
                              <ArrowUpRight size={14} aria-hidden="true" />
                            </Link>
                          </div>
                        </div>
                      </details>
                    ))}
                </section>
              ))}
            </div>
          </>
        )}
      </WorkspaceSurface>
      {examYears.length > 0 ? (
        <WorkspaceSurface>
          <WorkspaceSectionHeader
            title="真题年份完整性"
            description="按试卷发布规则检查题数与分值，同时提示解析和知识点快照缺口"
          />
          <div
            className={ws.tableScroll}
            tabIndex={0}
            role="region"
            aria-label="真题年份完整性，可横向滚动"
          >
            <table className={`${ws.table} min-w-[880px]`}>
              <caption className="sr-only">各年份真题完整性</caption>
              <thead>
                <tr>
                  <th scope="col">年份</th>
                  <th scope="col">状态</th>
                  <th scope="col">代表试卷</th>
                  <th scope="col" className="text-right">
                    题目 / 分值
                  </th>
                  <th scope="col">问题</th>
                  <th scope="col">
                    <span className="sr-only">处理</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {examYears.map((item) => (
                  <tr key={item.year}>
                    <td>
                      <span className={ws.yearNumber}>{item.year}</span>
                    </td>
                    <td>
                      <StatusBadge tone={examStatusTone(item.status)}>
                        {EXAM_STATUS_LABEL[item.status]}
                      </StatusBadge>
                    </td>
                    <td className="max-w-[380px]">
                      <p className={ws.tableTitle}>
                        {item.paper_title ?? "暂无试卷"}
                      </p>
                      {item.paper_version ? (
                        <p className={ws.caption}>
                          v{item.paper_version} ·{" "}
                          {item.paper_status === "published"
                            ? "已发布"
                            : item.paper_status === "draft"
                              ? "草稿"
                              : "已归档"}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-right">
                      {item.question_count}
                      <span className={ws.muted}>
                        {" "}
                        / {item.total_choice_score} 分
                      </span>
                    </td>
                    <td>
                      {item.validation_errors.map((message) => (
                        <p key={message} className="text-xs text-destructive">
                          {message}
                        </p>
                      ))}
                      {item.quality_warnings.map((message) => (
                        <p
                          key={message}
                          className="text-xs text-warning-foreground"
                        >
                          {message}
                        </p>
                      ))}
                      {!item.validation_errors.length &&
                      !item.quality_warnings.length ? (
                        <span className={ws.caption}>检查通过</span>
                      ) : null}
                    </td>
                    <td>
                      <Link
                        href={
                          item.paper_ref ? `/exams/${item.paper_ref}` : "/exams"
                        }
                        className={`${ws.textLink} whitespace-nowrap`}
                      >
                        {item.paper_ref ? "查看试卷" : "去建卷"}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WorkspaceSurface>
      ) : null}
      {qualitySampleCount > 0 || hasGraphIssuesResult ? (
        <WorkspaceSurface>
          <WorkspaceSectionHeader
            title="内容质量与图谱"
            description={
              summary
                ? `${qualityIssueCount} 项内容问题记录 · 从样本进入题目或图谱检查`
                : "查看可直接定位的质量样本"
            }
          />
          <div className={ws.qualityGrid}>
            {qualitySampleCount > 0 && quality ? (
              <section>
                <h3>题库质量样本</h3>
                {[
                  ["未映射当前考纲", quality.unmapped_question_ids],
                  ["缺少解析", quality.missing_analysis_question_ids],
                  [
                    "图片引用异常",
                    quality.image_reference_anomaly_question_ids,
                  ],
                  ["缺少题目版本", quality.unversioned_question_ids],
                  [
                    "缺少考纲快照",
                    quality.syllabus_snapshot_missing_question_ids,
                  ],
                ]
                  .filter(([, ids]) => (ids as number[]).length > 0)
                  .map(([label, ids]) => (
                    <div key={String(label)} className={ws.qualityRow}>
                      <span>
                        {String(label)} · 样本 {(ids as number[]).length}
                      </span>
                      <span className="flex flex-wrap gap-2">
                        {(ids as number[]).slice(0, 12).map((id) => (
                          <Link key={id} href={questionIdHref(id)}>
                            #{id}
                          </Link>
                        ))}
                      </span>
                    </div>
                  ))}
                {quality.duplicate_groups.length ? (
                  <div className="mt-4">
                    <p className={ws.caption}>疑似重复组</p>
                    {quality.duplicate_groups.slice(0, 8).map((group) => (
                      <div key={group.question_hash} className={ws.qualityRow}>
                        <span
                          className="max-w-full truncate font-mono text-[11px]"
                          title={group.question_hash}
                        >
                          {group.question_hash}
                        </span>
                        <span className="flex flex-wrap gap-2">
                          {group.question_ids.map((id) => (
                            <Link key={id} href={questionIdHref(id)}>
                              #{id}
                            </Link>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {hasGraphIssuesResult ? (
              <section>
                <h3>知识图谱联动</h3>
                <p className={`${ws.caption} mb-4`}>
                  检查范围限定为当前考纲知识点
                </p>
                {graph?.warnings?.length ? (
                  graph.warnings.map((warning) => (
                    <p
                      key={warning}
                      className="mb-3 text-sm leading-6 text-warning-foreground"
                    >
                      {warning}
                    </p>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-warning-foreground">
                    孤立点 {Number(graph?.summary?.isolated_count ?? 0)} · 循环{" "}
                    {Number(graph?.summary?.cycle_count ?? 0)}
                  </p>
                )}
                <div className={`${ws.actions} mt-6`}>
                  <Link href="/knowledge-graph" className={ws.actionLink}>
                    进入知识图谱
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                  <Link href="/syllabus" className={ws.textLink}>
                    考纲版本
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </section>
            ) : null}
          </div>
        </WorkspaceSurface>
      ) : null}
    </WorkspacePage>
  );
}
