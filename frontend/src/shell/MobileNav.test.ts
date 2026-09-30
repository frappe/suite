import { createApp, defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// A phone-width media query, before the platform reads it.
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
});

// Unit tests alias frappe-ui to a stub. The bar, its items and the sheet are
// the real components here, so a wrong prop name fails the test.
vi.mock("frappe-ui", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup: (_props, { attrs, slots }) => () => h("div", attrs, slots.default?.()),
  });
  return {
    MobileNav: (await import("../../../node_modules/frappe-ui/src/components/MobileNav/MobileNav.vue")).default,
    MobileNavItem: (await import("../../../node_modules/frappe-ui/src/components/MobileNav/MobileNavItem.vue")).default,
    BottomSheet: (await import("../../../node_modules/frappe-ui/src/components/BottomSheet/BottomSheet.vue")).default,
    Avatar: passthrough,
    ScrollArea: passthrough,
    Sidebar: passthrough,
    Skeleton: passthrough,
  };
});

import { AreaSidebar } from "@/platform/area-sidebar";
import type { AreaDefinition } from "@/platform/contracts";
import MobileNav from "@/shell/MobileNav.vue";
import { AREA_PROGRESS_KEY, type AreaProgressSource } from "@/shell/areaProgress";

const icon = defineComponent({ setup: () => () => h("span") });
const area = (id: string, label: string): AreaDefinition => ({
  id,
  label: () => label,
  icon,
  to: `/${id}`,
  loadRoutes: vi.fn(),
});
const areas = [area("home", "Home"), area("files", "Files")];

const FilesPage = defineComponent({
  setup: () => () =>
    h(AreaSidebar, { area: "files", title: "Files" }, () =>
      h("a", { "data-files-panel": "" }, "Starred"),
    ),
});
const DocumentPage = defineComponent({ setup: () => () => h("div", "Document") });

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

async function mountAt(path: string, progress?: AreaProgressSource) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/home", component: { render: () => h("div", "Home") }, meta: { area: "home" } },
      { path: "/files/:view?", component: FilesPage, meta: { area: "files" } },
      { path: "/d/:node", component: DocumentPage, meta: { area: "files" } },
    ],
  });
  await router.push(path);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp({
    setup: () => () => [
      h(RouterView),
      h(MobileNav, {
        areas,
        activeArea: router.currentRoute.value.meta.area as string | undefined,
      }),
    ],
  });
  app.use(router);
  if (progress) app.provide(AREA_PROGRESS_KEY, progress);
  app.mount(root);
  await router.isReady();
  await nextTick();
  cleanup = () => {
    app.unmount();
    root.remove();
  };
  const item = (label: string) =>
    root.querySelector<HTMLElement>(`[data-slot="mobile-nav-item"][aria-label="${label}"]`)!;
  return { router, root, item };
}

describe("phone bottom nav", () => {
  it("moves to another area, and opens the active area's sidebar sheet", async () => {
    const { router, item } = await mountAt("/files/starred");

    expect(item("Home").getAttribute("href")).toBe("/home");
    expect(item("Account")).not.toBeNull();

    item("Files").click();
    await vi.waitFor(() =>
      expect(document.body.querySelector("[role='dialog'] [data-files-panel]")).not.toBeNull(),
    );
    expect(router.currentRoute.value.fullPath).toBe("/files/starred");

    item("Home").click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/home"));
  });

  it("navigates to the area when the active page draws no sidebar", async () => {
    const { router, item } = await mountAt("/d/node-1");
    item("Files").click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/files"));
  });
});

describe("area progress on the bottom nav", () => {
  it("draws the ring on the area that runs work, and opens its view on click", async () => {
    const opened: string[] = [];
    const { root, item } = await mountAt("/home", {
      progress: (area) => (area === "files" ? { fraction: 0.4, tone: "paused", attention: true } : null),
      open: (area) => opened.push(area),
    });

    const ring = item("Files").querySelector("[data-slot='area-progress-ring']");
    expect(ring?.getAttribute("data-tone")).toBe("paused");
    expect(item("Files").querySelector("[data-slot='area-progress-attention']")).not.toBeNull();
    expect(item("Home").querySelector("[data-slot='area-progress-ring']")).toBeNull();
    expect(root.querySelectorAll("[data-slot='area-progress-ring']")).toHaveLength(1);

    item("Files").click();
    expect(opened).toEqual(["files"]);
  });
});
