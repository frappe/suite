import { describe, expect, it, vi } from "vitest";

import {
  CompositeGroupLoader,
  mergeCompositeSlides,
  type CompositeManifest,
} from "./compositeGroups";

const manifest: CompositeManifest = {
  presentation: "deck",
  node: "node",
  modified: "2026-09-15",
  group_limit: 2,
  references: [
    { reference: "a", index: 1, presentation: "A" },
    { reference: "b", index: 2, presentation: "B" },
    { reference: "c", index: 3, presentation: "C" },
  ],
};

describe("composite group loading", () => {
  it("keeps manifest order when one group fails and retries only that group", async () => {
    const grouper = {
      group: vi.fn(async (ids: readonly string[]) => [{ nodeIds: [...ids], codes: [] }]),
      codesFor: vi.fn(),
    };
    let fail = true;
    const request = vi.fn(async (references: string[]) => {
      if (references.includes("c") && fail) throw new Error("offline");
      return {
        references: references.map((reference) => ({
          reference,
          index: manifest.references.find((row) => row.reference === reference)!.index,
          presentation: reference.toUpperCase(),
          readable: reference !== "b",
          node: reference === "b" ? null : `node-${reference}`,
          composite: reference === "b" ? null : false,
          slides: reference === "b" ? null : [{ name: `slide-${reference}` }],
        })),
      };
    });
    const loader = new CompositeGroupLoader(manifest, grouper, request);

    await loader.load();
    expect(loader.items.map((item) => [item.reference, item.status])).toEqual([
      ["a", "ready"],
      ["b", "unreadable"],
      ["c", "failed"],
    ]);
    expect(mergeCompositeSlides(loader.items).map((item) => [item.reference, item.status])).toEqual([
      ["a", "ready"],
      ["b", "unreadable"],
      ["c", "failed"],
    ]);

    fail = false;
    await loader.retry(1);
    expect(loader.items.map((item) => [item.reference, item.status])).toEqual([
      ["a", "ready"],
      ["b", "unreadable"],
      ["c", "ready"],
    ]);
  });
});
