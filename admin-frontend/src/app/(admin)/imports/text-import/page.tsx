"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Edit3,
  Eye,
  FileText,
  Info,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { CustomSelect } from "@/components/ui/custom-select";
import { MathFormula } from "@/components/ui/math-formula";
import { QuestionContentRenderer } from "@/components/question-content-renderer";
import { apiRequest } from "@/lib/api/client";
import {
  canonicalizeQuestionType,
  formatUnknownType,
  getQuestionTypeLabel,
  QUESTION_TYPE_OPTIONS,
} from "@/lib/question-types";
import { inspectLatexImportText, normalizeLatexImportDelimiters } from "@/lib/latex-import";
import { buildEditFormLatexText, validateEditStructure } from "@/lib/text-import-validation-utils";
import { formatImportIssue, importErrorMessage } from "@/lib/imports/import-messages";

type ParsedOption = { key: string; text: string };

type ParsedQuestion = {
  subject?: string | null;
  subject_id?: number | null;
  question_type: string | null;
  stem: string;
  options: ParsedOption[];
  answer: string | string[] | boolean | null;
  analysis: string | null;
  knowledge_points: string[];
  difficulty: number;
  is_valid: boolean;
  errors: string[];
  warnings: string[];
  question_hash: string | null;
  stem_hash: string | null;
  block_index: number;
  detection_method: string;
};

type ParseResponse = {
  questions: ParsedQuestion[];
  warnings: string[];
  raw_count: number;
  valid_count: number;
};

type ImportResultItem = {
  block_index: number;
  import_id?: number;
  status: "ok" | "fail" | "duplicate";
  error?: string;
};

type ImportResponse = {
  batch_id: string;
  items: ImportResultItem[];
  total: number;
  succeeded: number;
  failed: number;
  duplicates_filtered: number;
};

type SubjectOption = { id: number; code: string; name: string };

function renderAnswer(answer: string | string[] | boolean | null) {
  if (answer === null || answer === undefined || answer === "") return "—";
  if (typeof answer === "boolean") return answer ? "正确" : "错误";
  if (Array.isArray(answer)) return answer.join(", ");
  return String(answer);
}

function typeLabel(type: string | null) {
  return getQuestionTypeLabel(type);
}

const formatParseIssue = formatImportIssue;

function parseEditableOptions(value: string): ParsedOption[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const options = new Map<string, string[]>();
  let currentKey: string | null = null;

  const start = (key: string, text = "") => {
    currentKey = key.toUpperCase();
    if (!options.has(currentKey)) options.set(currentKey, []);
    if (text.trim()) options.get(currentKey)?.push(text.trim());
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const inline = trimmed.match(/^([A-Da-d])\s*[.．、:：)）]\s*(.+)$/);
    if (inline) {
      start(inline[1], inline[2]);
      continue;
    }
    const bare = trimmed.match(/^([A-Da-d])$/);
    if (bare) {
      start(bare[1]);
      continue;
    }
    if (currentKey) options.get(currentKey)?.push(trimmed);
  }

  return [...options.entries()]
    .map(([key, parts]) => ({ key, text: parts.join(" ").trim() }))
    .filter((option) => option.text)
    .sort((a, b) => a.key.localeCompare(b.key));
}

const TEXT_IMPORT_SAMPLE = `【题目】
若 $f(x)=x^2$，则 $f'(x)$ 等于（）。

【选项】
A. $x$
B. $2x$
C. $x^2$
D. $2$

【答案】
B

【解析】
由幂函数求导公式，
$$
f'(x)=2x
$$`;

function RenderedAnswer({ answer }: { answer: string | string[] | boolean | null }) {
  const value = renderAnswer(answer);
  if (value === "—") return <>—</>;
  return <MathFormula text={value} />;
}

function ImportTextPreview({ text }: { text: string }) {
  if (!text.trim()) {
    return (
      <div className="v2-text-preview v2-text-preview--empty">
        <div>
          <Eye className="h-5 w-5" aria-hidden="true" />
          <p>暂无可预览内容</p>
        </div>
      </div>
    );
  }

  const parts = text.replace(/\r\n?/g, "\n").split("```");
  return (
    <div className="v2-text-preview">
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const newline = part.indexOf("\n");
          const maybeLanguage = newline >= 0 ? part.slice(0, newline).trim() : "";
          const code = newline >= 0 && /^[a-zA-Z0-9_+.#-]{1,20}$/.test(maybeLanguage)
            ? part.slice(newline + 1)
            : part;
          const language = code === part ? "" : maybeLanguage;
          return (
            <figure key={`code-${index}`} className="v2-text-codeblock">
              {language ? <figcaption className="v2-text-codecaption">{language}</figcaption> : null}
              <pre className="v2-text-pre"><code>{code}</code></pre>
            </figure>
          );
        }
        if (!part) return null;
        return (
          <div key={`text-${index}`} className="v2-text-preview-text">
            <MathFormula text={part} />
          </div>
        );
      })}
    </div>
  );
}

function LatexRulesPanel({ onClose }: { onClose: () => void }) {
  const rules = [
    {
      title: "行内公式",
      source: "$f(x)=x^2$",
      detail: "短公式放在正文内，统一使用单个 $ 包裹。",
      preview: "$f(x)=x^2$",
    },
    {
      title: "块级公式",
      source: "$$\\int_0^1 x\\,dx$$",
      detail: "积分、矩阵、长分式等独立成行，统一使用 $$ 包裹。",
      preview: "$$\\int_0^1 x\\,dx$$",
    },
    {
      title: "标准命令",
      source: "$x^2, \\sqrt{x}, \\sum, \\pi$",
      detail: "避免 x²、√x、∑、π 等 Unicode 数学符号，减少 OCR / LLM 差异。",
      preview: "$x^2, \\sqrt{x}, \\sum, \\pi$",
    },
    {
      title: "代码保护",
      source: "```c\nif (p != NULL) return;\n```",
      detail: "程序代码放进 ``` 围栏；->、!=、[]、{} 等不会进入公式规范化。",
      preview: null,
    },
  ];

  return (
    <section id="latex-import-rules" className="v2-text-rules">
      <header className="v2-text-rules-head">
        <div className="v2-text-rules-intro">
          <div className="v2-text-rules-title">
            <Braces className="h-4 w-4" aria-hidden="true" />
            LaTeX 导入规则
          </div>
          <p>
            行内使用 <code>$...$</code>，块级使用 <code>$$...$$</code>；兼容{" "}
            <code>\(...\)</code> / <code>\[...\]</code>，解析时会机械标准化，不改写公式内容。
          </p>
        </div>
        <button type="button" onClick={onClose} className="v2-text-link" aria-label="收起 LaTeX 规则">
          收起
        </button>
      </header>
      <div className="v2-text-rules-grid">
        {rules.map((rule) => (
          <div key={rule.title} className="v2-text-rule-card">
            <div className="v2-text-rule-card-head">
              <span>{rule.title}</span>
              {rule.preview ? (
                <span className="v2-text-rule-preview"><MathFormula text={rule.preview} /></span>
              ) : (
                <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </div>
            <code className="v2-text-rule-code">{rule.source}</code>
            <p>{rule.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LatexInspectionPanel({
  inspection,
  expanded,
  onToggle,
  onIssueClick,
}: {
  inspection: ReturnType<typeof inspectLatexImportText>;
  expanded: boolean;
  onToggle: () => void;
  onIssueClick: (line: number | null) => void;
}) {
  const hasErrors = inspection.errorCount > 0;
  const hasWarnings = inspection.warningCount > 0;
  const tone = hasErrors ? "bad" : hasWarnings ? "warn" : "ok";
  const stateLabel = hasErrors ? `${inspection.errorCount} 个错误` : hasWarnings ? `${inspection.warningCount} 个建议` : "检查通过";
  const StateIcon = hasErrors ? AlertTriangle : hasWarnings ? Info : Check;

  return (
    <div className="v2-text-precheck" data-tone={tone}>
      <button
        type="button"
        onClick={onToggle}
        className="v2-text-precheck-btn"
        aria-expanded={expanded}
        aria-controls="latex-import-inspection"
      >
        <StateIcon className="h-4 w-4" aria-hidden="true" />
        <span className="v2-text-precheck-main">
          <strong>LaTeX 预检 · {stateLabel}</strong>
          <span>行内 {inspection.inlineCount} · 块级 {inspection.blockCount} · 代码块 {inspection.codeFenceCount}</span>
        </span>
        <ChevronDown className={`v2-text-chevron ${expanded ? "is-open" : ""}`} aria-hidden="true" />
      </button>

      {expanded ? (
        <div id="latex-import-inspection" className="v2-text-precheck-body">
          {inspection.issues.length === 0 ? (
            <div className="v2-text-precheck-ok">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <p>定界符、花括号与代码围栏未发现结构问题。解析仍会执行服务端题目结构校验。</p>
            </div>
          ) : (
            <div className="v2-text-issue-list">
              {inspection.issues.map((issue) => {
                const Icon = issue.severity === "error" ? AlertTriangle : issue.severity === "warning" ? Info : CheckCircle2;
                const content = (
                  <>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      <strong>{issue.title}</strong>
                      {issue.line ? <em>L{issue.line}</em> : null}
                      <small>{issue.detail}</small>
                    </span>
                  </>
                );

                return issue.line ? (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => onIssueClick(issue.line)}
                    className="v2-text-issue"
                    title={`跳转到第 ${issue.line} 行`}
                  >
                    {content}
                  </button>
                ) : (
                  <div key={issue.id} className="v2-text-issue">{content}</div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function resolveSubjectLabel(question: ParsedQuestion, subjects: SubjectOption[]) {
  if (question.subject_id) {
    return subjects.find((subject) => subject.id === question.subject_id)?.name || `#${question.subject_id}`;
  }
  if (question.subject) {
    return subjects.find((subject) => subject.code === question.subject)?.name || question.subject;
  }
  return null;
}

export default function TextImportPage() {
  const queryClient = useQueryClient();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const editSectionRef = useRef<HTMLElement>(null);
  const lineGutterRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState<"source" | "preview">("source");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  useEffect(() => {
    apiRequest<Array<SubjectOption & { path: string; level: number }>>("/imports/subject-options")
      .then(setSubjectOptions)
      .catch(() => {});
  }, []);
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ParsedQuestion | null>(null);
  const [optionDraft, setOptionDraft] = useState("");
  const [importStatus, setImportStatus] = useState<ImportResponse | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [acceptedBlocks, setAcceptedBlocks] = useState<Map<number, "ok" | "duplicate">>(() => new Map());
  const [resultView, setResultView] = useState<"all" | "issues">("all");
  const [defaultSubjectId, setDefaultSubjectId] = useState("");
  const revisionRef = useRef(0);
  const parseRequestRef = useRef<AbortController | null>(null);
  const importRequestRef = useRef<AbortController | null>(null);

  const charCount = text.length;
  const latexInspection = useMemo(() => inspectLatexImportText(text), [text]);
  const editLatexInspection = useMemo(() => {
    if (!editForm) return inspectLatexImportText("");
    return inspectLatexImportText(buildEditFormLatexText(editForm));
  }, [editForm]);

  const editStructureIssues = useMemo(() => {
    if (!editForm) return [] as string[];
    return validateEditStructure(editForm);
  }, [editForm]);

  const lineCount = Math.max(14, text.replace(/\r\n?/g, "\n").split("\n").length);
  const pendingQuestions = parseResult?.questions.filter(
    (question) => question.is_valid && !acceptedBlocks.has(question.block_index),
  ) ?? [];
  const hasValidQuestions = pendingQuestions.length > 0;
  const firstInvalidIndex = parseResult?.questions.findIndex(
    (question) => question.errors.length > 0 || question.warnings.length > 0,
  ) ?? -1;
  const firstInvalidQuestion = firstInvalidIndex >= 0 ? parseResult?.questions[firstInvalidIndex] : undefined;
  const issueQuestions = parseResult?.questions.filter((question) => !question.is_valid || question.errors.length > 0 || question.warnings.length > 0).length ?? 0;
  const warningLines = parseResult
    ? [
        ...parseResult.warnings,
        ...(firstInvalidQuestion
          ? [formatParseIssue(firstInvalidQuestion.errors[0] ?? firstInvalidQuestion.warnings[0])]
          : []),
      ]
    : [];
  const inspectionTone = latexInspection.errorCount > 0 ? "bad" : latexInspection.warningCount > 0 ? "warn" : "ok";
  const InspectionIcon = latexInspection.errorCount > 0
    ? AlertTriangle
    : latexInspection.warningCount > 0
      ? Info
      : Check;
  const inspectionLabel = latexInspection.errorCount > 0
    ? `${latexInspection.errorCount} 个错误`
    : latexInspection.warningCount > 0
      ? `${latexInspection.warningCount} 个建议`
      : "检查通过";

  const resetParsedState = () => {
    setParseResult(null);
    setImportStatus(null);
    setEditingIndex(null);
    setEditForm(null);
    setOptionDraft("");
    setGlobalError(null);
    setAcceptedBlocks(new Map());
  };

  const updateSourceText = (next: string) => {
    if (importRequestRef.current) return;
    revisionRef.current += 1;
    parseRequestRef.current?.abort();
    parseRequestRef.current = null;
    setText(next);
    resetParsedState();
  };

  const wrapSelection = (kind: "inline" | "block" | "code") => {
    const textarea = textAreaRef.current;
    if (!textarea) {
      setInputMode("source");
      return;
    }

    const start = textarea.selectionStart ?? text.length;
    const end = textarea.selectionEnd ?? start;
    const selected = text.slice(start, end);
    const fallback = kind === "inline" ? "x^2" : kind === "block" ? "\\frac{a}{b}" : "int value = 0;";
    const body = selected || fallback;
    const wrapped = kind === "inline"
      ? `$${body}$`
      : kind === "block"
        ? `$$\n${body}\n$$`
        : `\`\`\`\n${body}\n\`\`\``;
    const next = `${text.slice(0, start)}${wrapped}${text.slice(end)}`;
    updateSourceText(next);
    setInputMode("source");

    requestAnimationFrame(() => {
      const current = textAreaRef.current;
      if (!current) return;
      current.focus();
      const prefixLength = kind === "inline" ? 1 : kind === "block" ? 3 : 4;
      const selectionStart = start + prefixLength;
      current.setSelectionRange(selectionStart, selectionStart + body.length);
    });
  };

  const handleNormalizeDelimiters = () => {
    const normalized = normalizeLatexImportDelimiters(text);
    if (normalized !== text) updateSourceText(normalized);
    setInputMode("source");
    setIssuesOpen(true);
  };

  const focusSourceLine = (line: number | null) => {
    if (!line) return;
    setInputMode("source");
    requestAnimationFrame(() => {
      const textarea = textAreaRef.current;
      if (!textarea) return;
      const lines = text.replace(/\r\n?/g, "\n").split("\n");
      const safeLine = Math.max(1, Math.min(line, lines.length));
      const start = lines.slice(0, safeLine - 1).reduce((sum, current) => sum + current.length + 1, 0);
      const end = start + (lines[safeLine - 1]?.length ?? 0);
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 28;
      textarea.scrollTop = Math.max(0, (safeLine - 3) * lineHeight);
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setRulesOpen(false);
      setIssuesOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (editingIndex === null) return;
    const frame = requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      editSectionRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [editingIndex]);

  useEffect(() => () => {
    revisionRef.current += 1;
    parseRequestRef.current?.abort();
    importRequestRef.current?.abort();
  }, []);

  const parseMutation = useMutation({
    mutationFn: ({ source, signal, subjectId }: { source: string; revision: number; signal: AbortSignal; subjectId?: number | null }) =>
      apiRequest<ParseResponse>("/imports/text-parse", {
        method: "POST",
        body: JSON.stringify({ text: source, subject_id: subjectId ?? null }),
        signal,
      }),
    onSuccess: (data, request) => {
      if (request.revision !== revisionRef.current || request.signal.aborted) return;
      setParseResult(data);
      setImportStatus(null);
      setGlobalError(null);
      setAcceptedBlocks(new Map());
    },
    onError: (err, request) => {
      if (request.revision !== revisionRef.current || request.signal.aborted) return;
      setGlobalError(importErrorMessage(err));
    },
    onSettled: (_data, _error, request) => {
      if (parseRequestRef.current?.signal === request.signal) parseRequestRef.current = null;
    },
  });

  const importMutation = useMutation({
    mutationFn: ({ questions, signal }: { questions: ParsedQuestion[]; revision: number; signal: AbortSignal }) =>
      apiRequest<ImportResponse>("/imports/text-import", {
        method: "POST",
        body: JSON.stringify({
          subject_id: null,
          questions,
        }),
        signal,
      }),
    onSuccess: (data, request) => {
      if (request.revision !== revisionRef.current || request.signal.aborted) return;
      // The API numbers items by position within this filtered submission.
      const items = data.items.flatMap((item) => {
        const original = request.questions[item.block_index];
        return original ? [{ ...item, block_index: original.block_index }] : [];
      });
      setImportStatus({ ...data, items });
      setAcceptedBlocks((previous) => {
        const next = new Map(previous);
        for (const item of items) {
          if (item.status === "ok" || item.status === "duplicate") next.set(item.block_index, item.status);
        }
        return next;
      });
      setGlobalError(null);
      queryClient.invalidateQueries({ queryKey: ["import-review-queue"] });
    },
    onError: (err, request) => {
      if (request.revision !== revisionRef.current || request.signal.aborted) return;
      setGlobalError(importErrorMessage(err));
    },
    onSettled: (_data, _error, request) => {
      if (importRequestRef.current?.signal === request.signal) importRequestRef.current = null;
    },
  });

  const handleParse = () => {
    if (parseRequestRef.current || importRequestRef.current) return;
    if (!text.trim()) {
      setGlobalError("请输入题目文本");
      return;
    }
    const controller = new AbortController();
    parseRequestRef.current = controller;
    parseMutation.mutate({ source: text, revision: ++revisionRef.current, signal: controller.signal, subjectId: defaultSubjectId ? Number(defaultSubjectId) : null });
  };

  const handleDelete = (index: number) => {
    if (!parseResult || importRequestRef.current || acceptedBlocks.has(parseResult.questions[index].block_index)) return;
    const next = parseResult.questions.filter((_, i) => i !== index);
    setParseResult({
      ...parseResult,
      questions: next,
      raw_count: next.length,
      valid_count: next.filter((q) => q.is_valid).length,
    });
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditForm(null);
      setOptionDraft("");
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const startEdit = (index: number) => {
    if (!parseResult || importRequestRef.current || acceptedBlocks.has(parseResult.questions[index].block_index)) return;
    setEditingIndex(index);
    const question = parseResult.questions[index];
    setEditForm({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      knowledge_points: [...(question.knowledge_points || [])],
    });
    setOptionDraft(question.options.map((option) => `${option.key}. ${option.text}`).join("\n"));
  };

  const saveEdit = () => {
    if (!parseResult || editingIndex === null || !editForm || editStructureIssues.length > 0 || importRequestRef.current) return;
    const next = [...parseResult.questions];
    next[editingIndex] = {
      ...editForm,
      is_valid: true,
      errors: [],
      warnings: [],
      question_hash: null,
      stem_hash: null,
    };
    setParseResult({
      ...parseResult,
      questions: next,
      valid_count: next.filter((q) => q.is_valid).length,
    });
    setEditingIndex(null);
    setEditForm(null);
    setOptionDraft("");
  };

  const handleImport = () => {
    if (!hasValidQuestions || parseRequestRef.current || importRequestRef.current || editingIndex !== null) return;
    const controller = new AbortController();
    importRequestRef.current = controller;
    importMutation.mutate({ questions: pendingQuestions, revision: revisionRef.current, signal: controller.signal });
  };

  const scrollToFirstIssue = () => {
    if (firstInvalidIndex < 0) return;
    document.getElementById("v2-text-first-issue")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  return (
    <div className="imports-v2 v2-text-page">
      <header className="v2-text-head">
        <h1 className="v2-text-title">文本导入</h1>
      </header>

      {globalError ? (
        <div className="v2-text-alert" role="alert">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <span><strong>操作未完成</strong> · {globalError}</span>
          <button type="button" onClick={() => setGlobalError(null)} aria-label="关闭错误提示">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="v2-text-layout" data-state={parseResult ? "parsed" : "idle"}>
        <section className="v2-text-editor" aria-labelledby="v2-text-editor-title">
          <header className="v2-text-card-head">
            <div>
              <div className="v2-text-card-title-wrap flex items-center gap-2" style={{ color: "var(--v2-ink3)" }}>
                <FileText className="h-4 w-4" aria-hidden="true" />
                <h2 id="v2-text-editor-title" className="v2-text-card-title">原始文本</h2>
              </div>
            </div>
            <div className="v2-text-head-tools">
              <div className="v2-text-tabs" role="group" aria-label="文本输入模式">
                <button
                  type="button"
                  aria-pressed={inputMode === "source"}
                  onClick={() => setInputMode("source")}
                  className="v2-text-tab"
                  data-active={inputMode === "source"}
                >
                  输入
                </button>
                <button
                  type="button"
                  aria-pressed={inputMode === "preview"}
                  onClick={() => setInputMode("preview")}
                  className="v2-text-tab"
                  data-active={inputMode === "preview"}
                >
                  <Eye className="h-3 w-3" aria-hidden="true" />
                  预览
                </button>
              </div>
              <button
                type="button"
                onClick={() => setRulesOpen((open) => !open)}
                className="v2-text-rule-btn"
                aria-expanded={rulesOpen}
                aria-controls="latex-import-rules"
              >
                <Braces className="h-3.5 w-3.5" aria-hidden="true" />
                LaTeX 规则
              </button>
            </div>
          </header>

          <div className="v2-text-card-body">
            <div className="v2-text-toolbar" aria-label="文本快速格式化工具">
              <button type="button" onClick={() => wrapSelection("inline")} className="v2-text-tool" title="将选中文本包裹为行内公式">
                <span className="v2-text-tool-code">$ · $</span> 行内
              </button>
              <button type="button" onClick={() => wrapSelection("block")} className="v2-text-tool" title="将选中文本包裹为块级公式">
                <span className="v2-text-tool-code">$$ · $$</span> 块级
              </button>
              <button type="button" onClick={() => wrapSelection("code")} className="v2-text-tool" title="将选中文本放入代码围栏">
                <Code2 className="h-3.5 w-3.5" aria-hidden="true" /> 代码块
              </button>
              {latexInspection.alternateDelimiterCount > 0 ? (
                <button type="button" onClick={handleNormalizeDelimiters} className="v2-text-normalize">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  标准化 {latexInspection.alternateDelimiterCount} 处定界符
                </button>
              ) : null}
            </div>

            {rulesOpen ? <LatexRulesPanel onClose={() => setRulesOpen(false)} /> : null}

            {inputMode === "source" ? (
              <div className="v2-text-paper-wrap">
                <div ref={lineGutterRef} className="v2-text-gutter" aria-hidden="true">
                  {Array.from({ length: lineCount }, (_, index) => (
                    <span key={index} className="v2-text-line-no">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <label htmlFor="question-import-text" className="sr-only">题目文本</label>
                <textarea
                  ref={textAreaRef}
                  id="question-import-text"
                  className="v2-text-input"
                  placeholder={TEXT_IMPORT_SAMPLE}
                  value={text}
                  spellCheck={false}
                  readOnly={importMutation.isPending}
                  onScroll={(event) => {
                    if (lineGutterRef.current) lineGutterRef.current.scrollTop = event.currentTarget.scrollTop;
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      handleParse();
                    }
                  }}
                  onChange={(event) => updateSourceText(event.target.value)}
                />
              </div>
            ) : (
              <div role="region" aria-label="题目渲染预览">
                <ImportTextPreview text={text} />
              </div>
            )}

            {latexInspection.issues.length > 0 ? <LatexInspectionPanel
              inspection={latexInspection}
              expanded={issuesOpen}
              onToggle={() => setIssuesOpen((open) => !open)}
              onIssueClick={focusSourceLine}
            /> : null}

            <footer className="v2-text-editor-foot">
              <div className="v2-text-stats">
                {charCount.toLocaleString()} 字 · 公式 {latexInspection.formulaCount} · 代码块 {latexInspection.codeFenceCount}
              </div>
              <div className="v2-text-foot-actions">
                {!text ? <button type="button" className="v2-text-link" onClick={() => updateSourceText(TEXT_IMPORT_SAMPLE)}>填入示例</button> : null}
                <button type="button" className="v2-text-link" onClick={() => updateSourceText("")} disabled={!text || importMutation.isPending}>
                  清空
                </button>
                {parseResult ? (
                  <button
                    type="button"
                    className="v2-text-link"
                    onClick={handleParse}
                    disabled={parseMutation.isPending || importMutation.isPending || !text.trim()}
                  >
                    重新解析
                  </button>
                ) : (
                  <span className="v2-text-keyhint">
                    <kbd>Ctrl</kbd><kbd>Enter</kbd> 解析
                  </span>
                )}
              </div>
            </footer>
          </div>
        </section>

        {parseResult ? (
          <aside className="v2-text-results" aria-labelledby="v2-text-results-title">
            <header className="v2-text-results-head">
              <h2 id="v2-text-results-title" className="v2-text-results-title">解析结果</h2>
            </header>

            <div className="v2-text-metrics" aria-live="polite">
              <div className="v2-text-metric">
                <strong className="v2-text-metric-val">{parseResult.raw_count}</strong>
                <span className="v2-text-metric-label">识别题目</span>
              </div>
              <div className="v2-text-metric">
                <strong className="v2-text-metric-val">{parseResult.valid_count}</strong>
                <span className="v2-text-metric-label">有效</span>
              </div>
              <div className="v2-text-metric">
                <strong
                  className="v2-text-metric-val"
                  data-tone={Math.max(0, parseResult.raw_count - parseResult.valid_count) > 0 ? "warn" : "neutral"}
                >
                  {Math.max(0, parseResult.raw_count - parseResult.valid_count)}
                </strong>
                <span className="v2-text-metric-label">需处理</span>
              </div>
            </div>

            <div className="v2-text-resulttools" role="group" aria-label="解析结果筛选">
              <button type="button" aria-pressed={resultView === "all"} onClick={() => setResultView("all")}>全部 {parseResult.questions.length}</button>
              <button type="button" aria-pressed={resultView === "issues"} onClick={() => setResultView("issues")}>需处理 {issueQuestions}</button>
            </div>

            {warningLines.length > 0 ? (
              <div className="v2-text-warnbar" role="status">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <div className="v2-text-warn-lines">
                  {warningLines.slice(0, 2).map((message, index) => (
                    <p key={index}>{formatParseIssue(message)}</p>
                  ))}
                  {warningLines.length > 2 ? <p>另有 {warningLines.length - 2} 项异常</p> : null}
                </div>
                {firstInvalidIndex >= 0 ? (
                  <button type="button" className="v2-text-warn-link" onClick={scrollToFirstIssue}>
                    查看异常
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="v2-text-question-list">
              {parseResult.questions.length === 0 ? (
                <div className="v2-text-results-empty">
                  <p>没有识别到题目</p>
                  <span>检查结构标签、选项分隔和公式定界符后重新解析。</span>
                </div>
              ) : null}

              {resultView === "issues" && issueQuestions === 0 ? <div className="v2-text-results-empty"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /><p>全部题目已通过检查</p></div> : null}
              {parseResult.questions.map((question, index) => {
                if (resultView === "issues" && question.is_valid && question.errors.length === 0 && question.warnings.length === 0) return null;
                const accepted = acceptedBlocks.has(question.block_index);
                const duplicate = acceptedBlocks.get(question.block_index) === "duplicate";
                const importFailure = importStatus?.items.find((item) => item.block_index === question.block_index && item.status === "fail");
                const subjectLabel = resolveSubjectLabel(question, subjectOptions);
                const issueCount = question.errors.length + question.warnings.length;
                const firstIssue = question.errors[0] ?? question.warnings[0] ?? null;
                const extraIssueCount = Math.max(0, issueCount - 1);
                const missingOptions = question.options.length === 0
                  && (question.question_type === "single_choice" || question.question_type === "multiple_choice");

                return (
                  <article
                    key={question.block_index}
                    id={index === firstInvalidIndex ? "v2-text-first-issue" : undefined}
                    className="v2-text-question"
                  >
                    <div className="v2-text-index" aria-hidden="true">
                      <span className="v2-text-index-no">{String(index + 1).padStart(2, "0")}</span>
                    </div>
                    <div className="v2-text-q-main">
                      <div className="v2-text-q-head">
                        <span className="v2-text-status-dot" data-tone={question.is_valid ? "ok" : "warn"} />
                        <span className="v2-text-q-state" data-tone={question.is_valid ? "ok" : "warn"}>
                          {duplicate ? "重复已跳过" : accepted ? "已暂存" : question.is_valid ? "有效" : "需处理"}
                        </span>
                        <span className="v2-text-q-meta">{typeLabel(question.question_type)}</span>
                        <span className="v2-text-q-sep">·</span>
                        <span className={subjectLabel ? "v2-text-q-meta" : "v2-text-q-meta v2-text-q-meta--warn"}>
                          {subjectLabel || "科目待补"}
                        </span>
                      </div>

                      <div className="v2-text-q-actions">
                        <button type="button" disabled={accepted || importMutation.isPending} onClick={() => startEdit(index)} aria-label={`编辑题目 ${index + 1}`} title={duplicate ? "题库中已存在，已跳过本次导入" : accepted ? "已暂存，可前往审核队列编辑" : "编辑题目"}>
                          <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button type="button" disabled={accepted || importMutation.isPending} onClick={() => handleDelete(index)} aria-label={`删除题目 ${index + 1}`} title={duplicate ? "题库中已存在，已跳过本次导入" : accepted ? "已暂存，可前往审核队列处理" : "删除题目"}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="v2-text-q-stem">
                        <QuestionContentRenderer content={question.stem} fallbackText={question.stem} preserveCodeText />
                      </div>
                      {importFailure ? <p className="v2-text-import-failure" role="status">暂存失败：{importErrorMessage(importFailure.error)}</p> : null}

                      {question.options.length > 0 ? (
                        <div className="v2-text-q-options">
                          {question.options.map((option) => (
                            <div key={option.key} className="v2-text-option">
                              <span>{option.key}.</span>
                              <span><MathFormula text={option.text} /></span>
                            </div>
                          ))}
                        </div>
                      ) : missingOptions ? (
                        <button type="button" onClick={() => startEdit(index)} className="v2-text-missing-options">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          <span><strong>未识别到选项</strong> · 点击编辑补充或检查选项分隔格式</span>
                        </button>
                      ) : null}

                      <div className="v2-text-q-foot">
                        <span>答案 <strong><RenderedAnswer answer={question.answer} /></strong></span>
                        {question.analysis ? <span>含解析</span> : null}
                        {question.warnings.length > 0 ? <span>{question.warnings.length} 条警告</span> : null}
                      </div>

                      {issueCount > 0 && firstIssue ? (
                        <details className="v2-text-q-issues">
                          <summary>
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{formatParseIssue(firstIssue)}</span>
                            {extraIssueCount > 0 ? <span>+{extraIssueCount}</span> : null}
                            <em>查看</em>
                          </summary>
                          <div className="v2-text-q-issues-body">
                            {question.errors.map((message, issueIndex) => (
                              <p key={`e-${issueIndex}`} className="is-error">
                                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                                {formatParseIssue(message)}
                              </p>
                            ))}
                            {question.warnings.map((message, issueIndex) => (
                              <p key={`w-${issueIndex}`}>
                                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                                {formatParseIssue(message)}
                              </p>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </article>
                );
              })}

              {editingIndex !== null && editForm ? (
                <section ref={editSectionRef} className="v2-text-edit">
                  <header className="v2-text-edit-head">
                    <div>
                      <h3 className="v2-text-edit-title">编辑题目 {editingIndex + 1}</h3>
                    </div>
                    <div className="v2-text-edit-actions">
                      <span className="v2-text-edit-status" data-tone={editLatexInspection.errorCount > 0 ? "bad" : editLatexInspection.warningCount > 0 ? "warn" : "ok"}>
                        公式 {editLatexInspection.formulaCount} · {editLatexInspection.errorCount + editLatexInspection.warningCount > 0 ? `风险 ${editLatexInspection.errorCount + editLatexInspection.warningCount}` : "通过"}
                      </span>
                      <button
                        type="button"
                        className="v2-text-secondary"
                        onClick={() => {
                          setEditingIndex(null);
                          setEditForm(null);
                          setOptionDraft("");
                        }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="v2-text-save"
                        onClick={saveEdit}
                        disabled={editStructureIssues.length > 0}
                        title={editStructureIssues.length > 0 ? editStructureIssues.join("；") : "保存修改"}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        保存
                      </button>
                    </div>
                  </header>

                  <div className="v2-text-edit-grid">
                    <div className="v2-text-field">
                      <span>科目 <em>可选</em></span>
                      <CustomSelect
                        className="v2-text-select"
                        aria-label="题目科目"
                        clearable={false}
                        value={String(editForm.subject_id ?? "")}
                        onChange={(value) => setEditForm({
                          ...editForm,
                          subject_id: value ? Number(value) : null,
                        })}
                        options={[{ value: "", label: "未指定科目" }, ...subjectOptions.map((subject) => ({ value: String(subject.id), label: subject.name }))]}
                      />
                    </div>
                    <div className="v2-text-field">
                      <span>题型</span>
                      <CustomSelect
                        className="v2-text-custom-select"
                        aria-label="题型"
                        value={editForm.question_type ?? ""}
                        onChange={(value) => setEditForm({ ...editForm, question_type: value || null })}
                        options={canonicalizeQuestionType(editForm.question_type) || !editForm.question_type
                          ? QUESTION_TYPE_OPTIONS
                          : [...QUESTION_TYPE_OPTIONS, { value: editForm.question_type!, label: formatUnknownType(editForm.question_type!), disabled: true }]}
                        placeholder="选择题型"
                        clearable={false}
                      />
                    </div>

                    <label className="v2-text-field v2-text-field--full">
                      <span>题干</span>
                      <textarea
                        className="v2-text-textarea"
                        value={editForm.stem}
                        onChange={(event) => setEditForm({ ...editForm, stem: event.target.value })}
                      />
                    </label>

                    <label className="v2-text-field v2-text-field--full">
                      <span>
                        选项 <em>支持 “A. 内容” 或 “A ↵ 内容”</em>
                        <b data-tone={editForm.options.length >= 4 ? "ok" : "muted"}>已识别 {editForm.options.length} 项</b>
                      </span>
                      <textarea
                        className="v2-text-textarea v2-text-textarea--mono"
                        value={optionDraft}
                        onChange={(event) => {
                          const nextDraft = event.target.value;
                          setOptionDraft(nextDraft);
                          setEditForm({ ...editForm, options: parseEditableOptions(nextDraft) });
                        }}
                      />
                    </label>

                    <label className="v2-text-field">
                      <span>答案</span>
                      <input
                        className="v2-text-input-sm"
                        value={typeof editForm.answer === "boolean"
                          ? (editForm.answer ? "正确" : "错误")
                          : Array.isArray(editForm.answer)
                            ? editForm.answer.join(",")
                            : String(editForm.answer ?? "")}
                        onChange={(event) => setEditForm({ ...editForm, answer: event.target.value })}
                      />
                    </label>

                    <label className="v2-text-field v2-text-field--full">
                      <span>解析</span>
                      <textarea
                        className="v2-text-textarea"
                        value={editForm.analysis ?? ""}
                        onChange={(event) => setEditForm({ ...editForm, analysis: event.target.value })}
                      />
                    </label>

                    {editStructureIssues.length > 0 ? (
                      <div className="v2-text-edit-issues" role="status">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        <div>
                          <strong>保存前还需处理 {editStructureIssues.length} 项结构问题</strong>
                          <p>{editStructureIssues.join(" · ")}</p>
                        </div>
                      </div>
                    ) : null}

                    <section className="v2-text-edit-preview">
                      <header>
                        <div><Eye className="h-3.5 w-3.5" aria-hidden="true" />最终渲染预览</div>
                        <span>与题库阅读侧使用同一渲染规则</span>
                      </header>
                      <div className="v2-text-edit-preview-body">
                        <div>
                          <p className="v2-text-preview-label">题干</p>
                          <QuestionContentRenderer content={editForm.stem} fallbackText={editForm.stem} preserveCodeText />
                        </div>
                        {editForm.options.length > 0 ? (
                          <div className="v2-text-edit-options">
                            {editForm.options.map((option) => (
                              <div key={option.key}>
                                <span>{option.key}.</span>
                                <span><MathFormula text={option.text} /></span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="v2-text-edit-meta">
                          <div>
                            <p className="v2-text-preview-label">答案</p>
                            <strong><RenderedAnswer answer={editForm.answer} /></strong>
                          </div>
                          <div>
                            <p className="v2-text-preview-label">解析</p>
                            <span>{editForm.analysis ? <MathFormula text={editForm.analysis} /> : "无解析"}</span>
                          </div>
                        </div>
                        {editLatexInspection.issues.length > 0 ? (
                          <div className="v2-text-edit-latex">
                            <strong>LaTeX 预检：</strong>
                            {editLatexInspection.errorCount > 0
                              ? `${editLatexInspection.errorCount} 个结构错误`
                              : `${editLatexInspection.warningCount} 个格式建议`}
                            <span> · 保存前建议核对公式定界符与括号。</span>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>
                </section>
              ) : null}
            </div>

            <footer className="v2-text-importbar">
              <div className="v2-text-import-summary">
                {importStatus ? (
                  <>
                    <strong>{importStatus.failed > 0 ? "部分题目未能暂存" : importStatus.succeeded > 0 ? "已暂存到审核队列" : "已过滤重复题目"}</strong>
                    <span>成功 {importStatus.succeeded} 题</span>
                    {importStatus.duplicates_filtered > 0 ? <span>过滤重复 {importStatus.duplicates_filtered} 题</span> : null}
                    {importStatus.failed > 0 ? <span className="is-bad">失败 {importStatus.failed} 题</span> : null}
                    <span className="v2-text-batch">批次 {importStatus.batch_id}</span>
                  </>
                ) : (
                  <>
                    <strong>{hasValidQuestions ? `${pendingQuestions.length} 题可导入` : "暂无可导入题目"}</strong>
                    {Math.max(0, parseResult.raw_count - parseResult.valid_count) > 0 ? (
                      <span className="is-warn">{Math.max(0, parseResult.raw_count - parseResult.valid_count)} 题待处理</span>
                    ) : null}
                  </>
                )}
              </div>
              {importStatus && !hasValidQuestions ? (
                <Link href={`/imports/review?batch_id=${encodeURIComponent(importStatus.batch_id)}`} className="v2-text-cta">
                  查看审核队列 <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : (
                <button
                  type="button"
                  className="v2-text-cta"
                  onClick={handleImport}
                  disabled={!hasValidQuestions || importMutation.isPending || parseMutation.isPending || editingIndex !== null}
                >
                  {importMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  {importMutation.isPending ? "导入中" : importStatus ? `继续导入 ${pendingQuestions.length} 题` : "确认导入"}
                  {!importMutation.isPending ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
                </button>
              )}
            </footer>
          </aside>
        ) : (
          <aside className="v2-text-inspector" aria-labelledby="v2-text-inspector-title">
            <header className="v2-text-insp-head">
              <h2 id="v2-text-inspector-title" className="v2-text-card-title">解析与校对</h2>
            </header>

            <div className="v2-text-insp-body">
              <section className="v2-text-section">
                <div className="v2-text-section-head">
                  <span className="v2-text-label">目标科目</span>
                </div>
                <CustomSelect value={defaultSubjectId} onChange={setDefaultSubjectId} options={[{ value: "", label: "未指定科目" }, ...subjectOptions.map((subject) => ({ value: String(subject.id), label: subject.name }))]} aria-label="解析科目" disabled={parseMutation.isPending || importMutation.isPending} clearable={false} />
              </section>

              <section className="v2-text-section">
                <div className="v2-text-section-head">
                  <span className="v2-text-label">LaTeX 预检</span>
                  <button type="button" className="v2-text-link" onClick={() => setIssuesOpen((open) => !open)}>
                    {issuesOpen ? "收起" : "查看"}
                  </button>
                </div>
                <div className="v2-text-statusline" data-tone={inspectionTone}>
                  <InspectionIcon className="h-4 w-4" aria-hidden="true" />
                  <div>
                    <strong>{inspectionLabel}</strong>
                    <p>行内 {latexInspection.inlineCount} · 块级 {latexInspection.blockCount} · 代码块 {latexInspection.codeFenceCount}</p>
                  </div>
                </div>
              </section>

              <div className="v2-text-empty">
                <FileText className="h-7 w-7" aria-hidden="true" />
                <p>等待解析结果</p>
              </div>
            </div>

            <footer className="v2-text-insp-foot">
              <button
                type="button"
                className="v2-text-cta"
                onClick={handleParse}
                disabled={parseMutation.isPending || importMutation.isPending || !text.trim()}
              >
                {parseMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                {parseMutation.isPending ? "解析中" : "解析文本"}
              </button>
            </footer>
          </aside>
        )}
      </div>
    </div>
  );
}
