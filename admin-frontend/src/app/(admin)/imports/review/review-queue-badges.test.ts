import { describe, expect, it } from "vitest";
import type { ImportQuestionItem } from "@/lib/api/types";
import { getReviewListBadges, getReviewTableBadges } from "./review-queue-badges";

function table(item: Partial<ImportQuestionItem>) {
  return getReviewTableBadges({ risk_level: "", ...item });
}
function list(item: Partial<ImportQuestionItem>) {
  return getReviewListBadges({ risk_level: "", risk_reasons: [], ...item });
}

describe("review queue badges", () => {
  it.each([
    ["missing", "缺失", "答案缺失", "var(--destructive)", 700],
    ["ai_filled", "AI", "AI补全", "var(--warning-foreground)", 600],
    ["imported", "导入", "已导入", null, null],
    ["manual_filled", "已填", "已填写", null, null],
    ["manual_verified", "已验", "已验证", null, null],
    ["abnormal", "异常", "答案异常", "var(--destructive)", 700],
  ])("retains both labels and emphasis for %s", (status, short, full, color, weight) => {
    const item = { answer_status: status as string };
    expect(table(item).answerStatusLabel).toBe(short);
    expect(table(item).answerStatusStyle).toEqual(color ? { color, fontWeight: weight } : {});
    expect(list(item).answerStatusLabel).toBe(full);
    expect(list(item).answerStatusColor).toBe(color ?? "var(--muted-foreground)");
  });

  it.each([undefined, null, "", "unknown", "MISSING", " missing ", "__proto__", "constructor"])(
    "does not normalize or recognize an unknown answer status: %s", (status) => {
      expect(table({ answer_status: status }).answerStatusLabel).toBe("—");
      expect(table({ answer_status: status }).answerStatusStyle).toEqual({});
      expect(list({ answer_status: status }).answerStatusLabel).toBeNull();
      expect(list({ answer_status: status }).answerStatusColor).toBe("var(--muted-foreground)");
    },
  );

  it.each([
    ["high", "高", "var(--destructive)", 700, "var(--destructive)"],
    ["medium", "中", "var(--warning-foreground)", 600, "var(--warning-foreground)"],
    ["low", "低", "var(--success)", undefined, "var(--success)"],
    ["unknown", "低", "var(--success)", undefined, "var(--border)"],
    ["HIGH", "低", "var(--success)", undefined, "var(--border)"],
    ["", "低", "var(--success)", undefined, "var(--border)"],
  ])("keeps table and list risk fallbacks distinct: %s", (risk, label, color, weight, dot) => {
    expect(table({ risk_level: risk as string }).riskLabel).toBe(label);
    expect(table({ risk_level: risk as string }).riskStyle).toEqual(
      weight ? { color, fontWeight: weight } : { color },
    );
    expect(list({ risk_level: risk as string }).riskColor).toBe(dot);
  });

  it("keeps missing-answer detection independent of status and AI badges", () => {
    for (const answer of [undefined, null, "", " \t\n"]) {
      expect(list({ parsed_answer: answer, risk_level: "high" }).hasAnswerMissing).toBe(true);
      expect(list({ parsed_answer: answer, risk_level: "low" }).hasAnswerMissing).toBe(false);
    }
    expect(list({ parsed_answer: " A ", risk_level: "high" }).hasAnswerMissing).toBe(false);
    expect(list({ parsed_answer: "", answer_status: "imported", ai_answer_flag: true })
      .hasAnswerMissing).toBe(true);
    expect(list({ risk_reasons: ["one", "two"] }).reasonCount).toBe(2);
    expect(list({}).reasonCount).toBe(0);
  });

  it("uses only explicit source fields, retaining zero image numbers and whitespace", () => {
    expect(list({ source_image_seq: 0, source_question_no: "0" }).sourceLabel).toBe("图0 · 原题0");
    expect(list({ source_image_seq: 2, source_question_no: "" }).sourceLabel).toBe("图2");
    expect(list({ source_question_no: " " }).sourceLabel).toBe("原题 ");
    expect(list({ source_question_no: "8" }).sourceLabel).toBe("原题8");
    expect(list({ source_image_seq: null, raw_text_preview: "9. raw",
      raw_data: { source_image_seq: 3 }, source_question_label: "第10题" }).sourceLabel).toBeNull();
  });
});
