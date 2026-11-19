type CatalogModel = {
  id: number;
  is_default: boolean;
  sort_order: number;
};

export function parseModelCatalogOrder(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(
      (id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
    ))];
  } catch {
    return [];
  }
}

export function sortModelCatalog<Model extends CatalogModel>(
  models: Model[],
  order: number[],
): Model[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...models].sort((left, right) => {
    const leftPosition = positions.get(left.id) ?? Infinity;
    const rightPosition = positions.get(right.id) ?? Infinity;
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
    return left.sort_order - right.sort_order || left.id - right.id;
  });
}

export function moveModelCatalogItem<Model extends { id: number }>(
  models: Model[],
  visibleIds: number[],
  sourceId: number,
  targetId: number,
): Model[] {
  const visibleSet = new Set(visibleIds);
  const visibleModels = models.filter((model) => visibleSet.has(model.id));
  const sourceIndex = visibleModels.findIndex((model) => model.id === sourceId);
  const targetIndex = visibleModels.findIndex((model) => model.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return models;
  const [moved] = visibleModels.splice(sourceIndex, 1);
  visibleModels.splice(targetIndex, 0, moved);
  let visibleIndex = 0;
  return models.map((model) => visibleSet.has(model.id) ? visibleModels[visibleIndex++] : model);
}
