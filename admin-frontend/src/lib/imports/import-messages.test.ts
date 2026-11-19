import { describe, expect, it } from "vitest";
import { formatImportIssue, importErrorMessage } from "./import-messages";

describe("import recovery messages", () => {
  it.each([
    ["multi_blank_choice_missing_answer", "多空选择题缺少答案，请补充每个空的答案"],
    ["answer_missing_slots: 1,3", "缺少空位 1,3 的答案"],
    ["group_2_has_empty_id", "第 3 个选项组缺少空位编号"],
    ["answer_2=C_not_in_group_options_['A', 'B']", "空位 2 的答案不在对应选项中"],
    ["missing_option_b", "缺少 B 选项"],
    ["题干不能为空", "题干不能为空"],
  ])("explains %s without leaking the machine code", (code, expected) => {
    expect(formatImportIssue(code)).toBe(expected);
  });

  it("handles an empty httpx timeout detail without claiming the server stopped", () => {
    const message = importErrorMessage(new Error("OCR 后端调用失败: ocr.remote_timeout: All retries exhausted:"));
    expect(message).toContain("响应超时");
    expect(message).toContain("重试");
    expect(message).not.toContain("ocr.remote_timeout");
    expect(message).not.toContain("未启动");
  });

  it("keeps meaningful validation copy and gives unknown codes a Chinese fallback", () => {
    expect(importErrorMessage(new Error("第 3 行：缺少科目"))).toBe("第 3 行：缺少科目");
    expect(formatImportIssue("future_validation_code")).not.toContain("future_validation_code");
    expect(importErrorMessage({ status: 409, message: "conflict" })).toContain("任务状态已变化");
    expect(importErrorMessage(undefined)).toContain("请重试");
  });

  it("guides expired recovery and a mismatched source instead of repeating a refresh", () => {
    expect(importErrorMessage({ status: 409, payload: { code: "IMPORT_RECOVERY_CONTEXT_EXPIRED" } })).toContain("新建导入");
    expect(importErrorMessage({ status: 400, payload: { code: "IMPORT_SOURCE_MISMATCH" } })).toContain("重新选择原文件");
    expect(importErrorMessage("ocr.remote_timeout")).not.toContain("已保留");
  });
});
