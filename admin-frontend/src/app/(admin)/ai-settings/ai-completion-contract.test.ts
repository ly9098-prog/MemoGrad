import { describe, expect, it } from "vitest";
import { buildCompletionPatch } from "./components/ai-completion";

const savedScopes = {
  completion_auto_stem: true,
  completion_auto_options: false,
  completion_auto_answer_reasoning: true,
  completion_auto_knowledge_tags: false,
};

describe("buildCompletionPatch", () => {
  it("returns no patch when nothing changed", () => {
    expect(
      buildCompletionPatch({
        prompt: "same",
        savedPrompt: "same",
        scopes: savedScopes,
        savedScopes,
        repairStructure: true,
        savedRepairStructure: true,
      }),
    ).toEqual({});
  });

  it("only includes changed scopes, prompt and repair flag", () => {
    expect(
      buildCompletionPatch({
        prompt: "next",
        savedPrompt: "same",
        scopes: {
          ...savedScopes,
          completion_auto_options: true,
          completion_auto_knowledge_tags: false,
        },
        savedScopes,
        repairStructure: false,
        savedRepairStructure: true,
      }),
    ).toEqual({
      completion_prompt: "next",
      completion_auto_options: true,
      completion_repair_structure: false,
    });
  });
});
