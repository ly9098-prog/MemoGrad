import type { KnowledgeOutline } from "@/lib/api/types";

type OutlineItem = KnowledgeOutline & {
  subject_id: number;
  subject_name: string;
  knowledge_point_id: number;
};

export type KnowledgeBranch<T> = { item: T; children: KnowledgeBranch<T>[] };

/** Use canonical parent IDs and outline order, promoting orphans to visible roots. */
export function buildKnowledgeTree<T extends OutlineItem>(
  items: T[],
): KnowledgeBranch<T>[] {
  const nodes = new Map(
    [...items]
      .sort((a, b) => (a.outline_order ?? 0) - (b.outline_order ?? 0))
      .map((item) => [
        item.knowledge_point_id,
        { item, children: [] } as KnowledgeBranch<T>,
      ]),
  );
  const roots: KnowledgeBranch<T>[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.item.parent_knowledge_point_id ?? -1);
    const visited = new Set([node.item.knowledge_point_id]);
    let ancestor = parent;
    while (ancestor && !visited.has(ancestor.item.knowledge_point_id)) {
      visited.add(ancestor.item.knowledge_point_id);
      ancestor = nodes.get(ancestor.item.parent_knowledge_point_id ?? -1);
    }
    if (parent && parent.item.subject_id === node.item.subject_id && !ancestor)
      parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** A filtered tree keeps ancestors so matches retain their actual location. */
export function withOutlineAncestors<T extends OutlineItem>(
  catalog: T[],
  matches: T[],
): T[] {
  const byId = new Map(catalog.map((item) => [item.knowledge_point_id, item]));
  const keep = new Set<number>();
  for (const match of matches) {
    let item: T | undefined = match;
    while (item && !keep.has(item.knowledge_point_id)) {
      keep.add(item.knowledge_point_id);
      const parent: T | undefined = byId.get(
        item.parent_knowledge_point_id ?? -1,
      );
      item = parent?.subject_id === match.subject_id ? parent : undefined;
    }
  }
  return catalog.filter((item) => keep.has(item.knowledge_point_id));
}

/** Preserve authoritative chapter identity, including when a filtered view omits its root. */
export function groupKnowledgeChapters<T extends OutlineItem>(items: T[]) {
  const groups = new Map<
    string,
    { key: string; name: string; subject: string; items: T[] }
  >();
  for (const item of [...items].sort(
    (a, b) => (a.outline_order ?? 0) - (b.outline_order ?? 0),
  )) {
    const key = `${item.subject_id}:${item.chapter_id ?? "unclassified"}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        name: item.chapter_name || "未归入章节",
        subject: item.subject_name,
        items: [],
      });
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()];
}

export function outlineLabel(item: KnowledgeOutline & { name: string }) {
  return item.outline_path?.at(-1) || item.name;
}

export function matchesOutline(
  item: KnowledgeOutline & {
    name: string;
    subject_name: string;
    knowledge_point_id: number;
  },
  keyword: string,
) {
  return `${item.subject_name} ${item.name} ${item.chapter_name ?? ""} ${item.outline_path?.join(" ") ?? ""} ${item.knowledge_point_id}`
    .toLowerCase()
    .includes(keyword.trim().toLowerCase());
}
