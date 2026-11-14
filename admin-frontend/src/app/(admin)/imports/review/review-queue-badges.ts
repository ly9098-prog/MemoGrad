import type { ImportQuestionItem } from "@/lib/api/types";

type BadgeStyle = { color?: string; fontWeight?: number };
type TableBadgeItem = Pick<ImportQuestionItem, "answer_status" | "risk_level">;
type ListBadgeItem = TableBadgeItem & Pick<ImportQuestionItem,
  "parsed_answer" | "risk_reasons" | "source_image_seq" | "source_question_no">;

export function getReviewTableBadges(item: TableBadgeItem) {
  const answerStatusLabel =
    item.answer_status === "missing" ? "缺失" :
    item.answer_status === "ai_filled" ? "AI" :
    item.answer_status === "imported" ? "导入" :
    item.answer_status === "manual_filled" ? "已填" :
    item.answer_status === "manual_verified" ? "已验" :
    item.answer_status === "abnormal" ? "异常" : "—";
  const answerStatusStyle: BadgeStyle =
    item.answer_status === "missing" ? { color: "var(--destructive)", fontWeight: 700 } :
    item.answer_status === "ai_filled" ? { color: "var(--warning-foreground)", fontWeight: 600 } :
    item.answer_status === "abnormal" ? { color: "var(--destructive)", fontWeight: 700 } :
    {};
  const riskLabel = item.risk_level === "high" ? "高" : item.risk_level === "medium" ? "中" : "低";
  const riskStyle: BadgeStyle =
    item.risk_level === "high" ? { color: "var(--destructive)", fontWeight: 700 } :
    item.risk_level === "medium" ? { color: "var(--warning-foreground)", fontWeight: 600 } :
    { color: "var(--success)" };
  return { answerStatusLabel, answerStatusStyle, riskLabel, riskStyle };
}

export function getReviewListBadges(item: ListBadgeItem) {
  const riskColor = item.risk_level === "high" ? "var(--destructive)" : item.risk_level === "medium" ? "var(--warning-foreground)" : item.risk_level === "low" ? "var(--success)" : "var(--border)";
  const hasAnswerMissing = (!item.parsed_answer || item.parsed_answer.trim() === "") && item.risk_level !== "low";
  const reasonCount = item.risk_reasons?.length ?? 0;
  const sourceLabel = item.source_image_seq != null
    ? `图${item.source_image_seq}${item.source_question_no ? ` · 原题${item.source_question_no}` : ""}`
    : (item.source_question_no ? `原题${item.source_question_no}` : null);
  const answerStatusLabel =
    item.answer_status === "missing" ? "答案缺失" :
    item.answer_status === "ai_filled" ? "AI补全" :
    item.answer_status === "imported" ? "已导入" :
    item.answer_status === "manual_filled" ? "已填写" :
    item.answer_status === "manual_verified" ? "已验证" :
    item.answer_status === "abnormal" ? "答案异常" : null;
  const answerStatusColor =
    item.answer_status === "missing" ? "var(--destructive)" :
    item.answer_status === "ai_filled" ? "var(--warning-foreground)" :
    item.answer_status === "abnormal" ? "var(--destructive)" :
    "var(--muted-foreground)";
  return { riskColor, hasAnswerMissing, reasonCount, sourceLabel, answerStatusLabel, answerStatusColor };
}
