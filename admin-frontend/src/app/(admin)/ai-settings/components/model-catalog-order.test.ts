import { describe, expect, it } from "vitest";
import { moveModelCatalogItem, parseModelCatalogOrder, sortModelCatalog } from "./model-catalog-order";

const models = [
  { id: 1, is_enabled: true, is_default: false, sort_order: 2 },
  { id: 2, is_enabled: true, is_default: true, sort_order: 5 },
  { id: 3, is_enabled: true, is_default: false, sort_order: 1 },
  { id: 4, is_enabled: true, is_default: false, sort_order: 2 },
];

describe("model catalog order", () => {
  const mixedModels = models.map((model) => ({ ...model, is_enabled: model.id === 1 || model.id === 3 }));

  it("prioritizes enabled models over default status and saved positions", () => {
    expect(sortModelCatalog(mixedModels, []).map((model) => model.id)).toEqual([3, 1, 2, 4]);
    expect(sortModelCatalog(mixedModels, [4, 1, 2, 3]).map((model) => model.id)).toEqual([1, 3, 4, 2]);
  });

  it("places a newly added enabled model before saved disabled models", () => {
    expect(sortModelCatalog(mixedModels, [4, 2, 1]).map((model) => model.id)).toEqual([1, 3, 4, 2]);
  });

  it("regroups after a status change while preserving saved order within groups", () => {
    const changed = mixedModels.map((model) => ({ ...model, is_enabled: model.id === 2 || model.id === 3 }));
    expect(sortModelCatalog(changed, [1, 3, 4, 2]).map((model) => model.id)).toEqual([3, 2, 1, 4]);
  });

  it("rejects moves across enabled and disabled groups in both directions", () => {
    const ordered = sortModelCatalog(mixedModels, []);
    expect(moveModelCatalogItem(ordered, [3, 1, 2, 4], 1, 2)).toBe(ordered);
    expect(moveModelCatalogItem(ordered, [3, 1, 2, 4], 2, 1)).toBe(ordered);
  });

  it("preserves the disabled group during a filtered enabled move", () => {
    const ordered = sortModelCatalog(mixedModels, []);
    const moved = moveModelCatalogItem(ordered, [3, 1, 4], 1, 3);
    expect(moved.map((model) => model.id)).toEqual([1, 3, 2, 4]);
    expect(moved[2]).toBe(ordered[2]);
    expect(moved[3]).toBe(ordered[3]);
  });

  it("starts with the existing default, then server order and stable IDs", () => {
    expect(sortModelCatalog(models, []).map((model) => model.id)).toEqual([2, 3, 1, 4]);
    expect(models.map((model) => model.id)).toEqual([1, 2, 3, 4]);
  });

  it("allows the default model to move without changing its routing priority", () => {
    const ordered = sortModelCatalog(models, [3, 1, 4, 2]);
    expect(ordered.map((model) => model.id)).toEqual([3, 1, 4, 2]);
    expect(ordered.find((model) => model.id === 2)).toBe(models[1]);
    expect(models[1]).toEqual({ id: 2, is_enabled: true, is_default: true, sort_order: 5 });
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
