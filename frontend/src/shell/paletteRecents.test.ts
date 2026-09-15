import { beforeEach, describe, expect, it } from "vitest";

import { readPaletteRecents, rememberPaletteRecent } from "./paletteRecents";

describe("palette recents", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the latest five unique selections", () => {
    for (let index = 0; index < 6; index++) {
      rememberPaletteRecent({
        id: String(index),
        label: `Item ${index}`,
        href: `/item/${index}`,
      });
    }
    rememberPaletteRecent({ id: "3", label: "Item 3", href: "/item/3" });

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
});
