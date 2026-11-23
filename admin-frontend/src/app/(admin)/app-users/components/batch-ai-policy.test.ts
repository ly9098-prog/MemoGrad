import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAIPolicyDetail } from "@/lib/api/types";
import { ApiError } from "@/lib/api/errors";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiRequest: request }));
import { loadBatchPolicies, saveBatchPolicies } from "./batch-ai-policy";

describe("batch AI policy transport", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("limits concurrent reads to five and preserves user versions", async () => {
    let active = 0;
    let maximum = 0;
    request.mockImplementation(async (url: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { user_id: Number(url.split("/")[2]), version: 3 };
    });
    const policies = await loadBatchPolicies(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(maximum).toBe(5);
    expect(policies.map((item) => item.user_id)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(policies.every((item) => item.version === 3)).toBe(true);
  });

  it("does not write if a required policy cannot be loaded", async () => {
    request.mockRejectedValue(new Error("网络错误"));
    await expect(loadBatchPolicies([1, 2])).rejects.toThrow("网络错误");
    expect(request.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it.each(["reset", "unlimited"] as const)(
    "uses one atomic request for %s without custom values",
    async (action) => {
      request.mockResolvedValue([]);
      await saveBatchPolicies(
        [
          { user_id: 1, version: 7 },
          { user_id: 2, version: 9 },
        ] as UserAIPolicyDetail[],
        action,
        "  审计说明  ",
      );
      expect(request).toHaveBeenCalledTimes(1);
      const [url, options] = request.mock.calls[0];
      expect(url).toBe("/app-users/ai-policy/batch");
      expect(options.method).toBe("PATCH");
      expect(JSON.parse(options.body)).toEqual({
        targets: [
          { user_id: 1, version: 7 },
          { user_id: 2, version: 9 },
        ],
        action,
        reason: "审计说明",
      });
    },
  );

  it("propagates a conflict without retrying stale writes", async () => {
    request.mockRejectedValue(new ApiError(409, "版本冲突", null));
    await expect(
      saveBatchPolicies(
        [{ user_id: 1, version: 2 }] as UserAIPolicyDetail[],
        "unlimited",
        "审计说明",
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
