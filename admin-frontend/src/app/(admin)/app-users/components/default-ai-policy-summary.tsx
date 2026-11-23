"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/errors";
import type { UserAIPolicyDefault } from "@/lib/api/types";
import { USER_AI_POLICY_FIELDS, formatPolicyValue } from "./ai-policy-fields";

export function DefaultAIPolicySummary({ onEdit }: { onEdit: () => void }) {
  const policy = useQuery({
    queryKey: ["app-users-ai-policy", "default", null],
    queryFn: () => apiRequest<UserAIPolicyDefault>("/app-users/ai-policy"),
    staleTime: 15_000,
  });
  return (
    <section
      aria-label="普通用户 AI 默认额度"
      className="border-y border-border/70 py-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">普通用户 AI 默认额度</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            新用户和选择“继承默认”的额度项共用此配置；个人覆盖保持独立
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          设置默认额度
        </Button>
      </div>
      {policy.isLoading ? (
        <p role="status" className="mt-4 text-xs text-muted-foreground">
          正在读取默认额度…
        </p>
      ) : null}
      {policy.isError ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 text-xs text-destructive"
        >
          {getErrorMessage(policy.error)}
          <Button
            size="sm"
            variant="ghost"
            disabled={policy.isFetching}
            onClick={() => void policy.refetch()}
          >
            重试
          </Button>
        </div>
      ) : null}
      {policy.data ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          {USER_AI_POLICY_FIELDS.map(({ key, label, unit }) => (
            <div key={key}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-sm font-medium tabular-nums">
                {formatPolicyValue(policy.data.values[key], unit)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
