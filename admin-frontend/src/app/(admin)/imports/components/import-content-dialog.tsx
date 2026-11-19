"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { QuestionContentRenderer } from "@/components/question-content-renderer";
import { MultiBlankQuestionOptions } from "@/components/question-options";
import { MathFormula } from "@/components/ui/math-formula";
import { apiRequest, toQuery } from "@/lib/api/client";
import type { ImportBatchDetail, QuestionOptionsValue } from "@/lib/api/types";
import { normalizeQuestionOptions, resolveQuestionBlankOptionGroups } from "@/lib/question-options";
import { getQuestionTypeLabel } from "@/lib/question-types";
import { resolveAssetUrl } from "@/lib/asset-url";
import { importErrorMessage } from "@/lib/imports/import-messages";
import s from "./import-dialog.module.css";

const PAGE_SIZE = 10;
const STATUS_LABELS: Record<string, string> = { pending: "待审核", approved: "已通过", rejected: "已拒绝", published: "已发布", draft: "草稿" };

function BatchContents({ batchId }: { batchId: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["import-content", batchId, page],
    queryFn: ({ signal }) => apiRequest<ImportBatchDetail>(`/imports/${encodeURIComponent(batchId)}${toQuery({ page, page_size: PAGE_SIZE })}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    retry: false,
  });
  const total = query.data?.total ?? query.data?.total_count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const displayedPage = query.data?.page ?? page;
  return <>
    <div className={s.toolbar}>
      <span className={s.description}>{query.data ? `共 ${total} 道题目` : "正在读取导入内容"}</span>
      <div className={s.toolbarActions}>
        <Button variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="刷新导入内容"><RefreshCw className="h-4 w-4" aria-hidden="true" />刷新</Button>
        <Link className={s.link} href={`/imports/review?batch_id=${encodeURIComponent(batchId)}`}>前往审核<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
      </div>
    </div>
    {query.isError ? <div className={s.error} role="alert"><span>{importErrorMessage(query.error)}</span><Button variant="ghost" onClick={() => void query.refetch()}>重试</Button></div> : null}
    <div className={s.body} aria-busy={query.isFetching}>
      {query.isPending ? <div className={s.state} role="status"><div className={s.skeleton} /><span>正在加载题目</span></div> : null}
      {query.data?.items.map((item, index) => {
        const options = normalizeQuestionOptions(item.parsed_options ?? item.parsed_content?.options as QuestionOptionsValue);
        const groups = resolveQuestionBlankOptionGroups({ content: item.parsed_content ?? item.raw_data });
        return <article key={item.id} className={s.question}>
          <div className={s.questionMeta}><strong>题目 {(displayedPage - 1) * PAGE_SIZE + index + 1}</strong><span>{getQuestionTypeLabel(item.question_type)}</span><span>{item.subject_name || item.subject_code || "科目待补"}</span><span>{STATUS_LABELS[item.status] || "待处理"}</span></div>
          <div className={s.stem}><QuestionContentRenderer content={item.parsed_content} fallbackText={item.content_preview || String(item.raw_data?.text ?? "暂未提取到题干")} preserveCodeText showTableMetadata /></div>
          {groups.length ? <div className={s.options}><MultiBlankQuestionOptions groups={groups} /></div> : options.length ? <div className={s.options}>{options.map((option) => <div key={option.key} className={s.option}><strong>{option.key}.</strong><div>{option.text ? <MathFormula text={option.text} /> : null}{option.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- imported image asset resolved through the existing asset policy
            <img src={resolveAssetUrl(option.imageUrl)} alt={`选项 ${option.key}`} />
          ) : null}</div></div>)}</div> : null}
          <dl className={s.answer}><dt>答案</dt><dd>{item.parsed_answer ? <MathFormula text={item.parsed_answer} /> : "待补充"}</dd>{item.parsed_analysis ? <><dt>解析</dt><dd><MathFormula text={item.parsed_analysis} /></dd></> : null}</dl>
        </article>;
      })}
      {query.data && query.data.items.length === 0 && !query.isError ? <div className={s.state}><strong>尚未生成题目</strong><span>可以返回任务查看处理进度。</span></div> : null}
    </div>
    <footer className={s.footer}><span>第 {page} / {pageCount} 页</span><div className={s.footerActions}><Button variant="secondary" disabled={page <= 1 || query.isPlaceholderData} onClick={() => setPage((value) => value - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" />上一页</Button><Button variant="secondary" disabled={page >= pageCount || query.isPlaceholderData} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight className="h-4 w-4" aria-hidden="true" /></Button></div></footer>
  </>;
}

export function ImportContentDialog({ open, onOpenChange, batchId, title = "导入内容" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batchId: string | null;
  title?: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className={s.dialog}
    onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
    onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus({ preventScroll: true }); }}>
    <header className={s.header}><DialogTitle className={s.title}>{title}</DialogTitle><DialogDescription className={s.description}>查看题干、选项、答案与解析</DialogDescription></header>
    {batchId ? <BatchContents key={batchId} batchId={batchId} /> : <div className={s.state}><strong>尚未生成可查看的题目</strong><span>处理完成后可在这里查看。</span></div>}
  </DialogContent></Dialog>;
}
