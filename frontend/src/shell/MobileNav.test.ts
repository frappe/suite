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
const area = (id: string, label: string, to = `/${id}`): AreaDefinition => ({
  id,
  label: () => label,
  icon,
  to,
  loadRoutes: vi.fn(),
});
const areas = [area("home", "Home"), area("files", "Drive", "/drive")];

const FilesPage = defineComponent({
  setup: () => () =>
    h(AreaSidebar, { area: "files", title: "Drive" }, () =>
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
      { path: "/drive/:view?", component: FilesPage, meta: { area: "files" } },
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
    const { router, item } = await mountAt("/drive/starred");

    expect(item("Home").getAttribute("href")).toBe("/home");
    expect(item("Account")).not.toBeNull();

    item("Drive").click();
    await vi.waitFor(() =>
      expect(document.body.querySelector("[role='dialog'] [data-files-panel]")).not.toBeNull(),
    );
    expect(router.currentRoute.value.fullPath).toBe("/drive/starred");

    item("Home").click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/home"));
  });

  it("navigates to the area when the active page draws no sidebar", async () => {
    const { router, item } = await mountAt("/d/node-1");
    item("Drive").click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/drive"));
  });
});

describe("area progress on the bottom nav", () => {
  it("draws one dot on the area that runs work, and opens its view on click", async () => {
    const opened: string[] = [];
    const { root, item } = await mountAt("/home", {
      progress: (area) => (area === "files" ? { fraction: 0.4, tone: "paused", attention: true } : null),
      open: (area) => opened.push(area),
    });

    const dot = item("Drive").querySelector("[data-slot='area-progress-dot']");
    expect(dot?.getAttribute("data-tone")).toBe("paused");
    expect(dot?.getAttribute("data-attention")).toBe("true");
    expect(item("Home").querySelector("[data-slot='area-progress-dot']")).toBeNull();
    expect(root.querySelectorAll("[data-slot='area-progress-dot']")).toHaveLength(1);

    item("Drive").click();
    expect(opened).toEqual(["files"]);
    expect(item("Drive").querySelector("[role='status']")?.textContent).toBe("Drive: Needs attention");
  });

  it("opens only the tracker from the active area's item, never the sidebar too", async () => {
    const opened: string[] = [];
    const { router, item } = await mountAt("/drive/starred", {
      progress: (area) => (area === "files" ? { fraction: 0.5, tone: "running", attention: false } : null),
      open: (area) => opened.push(area),
    });

    item("Drive").click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/drive"));
    expect(opened).toEqual(["files"]);
    expect(document.body.querySelector("[role='dialog'] [data-files-panel]")).toBeNull();
    expect(item("Drive").querySelector("[role='status']")?.textContent).toBe("Drive: In progress");
    expect(item("Drive").querySelector("[data-slot='area-progress-dot']")?.getAttribute("data-attention")).toBe("false");
  });

  it("draws no dot once the work is done, and still says so", async () => {
    const { root, item } = await mountAt("/home", {
      progress: (area) => (area === "files" ? { fraction: 1, tone: "done", attention: false } : null),
      open: () => {},
    });

    expect(root.querySelector("[data-slot='area-progress-dot']")).toBeNull();
    expect(item("Drive").querySelector("[role='status']")?.textContent).toBe("Drive: Done");
  });
});
