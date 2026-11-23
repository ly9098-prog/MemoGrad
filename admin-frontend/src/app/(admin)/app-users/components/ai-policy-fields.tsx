"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { UserAIPolicyValues } from "@/lib/api/types";

export type UserAIPolicyField = keyof UserAIPolicyValues;
export type UserAIPolicyMode = "inherit" | "finite" | "unlimited";

export const USER_AI_POLICY_FIELD_MAX: Record<UserAIPolicyField, number> = {
  regeneration_cooldown_seconds: 86_400,
  regeneration_question_24h_limit: 1_000,
  regeneration_account_24h_limit: 1_000,
  daily_token_limit: 2_147_483_647,
  monthly_token_limit: 2_147_483_647,
  rpm_limit: 100_000,
};

export const USER_AI_POLICY_FIELDS: Array<{
  key: UserAIPolicyField;
  label: string;
  unit: string;
  hint: string;
}> = [
  {
    key: "regeneration_cooldown_seconds",
    label: "重新生成冷却",
    unit: "秒",
    hint: "同一账号两次重新生成之间的最短间隔",
  },
  {
    key: "regeneration_question_24h_limit",
    label: "单题 24 小时次数",
    unit: "次",
    hint: "按稳定题目 ID 统计，删除并重新加入错题不会清零",
  },
  {
    key: "regeneration_account_24h_limit",
    label: "账号 24 小时次数",
    unit: "次",
    hint: "账号内所有错题复盘重新生成共用",
  },
  {
    key: "daily_token_limit",
    label: "每日 Token",
    unit: "Token",
    hint: "按北京时间自然日统计普通用户 AI 用量",
  },
  {
    key: "monthly_token_limit",
    label: "每月 Token",
    unit: "Token",
    hint: "按北京时间自然月统计普通用户 AI 用量",
  },
  {
    key: "rpm_limit",
    label: "通用请求频率",
    unit: "次/分钟",
    hint: "普通用户在所有 AI 能力上的通用分钟频率",
  },
];

export function formatPolicyValue(value: number, unit: string): string {
  if (value === -1) return "不限";
  return `${value.toLocaleString("zh-CN")} ${unit}`;
}

export function createPolicyForm(values: UserAIPolicyValues) {
  return Object.fromEntries(
    USER_AI_POLICY_FIELDS.map(({ key }) => [key, String(values[key])]),
  ) as Record<UserAIPolicyField, string>;
}

export function parsePolicyForm(form: Record<UserAIPolicyField, string>) {
  return Object.fromEntries(
    USER_AI_POLICY_FIELDS.map(({ key }) => {
      const raw = form[key].trim();
      return [key, raw === "" ? Number.NaN : Number(raw)];
    }),
  ) as UserAIPolicyValues;
}

export function policyFormIsValid(form: Record<UserAIPolicyField, string>) {
  return USER_AI_POLICY_FIELDS.every(({ key }) => {
    const value = Number(form[key]);
    return (
      form[key].trim() !== "" &&
      Number.isInteger(value) &&
      (value === -1 || (value > 0 && value <= USER_AI_POLICY_FIELD_MAX[key]))
    );
  });
}

export function userPolicyFormIsValid(
  form: Record<UserAIPolicyField, string>,
  modes: Record<UserAIPolicyField, UserAIPolicyMode>,
) {
  return USER_AI_POLICY_FIELDS.every(({ key }) => {
    if (modes[key] !== "finite") return true;
    const value = Number(form[key]);
    return (
      form[key].trim() !== "" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= USER_AI_POLICY_FIELD_MAX[key]
    );
  });
}

export function FinitePolicyFields({
  values,
  onChange,
  disabled,
}: {
  values: Record<UserAIPolicyField, string>;
  onChange: (key: UserAIPolicyField, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {USER_AI_POLICY_FIELDS.map((field) => (
        <label
          key={field.key}
          className="rounded-xl border border-border/70 bg-card/70 p-3"
        >
          <span className="text-xs font-semibold text-foreground">{field.label}</span>
          <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">
            {field.hint}
          </span>
          <span className="mt-2 flex items-center gap-2">
            <Input
              aria-label={`${field.label}（${field.unit}）`}
              type="number"
              min={-1}
              max={USER_AI_POLICY_FIELD_MAX[field.key]}
              step={1}
              value={values[field.key]}
              disabled={disabled}
              onChange={(event) => onChange(field.key, event.target.value)}
              className="h-9 bg-background/70 tabular-nums"
            />
            <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
              {field.unit}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function UserPolicyRows({
  values,
  defaults,
  effective,
  modes,
  onModeChange,
  onValueChange,
  disabled,
}: {
  values: Record<UserAIPolicyField, string>;
  defaults: UserAIPolicyValues;
  effective: UserAIPolicyValues;
  modes: Record<UserAIPolicyField, UserAIPolicyMode>;
  onModeChange: (key: UserAIPolicyField, mode: UserAIPolicyMode) => void;
  onValueChange: (key: UserAIPolicyField, value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card/60">
      {USER_AI_POLICY_FIELDS.map((field) => {
        const mode = modes[field.key];
        const previewValue =
          mode === "inherit"
            ? defaults[field.key]
            : mode === "unlimited"
              ? -1
              : Number(values[field.key]);
        const sourceLabel =
          mode === "inherit"
            ? "继承默认"
            : mode === "unlimited"
              ? "个人不限"
              : "个人覆盖";
        return (
          <div key={field.key} className="grid gap-3 p-3.5 sm:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {field.label}
                </span>
                <span className="rounded-full border border-border bg-secondary/55 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {sourceLabel}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {field.hint}
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground/80">
                默认 {formatPolicyValue(defaults[field.key], field.unit)}
                <span className="mx-2 text-border">·</span>
                保存后生效{" "}
                {formatPolicyValue(
                  Number.isInteger(previewValue)
                    ? previewValue
                    : effective[field.key],
                  field.unit,
                )}
              </p>
            </div>
            <div className="flex min-w-[210px] items-center justify-end gap-2">
              <select
                aria-label={`${field.label}配置方式`}
                value={mode}
                disabled={disabled}
                onChange={(event) =>
                  onModeChange(field.key, event.target.value as UserAIPolicyMode)
                }
                className="h-9 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-3 focus:ring-ring/15 disabled:opacity-50"
              >
                <option value="inherit">继承默认</option>
                <option value="finite">自定义</option>
                <option value="unlimited">不限</option>
              </select>
              <Input
                aria-label={`${field.label}自定义值`}
                type="number"
                min={1}
                max={USER_AI_POLICY_FIELD_MAX[field.key]}
                step={1}
                value={values[field.key]}
                disabled={disabled || mode !== "finite"}
                onChange={(event) => onValueChange(field.key, event.target.value)}
                className={cn(
                  "h-9 w-28 bg-background/70 text-right tabular-nums",
                  mode !== "finite" && "text-muted-foreground",
                )}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
