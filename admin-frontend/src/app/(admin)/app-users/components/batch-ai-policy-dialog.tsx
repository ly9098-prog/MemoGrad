"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, getErrorMessage } from "@/lib/api/errors";
import {
  FinitePolicyFields,
  createPolicyForm,
  parsePolicyForm,
  policyFormIsValid,
} from "./ai-policy-fields";
import {
  loadBatchPolicies,
  saveBatchPolicies,
  type BatchPolicyAction,
} from "./batch-ai-policy";

export function BatchAIPolicyDialog({
  userIds,
  onClose,
}: {
  userIds: number[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<BatchPolicyAction>("update");
  const [draft, setDraft] = useState<ReturnType<
    typeof createPolicyForm
  > | null>(null);
  const [reason, setReason] = useState("管理员批量调整普通用户 AI 额度");
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const policies = useQuery({
    queryKey: ["app-users-ai-policy-batch", userIds],
    queryFn: () => loadBatchPolicies(userIds),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const values =
    draft ??
    (policies.data?.[0] ? createPolicyForm(policies.data[0].defaults) : null);
  const mutation = useMutation({
    mutationFn: () => {
      if (!policies.data || !values)
        throw new Error("请先读取全部用户的额度版本");
      return saveBatchPolicies(
        policies.data,
        action,
        reason,
        parsePolicyForm(values),
      );
    },
    onSuccess: () => {
      setConfirm(false);
      setSaved(true);
      setError("");
      void queryClient.invalidateQueries({ queryKey: ["app-users-ai-policy"] });
    },
    onError: (err) => {
      setConfirm(false);
      setError(getErrorMessage(err));
      setConflict(err instanceof ApiError && err.status === 409);
    },
  });
  const close = () => {
    if (mutation.isPending) return;
    if (
      !saved &&
      (draft || action !== "update") &&
      !window.confirm("当前批量额度草稿尚未保存，确定关闭吗？")
    )
      return;
    onClose();
  };
  const refresh = async () => {
    const latest = await policies.refetch();
    if (latest.error) {
      setError(getErrorMessage(latest.error));
      return;
    }
    setConflict(false);
    setError("");
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden p-0">
          <div className="shrink-0 border-b border-border px-6 py-5 pr-14">
            <DialogTitle>
              批量管理 AI 额度 · {userIds.length} 位用户
            </DialogTitle>
            <DialogDescription className="mt-2 text-xs leading-5">
              仅修改本次选择的用户，不改变全局默认。任一用户版本冲突时，整批不保存，已有用量保留。
            </DialogDescription>
          </div>
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            {saved ? (
              <p role="status" className="text-sm text-success">
                已为 {userIds.length} 位用户保存额度设置
              </p>
            ) : (
              <>
                <p className="break-words text-xs leading-5 text-muted-foreground">
                  选中用户：{userIds.map((id) => `#${id}`).join("、")}
                </p>
                <CustomSelect
                  aria-label="批量额度操作"
                  value={action}
                  onChange={(value) => setAction(value as BatchPolicyAction)}
                  options={[
                    { value: "update", label: "设置统一自定义额度" },
                    { value: "unlimited", label: "全部设为不限" },
                    { value: "reset", label: "恢复继承默认" },
                  ]}
                  clearable={false}
                  disabled={mutation.isPending}
                  className="h-10 w-full sm:w-60"
                />
                {policies.isLoading ? (
                  <p role="status">正在读取所选用户额度…</p>
                ) : null}
                {policies.isError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {getErrorMessage(policies.error)}
                  </p>
                ) : null}
                {action === "update" && values ? (
                  <>
                    <p className="text-xs leading-5 text-muted-foreground">
                      以下数值初始取自全局默认。保存后，六项额度将全部成为所选用户的个人覆盖；未来修改默认值不会改变这些覆盖。
                    </p>
                    <FinitePolicyFields
                      values={values}
                      disabled={mutation.isPending}
                      onChange={(key, value) =>
                        setDraft({ ...values, [key]: value })
                      }
                    />
                  </>
                ) : null}
                {action === "unlimited" ? (
                  <p className="text-sm leading-6">
                    解除所选用户全部六项业务额度限制。并发、超时和队列保护仍保留。
                  </p>
                ) : null}
                {action === "reset" ? (
                  <p className="text-sm leading-6">
                    清除所选用户的全部个人覆盖，恢复继承全局默认。历史用量不会清空。
                  </p>
                ) : null}
                <label className="block text-xs font-medium">
                  变更说明
                  <Textarea
                    className="mt-2"
                    value={reason}
                    maxLength={256}
                    disabled={mutation.isPending}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border px-6 py-4">
            {!saved && (policies.isError || conflict) ? (
              <Button
                variant="secondary"
                disabled={policies.isFetching || mutation.isPending}
                onClick={() => void refresh()}
              >
                重新读取版本
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={mutation.isPending}
              onClick={close}
            >
              {saved ? "完成" : "取消"}
            </Button>
            {!saved ? (
              <Button
                disabled={
                  !values ||
                  policies.isError ||
                  policies.isFetching ||
                  conflict ||
                  mutation.isPending ||
                  reason.trim().length < 2 ||
                  (action === "update" && !policyFormIsValid(values))
                }
                onClick={() => setConfirm(true)}
              >
                预览并确认
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirm}
        title={`确认修改 ${userIds.length} 位用户的额度`}
        description={
          action === "unlimited"
            ? "所有额度维度将设为不限，并逐用户写入审计日志。"
            : action === "reset"
              ? "全部个人覆盖将清除，恢复继承默认，并逐用户写入审计日志。"
              : "所选用户的六项个人额度将统一替换为当前表单数值，并逐用户写入审计日志。"
        }
        confirmText="确认批量保存"
        danger={action === "unlimited"}
        loading={mutation.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => mutation.mutate()}
      />
    </>
  );
}
