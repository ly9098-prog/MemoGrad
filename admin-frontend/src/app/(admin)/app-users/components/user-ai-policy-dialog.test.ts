import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";

type Mutation = {
  mutationFn: (action: string) => Promise<unknown>;
  onError: (error: unknown) => Promise<void> | void;
};

const values = {
  regeneration_cooldown_seconds: 60,
  regeneration_question_24h_limit: 3,
  regeneration_account_24h_limit: 20,
  daily_token_limit: 50_000,
  monthly_token_limit: 500_000,
  rpm_limit: 12,
};

const h = vi.hoisted(() => ({
  index: 0,
  setters: [] as ReturnType<typeof vi.fn>[],
  refs: [] as Array<{ current: unknown }>,
  mutations: [] as Mutation[],
  refetch: vi.fn(),
  request: vi.fn(),
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  policy: null as unknown,
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => undefined,
  useRef: (current: unknown) => {
    const ref = { current };
    h.refs.push(ref);
    return ref;
  },
  useState: (initial: unknown) => {
    const setter = vi.fn();
    h.setters.push(setter);
    return [initial, setter];
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: h.invalidateQueries,
    setQueryData: h.setQueryData,
  }),
  useQuery: () => ({
    data: h.policy,
    isLoading: false,
    isError: false,
    error: null,
    refetch: h.refetch,
  }),
  useMutation: (mutation: Mutation) => {
    h.mutations.push(mutation);
    return { mutate: vi.fn(), isPending: false };
  },
}));

vi.mock("@/lib/api/client", () => ({ apiRequest: h.request }));

import {
  UserAIPolicyDialog,
  resolvePolicyView,
} from "./user-ai-policy-dialog";

function renderDialog() {
  UserAIPolicyDialog({
    target: { scope: "default" },
    open: true,
    onOpenChange: vi.fn(),
  });
  return h.mutations[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  h.index = 0;
  h.setters = [];
  h.refs = [];
  h.mutations = [];
  h.request.mockReset();
  h.policy = {
    scope: "default",
    version: 1,
    values,
  };
  h.refetch.mockReset();
});

describe("UserAIPolicyDialog conflict recovery", () => {
  it("keeps retained policy data visible when refresh fails", () => {
    expect(resolvePolicyView(true, false, true)).toBe("data");
    expect(resolvePolicyView(false, false, true)).toBe("error");
    expect(resolvePolicyView(false, true, false)).toBe("loading");
  });

  it("adopts the refreshed version while preserving the current draft", async () => {
    const mutation = renderDialog();
    h.refetch.mockResolvedValue({
      data: { scope: "default", version: 2, values },
      error: null,
    });

    await mutation.onError(new ApiError(409, "版本冲突", null));

    expect(h.refs[1].current).toBe(2);
    expect(h.setters[5]).toHaveBeenCalledWith(true);
    expect(h.setters[6]).toHaveBeenLastCalledWith(
      "已载入最新版本，当前草稿仍保留；请再次保存。",
    );
    expect(h.setters[7]).toHaveBeenCalledWith("");
  });

  it("reports a failed refresh and keeps the stale version unchanged", async () => {
    const mutation = renderDialog();
    h.refetch.mockResolvedValue({
      data: undefined,
      error: new ApiError(503, "刷新失败，请稍后重试", null),
    });

    await mutation.onError(new ApiError(409, "版本冲突", null));

    expect(h.refs[1].current).toBe(0);
    expect(h.setters[5]).toHaveBeenCalledWith(true);
    expect(h.setters[6]).toHaveBeenLastCalledWith(
      "服务器上的额度版本刷新失败；当前草稿已保留。",
    );
    expect(h.setters[7]).toHaveBeenLastCalledWith("刷新失败，请稍后重试");
  });

  it("uses a version loaded by manual recovery for the next save", async () => {
    const mutation = renderDialog();
    h.refetch
      .mockResolvedValueOnce({
        data: undefined,
        error: new ApiError(503, "刷新失败，请稍后重试", null),
      })
      .mockResolvedValueOnce({
        data: { scope: "default", version: 3, values },
        error: null,
      });

    await mutation.onError(new ApiError(409, "版本冲突", null));
    expect(h.refs[1].current).toBe(0);
    await mutation.onError(new ApiError(409, "版本冲突", null));
    expect(h.refs[1].current).toBe(3);

    h.request.mockResolvedValue({ scope: "default", version: 4, values });
    await mutation.mutationFn("save");
    expect(JSON.parse(h.request.mock.calls[0][1].body).version).toBe(3);
  });
});
