import { describe, expect, it } from "vitest";
import {
  USER_AI_POLICY_FIELDS,
  createPolicyForm,
  formatPolicyValue,
  parsePolicyForm,
  policyFormIsValid,
  userPolicyFormIsValid,
} from "./ai-policy-fields";

const values = {
  regeneration_cooldown_seconds: 60,
  regeneration_question_24h_limit: 3,
  regeneration_account_24h_limit: 20,
  daily_token_limit: 50000,
  monthly_token_limit: 500000,
  rpm_limit: 12,
};

describe("ordinary user AI policy fields", () => {
  it("round-trips every backend policy field", () => {
    expect(USER_AI_POLICY_FIELDS).toHaveLength(6);
    expect(USER_AI_POLICY_FIELDS.map(({ key }) => key)).toEqual([
      "regeneration_cooldown_seconds",
      "regeneration_question_24h_limit",
      "regeneration_account_24h_limit",
      "daily_token_limit",
      "monthly_token_limit",
      "rpm_limit",
    ]);
    expect(parsePolicyForm(createPolicyForm(values))).toEqual(values);
  });

  it.each([
    [{ ...values }, true],
    [{ ...values, rpm_limit: -1 }, true],
    [{ ...values, rpm_limit: 0 }, false],
    [{ ...values, rpm_limit: 1.5 }, false],
    [{ ...values, rpm_limit: Number.NaN }, false],
    [{ ...values, rpm_limit: 100_001 }, false],
  ])("validates finite and unlimited policy values (%#)", (candidate, valid) => {
    const form = Object.fromEntries(
      USER_AI_POLICY_FIELDS.map(({ key }) => [key, String(candidate[key])]),
    ) as Parameters<typeof policyFormIsValid>[0];
    expect(policyFormIsValid(form)).toBe(valid);
  });

  it("renders unlimited without converting it into a huge finite limit", () => {
    expect(formatPolicyValue(-1, "次")).toBe("不限");
    expect(formatPolicyValue(3, "次")).toContain("3");
  });

  it("validates only finite per-user fields and ignores inherited drafts", () => {
    const form = createPolicyForm(values);
    form.rpm_limit = "not-a-number";
    const modes = Object.fromEntries(
      USER_AI_POLICY_FIELDS.map(({ key }) => [key, "inherit"]),
    ) as Parameters<typeof userPolicyFormIsValid>[1];
    expect(userPolicyFormIsValid(form, modes)).toBe(true);
    modes.rpm_limit = "finite";
    expect(userPolicyFormIsValid(form, modes)).toBe(false);
    modes.rpm_limit = "unlimited";
    expect(userPolicyFormIsValid(form, modes)).toBe(true);
  });
});
