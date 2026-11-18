import { getAiProviderIcon } from "./ai-model-icons";

export type AiProviderOption = {
  value: string;
  label: string;
  suffix?: string;
  icon?: string;
};

const PROVIDER_PRESETS: AiProviderOption[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic / Claude" },
  { value: "gemini", label: "Google Gemini" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "qwen", label: "通义千问" },
  { value: "glm", label: "智谱 GLM" },
  { value: "minimax", label: "MiniMax" },
  { value: "kimi", label: "Kimi" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "dashscope", label: "阿里云百炼 / DashScope" },
  { value: "volcengine", label: "火山引擎" },
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "vllm", label: "vLLM" },
  { value: "relay", label: "Relay" },
  { value: "custom", label: "自定义兼容接口" },
  { value: "paddleocr", label: "PaddleOCR" },
];

const PROVIDER_ALIASES: Record<string, string> = {
  "qwen-vl": "qwen",
  moonshot: "kimi",
  paddle: "paddleocr",
  "paddleocr-vl": "paddleocr",
  "azure-openai": "azure",
  "silicon-flow": "siliconflow",
  "volcengine-ark": "volcengine",
  "lm-studio": "lmstudio",
};

export function canonicalAiProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase().replaceAll("_", "-");
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

export function buildAiProviderOptions(
  providerCounts: Iterable<string>,
  currentProvider?: string,
): AiProviderOption[] {
  const normalizedCounts = new Map<string, number>();
  const existingProviders = new Map<string, string>();
  for (const provider of providerCounts) {
    const trimmed = provider.trim();
    const normalized = canonicalAiProvider(trimmed);
    if (!normalized) continue;
    normalizedCounts.set(normalized, (normalizedCounts.get(normalized) ?? 0) + 1);
    if (!existingProviders.has(normalized)) {
      existingProviders.set(normalized, trimmed);
    }
  }

  const seen = new Set<string>();
  const options = PROVIDER_PRESETS.map((option) => {
    const normalized = canonicalAiProvider(option.value);
    const current = currentProvider?.trim();
    const value =
      current && canonicalAiProvider(current) === normalized
        ? current
        : option.value;
    seen.add(normalized);
    const count = normalizedCounts.get(normalized) ?? 0;
    return {
      ...option,
      value,
      icon: getAiProviderIcon(option.value) ?? undefined,
      suffix: count > 0 ? `${count} 个模型` : undefined,
    };
  });

  for (const [normalized, provider] of existingProviders) {
    if (seen.has(normalized)) continue;
    options.push({
      value: provider,
      label: provider,
      icon: getAiProviderIcon(provider) ?? undefined,
      suffix: `${normalizedCounts.get(normalized) ?? 0} 个模型`,
    });
    seen.add(normalized);
  }

  const current = currentProvider?.trim();
  const currentNormalized = current ? canonicalAiProvider(current) : "";
  if (current && currentNormalized && !seen.has(currentNormalized)) {
    options.push({
      value: current,
      label: current,
      icon: getAiProviderIcon(current) ?? undefined,
      suffix: "当前使用",
    });
    seen.add(currentNormalized);
  }

  return options;
}
