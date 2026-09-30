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

  it("contains the canonical grammar that answers before the files flip", () => {
    expect(canonicalRoutes.map((route) => route.path)).toEqual([
      "/home",
      "/mail/:pathMatch(.*)*",
      "/calendar/:pathMatch(.*)*",
      "/meet/:pathMatch(.*)*",
      "/d/:node/:slug?",
    ]);
  });
});

describe("the files flip", () => {
  afterEach(() => {
    delete window.suite_flip_files;
    vi.resetModules();
  });

  it("mounts the Drive area under /drive once the boot turns the flip on", async () => {
    window.suite_flip_files = true;
    vi.resetModules();
    const { canonicalRoutes } = await import("@/composition/routes");
    expect(canonicalRoutes.map((route) => route.path)).toEqual([
      "/home",
      "/drive",
      "/drive/organization",
      "/drive/f/:node/:slug?",
      "/drive/recent",
      "/drive/starred",
      "/drive/shared-with-me",
      "/drive/trash",
      "/mail/:pathMatch(.*)*",
      "/calendar/:pathMatch(.*)*",
      "/meet/:pathMatch(.*)*",
      "/d/:node/:slug?",
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
