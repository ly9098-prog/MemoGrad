const PROVIDER_ICONS: Record<string, string> = {
  deepseek: "/model-icons/deepseek.svg",
  qwen: "/model-icons/qwen.png",
  "qwen-vl": "/model-icons/qwen.png",
  glm: "/model-icons/glm.svg",
  moonshot: "/model-icons/kimi.png",
  kimi: "/model-icons/kimi.png",
  openai: "/model-icons/gpt.svg",
  anthropic: "/model-icons/claude.svg",
  gemini: "/model-icons/gemini.png",
  paddle: "/model-icons/paddleocr.png",
  paddleocr: "/model-icons/paddleocr.png",
  paddleocr_vl: "/model-icons/paddleocr.png",
  "paddleocr-vl": "/model-icons/paddleocr.png",
};

export function getAiProviderIcon(provider: string): string | null {
  return PROVIDER_ICONS[provider.trim().toLowerCase()] ?? null;
}

export function getAiModelIcon(modelName?: string | null): string | null {
  const name = modelName?.trim();
  if (!name) return null;
  if (/(^|[/:])paddle(?:ocr)?(?:[-_/:]|$)/i.test(name)) return PROVIDER_ICONS.paddleocr;
  if (/(^|[/:])deepseek(?:[-/:]|$)/i.test(name)) return PROVIDER_ICONS.deepseek;
  if (/(^|[/:])(?:qwen|qwq)(?:[-/:\d]|$)/i.test(name)) return PROVIDER_ICONS.qwen;
  if (/(^|[/:])(?:glm|chatglm)(?:[-/:\d]|$)/i.test(name)) return PROVIDER_ICONS.glm;
  if (/(^|[/:])(?:kimi|moonshot)(?:[-/:\d]|$)/i.test(name)) return PROVIDER_ICONS.moonshot;
  if (/(^|[/:])(?:(?:gpt|chatgpt)(?:[-/:\d]|$)|o[1-9](?:[-/:]|$))/i.test(name)) return PROVIDER_ICONS.openai;
  if (/(^|[/:])claude(?:[-/:\d]|$)/i.test(name)) return PROVIDER_ICONS.anthropic;
  if (/(^|[/:])gemini(?:[-/:\d]|$)/i.test(name)) return PROVIDER_ICONS.gemini;
  return null;
}
