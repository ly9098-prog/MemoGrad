import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ImportBatchDetail, ImportBatchListItem, ImportQuestionItem } from "@/lib/api/types";
import ImportHistoryPage from "./page";
import { HistoryBatchDetail, HistoryPagination } from "./history-components";

const context = vi.hoisted(() => ({ search: "", permissions: ["*"], replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: context.replace }),
  useSearchParams: () => new URLSearchParams(context.search),
}));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (select: (state: { permissions: string[] }) => unknown) => select({ permissions: context.permissions }),
}));
vi.mock("@/lib/api/client", async (original) => ({
  ...await original<typeof import("@/lib/api/client")>(), apiRequest: vi.fn(),
}));

const batch: ImportBatchListItem = {
  batch_id: "batch-sample", source_type: "text", source_file: "测试题目.txt", total_count: 41,
  pending_count: 38, approved_count: 2, rejected_count: 1, published_count: 0,
  created_at: "2026-11-18T00:00:00Z", updated_at: "2026-11-18T01:00:00Z",
};
const listKey = ["import-batches", "history", { page: 1, page_size: 20, keyword: "", status: "", source_type: "", batch_id: "" }];

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
}
function renderPage(queryClient: QueryClient) {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient }, createElement(ImportHistoryPage)));
}

beforeEach(() => { context.search = ""; context.permissions = ["*"]; vi.clearAllMocks(); });

describe("history read flows", () => {
  it("shows Chinese pipeline failures, technical detail, zero count, retry and batch links", () => {
    context.search = "view=pipelines&return_to=%2Fimports%2Fbatch-image";
    const queryClient = client();
    queryClient.setQueryData(["import-pipelines", "history", { page: 1, page_size: 20, status: "", source_type: "" }], {
      page: 1, page_size: 20, total: 2, items: [
        { pipeline_id: "retry/id", status: "failed", source_type: "pdf", source_file: "失败文件.pdf", question_count: 0, error_message: "RuntimeError: ocr.remote_unavailable ECONNREFUSED" },
        { pipeline_id: "completed-id", status: "completed", source_type: "pdf", batch_id: "batch-sample", question_count: 41 },
      ],
    });
    const html = renderPage(queryClient);
    expect(html).toContain("暂时无法连接 OCR 服务");
    expect(html).toContain("技术详情");
    expect(html).toContain("未生成题目");
    expect(html).toContain('href="/imports/tasks?retry_pipeline=retry%2Fid"');
    expect(html).toContain("重新上传");
    expect(html).toContain("查看题目");
    expect(html).toContain('href="/imports/batch-image"');
    queryClient.clear();
  });

  it("disables writes for read-only permissions while keeping content visible", () => {
    context.permissions = ["import:read"];
    const queryClient = client();
    queryClient.setQueryData(listKey, { items: [batch], total: 1, page: 1, page_size: 20 });
    const html = renderPage(queryClient);
    expect(html).toContain("测试题目.txt");
    expect(html).toContain("当前为只读权限");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?发布<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?删除<\/button>/);
    expect(html).toContain("内容");
    queryClient.clear();
  });

  it("keeps a recovery entry for completed batch jobs with failed images", () => {
    context.search = "view=pipelines";
    const queryClient = client();
    queryClient.setQueryData(["import-pipelines", "history", { page: 1, page_size: 20, status: "", source_type: "" }], {
      page: 1, page_size: 20, total: 1, items: [{
        pipeline_id: "partial-batch", run_type: "batch_image", status: "completed", source_type: "image",
        question_count: 3, error_message: "部分失败: 2/3",
      }],
    });
    const html = renderPage(queryClient);
    expect(html).toContain('href="/imports/batch-image?retry_job=partial-batch"');
    expect(html).toContain("重新上传");
    queryClient.clear();
  });

  it("renders first-load skeleton and keeps request failures out of empty states", () => {
    const queryClient = client();
    expect(renderPage(queryClient)).toContain("正在加载导入历史");
    const query = queryClient.getQueryCache().find({ queryKey: listKey });
    query!.setState({ status: "error", fetchStatus: "idle", error: new Error("加载失败") });
    const html = renderPage(queryClient);
    expect(html).toContain("加载失败");
    expect(html).toContain("重新加载");
    expect(html).not.toContain("还没有题目批次");
    queryClient.clear();
  });

  it("does not offer a retry upload to read-only users", () => {
    context.search = "view=pipelines";
    context.permissions = ["import:read"];
    const queryClient = client();
    queryClient.setQueryData(["import-pipelines", "history", { page: 1, page_size: 20, status: "", source_type: "" }], {
      items: [{ pipeline_id: "failed", source_type: "pdf", status: "failed", error_message: "无法识别题目" }], total: 1, page: 1, page_size: 20,
    });
    const html = renderPage(queryClient);
    expect(html).toContain("无法识别题目");
    expect(html).not.toContain("retry_pipeline=");
    queryClient.clear();
  });
});

describe("history paginated details", () => {
  const item: ImportQuestionItem = {
    id: 21, batch_id: "batch-sample", parsed_content: { stem: "计算下列数据结构的复杂度" },
    parsed_answer: "O(n)", parsed_analysis: "逐项遍历即可得到结论", status: "approved",
    parsed_options: { A: "O(n)", B: "O(1)" }, subject_name: "数据结构",
    source_type: "text", ai_generated: false, ai_answer_flag: false,
    risk_flags: [], risk_reasons: [], risk_level: "low",
    created_at: "2026-11-18T00:00:00Z", updated_at: "2026-11-18T00:00:00Z",
  };
  const detail: ImportBatchDetail = { ...batch, items: [item], page: 2, page_size: 20, total: 41, total_pages: 3 };
  const handlers = { onRetry: vi.fn(), onClose: vi.fn(), onPage: vi.fn() };

  it("renders question, options, answer, explanation, review link and real pagination", () => {
    const html = renderToStaticMarkup(createElement(HistoryBatchDetail, {
      ...handlers, batchId: "batch-sample", data: detail, page: 2, loading: false, fetching: false, error: null,
    }));
    expect(html).toContain("第 21 题");
    expect(html).toContain("计算下列数据结构的复杂度");
    expect(html).toContain("O(n)");
    expect(html).toContain("逐项遍历即可得到结论");
    expect(html).toContain("第 2 / 3 页");
    expect(html).toContain("/imports/review?batch_id=batch-sample");
  });

  it("shows first detail load and failures explicitly", () => {
    const props = { ...handlers, batchId: "missing", data: undefined, page: 1, loading: true, fetching: true, error: null };
    expect(renderToStaticMarkup(createElement(HistoryBatchDetail, props))).toContain("正在加载批次内容");
    const errorHtml = renderToStaticMarkup(createElement(HistoryBatchDetail, { ...props, loading: false, fetching: false, error: "记录已失效" }));
    expect(errorHtml).toContain("批次内容加载失败");
    expect(errorHtml).toContain("记录已失效");
    expect(errorHtml).not.toContain("此批次暂无");
  });

  it("keeps previous content visible while the next detail page is loading", () => {
    const html = renderToStaticMarkup(createElement(HistoryBatchDetail, {
      ...handlers, batchId: "batch-sample", data: detail, page: 3, loading: false, fetching: true, error: null,
    }));
    expect(html).toContain("当前内容保留显示");
    expect(html).toContain("第 21 题");
    expect(html).not.toContain("第 41 题");
  });

  it("keeps each blank's distinct choices visible in multi-blank imported content", () => {
    const grouped = { ...item, question_type: "multi_blank_choice", parsed_options: null, parsed_content: {
      stem: "完成第（1）空与第（2）空", blank_option_groups: [
        { id: "1", options: { A: "邻接表", B: "邻接矩阵" } },
        { id: "2", options: { A: "深度优先", B: "广度优先" } },
      ],
    } };
    const html = renderToStaticMarkup(createElement(HistoryBatchDetail, {
      ...handlers, batchId: "batch-sample", data: { ...detail, items: [grouped] }, page: 2, loading: false, fetching: false, error: null,
    }));
    for (const text of ["邻接表", "邻接矩阵", "深度优先", "广度优先", "各空选项"]) expect(html).toContain(text);
  });

  it("keeps an out-of-range page recoverable", () => {
    const html = renderToStaticMarkup(createElement(HistoryPagination, {
      page: 5, pageSize: 20, total: 21, noun: "题", busy: false, onPage: vi.fn(),
    }));
    expect(html).toContain("当前页超出范围");
    expect(html).toContain('aria-label="题上一页"');
  });
});
