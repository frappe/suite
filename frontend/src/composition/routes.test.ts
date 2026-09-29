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

  async function meetFrame() {
    vi.resetModules();
    const { canonicalRoutes } = await import("@/composition/routes");
    return canonicalRoutes.find((route) => route.meta?.area === "meet")?.meta
      ?.frame;
  }

  it("keeps Meet outside the shell while the boot leaves the flip off", async () => {
    expect(await meetFrame()).toBe("none");
  });

  it("puts Meet in the shell once the boot turns the flip on", async () => {
    window.suite_flip_shell = true;
    expect(await meetFrame()).toBe("shell");
  });
});
