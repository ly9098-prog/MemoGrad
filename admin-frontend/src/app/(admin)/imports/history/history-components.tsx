"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { QuestionContentRenderer } from "@/components/question-content-renderer";
import { MultiBlankQuestionOptions, QuestionOptions } from "@/components/question-options";
import { StatusBadge } from "@/components/status-badge";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { normalizeQuestionOptions, resolveQuestionBlankOptionGroups } from "@/lib/question-options";
import type { ImportBatchDetail, QuestionOptionsValue } from "@/lib/api/types";
import { historyDate, statusPresentation } from "./history-state";
import styles from "./history.module.css";

export function HistorySearch({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState({ value, committed: value });
  const [composing, setComposing] = useState(false);
  if (draft.committed !== value) setDraft({ value, committed: value });
  useDebouncedValue(composing ? value : draft.value, 300, (next) => {
    if (!composing && next !== value) onCommit(next);
  });
  return <div className={styles.searchField}>
    <label htmlFor="history-search">搜索批次</label>
    <div className={styles.searchInput}><Search aria-hidden="true" size={16} />
      <Input id="history-search" name="keyword" type="search" value={draft.value} placeholder="搜索批次编号或来源文件"
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onChange={(event) => setDraft({ value: event.target.value, committed: value })} />
    </div>
  </div>;
}

export function HistoryPagination({ page, pageSize, total, noun, busy, onPage, onPageSize }: {
  page: number; pageSize: number; total: number; noun: string; busy: boolean;
  onPage: (page: number) => void; onPageSize?: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return <nav className={styles.pagination} aria-label={`${noun}分页`}>
    <p>{page > pages ? `共 ${total} ${noun}，当前页超出范围` : `${start}–${Math.min(page * pageSize, total)} / 共 ${total} ${noun}`}</p>
    <div className={styles.paginationControls}>
      {onPageSize ? <CustomSelect aria-label={`每页${noun}数`} className={styles.pageSize} value={String(pageSize)} clearable={false}
        options={[10, 20, 50].map((size) => ({ value: String(size), label: `${size} / 页` }))}
        onChange={(value) => onPageSize(Number(value))} /> : null}
      <Button size="sm" variant="ghost" aria-label={`${noun}上一页`} disabled={page <= 1 || busy}
        onClick={() => onPage(Math.min(page - 1, pages))}><ChevronLeft aria-hidden="true" size={16} /></Button>
      <span>第 {page} / {pages} 页</span>
      <Button size="sm" variant="ghost" aria-label={`${noun}下一页`} disabled={page >= pages || busy}
        onClick={() => onPage(page + 1)}><ChevronRight aria-hidden="true" size={16} /></Button>
    </div>
  </nav>;
}

export function HistoryLoading({ label }: { label: string }) {
  return <div className={styles.loading} role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    {[0, 1, 2, 3].map((line) => <div className={styles.skeletonRow} key={line}><span /><span /><span /></div>)}
  </div>;
}

export function HistoryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className={styles.error} role="alert"><p>{message}</p>
    <Button variant="secondary" size="sm" onClick={onRetry}>重新加载</Button>
  </div>;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("、");
  return "";
}

export function HistoryBatchDetail({ batchId, data, page, loading, fetching, error, onRetry, onClose, onPage }: {
  batchId: string; data: ImportBatchDetail | undefined; page: number;
  loading: boolean; fetching: boolean; error: string | null;
  onRetry: () => void; onClose: () => void; onPage: (page: number) => void;
}) {
  const total = data?.total ?? data?.total_count ?? 0;
  const displayedPage = data?.page ?? page;
  return <section id="history-batch-detail" className={styles.detail} aria-labelledby="history-detail-title" aria-busy={fetching}>
    <header className={styles.detailHeader}>
      <div><h2 id="history-detail-title">批次内容</h2><p className={styles.identifier}>{batchId}</p></div>
      <div className={styles.detailActions}>
        <Link className={styles.textLink} href={`/imports/review?batch_id=${encodeURIComponent(batchId)}`}>进入审核</Link>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="收起批次内容"><X size={16} aria-hidden="true" /></Button>
      </div>
    </header>
    {error ? <HistoryError message={`批次内容加载失败。${error}`} onRetry={onRetry} /> : null}
    {loading && !data ? <HistoryLoading label="正在加载批次内容" /> : null}
    {fetching && data ? <p role="status" className={styles.refreshNote}>正在更新批次内容，当前内容保留显示…</p> : null}
    {data ? <>
      <p className={styles.detailMeta}>共 {data.total_count} 题 · 更新于 {historyDate(data.updated_at)} · 北京时间</p>
      {data.items.map((item, index) => {
        const status = statusPresentation(item.status);
        const parsed = item.parsed_content;
        const answer = item.parsed_answer || contentText(parsed?.answer);
        const analysis = item.parsed_analysis || contentText(parsed?.analysis ?? parsed?.explanation);
        const options = normalizeQuestionOptions(item.parsed_options ?? parsed?.options as QuestionOptionsValue);
        const groups = resolveQuestionBlankOptionGroups({ content: parsed ?? item.raw_data });
        return <article key={item.id} className={styles.question}>
          <div className={styles.questionHeader}><h3>第 {(displayedPage - 1) * 20 + index + 1} 题</h3>
            <StatusBadge tone={status.tone} variant="compact">{status.label}</StatusBadge>
            <span>{item.subject_name || item.subject_code || "未分类"}</span>
          </div>
          <div className={styles.questionBody}><QuestionContentRenderer content={parsed}
            fallbackText={contentText(parsed?.text ?? parsed?.stem ?? item.raw_data?.text) || "题干尚未提取，请进入审核查看原始内容。"}
            showTableMetadata preserveCodeText /></div>
          {groups.length > 0 ? <div className={styles.options} aria-label="各空选项"><MultiBlankQuestionOptions groups={groups} /></div>
            : options.length > 0 ? <div className={styles.options} aria-label="题目选项"><QuestionOptions options={options} /></div> : null}
          <dl className={styles.answerGrid}>
            <div><dt>答案</dt><dd>{answer ? <QuestionContentRenderer content={answer} fallbackText={answer} /> : "尚未提供答案"}</dd></div>
            <div><dt>解析</dt><dd>{analysis ? <QuestionContentRenderer content={analysis} fallbackText={analysis} /> : "尚未提供解析"}</dd></div>
          </dl>
          {item.reject_reason || item.review_note ? <p className={styles.reviewNote}>审核备注：{item.reject_reason || item.review_note}</p> : null}
        </article>;
      })}
      {!error && !loading && data.items.length === 0 ? <p className={styles.empty}>{page > 1 ? "这一页已无题目，请返回上一页。" : "此批次暂无可查看的题目。"}</p> : null}
      <HistoryPagination page={page} pageSize={20} total={total} noun="题" busy={fetching} onPage={onPage} />
    </> : null}
  </section>;
}
