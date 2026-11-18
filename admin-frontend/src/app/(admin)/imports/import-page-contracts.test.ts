import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistoryPage from "./history/page";
import MaintenancePage from "./maintenance/page";
import QuestionsPage from "./questions/page";
import TextPage from "./text-import/page";

type Mutation = {
  mutationFn: (input?: unknown) => Promise<unknown>;
  onSuccess?: (...args: unknown[]) => void;
  onError?: (error: unknown) => void;
  onSettled?: (...args: unknown[]) => void;
};
type Query = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
  enabled?: boolean;
  refetchInterval?: (query: { state: { data?: { status: string } } }) => unknown;
};
const ports = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  stateIndex: 0,
  refIndex: 0,
  effects: [] as Array<() => void | (() => void)>,
  queries: [] as Query[],
  mutations: [] as Mutation[],
  mutationInputs: [] as unknown[],
  searchParams: new URLSearchParams(),
  request: vi.fn(),
  toQuery: vi.fn(() => "?fixture"),
  invalidate: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useId: () => "import-fixture",
  useMemo: (compute: () => unknown) => compute(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { ports.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = ports.refIndex++;
    ports.refs[index] ??= { current: initial };
    return ports.refs[index];
  },
  useState: (initial: unknown) => {
    const index = ports.stateIndex++;
    if (!(index in ports.states)) ports.states[index] = typeof initial === "function" ? initial() : initial;
    return [ports.states[index], (next: unknown) => {
      ports.states[index] = typeof next === "function" ? next(ports.states[index]) : next;
    }];
  },
}));
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: (data: unknown) => data,
  useQueryClient: () => ({ invalidateQueries: ports.invalidate }),
  useQuery: (query: Query) => {
    ports.queries.push(query);
    return { data: undefined, isLoading: false, isFetching: false, refetch: vi.fn() };
  },
  useMutation: (mutation: Mutation) => {
    const index = ports.mutations.length;
    ports.mutations.push(mutation);
    return { mutate: vi.fn((input: unknown) => { ports.mutationInputs[index] = input; }), isPending: false };
  },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => ports.searchParams, useRouter: () => ({ replace: ports.replace }) }));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (select: (state: { permissions: string[] }) => unknown) =>
    select({ permissions: ["*"] }),
}));
vi.mock("@/lib/api/client", () => ({
  apiRequest: ports.request,
  toQuery: ports.toQuery,
}));

function render(page: () => unknown) {
  ports.stateIndex = ports.refIndex = 0;
  ports.effects = [];
  ports.queries = [];
  ports.mutations = [];
  return page();
}
function seed(values: Record<number, unknown>) {
  for (const [index, value] of Object.entries(values)) ports.states[Number(index)] = value;
}
function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object") return "";
  return textOf((node as { props?: { children?: unknown } }).props?.children);
}
function click(node: unknown, label: string): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = click(child, label);
      if (found) return found;
    }
  } else if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return;
    if (typeof props.onClick === "function" && textOf(props.children).includes(label)) {
      return props.onClick as () => Promise<void>;
    }
    for (const value of Object.values(props)) {
      const found = click(value, label);
      if (found) return found;
    }
  }
}

function propsBy(node: unknown, key: string, value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsBy(child, key, value);
      if (found) return found;
    }
  } else if (node && typeof node === "object") {
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return;
    if (props[key] === value) return props;
    return propsBy(props.children, key, value);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T00:00:00Z"));
  vi.clearAllMocks();
  ports.request.mockReset().mockResolvedValue({});
  ports.states = [];
  ports.refs = [];
  ports.searchParams = new URLSearchParams();
  ports.mutationInputs = [];
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("other import page requests", () => {
  it("sends text verbatim to parsing and imports only currently valid questions", async () => {
    const valid = {
      block_index: 1, question_type: "single_choice", stem: "question",
      options: [], knowledge_points: [], answer: "A", analysis: null, difficulty: 2,
      is_valid: true, errors: [], warnings: [], question_hash: null,
      stem_hash: null, detection_method: "fixture",
    };
    seed({ 0: "source $x$", 5: {
      questions: [valid, { ...valid, block_index: 2, is_valid: false }],
      raw_count: 2, valid_count: 1, warnings: [],
    } });
    const tree = render(TextPage);
    const parseInput = { source: "source $x$", revision: 0, signal: new AbortController().signal };
    await ports.mutations[0].mutationFn(parseInput);
    await click(tree, "确认导入")?.();
    const importInput = ports.mutationInputs[1];
    await ports.mutations[1].mutationFn(importInput);
    expect(ports.request.mock.calls).toEqual([
      ["/imports/text-parse", {
        method: "POST", body: JSON.stringify({ text: "source $x$", subject_id: null }), signal: expect.any(AbortSignal),
      }],
      ["/imports/text-import", {
        method: "POST", body: JSON.stringify({ subject_id: null, questions: [valid] }), signal: expect.any(AbortSignal),
      }],
    ]);
    ports.mutations[1].onSuccess?.({ batch_id: "b-1", items: [] }, importInput);
    expect(ports.invalidate.mock.calls).toEqual([[{ queryKey: ["import-review-queue"] }]]);
  });

  it("discards a parse response after the source text changes", async () => {
    seed({ 0: "old source" });
    const tree = render(TextPage);
    await click(tree, "解析文本")?.();
    const request = ports.mutationInputs[0] as { signal: AbortSignal };
    const input = propsBy(tree, "id", "question-import-text");
    (input?.onChange as (event: { target: { value: string } }) => void)({ target: { value: "new source" } });
    ports.mutations[0].onSuccess?.({ raw_count: 1, valid_count: 1, questions: [], warnings: [] }, request);
    expect(request.signal.aborted).toBe(true);
    expect(ports.states[0]).toBe("new source");
    expect(ports.states[5]).toBeNull();
  });

  it("lets repaired questions be imported without resending accepted questions", async () => {
    const valid = {
      block_index: 1, question_type: "short_answer", stem: "first question",
      options: [], knowledge_points: [], answer: "first answer", analysis: null, difficulty: 2,
      is_valid: true, errors: [], warnings: [], question_hash: null,
      stem_hash: null, detection_method: "fixture",
    };
    seed({ 5: { questions: [valid, { ...valid, block_index: 2, stem: "second question", is_valid: false, errors: ["answer_missing"] }], raw_count: 2, valid_count: 1, warnings: [] } });
    let tree = render(TextPage);
    await click(tree, "确认导入")?.();
    const request = ports.mutationInputs[1];
    const result = { batch_id: "first-batch", succeeded: 1, failed: 0, duplicates_filtered: 0, items: [{ block_index: 0, status: "ok" }] };
    ports.mutations[1].onSuccess?.(result, request);
    ports.mutations[1].onSettled?.(result, null, request);
    tree = render(TextPage);
    (propsBy(tree, "aria-label", "编辑题目 2")?.onClick as () => void)();
    tree = render(TextPage);
    await click(tree, "保存")?.();
    tree = render(TextPage);
    expect(textOf(tree)).toContain("继续导入 1 题");
    await click(tree, "继续导入")?.();
    const retry = ports.mutationInputs[1] as { questions: Array<{ block_index: number }> };
    expect(retry.questions.map((question) => question.block_index)).toEqual([2]);
  });

  it("retries only failed items from a partially accepted import", async () => {
    const valid = { block_index: 1, question_type: "short_answer", stem: "question", options: [], answer: "answer", analysis: null, knowledge_points: [], difficulty: 2, is_valid: true, errors: [], warnings: [] };
    seed({ 5: { questions: [valid, { ...valid, block_index: 2 }], raw_count: 2, valid_count: 2, warnings: [] } });
    let tree = render(TextPage);
    await click(tree, "确认导入")?.();
    const request = ports.mutationInputs[1];
    const result = { batch_id: "partial", succeeded: 1, failed: 1, duplicates_filtered: 0, items: [{ block_index: 0, status: "ok" }, { block_index: 1, status: "fail", error: "temporary failure" }] };
    ports.mutations[1].onSuccess?.(result, request);
    ports.mutations[1].onSettled?.(result, null, request);
    tree = render(TextPage);
    expect(textOf(tree)).toContain("暂存失败：导入处理未完成");
    expect(textOf(tree)).not.toContain("temporary failure");
    await click(tree, "继续导入")?.();
    const retry = ports.mutationInputs[1] as { questions: Array<{ block_index: number }> };
    expect(retry.questions.map((question) => question.block_index)).toEqual([2]);
  });

  it("maps filtered and deleted blocks by submitted position and distinguishes duplicates", async () => {
    const valid = { block_index: 0, question_type: "short_answer", stem: "question", options: [], answer: "answer", analysis: null, knowledge_points: [], difficulty: 2, is_valid: true, errors: [], warnings: [] };
    seed({ 5: { questions: [{ ...valid, is_valid: false }, { ...valid, block_index: 1 }, { ...valid, block_index: 2 }], raw_count: 3, valid_count: 2, warnings: [] } });
    let tree = render(TextPage);
    (propsBy(tree, "aria-label", "删除题目 3")?.onClick as () => void)();
    tree = render(TextPage);
    await click(tree, "确认导入")?.();
    const request = ports.mutationInputs[1];
    const result = { batch_id: "duplicates", succeeded: 0, failed: 0, duplicates_filtered: 1, items: [{ block_index: 0, status: "duplicate" }] };
    ports.mutations[1].onSuccess?.(result, request);
    ports.mutations[1].onSettled?.(result, null, request);
    tree = render(TextPage);
    expect(propsBy(tree, "aria-label", "编辑题目 1")?.disabled).toBe(false);
    expect(propsBy(tree, "aria-label", "编辑题目 2")?.disabled).toBe(true);
    expect(textOf(tree)).toContain("重复已跳过");
    expect(textOf(tree)).not.toContain("已暂存到审核队列");
    expect(click(tree, "确认导入")).toBeUndefined();
  });

  it("keeps history publishing separate from deletion and clears matching selection", async () => {
    ports.searchParams = new URLSearchParams("selected_batch=batch-1");
    render(HistoryPage);
    const batch = { batch_id: "batch-1", total_count: 1, approved_count: 1, published_count: 0 };
    await ports.mutations[0].mutationFn({ action: "publish", batch });
    await ports.mutations[0].mutationFn({ action: "delete", batch });
    expect(ports.request.mock.calls).toEqual([
      ["/imports/batch-1/publish", { method: "POST" }],
      ["/imports/batch-1", { method: "DELETE" }],
    ]);
    ports.mutations[0].onSuccess?.({ deleted_count: 1 }, { action: "delete", batch });
    expect(ports.replace).toHaveBeenCalledWith("/imports/history", { scroll: false });
    expect(ports.invalidate).toHaveBeenCalledWith({ queryKey: ["import-batches"] });
    expect(ports.invalidate).toHaveBeenCalledWith({ queryKey: ["import-content"] });
  });

  it("performs a maintenance dry run and restores its local busy state", async () => {
    const tree = render(MaintenancePage);
    const runDryRun = click(tree, "运行 Dry-Run");
    if (!runDryRun) throw new Error("missing dry-run action");
    ports.request.mockResolvedValueOnce({ dry_run: true });
    await runDryRun();
    expect(ports.request).toHaveBeenCalledWith("/imports/maintenance/cleanup", {
      method: "POST", body: '{"target":"all","dry_run":true}',
      headers: { "Content-Type": "application/json" },
    });
    expect(ports.states[1]).toEqual({ dry_run: true });
    expect(ports.states[3]).toBe(false);
    expect(ports.states[2]).toBe(false);
  });

  it("uses the URL batch filter while keeping full question detail disabled initially", async () => {
    ports.searchParams = new URLSearchParams("batch_id=url-batch");
    render(QuestionsPage);
    await ports.queries[0].queryFn();
    expect(ports.toQuery).toHaveBeenCalledWith(expect.objectContaining({
      page: 1, page_size: 50, batch_id: "url-batch",
    }));
    expect(ports.request).toHaveBeenCalledWith("/imports/review-queue?fixture");
    expect(ports.queries[1].queryKey).toEqual(["import-question-detail", null]);
    expect(ports.queries[1].enabled).toBe(false);
  });
});
