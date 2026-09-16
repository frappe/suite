import { describe, expect, it } from "vitest";

import { canonicalRoutes } from "@/composition/routes";

describe("canonical route metadata", () => {
  it("declares a frame and scroll owner on every canonical route", () => {
    for (const route of canonicalRoutes) {
      expect(route.meta?.frame, String(route.path)).toMatch(
        /^(area|document|none)$/,
      );
      expect(route.meta?.scroll, String(route.path)).toMatch(
        /^(shell|content)$/,
      );
    }
  });

  it("contains the complete canonical grammar", () => {
    expect(canonicalRoutes.map((route) => route.path)).toEqual([
      "/home",
      "/files",
      "/files/organization",
      "/files/f/:node/:slug?",
      "/files/recent",
      "/files/starred",
      "/files/shared-with-me",
      "/files/trash",
      "/mail/:pathMatch(.*)*",
      "/calendar/:pathMatch(.*)*",
      "/d/:node/:slug?",
      "/l/:token",
    ]);
  });
});
