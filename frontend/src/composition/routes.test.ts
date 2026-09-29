import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalRoutes } from "@/composition/routes";

describe("canonical route metadata", () => {
  it("declares a frame and scroll owner on every canonical route", () => {
    for (const route of canonicalRoutes) {
      expect(route.meta?.frame, String(route.path)).toMatch(
        /^(shell|none)$/,
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
      "/meet/:pathMatch(.*)*",
      "/d/:node/:slug?",
      "/l/:token",
    ]);
  });
});

describe("the shell flip", () => {
  afterEach(() => {
    delete window.suite_flip_shell;
    vi.resetModules();
  });

  async function frameOf(area: string) {
    vi.resetModules();
    const { canonicalRoutes } = await import("@/composition/routes");
    return canonicalRoutes.find((route) => route.meta?.area === area)?.meta
      ?.frame;
  }

  it.each(["meet", "calendar", "mail"])(
    "keeps %s outside the shell while the boot leaves the flip off",
    async (area) => {
      expect(await frameOf(area)).toBe("none");
    },
  );

  it.each(["meet", "calendar", "mail"])(
    "puts %s in the shell once the boot turns the flip on",
    async (area) => {
      window.suite_flip_shell = true;
      expect(await frameOf(area)).toBe("shell");
    },
  );
});
