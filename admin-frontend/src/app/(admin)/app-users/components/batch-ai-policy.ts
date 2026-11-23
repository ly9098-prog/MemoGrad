import { apiRequest } from "@/lib/api/client";
import type { UserAIPolicyDetail, UserAIPolicyValues } from "@/lib/api/types";

export type BatchPolicyAction = "update" | "unlimited" | "reset";

export async function loadBatchPolicies(userIds: number[]) {
  const result: UserAIPolicyDetail[] = [];
  for (let index = 0; index < userIds.length; index += 5) {
    result.push(
      ...(await Promise.all(
        userIds
          .slice(index, index + 5)
          .map((id) =>
            apiRequest<UserAIPolicyDetail>(`/app-users/${id}/ai-policy`),
          ),
      )),
    );
  }
  return result;
}

export function saveBatchPolicies(
  policies: UserAIPolicyDetail[],
  action: BatchPolicyAction,
  reason: string,
  values?: UserAIPolicyValues,
) {
  return apiRequest<UserAIPolicyDetail[]>("/app-users/ai-policy/batch", {
    method: "PATCH",
    body: JSON.stringify({
      targets: policies.map((policy) => ({
        user_id: policy.user_id,
        version: policy.version,
      })),
      action,
      reason: reason.trim(),
      ...(action === "update" ? { values } : {}),
    }),
  });
}
