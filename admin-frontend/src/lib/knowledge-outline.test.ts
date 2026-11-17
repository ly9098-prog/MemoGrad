import { describe, expect, it } from "vitest";
import { buildKnowledgeTree, withOutlineAncestors } from "./knowledge-outline";

const node = (id: number, parent: number | null, subject = 2) => ({
  knowledge_point_id: id,
  parent_knowledge_point_id: parent,
  subject_id: subject,
  subject_name: "数据结构",
});

describe("catalog parent relationships", () => {
  it("uses outline order even when the API returns items by name", () => {
    const first = { ...node(1, null), outline_order: 0 };
    const second = { ...node(2, null), outline_order: 10 };
    expect(
      buildKnowledgeTree([second, first]).map((n) => n.item.knowledge_point_id),
    ).toEqual([1, 2]);
  });
  it("nests by canonical IDs without duplicating the chapter root", () => {
    const items = [node(1, null), node(2, 1), node(3, 2), node(4, 1)];
    const tree = buildKnowledgeTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((n) => n.item.knowledge_point_id)).toEqual([
      2, 4,
    ]);
    expect(tree[0].children[0].children[0].item.knowledge_point_id).toBe(3);
  });
  it("search retains the path to a matching descendant without adding unrelated siblings", () => {
    const items = [node(1, null), node(2, 1), node(3, 2), node(4, 1)];
    expect(
      withOutlineAncestors(items, [items[2]]).map((n) => n.knowledge_point_id),
    ).toEqual([1, 2, 3]);
    expect(withOutlineAncestors(items, [])).toEqual([]);
  });
  it("keeps orphans and cyclic input visible without recursive cycles", () => {
    const items = [node(1, 2), node(2, 1), node(3, 999), node(4, 1, 3)];
    const tree = buildKnowledgeTree(items);
    expect(tree.map((n) => n.item.knowledge_point_id)).toEqual([1, 2, 3, 4]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
    expect(withOutlineAncestors(items, [items[0]])).toHaveLength(2);
  });
});
