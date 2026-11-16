"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CircleHelp,
  FileQuestion,
  Filter,
  Import,
  Search,
  ShieldAlert,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";

import {
  EmptyState,
  FieldLabel,
  ManagementNotice,
  ManagementPage,
  PremiumSection,
  PremiumSectionHeader,
  PremiumStat,
  StatusBadge,
  ManagementProgress,
} from "@/components/admin/management-ui";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { Input } from "@/components/ui/input";
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

  const versionsQuery = useQuery({
    queryKey: ["syllabus", "versions", "coverage"],
    queryFn: () => apiRequest<SyllabusVersionSummary[]>("/knowledge/syllabus/versions"),
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (versionId || !versionsQuery.data?.length) return;
    const active = versionsQuery.data.find((item) => item.status === "active") ?? versionsQuery.data[0];
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
    () => (subjectsQuery.data ?? []).map((item) => ({ label: item.name, value: String(item.id) })),
    [subjectsQuery.data],
  );

  useEffect(() => {
    if (!subjectId) return;
    if (!subjectOptions.some((item) => item.value === subjectId)) setSubjectId("");
  }, [subjectId, subjectOptions]);

  const reportParams = useMemo(() => ({
    syllabus_version_id: selectedVersionId,
    subject_id: subjectId ? Number(subjectId) : undefined,
    min_questions: minQuestions,
    year_from: yearFrom.length === 4 ? Number(yearFrom) : undefined,
    year_to: yearTo.length === 4 ? Number(yearTo) : undefined,
  }), [selectedVersionId, subjectId, minQuestions, yearFrom, yearTo]);

  const reportQuery = useQuery({
    queryKey: ["coverage", "report", reportParams],
    queryFn: () => apiRequest<CoverageReportResponse>(`/coverage/report${toQuery(reportParams)}`),
    enabled: Boolean(selectedVersionId),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const filteredItems = useMemo(() => {
    return filterCoverageItems(reportQuery.data?.items ?? [], keyword, status);
  }, [keyword, reportQuery.data?.items, status]);

  const summary = reportQuery.data?.summary;
  const quality = reportQuery.data?.quality_issues;
  const graph = reportQuery.data?.knowledge_graph_quality;

  const applyMinQuestions = () => {
    const parsed = Number(minQuestionsInput);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 500) setMinQuestions(Math.floor(parsed));
  };

  const qualityIssueCount = summary
    ? summary.missing_analysis_questions + summary.image_reference_anomaly_questions + summary.duplicate_suspect_questions
    : 0;
  const lowCoverageCount = summary
    ? summary.empty_knowledge_points + summary.insufficient_knowledge_points + summary.imbalanced_knowledge_points
    : 0;
  const healthyRate = summary?.total_knowledge_points
    ? Math.round((summary.healthy_knowledge_points / summary.total_knowledge_points) * 100)
    : 0;
  const mappedRate = summary?.total_questions
    ? Math.round((summary.mapped_questions / summary.total_questions) * 100)
    : 0;
  const statusCounts = useMemo(() => {
    return computeStatusCounts(reportQuery.data?.items ?? []);
  }, [reportQuery.data?.items]);
  const hasLocalFilters = Boolean(keyword.trim() || status);
  const hasScopeFilters = Boolean(subjectId || yearFrom || yearTo || minQuestions !== 10 || minQuestionsInput !== "10");
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
    <ManagementPage className="space-y-5">
      <PremiumSection accent={summary ? "teal" : "blue"}>
        <PremiumSectionHeader
          icon={<BarChart3 className="h-4 w-4" />}
          title="题库覆盖"
          titleAs="h1"
          titleClassName="text-[26px] tracking-[-0.04em] md:text-[28px]"
          description="按考纲版本查看知识点题量、真题年份、难度结构和内容质量，优先定位最需要补题或治理的区域。"
          meta={reportQuery.data ? (
            <>
              <StatusBadge tone="accent">{reportQuery.data.syllabus.name}</StatusBadge>
              <span>生效年份 {reportQuery.data.syllabus.effective_year}</span>
              <span>题量阈值 {minQuestions}</span>
            </>
          ) : <span>选择考纲版本后生成覆盖报告</span>}
          aside={hasScopeFilters ? (
            <Button variant="secondary" size="sm" onClick={resetScope}>
              <RotateCcw className="h-3.5 w-3.5" />
              重置范围
            </Button>
          ) : <StatusBadge tone="neutral">默认范围</StatusBadge>}
        />
        <div className="grid gap-x-4 gap-y-3 border-b border-[var(--admin-line)] bg-[linear-gradient(180deg,rgba(240,248,253,0.44),rgba(255,255,255,0.12))] px-5 py-4 md:grid-cols-2 xl:grid-cols-[1.25fr_1fr_210px_145px_145px] xl:items-end">
          <label className="min-w-0">
            <FieldLabel>考纲版本</FieldLabel>
            <CustomSelect
              value={versionId}
              onChange={(value) => { setVersionId(value); setSubjectId(""); }}
              options={(versionsQuery.data ?? []).map((item) => ({
                label: `${item.name} · ${item.effective_year} · ${item.status}`,
                value: String(item.id),
              }))}
              placeholder="选择考纲版本"
              clearable={false}
            />
          </label>
          <label className="min-w-0">
            <FieldLabel>科目范围</FieldLabel>
            <CustomSelect
              value={subjectId}
              onChange={setSubjectId}
              options={[{ label: "全部核心科目", value: "" }, ...subjectOptions]}
              placeholder="全部核心科目"
            />
          </label>
          <label className="min-w-0">
            <FieldLabel>题量不足阈值</FieldLabel>
            <div className="flex min-w-0 gap-2">
              <Input className="w-0 min-w-0 flex-1" inputMode="numeric" value={minQuestionsInput} onChange={(event) => setMinQuestionsInput(event.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={applyMinQuestions} />
              <Button variant="secondary" onClick={applyMinQuestions} className="shrink-0 px-3.5">应用</Button>
            </div>
          </label>
          <label className="min-w-0">
            <FieldLabel>起始年份</FieldLabel>
            <Input inputMode="numeric" placeholder="自动" value={yearFrom} onChange={(event) => setYearFrom(event.target.value.replace(/\D/g, "").slice(0, 4))} />
          </label>
          <label className="min-w-0">
            <FieldLabel>结束年份</FieldLabel>
            <Input inputMode="numeric" placeholder="自动" value={yearTo} onChange={(event) => setYearTo(event.target.value.replace(/\D/g, "").slice(0, 4))} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--admin-line)] px-5 py-2.5 text-[11px] leading-5 text-muted-foreground/70">
          <span className="rounded-md bg-[rgba(231,243,250,0.82)] px-2 py-1 font-medium text-accent-foreground">自动范围</span>
          <span>年份留空时使用系统已知真题卷区间；填写起止年份后，会把缺失年份直接纳入完整性检查。</span>
        </div>

        {reportQuery.isError ? (
          <div className="border-t border-[var(--admin-line)] p-4 sm:p-5">
            <ManagementNotice tone="danger" title="覆盖报告加载失败">请确认当前账号具备题库与知识点读取权限，并检查所选考纲版本。</ManagementNotice>
          </div>
        ) : null}

        {summary ? (
          <>
            <div className="grid gap-px border-t border-[var(--admin-line)] sm:grid-cols-2 xl:grid-cols-4">
              <PremiumStat
                icon={<FileQuestion className="h-3.5 w-3.5" />}
                label="有效题目"
                value={summary.total_questions}
                hint={`已映射 ${summary.mapped_questions} · 未映射 ${summary.unmapped_questions}`}
              />
              <PremiumStat
                icon={<BookOpen className="h-3.5 w-3.5" />}
                label="考纲知识点"
                value={summary.total_knowledge_points}
                hint={`健康 ${summary.healthy_knowledge_points} · 无题 ${summary.empty_knowledge_points} · 健康率 ${healthyRate}%`}
                accent={summary.total_knowledge_points > 0 ? "teal" : "amber"}
                tone={summary.total_knowledge_points > 0 ? "default" : "alert"}
              />
              <PremiumStat
                icon={<BarChart3 className="h-3.5 w-3.5" />}
                label="题目映射率"
                value={`${mappedRate}%`}
                hint={`已映射 ${summary.mapped_questions} / ${summary.total_questions} 道有效题目`}
                accent={summary.unmapped_questions > 0 ? "amber" : "teal"}
                tone={summary.unmapped_questions > 0 ? "alert" : "default"}
              />
              <PremiumStat
                icon={<ShieldAlert className="h-3.5 w-3.5" />}
                label="待治理知识点"
                value={lowCoverageCount}
                hint={`无题 ${summary.empty_knowledge_points} · 不足 ${summary.insufficient_knowledge_points} · 失衡 ${summary.imbalanced_knowledge_points} · 内容问题 ${qualityIssueCount}`}
                accent={lowCoverageCount > 0 || qualityIssueCount > 0 ? "rose" : "teal"}
                tone={lowCoverageCount > 0 || qualityIssueCount > 0 ? "alert" : "default"}
              />
            </div>

            <div className="grid gap-px border-t border-[var(--admin-line)] bg-[var(--admin-line)] sm:grid-cols-2 xl:grid-cols-4">
            {([
              ["healthy", "健康", statusCounts.healthy, "success" as const],
              ["insufficient", "题量不足", statusCounts.insufficient, "warning" as const],
              ["imbalanced", "结构失衡", statusCounts.imbalanced, "warning" as const],
              ["empty", "无题", statusCounts.empty, "danger" as const],
            ] as Array<[CoverageStatus, string, number, "success" | "warning" | "danger"]>).map(([value, label, count, tone]) => {
              const amount = Number(count);
              const total = summary.total_knowledge_points || 1;
              const active = status === value;
              return (
                <button
                  type="button"
                  key={value}
                  onClick={() => setStatus((current) => current === value ? "" : value)}
                  className={`min-w-0 bg-[rgba(249,253,255,0.8)] px-5 py-3.5 text-left transition-[background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? "bg-[rgba(229,243,251,0.88)] shadow-[inset_0_-2px_0_var(--primary)]" : "hover:bg-white/82"}`}
                  aria-pressed={active}
                  title={active ? `取消“${label}”筛选` : `只看“${label}”知识点`}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <StatusBadge tone={tone}>{label}</StatusBadge>
                    <span className={`text-sm font-semibold tabular-nums ${active ? "text-accent-foreground" : "text-muted-foreground"}`}>{amount}</span>
                  </div>
                  <ManagementProgress value={amount} max={total} tone={tone === "success" ? "success" : "warning"} />
                  <p className="mt-2 text-[10px] text-muted-foreground/70">{active ? "已作为矩阵筛选条件" : "点击聚焦此状态"}</p>
                </button>
              );
            })}
          </div>

          {integrityIssueCount > 0 ? (
            <div className="border-t border-[var(--admin-line)]">
              <div className="flex items-start gap-2.5 px-5 py-3.5">
                <span className="admin-premium-icon"><AlertTriangle className="h-3.5 w-3.5" /></span>
                <div>
                  <h3 className="text-[13px] font-semibold tracking-[-0.015em] text-foreground">完整性诊断</h3>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">仅在存在结构问题时展示，避免正常的 0 值占用整块页面。</p>
                </div>
              </div>
              <div className="grid divide-y divide-[var(--admin-line)] border-t border-[var(--admin-line)] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
                {[
                  ["题目版本缺口", summary.unversioned_questions, "已审核且启用的题目缺少 current_version_id"],
                  ["考纲快照缺口", summary.syllabus_snapshot_missing_questions, "题目版本知识点关联缺少 syllabus snapshot"],
                  ["知识图谱孤立点", Number(graph?.summary?.isolated_count ?? 0), "当前考纲范围内没有有效关系的知识点"],
                  ["知识图谱循环", Number(graph?.summary?.cycle_count ?? 0), "prerequisite 关系循环检查"],
                ].filter(([, value]) => Number(value) > 0).map(([label, value, hint]) => (
                  <div key={String(label)} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-foreground">{String(label)}</p>
                      <StatusBadge tone="warning">需处理</StatusBadge>
                    </div>
                    <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{Number(value)}</p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{String(hint)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          </>
        ) : null}
      </PremiumSection>

      <PremiumSection className="overflow-hidden">
        <PremiumSectionHeader
          title="知识点覆盖矩阵"
          description="真题与模拟题计数来自试卷固定的题目版本快照，题库后续知识点编辑不会反向改变历史统计。"
          aside={
          <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
            <label className="relative block w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input className="pl-9" placeholder="搜索知识点" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
            </label>
            <CustomSelect
              className="w-full sm:w-36"
              value={status}
              onChange={(value) => setStatus(value as CoverageStatus | "")}
              options={[
                { label: "全部状态", value: "" },
                { label: "无题", value: "empty" },
                { label: "题量不足", value: "insufficient" },
                { label: "结构失衡", value: "imbalanced" },
                { label: "良好", value: "healthy" },
              ]}
              placeholder="全部状态"
            />
            {hasLocalFilters ? (
              <Button variant="ghost" size="sm" className="h-10 px-3 text-muted-foreground hover:bg-[var(--mgmt-steel)]" onClick={() => { setKeyword(""); setStatus(""); }}>
                <RotateCcw className="h-3.5 w-3.5" />
                清除
              </Button>
            ) : null}
          </div>
          }
        />
        <div className="max-h-[680px] overflow-auto">
          <table className="w-full min-w-[1260px] text-sm">
            <thead className="sticky top-0 z-10 bg-secondary/95 text-left text-[11px] font-semibold text-muted-foreground shadow-[0_1px_0_var(--border)] backdrop-blur-md">
              <tr className="border-b border-border/60 text-[10px] tracking-[0.04em] text-muted-foreground/70">
                <th rowSpan={2} className="sticky left-0 z-20 min-w-[360px] bg-secondary px-5 py-3 align-bottom text-[11px] tracking-normal text-muted-foreground">知识点</th>
                <th colSpan={3} className="px-3 py-2 text-center">题源</th>
                <th colSpan={3} className="px-3 py-2 text-center">难度</th>
                <th colSpan={2} className="px-3 py-2 text-center">质量</th>
                <th rowSpan={2} className="px-5 py-3 text-right align-bottom text-[11px] tracking-normal text-muted-foreground">处理</th>
              </tr>
              <tr>
                <th className="px-3 py-2.5 text-right">总题数</th>
                <th className="px-3 py-2.5 text-right">真题选择</th>
                <th className="px-3 py-2.5 text-right">模拟选择</th>
                <th className="px-3 py-2.5 text-right">简单</th>
                <th className="px-3 py-2.5 text-right">中等</th>
                <th className="px-3 py-2.5 text-right">困难</th>
                <th className="px-3 py-2.5 text-right">缺解析</th>
                <th className="px-3 py-2.5">状态</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item: CoverageMatrixItem) => (
                <tr key={item.syllabus_knowledge_point_id} className="group border-b border-border/60 align-top transition-[background-color,box-shadow] duration-200 hover:bg-[rgba(74,111,138,0.035)] hover:shadow-[inset_3px_0_0_rgba(74,111,138,0.28)]">
                  <td className="sticky left-0 z-[1] border-r border-border/60 bg-[var(--mgmt-paper)] px-5 py-4 shadow-[10px_0_18px_-18px_rgba(31,49,61,0.35)] transition-colors duration-200 group-hover:bg-card">
                    <p className="font-semibold text-foreground">{item.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">{item.subject_name} · KP #{item.knowledge_point_id}</p>
                    {item.years.length || Object.keys(item.question_type_counts).length || item.sources.length ? (
                      <div className="mt-1 flex max-w-lg flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-5 text-muted-foreground">
                        {item.years.length ? <span>年份 {item.years.slice(0, 6).join("/")}</span> : null}
                        {Object.keys(item.question_type_counts).length ? <span>题型 {Object.entries(item.question_type_counts).map(([type, count]) => `${type}:${count}`).join(" / ")}</span> : null}
                        {item.sources.length ? <span className="max-w-full truncate" title={item.sources.join(" / ")}>来源 {item.sources.join(" / ")}</span> : null}
                      </div>
                    ) : null}
                    {item.issues.length ? <p className="mt-2 max-w-lg text-xs leading-5 text-warning-foreground">{item.issues.join("；")}</p> : null}
                  </td>
                  <td className="px-3 py-4 text-right font-semibold tabular-nums text-foreground">{item.total_question_count}</td>
                  <td className="px-3 py-4 text-right tabular-nums">{item.past_exam_choice_count}</td>
                  <td className="px-3 py-4 text-right tabular-nums">{item.mock_choice_count}</td>
                  <td className="px-3 py-4 text-right tabular-nums">{item.difficulty_easy_count}</td>
                  <td className="px-3 py-4 text-right tabular-nums">{item.difficulty_medium_count}</td>
                  <td className="px-3 py-4 text-right tabular-nums">{item.difficulty_hard_count}</td>
                  <td className="px-3 py-4 text-right tabular-nums">{item.missing_analysis_count}</td>
                  <td className="px-3 py-4"><StatusBadge tone={coverageTone(item.status)}>{STATUS_LABEL[item.status]}</StatusBadge></td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <Link href={questionBankHref(item.knowledge_point_id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--mgmt-line)] bg-card px-3 text-xs font-semibold !text-accent-foreground transition-[border-color,background-color,transform] duration-200 hover:-translate-y-px hover:border-[rgba(74,111,138,0.34)] hover:bg-[var(--mgmt-steel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(49,95,122,0.22)] active:translate-y-0 motion-reduce:transform-none"><FileQuestion className="h-3.5 w-3.5" />看题库</Link>
                      <Link href="/imports/text-import" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary bg-primary px-3 text-xs font-semibold !text-primary-foreground shadow-[0_4px_12px_rgba(45,80,104,0.15)] transition-[background-color,transform,box-shadow] duration-200 hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_6px_16px_rgba(45,80,104,0.19)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(49,95,122,0.28)] active:translate-y-0 motion-reduce:transform-none"><Import className="h-3.5 w-3.5" />去导题</Link>
                    </div>
                  </td>
                </tr>
              ))}
              {!reportQuery.isLoading && filteredItems.length === 0 ? <tr><td colSpan={10}><EmptyState>当前筛选没有知识点。</EmptyState></td></tr> : null}
              {reportQuery.isLoading ? Array.from({ length: 5 }).map((_, index) => (
                <tr key={`loading-${index}`} className="border-b border-border/60">
                  <td className="sticky left-0 bg-[var(--mgmt-paper)] px-5 py-5"><div className="mgmt-skeleton h-4 w-48 rounded-full" /><div className="mgmt-skeleton mt-2 h-2.5 w-32 rounded-full" /></td>
                  {Array.from({ length: 9 }).map((__, cell) => <td key={cell} className="px-3 py-5"><div className="mgmt-skeleton ml-auto h-3 w-10 rounded-full" /></td>)}
                </tr>
              )) : null}
            </tbody>
          </table>
        </div>
      </PremiumSection>

      {examYears.length > 0 ? (
      <PremiumSection className="overflow-hidden">
        <PremiumSectionHeader
          title="真题选择题年份完整性"
          description="复用试卷发布校验，并把缺解析、固定题目版本缺知识点等问题作为额外质量警告。"
          icon={<BookOpen className="h-4 w-4" />}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] text-sm">
            <thead className="bg-[rgba(74,111,138,0.045)] text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-5 py-3">年份</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">代表试卷</th>
                <th className="px-4 py-3 text-right">题数</th>
                <th className="px-4 py-3 text-right">选择题分</th>
                <th className="px-4 py-3">问题</th>
                <th className="px-5 py-3 text-right">处理</th>
              </tr>
            </thead>
            <tbody>
              {examYears.map((item) => (
                <tr key={item.year} className="group border-t border-border/60 align-top transition-colors duration-200 hover:bg-[rgba(74,111,138,0.025)]">
                  <td className="px-5 py-4 font-semibold tabular-nums text-foreground">{item.year}</td>
                  <td className="px-4 py-4"><StatusBadge tone={examStatusTone(item.status)}>{EXAM_STATUS_LABEL[item.status]}</StatusBadge></td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">{item.paper_title ?? "暂无试卷"}</p>
                    {item.paper_version ? <p className="mt-1 text-xs text-muted-foreground/70">v{item.paper_version} · {item.paper_status}</p> : null}
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums">{item.question_count}</td>
                  <td className="px-4 py-4 text-right tabular-nums">{item.total_choice_score}</td>
                  <td className="px-4 py-4">
                    <div className="max-w-xl space-y-1 text-xs leading-5">
                      {item.validation_errors.map((message) => <p key={`e-${message}`} className="text-destructive">{message}</p>)}
                      {item.quality_warnings.map((message) => <p key={`w-${message}`} className="text-warning-foreground">{message}</p>)}
                      {!item.validation_errors.length && !item.quality_warnings.length ? <span className="text-success">完整性检查通过</span> : null}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link href={item.paper_ref ? `/exams/${item.paper_ref}` : "/exams"} className="inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground transition-[color,transform] hover:translate-x-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(74,111,138,0.25)] motion-reduce:transform-none">
                      {item.paper_ref ? "查看试卷" : "去建卷"}<ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PremiumSection>

      ) : null}

      {qualitySampleCount > 0 || hasGraphIssuesResult ? (
        <PremiumSection>
          <PremiumSectionHeader
            icon={<ShieldAlert className="h-4 w-4" />}
            title="质量样本与图谱联动"
            description="从异常题目中抽取可直接定位的样本，并复用 Knowledge Quality Report 检查当前考纲范围。"
          />
          <div className={`grid divide-y divide-[var(--admin-line)] ${qualitySampleCount > 0 && hasGraphIssuesResult ? "xl:grid-cols-2 xl:divide-x xl:divide-y-0" : ""}`}>
            {qualitySampleCount > 0 ? (
              <section className="min-w-0 p-5">
                <div className="flex items-start gap-2.5">
                  <span className="admin-premium-icon"><ShieldAlert className="h-3.5 w-3.5" /></span>
                  <div>
                    <h3 className="text-[13px] font-semibold tracking-[-0.015em] text-foreground">题库质量样本</h3>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">从每类异常中抽取可直接定位的题目样本。</p>
                  </div>
                </div>
                {quality ? (
                  <div className="mt-4 space-y-4">
                    {[
                      ["未映射当前考纲", quality.unmapped_question_ids],
                      ["缺少解析", quality.missing_analysis_question_ids],
                      ["图片引用结构异常", quality.image_reference_anomaly_question_ids],
                      ["缺少 current version", quality.unversioned_question_ids],
                      ["缺少考纲语义快照", quality.syllabus_snapshot_missing_question_ids],
                    ].filter(([, ids]) => (ids as number[]).length > 0).map(([label, ids]) => {
                      const values = ids as number[];
                      return (
                        <div key={label as string} className="grid gap-2 sm:grid-cols-[150px_1fr] sm:items-start">
                          <div>
                            <p className="text-sm font-medium text-foreground">{label as string}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">样本 {values.length}</p>
                          </div>
                          <div className="flex min-h-7 flex-wrap gap-1.5">
                            {values.slice(0, 12).map((id) => <Link key={id} href={questionIdHref(id)} className="rounded-md border border-[var(--admin-line)] bg-white/56 px-2 py-1 text-[11px] font-semibold text-accent-foreground transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-[rgba(74,111,138,0.28)] hover:bg-white/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(74,111,138,0.22)] motion-reduce:transform-none">#{id}</Link>)}
                          </div>
                        </div>
                      );
                    })}

                    {quality.duplicate_groups.length > 0 ? (
                      <div className="border-t border-[var(--admin-line)] pt-4">
                        <p className="text-sm font-medium text-foreground">重复疑似 hash 组</p>
                        <div className="mt-2 space-y-2">
                          {quality.duplicate_groups.slice(0, 8).map((group) => (
                            <div key={group.question_hash} className="rounded-[12px] border border-[var(--admin-line)] bg-white/48 px-3 py-2.5">
                              <p className="truncate font-mono text-[10px] text-muted-foreground/70">{group.question_hash}</p>
                              <div className="mt-1.5 flex flex-wrap gap-2">
                                {group.question_ids.map((id) => <Link key={id} href={questionIdHref(id)} className="text-xs font-semibold text-accent-foreground hover:underline">#{id}</Link>)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : <EmptyState>正在加载质量样本...</EmptyState>}
              </section>
            ) : null}

            {hasGraphIssuesResult ? (
              <section className="min-w-0 p-5">
                <div className="flex items-start gap-2.5">
                  <span className="admin-premium-icon"><CircleHelp className="h-3.5 w-3.5" /></span>
                  <div>
                    <h3 className="text-[13px] font-semibold tracking-[-0.015em] text-foreground">知识图谱联动</h3>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">复用现有 Knowledge Quality Report，并将统计范围限制到当前考纲知识点。</p>
                  </div>
                </div>
                <div className="mt-4 space-y-4">
                  {(graph?.warnings ?? []).length ? (
                    <div className="space-y-2">
                      {(graph?.warnings ?? []).map((warning) => (
                        <div key={warning} className="flex gap-2 rounded-[12px] border border-warning/30 bg-warning-light px-3 py-2.5 text-sm leading-5 text-warning-foreground">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[12px] border border-warning/30 bg-warning-light px-3 py-2.5 text-sm leading-5 text-warning-foreground">
                      图谱存在结构异常：孤立点 {Number(graph?.summary?.isolated_count ?? 0)}，循环 {Number(graph?.summary?.cycle_count ?? 0)}。
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 border-t border-[var(--admin-line)] pt-4">
                    <Link href="/knowledge-graph" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[var(--admin-line)] bg-white/56 px-4 text-sm font-semibold text-foreground transition hover:border-[rgba(74,111,138,0.28)] hover:bg-white/82"><Filter className="h-4 w-4" />进入知识图谱治理<ArrowUpRight className="h-3.5 w-3.5" /></Link>
                    <Link href="/syllabus" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[var(--admin-line)] bg-white/56 px-4 text-sm font-semibold text-foreground transition hover:border-[rgba(74,111,138,0.28)] hover:bg-white/82"><BookOpen className="h-4 w-4" />考纲版本<ArrowUpRight className="h-3.5 w-3.5" /></Link>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </PremiumSection>
      ) : null}
    </ManagementPage>
  );
}
