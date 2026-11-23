import { describe, expect, it } from "vitest";
import {
  previewCategoryTree,
  previewFormulaParams,
  type PublicFormulaCategory,
} from "./learner-formulas";

const chapter: PublicFormulaCategory = {
  id: 2,
  parent_id: 1,
  name: "极限",
  code: "limit",
  node_type: "chapter",
  available_count: 3,
  children: [],
};
const subject: PublicFormulaCategory = {
  id: 1,
  parent_id: null,
  name: "高等数学",
  code: "math",
  node_type: "subject",
  available_count: 3,
  children: [chapter],
};
const filters = { q: "极限", library_type: "", study_card_type: "formula" };

describe("published formula preview adapter", () => {
  it("maps available subtree counts without mutating the public catalog", () => {
    const result = previewCategoryTree([subject]);
    expect(result[0].subtree_formula_count).toBe(3);
    expect(result[0].children[0].subtree_formula_count).toBe(3);
    expect(subject).not.toHaveProperty("subtree_formula_count");
  });

  it("uses public subject/chapter filters so descendants remain visible", () => {
    expect(previewFormulaParams(subject, filters, 1)).toMatchObject({
      subject_code: "math",
      category_id: undefined,
    });
    expect(previewFormulaParams(chapter, filters, 1)).toMatchObject({
      chapter_id: 2,
      category_id: undefined,
    });
    expect(
      previewFormulaParams(
        { ...chapter, id: 3, node_type: "group" },
        filters,
        2,
      ),
    ).toMatchObject({ category_id: 3, page: 2 });
  });

  it("does not forward admin-only status and unsupported library filters", () => {
    const params = previewFormulaParams(
      null,
      {
        ...filters,
        library_type: "pure_formula",
        status: "draft",
      } as typeof filters,
      1,
    );
    expect(params).not.toHaveProperty("status");
    expect(params.library_type).toBeUndefined();
  });
});
