import { describe, expect, it } from "vitest";
import { moveModelCatalogItem, parseModelCatalogOrder, sortModelCatalog } from "./model-catalog-order";

const models = [
  { id: 1, is_default: false, sort_order: 2 },
  { id: 2, is_default: true, sort_order: 5 },
  { id: 3, is_default: false, sort_order: 1 },
  { id: 4, is_default: false, sort_order: 2 },
];

describe("model catalog order", () => {
  it("starts with the existing default, then server order and stable IDs", () => {
    expect(sortModelCatalog(models, []).map((model) => model.id)).toEqual([2, 3, 1, 4]);
    expect(models.map((model) => model.id)).toEqual([1, 2, 3, 4]);
  });

  it("allows the default model to move without changing its routing priority", () => {
    const ordered = sortModelCatalog(models, [3, 1, 4, 2]);
    expect(ordered.map((model) => model.id)).toEqual([3, 1, 4, 2]);
    expect(ordered.find((model) => model.id === 2)).toBe(models[1]);
    expect(models[1]).toEqual({ id: 2, is_default: true, sort_order: 5 });
  });

  it("ignores deleted IDs and appends new models in the server order", () => {
    expect(sortModelCatalog(models, [99, 4, 1]).map((model) => model.id)).toEqual([4, 1, 2, 3]);
  });

  it.each([null, "", "null", "{}", "true", "[not-json]"])(
    "falls back safely for invalid saved data: %s",
    (raw) => expect(parseModelCatalogOrder(raw)).toEqual([]),
  );

  it("rejects invalid IDs and deduplicates saved values", () => {
    expect(parseModelCatalogOrder('[3, "2", 1, 3, 0, -1, 1.5, null, {}, 9007199254740992, 4]'))
      .toEqual([3, 1, 4]);
  });

  it("moves down and up without losing any model or mutating server data", () => {
    const down = moveModelCatalogItem(models, [1, 2, 3, 4], 1, 4);
    expect(down.map((model) => model.id)).toEqual([2, 3, 4, 1]);
    expect(moveModelCatalogItem(down, [2, 3, 4, 1], 1, 2).map((model) => model.id))
      .toEqual([1, 2, 3, 4]);
    expect(models.map((model) => model.id)).toEqual([1, 2, 3, 4]);
  });

  it("reorders filtered models within their slots and leaves hidden models in place", () => {
    const reordered = moveModelCatalogItem(models, [1, 3, 4], 4, 1);
    expect(reordered.map((model) => model.id)).toEqual([4, 2, 1, 3]);
    expect(reordered[1]).toBe(models[1]);
    expect(reordered.every((model) => models.includes(model))).toBe(true);
  });

  it("persists a filtered move as a complete order for refresh and clear-filter", () => {
    const reordered = moveModelCatalogItem(models, [1, 4], 1, 4);
    const restored = sortModelCatalog(
      [...models].reverse(),
      parseModelCatalogOrder(JSON.stringify(reordered.map((model) => model.id))),
    );
    expect(restored.map((model) => model.id)).toEqual([4, 2, 3, 1]);
  });

  it.each([[1, 1], [1, 99], [99, 1], [2, 4]])(
    "leaves the order untouched for a cancelled or unavailable move %i → %i",
    (source, target) => {
      expect(moveModelCatalogItem(models, [1, 3, 4], source, target)).toBe(models);
    },
  );
});
