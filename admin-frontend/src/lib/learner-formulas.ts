import type { FormulaCategoryNode } from "@/components/formulas/formula-category-picker";

export type PublicFormulaCategory = FormulaCategoryNode & {
  available_count?: number;
  children: PublicFormulaCategory[];
};

export type PreviewCategory = Omit<FormulaCategoryNode, "children"> & {
  subtree_formula_count?: number;
  children: PreviewCategory[];
};

export function previewCategoryTree(
  nodes: PublicFormulaCategory[],
): PreviewCategory[] {
  return nodes.map((node) => ({
    ...node,
    subtree_formula_count: node.available_count ?? 0,
    children: previewCategoryTree(node.children),
  }));
}

export function previewFormulaParams(
  category: FormulaCategoryNode | null,
  filters: { q: string; library_type: string; study_card_type: string },
  page: number,
) {
  return {
    page,
    page_size: 20,
    q: filters.q || undefined,
    library_type:
      filters.library_type === "function_graph" ? "function_graph" : undefined,
    study_card_type: filters.study_card_type || undefined,
    subject_code: category?.node_type === "subject" ? category.code : undefined,
    chapter_id: category?.node_type === "chapter" ? category.id : undefined,
    category_id:
      category && !["subject", "chapter"].includes(category.node_type)
        ? category.id
        : undefined,
  };
}
