const ISSUE_LABELS: Record<string, string> = {
  stem_empty: "题干为空，请补充题干",
  missing_stem: "缺少题干，请补充题干",
  answer_empty: "答案为空，请补充答案",
  answer_missing: "缺少答案，请补充答案",
  missing_answer: "缺少答案，请补充答案",
  options_empty: "未识别到选项，请补充选项",
  options_too_few: "选项数量不足，请检查选项",
  missing_options: "缺少选项，请补充选项",
  subject_empty: "未指定科目，可在审核时补充",
  subject_unspecified: "未指定科目，可在审核时补充",
  question_type_unknown: "无法识别题型，请手动选择题型",
  unsupported_question_type: "暂不支持该题型，请检查题型",
  missing_blank_option_groups: "缺少各空的选项组，请检查原文",
  multi_blank_choice_requires_at_least_2_blanks: "多空选择题至少需要两个空位",
  multi_blank_choice_missing_answer: "多空选择题缺少答案，请补充每个空的答案",
  multi_blank_choice_empty_answer_after_parse: "未能识别各空答案，请按空位编号补充答案",
  multi_blank_choice_unparseable_answer: "各空答案格式无法识别，请检查空位编号和选项",
  empty_answer: "答案为空，请补充答案",
  unparseable_answer: "答案格式无法识别，请检查答案",
};

/** User-facing text only; machine codes stay in diagnostics rather than primary copy. */
export function formatImportIssue(value: string): string {
  const text = value.trim();
  if (ISSUE_LABELS[text]) return ISSUE_LABELS[text];
  const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
    [/^missing_option_([A-H])$/i, (key) => `缺少 ${key.toUpperCase()} 选项`],
    [/^answer_missing_slots:\s*(.+)$/, (slots) => `缺少空位 ${slots} 的答案`],
    [/^answer_extra_slots:\s*(.+)$/, (slots) => `答案包含多余的空位 ${slots}`],
    [/^group_(\d+)_has_empty_id$/, (index) => `第 ${Number(index) + 1} 个选项组缺少空位编号`],
    [/^duplicate_group_id_(.+)$/, (id) => `空位编号 ${id} 重复，请检查选项组`],
    [/^group_(.+)_has_less_than_2_options$/, (id) => `空位 ${id} 的选项不足两个`],
    [/^group_(.+)_duplicate_option_key_(.+)$/, (id, key) => `空位 ${id} 的 ${key} 选项编号重复`],
    [/^answer_(.+?)=.+_not_in_group_options_.+$/, (id) => `空位 ${id} 的答案不在对应选项中`],
    [/^invalid_value_for_slot_(.+?):.*$/, (id) => `空位 ${id} 的答案格式不正确`],
    [/^invalid_answer_type:.*$/, () => "答案类型不正确，请检查答案格式"],
  ];
  for (const [pattern, describe] of patterns) {
    const match = text.match(pattern);
    if (match) return describe(...match.slice(1));
  }
  if (/[\u3400-\u9fff]/.test(text) && !/Traceback|RuntimeError/.test(text)) return text;
  return "题目结构未通过校验，请检查题干、选项和答案";
}

export function importErrorMessage(value: unknown): string {
  const error = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const message = typeof value === "string" ? value : value instanceof Error ? value.message : typeof error?.message === "string" ? error.message : "";
  const metadata = error?.payload && typeof error.payload === "object" ? error.payload as Record<string, unknown> : null;
  const code = typeof error?.code === "string" ? error.code : typeof metadata?.code === "string" ? metadata.code : "";
  const text = `${code} ${message}`;
  if (/IMPORT_RECOVERY_CONTEXT_EXPIRED|原任务设置已过期/.test(text)) {
    return "原任务的导入设置已过期，请新建导入并重新选择文件和设置。";
  }
  if (/IMPORT_SOURCE_MISMATCH|文件与原始导入文件不一致/.test(text)) {
    return "所选文件与原导入文件不一致，请重新选择原文件。";
  }
  if (/ocr\.remote_timeout|ReadTimeout|ConnectTimeout|All retries exhausted|deadline.*exceed/i.test(text)) {
    return "OCR 服务响应超时，请稍后重试，或重新上传原文件。";
  }
  if (/ocr\.remote_(unavailable|connection)|ConnectError|ECONNREFUSED|connection refused/i.test(text)) {
    return "暂时无法连接 OCR 服务，请确认服务可用后重试。";
  }
  if (/ocr\.(remote_)?(auth|unauthorized)|invalid.*api.?key/i.test(text)) {
    return "OCR 服务认证失败，请检查识别服务配置后重试。";
  }
  if (/ocr\.(remote_)?(invalid_response|parse_error|empty_result)/i.test(text)) {
    return "识别服务未返回有效内容，请检查图片清晰度或更换文件重试。";
  }
  if (/ocr\.(circuit_open|remote_circuit_open|rate_limited)|circuit breaker/i.test(text)) {
    return "识别服务暂时繁忙，请稍后手动重试。";
  }
  const status = Number(error?.status ?? error?.statusCode);
  if (status === 403) return "没有执行此操作的权限，请联系管理员。";
  if (status === 404) return "导入记录不存在或已失效，请返回导入历史刷新。";
  if (status === 409) return "任务状态已变化，请刷新进度后再操作。";
  if (status === 413) return "文件过大，请缩小文件或分批上传。";
  if (status === 429) return "请求过于频繁，请稍后重试。";
  if (status >= 500) return "导入服务暂时不可用，请稍后重试。";
  if (/failed to fetch|networkerror|network request failed/i.test(text)) return "网络连接中断，请检查网络后重试。";
  if (/[\u3400-\u9fff]/.test(message) && !/Traceback|RuntimeError|All retries exhausted/.test(message)) return message;
  if (/^[a-z][a-z_]+(?::.*)?$/i.test(message.trim())) return formatImportIssue(message);
  return "导入处理未完成，请重试。";
}
