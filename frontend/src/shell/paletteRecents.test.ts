import { beforeEach, describe, expect, it } from "vitest";

import { readPaletteRecents, rememberPaletteRecent } from "./paletteRecents";

describe("palette recents", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the latest five unique selections", () => {
    for (let index = 0; index < 6; index++) {
      rememberPaletteRecent({
        kind: "entity",
        id: String(index),
        label: `Item ${index}`,
        href: `/item/${index}`,
      });
    }
    rememberPaletteRecent({
      kind: "entity",
      id: "3",
      label: "Item 3",
      href: "/item/3",
    });

    expect(readPaletteRecents().map(({ id }) => id)).toEqual([
      "3",
      "5",
      "4",
      "2",
      "1",
    ]);
  });

  it("ignores invalid stored data", () => {
    localStorage.setItem("suite-palette-recents", "invalid");
    expect(readPaletteRecents()).toEqual([]);
  });

  it("ignores entries from the old app and mail history", () => {
    localStorage.setItem(
      "suite-palette-recents",
      JSON.stringify([{ id: "app:drive", label: "Drive", href: "/drive" }]),
    );
    expect(readPaletteRecents()).toEqual([]);
  });
});
