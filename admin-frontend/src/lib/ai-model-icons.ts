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
  minimax: "/model-icons/minimax.png",
  openrouter: "/model-icons/openrouter.png",
  dashscope: "/model-icons/dashscope.png",
  aliyun: "/model-icons/dashscope.png",
  "alibaba-cloud": "/model-icons/dashscope.png",
  bailian: "/model-icons/dashscope.png",
  volcengine: "/model-icons/volcengine.png",
  "volcengine-ark": "/model-icons/volcengine.png",
  siliconflow: "/model-icons/siliconflow.png",
  "silicon-flow": "/model-icons/siliconflow.png",
  azure: "/model-icons/azure.png",
  "azure-openai": "/model-icons/azure.png",
  ollama: "/model-icons/ollama.png",
  lmstudio: "/model-icons/lmstudio.png",
  "lm-studio": "/model-icons/lmstudio.png",
  vllm: "/model-icons/vllm.png",
  paddle: "/model-icons/paddleocr.png",
  paddleocr: "/model-icons/paddleocr.png",
  paddleocr_vl: "/model-icons/paddleocr.png",
  "paddleocr-vl": "/model-icons/paddleocr.png",
};

export function getAiProviderIcon(provider: string): string | null {
  const normalized = provider.trim().toLowerCase();
  if (normalized.replaceAll("_", "-").startsWith("paddle")) {
    return PROVIDER_ICONS.paddleocr;
  }
  return PROVIDER_ICONS[normalized] ?? PROVIDER_ICONS[normalized.replaceAll("_", "-")] ?? null;
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
