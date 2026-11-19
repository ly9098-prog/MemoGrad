import { describe, expect, it } from "vitest";
import {
  buildAiProviderOptions,
  canonicalAiProvider,
} from "./ai-model-provider-options";

describe("buildAiProviderOptions", () => {
  it("includes providers already configured in the model catalog", () => {
    const options = buildAiProviderOptions(
      ["openai", "company-gateway", "company-gateway"],
      "company-gateway",
    );

    expect(options.find((option) => option.value === "company-gateway")).toMatchObject({
      label: "company-gateway",
      suffix: "2 个模型",
    });
    expect(options.find((option) => option.value === "openai")?.suffix).toBe(
      "1 个模型",
    );
    expect(options.find((option) => option.value === "openai")?.icon).toBe(
      "/model-icons/gpt.svg",
    );
    expect(options.find((option) => option.value === "openrouter")?.icon).toBe(
      "/model-icons/openrouter.png",
    );
  });

  it("keeps an unstructured current provider selectable", () => {
    const options = buildAiProviderOptions([], "company-gateway");

    expect(options.find((option) => option.value === "company-gateway")).toMatchObject({
      value: "company-gateway",
      label: "company-gateway",
      suffix: "当前使用",
    });
  });

  it("does not duplicate providers that differ only by case", () => {
    const options = buildAiProviderOptions(["Kimi"], "Kimi");
    const kimiOptions = options.filter(
      (option) => canonicalAiProvider(option.value) === "kimi",
    );

    expect(kimiOptions).toHaveLength(1);
    expect(kimiOptions[0]?.value).toBe("Kimi");
    expect(kimiOptions[0]?.suffix).toBe("1 个模型");
    expect(kimiOptions[0]?.icon).toBe(
      "/model-icons/kimi.png",
    );
  });

  it.each([
    ["qwen-vl", "qwen"],
    ["moonshot", "kimi"],
    ["paddle", "paddleocr"],
    ["paddleocr_vl", "paddleocr"],
    ["paddle-ocr-vl", "paddleocr"],
    ["paddleoce-vl", "paddleocr"],
  ])("groups %s under one vendor instead of a model variant", (alias, vendor) => {
    const options = buildAiProviderOptions([alias], alias);
    const vendorOptions = options.filter(
      (option) => canonicalAiProvider(option.value) === vendor,
    );

    expect(vendorOptions).toHaveLength(1);
    expect(vendorOptions[0]?.value).toBe(alias);
    expect(vendorOptions[0]?.suffix).toBe("1 个模型");
  });
});
