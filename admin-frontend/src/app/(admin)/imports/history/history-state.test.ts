import { describe, expect, it } from "vitest";
import type { ImportBatchListItem, ImportPipelineSummaryItem } from "@/lib/api/types";
import { batchActionDisabledReason, historyDate, historyHref, historyReturnTarget, pipelineBatchId, pipelineQuestionCount, pipelineRetryHref, readHistoryState, sourceLabel, statusPresentation } from "./history-state";

const batch: ImportBatchListItem = {
  batch_id: "batch-1", source_type: "text", source_file: null, total_count: 3,
  approved_count: 2, pending_count: 1, rejected_count: 0, published_count: 0,
  created_at: "2026-11-18T00:00:00Z", updated_at: "2026-11-18T00:00:00Z",
};
const pipeline: ImportPipelineSummaryItem = { pipeline_id: "pipeline-1", source_type: "pdf", status: "completed" };

describe("history URL state", () => {
  it("restores filters, separate batch selection and both pagination contexts", () => {
    const state = readHistoryState(new URLSearchParams("page=3&page_size=50&keyword=数学&status=approved&source_type=text&batch_id=exact&selected_batch=chosen&detail_page=2&return_to=%2Fimports%2Ftext-import"));
    expect(state).toMatchObject({ view: "batches", page: 3, pageSize: 50, keyword: "数学", status: "approved", sourceType: "text", batchId: "exact", selectedBatchId: "chosen", detailPage: 2 });
    expect(state.returnTarget.href).toBe("/imports/text-import");
  });

  it("opens a batch supplied by an import entry", () => {
    expect(readHistoryState(new URLSearchParams("batch_id=created-batch")).selectedBatchId).toBe("created-batch");
  });

  it.each(["-1", "0", "1.5", "Infinity", "999999999999999999999", "invalid"])("rejects invalid page %s", (value) => {
    expect(readHistoryState(new URLSearchParams({ page: value, detail_page: value })).page).toBe(1);
    expect(readHistoryState(new URLSearchParams({ detail_page: value })).detailPage).toBe(1);
  });

  it("keeps the pipeline status vocabulary separate", () => {
    expect(readHistoryState(new URLSearchParams("view=pipelines&status=failed")).status).toBe("failed");
    expect(readHistoryState(new URLSearchParams("view=pipelines&status=approved")).status).toBe("");
    expect(readHistoryState(new URLSearchParams("view=unknown&page_size=10000")).pageSize).toBe(20);
  });

  it("updates one scope while retaining return, detail and unrelated parameters", () => {
    const result = historyHref("return_to=%2Fimports%2Ftasks&selected_batch=one&detail_page=3&page=4&trace=keep", { keyword: "含 空格", page: 1 });
    const params = new URL(result, "http://localhost").searchParams;
    expect(params.get("keyword")).toBe("含 空格");
    expect(params.has("page")).toBe(false);
    expect(params.get("detail_page")).toBe("3");
    expect(params.get("selected_batch")).toBe("one");
    expect(params.get("return_to")).toBe("/imports/tasks");
    expect(params.get("trace")).toBe("keep");
  });

  it.each(["/imports/tasks", "/imports/batch-image", "/imports/text-import"])("allows the exact return destination %s", (href) => {
    expect(historyReturnTarget(href).href).toBe(href);
  });

  it.each([null, "https://outside.example", "//outside.example", "javascript:alert(1)", "/imports/tasks?next=outside", "/imports/tasks/../../login", "constructor"])("falls back safely for return target %s", (href) => {
    expect(historyReturnTarget(href).href).toBe("/imports/tasks");
  });
});

describe("history data semantics", () => {
  it("distinguishes a real zero question count from unknown metadata", () => {
    expect(pipelineQuestionCount(pipeline)).toBeNull();
    expect(pipelineQuestionCount({ ...pipeline, question_count: 0 })).toBe(0);
    expect(pipelineQuestionCount({ ...pipeline, quality_report: { total_questions: 7 } })).toBe(7);
    expect(pipelineQuestionCount({ ...pipeline, question_count: 2, quality_report: { total_questions: 7 } })).toBe(2);
  });

  it("does not infer a batch from a pipeline identifier", () => {
    expect(pipelineBatchId(pipeline)).toBeNull();
    expect(pipelineBatchId({ ...pipeline, batch_id: "linked-batch" })).toBe("linked-batch");
  });

  it("routes batch image job retries to their own upload entry", () => {
    const imageJob: ImportPipelineSummaryItem = { ...pipeline, pipeline_id: "batch/job", run_type: "batch_image" };
    expect(pipelineRetryHref(imageJob)).toBe("/imports/batch-image?retry_job=batch%2Fjob");
    expect(pipelineRetryHref(imageJob)).not.toContain("retry_pipeline");
    expect(pipelineRetryHref({ ...pipeline, pipeline_id: "pdf/job" })).toBe("/imports/tasks?retry_pipeline=pdf%2Fjob");
  });

  it("uses Chinese source and status labels", () => {
    expect(sourceLabel("batch_image")).toBe("批量图片");
    expect(sourceLabel("unrecognized")).toBe("其他来源");
    expect(statusPresentation("failed")).toEqual({ label: "处理失败", tone: "danger" });
    expect(statusPresentation("unknown").label).toBe("状态待确认");
  });

  it("formats timestamps in Beijing time and preserves unknown dates", () => {
    expect(historyDate("2026-11-18T00:15:00Z")).toContain("08:15");
    expect(historyDate(null)).toBe("时间未记录");
    expect(historyDate("invalid")).toBe("时间待确认");
  });

  it("gates publish and deletion independently of button presentation", () => {
    expect(batchActionDisabledReason(batch, "publish", false)).toContain("权限");
    expect(batchActionDisabledReason(batch, "delete", false)).toContain("权限");
    expect(batchActionDisabledReason({ ...batch, approved_count: 0 }, "publish", true)).toContain("没有可发布");
    expect(batchActionDisabledReason({ ...batch, published_count: 1 }, "delete", true)).toContain("不能删除");
    expect(batchActionDisabledReason(batch, "publish", true)).toBe("");
  });
});
