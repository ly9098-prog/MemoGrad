"use client";

import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { useRef, type ReactNode } from "react";
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
    label: "每日 AI 用量",
    unit: "Token",
    hint: "按北京时间自然日统计普通用户 AI 用量",
  },
  {
    key: "monthly_token_limit",
    label: "每月 AI 用量",
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

const POLICY_GROUPS = [
  {
    title: "重新生成",
    description: "控制错题 AI 复盘的重新生成频率",
    fields: USER_AI_POLICY_FIELDS.slice(0, 3),
  },
  {
    title: "AI 总用量",
    description: "日、月用量按北京时间统计，涵盖普通用户 AI 请求",
    fields: USER_AI_POLICY_FIELDS.slice(3),
  },
];

function PolicyGroups({
  renderField,
}: {
  renderField: (field: (typeof USER_AI_POLICY_FIELDS)[number]) => ReactNode;
}) {
  return (
    <div className="space-y-8">
      {POLICY_GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3 className="text-sm font-semibold text-foreground">
            {group.title}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {group.description}
          </p>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {group.fields.map(renderField)}
          </div>
        </section>
      ))}
    </div>
  );
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
  const previousFinite = useRef<Partial<Record<UserAIPolicyField, string>>>({});
  return (
    <PolicyGroups
      renderField={(field) => (
        <div
          key={field.key}
          className="grid items-center gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_300px]"
        >
          <div>
            <p className="text-sm font-medium text-foreground">{field.label}</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              {field.hint}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <CustomSelect
              aria-label={`${field.label}默认配置方式`}
              value={values[field.key] === "-1" ? "unlimited" : "finite"}
              options={[
                { value: "finite", label: "限定额度" },
                { value: "unlimited", label: "不限" },
              ]}
              clearable={false}
              disabled={disabled}
              className="h-10 w-32 text-sm"
              onChange={(mode) => {
                if (mode === "unlimited") previousFinite.current[field.key] = values[field.key];
                onChange(field.key, mode === "unlimited" ? "-1" : previousFinite.current[field.key] ?? "1");
              }}
            />
            {values[field.key] !== "-1" ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  aria-label={`${field.label}（${field.unit}）`}
                  type="number"
                  min={1}
                  max={USER_AI_POLICY_FIELD_MAX[field.key]}
                  step={1}
                  value={values[field.key]}
                  disabled={disabled}
                  onChange={(event) => onChange(field.key, event.target.value)}
                  className="h-10 min-w-0 text-right tabular-nums"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {field.unit}
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">不设限制</span>
            )}
          </div>
        </div>
      )}
    />
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
    <PolicyGroups
      renderField={(field) => {
        const mode = modes[field.key];
        const preview =
          mode === "inherit"
            ? defaults[field.key]
            : mode === "unlimited"
              ? -1
              : Number(values[field.key]);
        const valid =
          Number.isInteger(preview) &&
          (preview === -1 ||
            (preview > 0 && preview <= USER_AI_POLICY_FIELD_MAX[field.key]));
        const changed = valid && preview !== effective[field.key];
        return (
          <div
            key={field.key}
            className="grid items-start gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_300px]"
          >
            <div>
              <p className="text-sm font-medium text-foreground">
                {field.label}
              </p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                {field.hint}
              </p>
              {mode !== "inherit" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  全局默认：{formatPolicyValue(defaults[field.key], field.unit)}
                </p>
              ) : null}
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <CustomSelect
                  aria-label={`${field.label}配置方式`}
                  value={mode}
                  disabled={disabled}
                  onChange={(value) =>
                    onModeChange(field.key, value as UserAIPolicyMode)
                  }
                  clearable={false}
                  options={[
                    { value: "inherit", label: "继承默认" },
                    { value: "finite", label: "自定义" },
                    { value: "unlimited", label: "不限" },
                  ]}
                  className="h-10 w-32 text-sm"
                />
                {mode === "finite" ? (
                  <Input
                    aria-label={`${field.label}自定义值`}
                    type="number"
                    min={1}
                    max={USER_AI_POLICY_FIELD_MAX[field.key]}
                    step={1}
                    value={values[field.key]}
                    disabled={disabled}
                    onChange={(event) =>
                      onValueChange(field.key, event.target.value)
                    }
                    className="h-10 min-w-0 flex-1 text-right tabular-nums"
                  />
                ) : null}
              </div>
              <p
                className={`text-sm tabular-nums ${valid ? "text-foreground" : "text-destructive"}`}
              >
                <span className="mr-2 text-xs text-muted-foreground">
                  {changed ? "保存后" : "生效额度"}
                </span>
                {valid
                  ? formatPolicyValue(preview, field.unit)
                  : "请输入有效数值"}
              </p>
            </div>
          </div>
        );
      }}
    />
  );
}
