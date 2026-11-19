"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, CheckCircle2, Eye, FileText, RefreshCw, Send, Trash2, X } from "lucide-react";
import { WorkspaceHeader, WorkspacePage } from "@/components/admin/workspace";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { StatusBadge } from "@/components/status-badge";
import { apiRequest, toQuery } from "@/lib/api/client";
import type { ImportBatchDetail, ImportBatchListItem, ImportDeleteResponse, ImportPublishResponse, PaginatedResponse, PipelinesListResponse } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { hasPermission } from "@/lib/permissions/permissions";
import { importErrorMessage } from "@/lib/imports/import-messages";
import { HistoryBatchDetail, HistoryError, HistoryLoading, HistoryPagination, HistorySearch } from "./history-components";
import { batchActionDisabledReason, batchStatusOptions, historyDate, historyHref, pipelineBatchId, pipelineQuestionCount, pipelineRetryHref, pipelineStatusOptions, readHistoryState, sourceLabel, sourceOptions, statusPresentation } from "./history-state";
import styles from "./history.module.css";

type ConfirmState = { action: "publish" | "delete"; batch: ImportBatchListItem } | null;

export default function ImportHistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = readHistoryState(searchParams);
  const queryClient = useQueryClient();
  const permissions = useAuthStore((auth) => auth.permissions);
  const canRead = hasPermission(permissions, "import:read");
  const canWrite = hasPermission(permissions, "import:write");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const actionLock = useRef(false);
  const revealDetail = useRef(false);
  const isBatches = state.view === "batches";

  function navigate(updates: Record<string, string | number | null>) {
    router.replace(historyHref(searchParams.toString(), updates), { scroll: false });
  }

  function selectBatch(batchId: string) {
    revealDetail.current = true;
    if (batchId === state.selectedBatchId && isBatches) {
      document.getElementById("history-batch-detail")?.scrollIntoView({ block: "start" });
    }
    navigate({ view: "batches", selected_batch: batchId, detail_page: 1 });
  }

  useEffect(() => {
    if (!revealDetail.current || !isBatches || !state.selectedBatchId) return;
    revealDetail.current = false;
    document.getElementById("history-batch-detail")?.scrollIntoView({ block: "start" });
  }, [isBatches, state.selectedBatchId]);

  const batches = useQuery({
    queryKey: ["import-batches", "history", { page: state.page, page_size: state.pageSize, keyword: state.keyword, status: state.status, source_type: state.sourceType, batch_id: state.batchId }],
    queryFn: ({ signal }) => apiRequest<PaginatedResponse<ImportBatchListItem>>(`/imports${toQuery({
      page: state.page, page_size: state.pageSize, keyword: state.keyword,
      status: state.status, source_type: state.sourceType, batch_id: state.batchId,
    })}`, { signal }),
    enabled: canRead && isBatches,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const pipelines = useQuery({
    queryKey: ["import-pipelines", "history", { page: state.page, page_size: state.pageSize, status: state.status, source_type: state.sourceType }],
    queryFn: ({ signal }) => apiRequest<PipelinesListResponse>(`/imports/pipelines${toQuery({
      page: state.page, page_size: state.pageSize, status: state.status, source_type: state.sourceType, sort_by: "started_at",
    })}`, { signal }),
    enabled: canRead && !isBatches,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["import-batches", "detail", state.selectedBatchId, state.detailPage],
    queryFn: ({ signal }) => apiRequest<ImportBatchDetail>(`/imports/${encodeURIComponent(state.selectedBatchId!)}${toQuery({ page: state.detailPage, page_size: 20 })}`, { signal }),
    enabled: canRead && isBatches && state.selectedBatchId !== null,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === state.selectedBatchId ? previous : undefined,
    retry: false,
  });
  const actionMutation = useMutation({
    mutationFn: async (action: NonNullable<ConfirmState>) => {
      const reason = batchActionDisabledReason(action.batch, action.action, canWrite);
      if (reason) throw new Error(reason);
      const path = `/imports/${encodeURIComponent(action.batch.batch_id)}`;
      return action.action === "publish"
        ? apiRequest<ImportPublishResponse>(`${path}/publish`, { method: "POST" })
        : apiRequest<ImportDeleteResponse>(path, { method: "DELETE" });
    },
    onSuccess: (result, action) => {
      setFeedback(action.action === "publish"
        ? `发布完成，已发布 ${"published" in result ? result.published : 0} 题。`
        : `批次已删除，共删除 ${"deleted_count" in result ? result.deleted_count : 0} 条暂存记录。`);
      setConfirm(null);
      if (action.action === "delete" && state.selectedBatchId === action.batch.batch_id) {
        navigate({ selected_batch: null, detail_page: null, ...(state.batchId === action.batch.batch_id ? { batch_id: null } : {}) });
      }
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["import-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["import-pipelines"] }),
        queryClient.invalidateQueries({ queryKey: ["import-questions"] }),
        queryClient.invalidateQueries({ queryKey: ["import-review-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["import-content"] }),
        queryClient.invalidateQueries({ queryKey: ["questions"] }),
      ]);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["import-batches"] });
    },
    onSettled: () => { actionLock.current = false; },
  });

  function openConfirm(batch: ImportBatchListItem, action: "publish" | "delete") {
    if (actionLock.current || batchActionDisabledReason(batch, action, canWrite)) return;
    actionMutation.reset();
    setConfirm({ action, batch });
  }

  const activeQuery = isBatches ? batches : pipelines;
  const total = activeQuery.data?.total ?? 0;
  const currentItems = activeQuery.data?.items;
  const filtered = Boolean(state.status || state.sourceType || (isBatches && (state.keyword || state.batchId)));
  const sourceChoices = sourceOptions.some((option) => option.value === state.sourceType)
    ? sourceOptions : [...sourceOptions, { value: state.sourceType, label: "当前来源" }];

  return (
    <WorkspacePage embedded className={styles.history}>
      <WorkspaceHeader title="导入历史" description="追踪处理任务，查看暂存题目与批次审核结果。" actions={<>
        <Link className={styles.returnLink} href={state.returnTarget.href}><ArrowLeft aria-hidden="true" size={16} />{state.returnTarget.label}</Link>
        <Button size="sm" variant="secondary" className={styles.flatButton} disabled={activeQuery.isFetching || !canRead}
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: [isBatches ? "import-batches" : "import-pipelines"] });
          }}><RefreshCw aria-hidden="true" size={15} />{activeQuery.isFetching ? "刷新中" : "刷新"}</Button>
      </>} />

      {!canRead ? <p className={styles.empty}>当前账号没有查看导入历史的权限。</p> : <>
        {feedback ? <div role="status" className={styles.feedback}><CheckCircle2 aria-hidden="true" size={17} /><p>{feedback}</p>
          <Button variant="ghost" size="sm" onClick={() => setFeedback(null)} aria-label="关闭操作结果"><X aria-hidden="true" size={15} /></Button></div> : null}
        <div className={styles.viewBar}>
          <div className={styles.viewSwitch} aria-label="历史记录视图">
            {([{ value: "batches", label: "题目批次" }, { value: "pipelines", label: "处理任务" }] as const).map((view) =>
              <button key={view.value} type="button" aria-pressed={state.view === view.value}
                onClick={() => navigate({ view: view.value, page: 1, status: null, source_type: null })}>{view.label}</button>)}
          </div>
          <p role="status">{activeQuery.data ? `${total} ${isBatches ? "个批次" : "个任务"}` : activeQuery.isError ? "记录暂不可用" : "正在读取记录"}
            {activeQuery.isFetching && activeQuery.data ? " · 正在更新" : ""}</p>
        </div>
        <div className={styles.filters}>
          {isBatches ? <HistorySearch value={state.keyword} onCommit={(keyword) => navigate({ keyword, page: 1 })} /> :
            <p className={styles.taskExplanation}>处理失败或未生成题目的任务也会显示在这里。</p>}
          <div className={styles.filterField}><label htmlFor="history-status">{isBatches ? "审核状态" : "处理状态"}</label>
            <CustomSelect id="history-status" value={state.status} clearable={false}
              options={isBatches ? batchStatusOptions : pipelineStatusOptions}
              onChange={(status) => navigate({ status, page: 1 })} /></div>
          <div className={styles.filterField}><label htmlFor="history-source">来源</label>
            <CustomSelect id="history-source" value={state.sourceType} clearable={false} options={sourceChoices}
              onChange={(source_type) => navigate({ source_type, page: 1 })} /></div>
          {filtered ? <Button size="sm" variant="ghost" className={styles.clearFilters}
            onClick={() => navigate({ keyword: null, status: null, source_type: null, batch_id: null, page: 1 })}>清空筛选</Button> : null}
        </div>
        {isBatches && state.batchId ? <p className={styles.scopeNote}>仅查看批次 <span className={styles.identifier}>{state.batchId}</span>
          <button type="button" onClick={() => navigate({ batch_id: null, page: 1 })}>查看全部批次</button></p> : null}
        {!canWrite && isBatches ? <p className={styles.readOnly}>当前为只读权限，可以查看内容和审核结果。</p> : null}
        <section className={styles.list} aria-label={isBatches ? "题目批次列表" : "处理任务列表"} aria-busy={activeQuery.isFetching}>
          {activeQuery.isError ? <HistoryError message={`导入${isBatches ? "批次" : "任务"}加载失败。${importErrorMessage(activeQuery.error)}`}
            onRetry={() => { void activeQuery.refetch(); }} /> : null}
          {activeQuery.isLoading && !activeQuery.data ? <HistoryLoading label="正在加载导入历史" /> : null}
          {activeQuery.isPlaceholderData ? <p className={styles.refreshNote} role="status">正在加载所选范围，暂时显示上一页内容…</p> : null}
          {isBatches && batches.data?.items.length ? <>
            <div className={styles.listHead} aria-hidden="true"><span>批次 / 来源</span><span>题目统计</span><span>更新时间（北京时间）</span><span>操作</span></div>
            {batches.data.items.map((batch) => <article className={styles.batchRow} key={batch.batch_id} data-selected={state.selectedBatchId === batch.batch_id}>
              <div className={styles.batchIdentity}><span className={styles.sourceTag}><FileText size={14} aria-hidden="true" />{sourceLabel(batch.source_type)}</span>
                <h2><button type="button" onClick={() => selectBatch(batch.batch_id)}>{batch.source_file || "未命名导入批次"}</button></h2>
                <p className={styles.identifier}>{batch.batch_id}</p></div>
              <div className={styles.counts}><strong>共 {batch.total_count} 题</strong><span>待审 {batch.pending_count} · 通过 {batch.approved_count}</span>
                <span>拒绝 {batch.rejected_count} · 发布 {batch.published_count}</span></div>
              <div className={styles.batchTime}><span className={styles.mobileLabel}>更新于</span><time dateTime={batch.updated_at}>{historyDate(batch.updated_at)}</time>
                <span>创建 {historyDate(batch.created_at)}</span></div>
              <div className={styles.rowActions}>
                <Button size="sm" variant="ghost" aria-expanded={state.selectedBatchId === batch.batch_id}
                  aria-controls={state.selectedBatchId === batch.batch_id ? "history-batch-detail" : undefined}
                  disabled={batches.isPlaceholderData} onClick={() => selectBatch(batch.batch_id)}><Eye size={14} aria-hidden="true" />内容</Button>
                <Button size="sm" variant="ghost" title={batchActionDisabledReason(batch, "publish", canWrite) || "发布已通过的题目"}
                  disabled={Boolean(batchActionDisabledReason(batch, "publish", canWrite)) || batches.isPlaceholderData || actionMutation.isPending}
                  onClick={() => openConfirm(batch, "publish")}><Send size={14} aria-hidden="true" />发布</Button>
                <Button size="sm" variant="ghost" className={styles.deleteButton} title={batchActionDisabledReason(batch, "delete", canWrite) || "删除未发布批次"}
                  disabled={Boolean(batchActionDisabledReason(batch, "delete", canWrite)) || batches.isPlaceholderData || actionMutation.isPending}
                  onClick={() => openConfirm(batch, "delete")}><Trash2 size={14} aria-hidden="true" />删除</Button>
              </div>
            </article>)}
          </> : null}
          {!isBatches ? pipelines.data?.items.map((pipeline) => {
            const status = pipeline.status === "pending" ? { label: "等待处理", tone: "neutral" } as const : statusPresentation(pipeline.status);
            const count = pipelineQuestionCount(pipeline);
            const batchId = pipelineBatchId(pipeline);
            const failed = ["failed", "error"].includes(pipeline.status);
            const canRetry = failed || pipeline.run_type === "batch_image" && Boolean(pipeline.error_message) && ["completed", "completed_with_warnings", "cancelled", "interrupted"].includes(pipeline.status);
            return <article className={styles.pipelineRow} key={pipeline.pipeline_id}>
              <div className={styles.batchIdentity}><span className={styles.sourceTag}>{sourceLabel(pipeline.source_type)}</span>
                <h2>{pipeline.source_file || "未命名处理任务"}</h2><p className={styles.identifier}>{pipeline.pipeline_id}</p></div>
              <div className={styles.pipelineResult}><StatusBadge variant="compact" tone={status.tone}>{status.label}</StatusBadge>
                <p>{count === null ? "题量未记录" : count === 0 ? "未生成题目" : `生成 ${count} 题`}{pipeline.total_pages != null ? ` · ${pipeline.total_pages} 页` : ""}</p>
                {failed || pipeline.error_message ? <div className={styles.issue}><p>{pipeline.error_message ? importErrorMessage(new Error(pipeline.error_message)) : "任务处理失败，请检查来源文件后重新导入。"}</p>
                  {pipeline.error_message ? <details><summary>技术详情</summary><pre>{pipeline.error_message}</pre></details> : null}</div> : null}
                {!failed && count === 0 ? <p className={styles.muted}>请检查原文件是否包含可识别题目，再返回来源重新导入。</p> : null}</div>
              <div className={styles.batchTime}><time dateTime={pipeline.started_at || undefined}>{historyDate(pipeline.started_at)}</time>
                <span>{pipeline.finished_at ? `结束 ${historyDate(pipeline.finished_at)}` : "尚未记录结束时间"}</span></div>
              <div className={styles.pipelineActions}>{batchId ? <Button size="sm" variant="ghost" disabled={pipelines.isPlaceholderData} onClick={() => {
                revealDetail.current = true;
                navigate({ view: "batches", batch_id: batchId, selected_batch: batchId, page: 1, detail_page: 1, status: null, source_type: null, keyword: null });
              }}>查看题目<ArrowUpRight size={14} aria-hidden="true" /></Button>
                : <span className={styles.muted}>{failed || count === 0 ? "暂无题目批次" : "批次关联未记录"}</span>}
                {canRetry && canWrite ? <Link className={styles.textLink} href={pipelineRetryHref(pipeline)}>重新上传<ArrowUpRight size={14} aria-hidden="true" /></Link> : null}
              </div>
            </article>;
          }) : null}
          {!activeQuery.isError && !activeQuery.isLoading && currentItems?.length === 0 ? <div className={styles.empty}>
            <h2>{state.page > 1 ? "这一页没有记录" : filtered ? "没有符合条件的记录" : isBatches ? "还没有题目批次" : "还没有处理任务"}</h2>
            <p>{state.page > 1 ? "记录数量可能已经变化，请返回第一页查看。" : filtered ? "调整状态、来源或搜索条件后再试。" : isBatches ? "导入文件或文本后，已暂存的题目会按批次显示在这里。" : "PDF 与图片的处理记录会显示在这里，包括失败与未生成题目的任务。"}</p>
            {state.page > 1 ? <Button size="sm" variant="secondary" onClick={() => navigate({ page: 1 })}>返回第一页</Button>
              : filtered ? <Button size="sm" variant="secondary" onClick={() => navigate({ keyword: null, status: null, source_type: null, batch_id: null, page: 1 })}>清空筛选</Button>
                : canWrite ? <Link className={styles.textLink} href={state.returnTarget.href}>前往{state.returnTarget.label.replace("返回", "")}</Link> : null}
          </div> : null}
          {activeQuery.data ? <HistoryPagination page={state.page} pageSize={state.pageSize} total={total} noun={isBatches ? "个批次" : "个任务"}
            busy={activeQuery.isFetching} onPage={(page) => navigate({ page })} onPageSize={(page_size) => navigate({ page_size, page: 1 })} /> : null}
        </section>
        {isBatches && state.selectedBatchId ? <HistoryBatchDetail batchId={state.selectedBatchId} data={detail.data} page={state.detailPage}
          loading={detail.isLoading} fetching={detail.isFetching} error={detail.isError ? importErrorMessage(detail.error) : null}
          onRetry={() => { void detail.refetch(); }} onClose={() => navigate({ selected_batch: null, detail_page: null, ...(state.batchId === state.selectedBatchId ? { batch_id: null } : {}) })}
          onPage={(detail_page) => navigate({ detail_page })} /> : null}
      </>}
      <ConfirmDialog open={confirm !== null} title={confirm?.action === "delete" ? "删除导入批次" : "发布已通过题目"}
        description={confirm?.action === "delete" ? "仅未发布且未关联正式题目的批次可删除。删除暂存记录后无法恢复。" : "将此批次中审核已通过的题目发布到正式题库，其他状态的题目保留在暂存区。"}
        confirmText={confirm?.action === "delete" ? "确认删除" : "确认发布"} danger={confirm?.action === "delete"}
        loading={actionMutation.isPending} confirmDisabled={!canWrite}
        onCancel={() => { if (!actionLock.current) { setConfirm(null); actionMutation.reset(); } }}
        onConfirm={() => { if (!confirm || actionLock.current || !canWrite) return; actionLock.current = true; actionMutation.mutate(confirm); }}>
        {confirm ? <p className={styles.confirmBatch}>{confirm.batch.source_file || "未命名批次"}<br /><span className={styles.identifier}>{confirm.batch.batch_id}</span></p> : null}
        {actionMutation.isError ? <p className={styles.confirmError} role="alert">{importErrorMessage(actionMutation.error)}</p> : null}
        {!canWrite && confirm ? <p className={styles.confirmError} role="alert">导入写入权限已失效，请取消后刷新页面。</p> : null}
      </ConfirmDialog>
    </WorkspacePage>
  );
}
