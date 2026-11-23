"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Infinity as InfinityIcon, RotateCcw, Save, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/api/client";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import type {
  AppUser,
  UserAIPolicyDefault,
  UserAIPolicyDetail,
  UserAIPolicyValues,
} from "@/lib/api/types";
import {
  FinitePolicyFields,
  USER_AI_POLICY_FIELDS,
  UserPolicyRows,
  createPolicyForm,
  parsePolicyForm,
  policyFormIsValid,
  userPolicyFormIsValid,
  type UserAIPolicyField,
  type UserAIPolicyMode,
} from "./ai-policy-fields";

export type UserAIPolicyTarget =
  | { scope: "default" }
  | { scope: "user"; user: AppUser };

type DraftAction = "save" | "unlimited" | "reset";
type FormRecord = Record<UserAIPolicyField, string>;
const DEFAULT_REASON = "管理员调整普通用户 AI 额度";

const emptyValues: UserAIPolicyValues = {
  regeneration_cooldown_seconds: 60,
  regeneration_question_24h_limit: 3,
  regeneration_account_24h_limit: 20,
  daily_token_limit: 50000,
  monthly_token_limit: 500000,
  rpm_limit: 12,
};
const inheritModes = Object.fromEntries(
  USER_AI_POLICY_FIELDS.map(({ key }) => [key, "inherit"]),
) as Record<UserAIPolicyField, UserAIPolicyMode>;

function overrideForm(data: UserAIPolicyDetail) {
  const modes = { ...inheritModes };
  const values = createPolicyForm(data.defaults);
  for (const { key } of USER_AI_POLICY_FIELDS) {
    const current = data.overrides[key];
    if (current === -1) modes[key] = "unlimited";
    if (typeof current === "number" && current > 0) {
      modes[key] = "finite";
      values[key] = String(current);
    }
  }
  return { modes, values };
}

function draftSnapshot(
  values: FormRecord,
  modes: Record<UserAIPolicyField, UserAIPolicyMode>,
  reason: string,
) {
  return JSON.stringify({ values, modes, reason: reason.trim() });
}

export function UserAIPolicyDialog({
  target,
  open,
  onOpenChange,
}: {
  target: UserAIPolicyTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormRecord>(createPolicyForm(emptyValues));
  const [modes, setModes] = useState<Record<UserAIPolicyField, UserAIPolicyMode>>(
    inheritModes,
  );
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [pendingAction, setPendingAction] = useState<DraftAction | null>(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState("");
  const [conflictPending, setConflictPending] = useState(false);
  const [notice, setNotice] = useState("");
  const loadedVersion = useRef<string | null>(null);
  const remoteVersion = useRef(0);
  const draftDirty = useRef(false);
  const endpoint =
    target?.scope === "default"
      ? "/app-users/ai-policy"
      : target?.scope === "user"
        ? `/app-users/${target.user.id}/ai-policy`
        : "";
  const queryKey = [
    "app-users-ai-policy",
    target?.scope ?? "closed",
    target?.scope === "user" ? target.user.id : null,
  ];
  const policy = useQuery({
    queryKey,
    queryFn: () =>
      apiRequest<UserAIPolicyDefault | UserAIPolicyDetail>(endpoint),
    enabled: open && Boolean(target),
    staleTime: 15_000,
  });
  const targetUserId =
    target?.scope === "user" ? target.user.id : null;

  useEffect(() => {
    if (!open) {
      loadedVersion.current = null;
      draftDirty.current = false;
      return;
    }
    const data = policy.data;
    if (!data) return;
    const targetKey = targetUserId === null ? "default" : `user:${targetUserId}`;
    const marker = `${targetKey}:${data.version}:${JSON.stringify(data)}`;
    if (loadedVersion.current === marker) return;
    const hadLoadedPolicy = loadedVersion.current !== null;
    loadedVersion.current = marker;
    remoteVersion.current = data.version;
    if (hadLoadedPolicy && draftDirty.current) {
      setConflictPending(true);
      setNotice("服务器上的额度已更新，当前草稿已保留；请确认后再保存。");
      return;
    }
    if (data.scope === "default") {
      const nextValues = createPolicyForm(data.values);
      setValues(nextValues);
      setModes(inheritModes);
      setBaselineSnapshot(
        draftSnapshot(nextValues, inheritModes, DEFAULT_REASON),
      );
    } else {
      const draft = overrideForm(data);
      setValues(draft.values);
      setModes(draft.modes);
      setBaselineSnapshot(
        draftSnapshot(draft.values, draft.modes, DEFAULT_REASON),
      );
    }
    setReason(DEFAULT_REASON);
    draftDirty.current = false;
    setConflictPending(false);
  }, [open, policy.data, target?.scope, targetUserId]);

  const currentSnapshot = draftSnapshot(values, modes, reason);
  const hasChanges =
    Boolean(policy.data) &&
    (currentSnapshot !== baselineSnapshot || conflictPending);

  useEffect(() => {
    draftDirty.current = hasChanges;
  }, [hasChanges]);

  const mutation = useMutation({
    mutationFn: async (action: DraftAction) => {
      if (!policy.data) throw new Error("额度设置尚未加载");
      const common = {
        version: remoteVersion.current,
        reason: reason.trim(),
      };
      if (action === "unlimited" && target?.scope === "user") {
        return apiRequest<UserAIPolicyDetail>(`${endpoint}/unlimited`, {
          method: "PATCH",
          body: JSON.stringify(common),
        });
      }
      if (action === "reset" && target?.scope === "user") {
        return apiRequest<UserAIPolicyDetail>(endpoint, {
          method: "DELETE",
          body: JSON.stringify(common),
        });
      }
      const parsed = parsePolicyForm(values);
      if (target?.scope === "default") {
        return apiRequest<UserAIPolicyDefault>(endpoint, {
          method: "PATCH",
          body: JSON.stringify({ ...common, values: parsed }),
        });
      }
      const overrides = Object.fromEntries(
        USER_AI_POLICY_FIELDS.map(({ key }) => [
          key,
          modes[key] === "inherit"
            ? null
            : modes[key] === "unlimited"
              ? -1
              : Number(values[key]),
        ]),
      );
      return apiRequest<UserAIPolicyDetail>(endpoint, {
        method: "PATCH",
        body: JSON.stringify({ ...common, values: overrides }),
      });
    },
    onSuccess: (data) => {
      draftDirty.current = false;
      setBaselineSnapshot(currentSnapshot);
      setConflictPending(false);
      setNotice("额度设置已保存，新配置已作用于后续请求。");
      queryClient.setQueryData(queryKey, data);
      queryClient.invalidateQueries({ queryKey: ["app-users-ai-policy"] });
      setPendingAction(null);
    },
    onError: async (error) => {
      setPendingAction(null);
      setNotice("");
      if (error instanceof ApiError && error.status === 409) {
        setConflictPending(true);
        setNotice("额度已被其他管理员更新，正在刷新版本；当前草稿不会丢失。");
        await policy.refetch();
      }
    },
  });

  const valid =
    (target?.scope === "default"
      ? policyFormIsValid(values)
      : userPolicyFormIsValid(values, modes)) &&
    reason.trim().length >= 2 &&
    hasChanges;
  const title =
    target?.scope === "default"
      ? "普通用户 AI 默认额度"
      : `${target?.scope === "user" ? target.user.nickname || `用户 #${target.user.id}` : "用户"} · AI 额度`;
  const confirmCopy =
    pendingAction === "reset"
      ? "清除该用户的个人覆盖并恢复全局默认额度？既有用量不会被清空。"
      : pendingAction === "unlimited"
        ? "将该用户所有 AI 额度维度设为不限？权限会立即作用于后续请求，并写入审计日志。"
        : "确认保存当前 AI 额度配置？新配置会立即作用于后续请求。";

  const updateValue = (key: UserAIPolicyField, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const updateMode = (key: UserAIPolicyField, mode: UserAIPolicyMode) =>
    setModes((current) => ({ ...current, [key]: mode }));
  const handleOpenChange = (nextOpen: boolean) => {
    if (
      !nextOpen &&
      hasChanges &&
      !window.confirm("当前额度草稿尚未保存，确定关闭吗？")
    ) {
      return;
    }
    if (!nextOpen) {
      setPendingAction(null);
      setNotice("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0">
          <div className="shrink-0 border-b border-border/70 bg-secondary/30 px-6 py-5 pr-14">
            <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
            <DialogDescription className="mt-1 max-w-2xl text-xs leading-5">
              不限额度只解除业务配额，仍保留并发、幂等、队列去重、超时和模型可用性等运行保护。
            </DialogDescription>
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            {policy.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">
                正在读取额度策略…
              </p>
            ) : policy.isError ? (
              <div role="alert" className="rounded-xl border border-destructive/25 bg-destructive-light px-4 py-3 text-sm text-destructive">
                {getErrorMessage(policy.error)}
              </div>
            ) : policy.data ? (
              <div className="space-y-4">
                {policy.data.scope === "default" ? (
                  <FinitePolicyFields
                    values={values}
                    onChange={updateValue}
                    disabled={mutation.isPending}
                  />
                ) : (
                  <UserPolicyRows
                    values={values}
                    defaults={policy.data.defaults}
                    effective={policy.data.effective}
                    modes={modes}
                    onModeChange={updateMode}
                    onValueChange={updateValue}
                    disabled={mutation.isPending}
                  />
                )}
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    变更说明
                  </span>
                  <Textarea
                    value={reason}
                    maxLength={256}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={mutation.isPending}
                  />
                </label>
                <p className="flex items-start gap-2 rounded-xl border border-border/70 bg-secondary/30 px-3.5 py-3 text-[11px] leading-5 text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  值为 -1 表示该维度不限。全局默认只影响继承项，不会覆盖已经设置的个人配置。
                </p>
                {notice ? (
                  <p
                    role={mutation.isError ? "alert" : "status"}
                    className={
                      mutation.isError
                        ? "text-xs text-destructive"
                        : "rounded-lg border border-success/25 bg-success/5 px-3 py-2 text-xs text-success"
                    }
                  >
                    {notice}
                  </p>
                ) : null}
                {mutation.isError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {getErrorMessage(mutation.error)}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-card/95 px-6 py-4">
            {target?.scope === "user" ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={
                    !policy.data ||
                    mutation.isPending ||
                    reason.trim().length < 2
                  }
                  onClick={() => setPendingAction("reset")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  恢复默认
                </Button>
                <Button
                  variant="dangerOutline"
                  size="sm"
                  disabled={
                    !policy.data ||
                    mutation.isPending ||
                    reason.trim().length < 2
                  }
                  onClick={() => setPendingAction("unlimited")}
                >
                  <InfinityIcon className="h-3.5 w-3.5" />
                  设为无限
                </Button>
              </>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              disabled={!valid || !policy.data || mutation.isPending}
              onClick={() => setPendingAction("save")}
            >
              <Save className="h-3.5 w-3.5" />
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pendingAction !== null}
        title="确认额度变更"
        description={confirmCopy}
        confirmText={pendingAction === "reset" ? "恢复默认" : pendingAction === "unlimited" ? "确认不限" : "确认保存"}
        danger={pendingAction === "unlimited"}
        loading={mutation.isPending}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => pendingAction && mutation.mutate(pendingAction)}
      />
    </>
  );
}
