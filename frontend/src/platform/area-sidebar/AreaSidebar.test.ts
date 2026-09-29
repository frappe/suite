import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// Unit tests alias frappe-ui to a stub. The sidebar geometry comes from the
// real components.
vi.mock("frappe-ui", async () => ({
  BottomSheet: (await import("../../../../node_modules/frappe-ui/src/components/BottomSheet/BottomSheet.vue")).default,
  ScrollArea: (await import("../../../../node_modules/frappe-ui/src/components/ScrollArea/ScrollArea.vue")).default,
  Sidebar: (await import("../../../../node_modules/frappe-ui/src/components/Sidebar/Sidebar.vue")).default,
  Skeleton: (await import("../../../../node_modules/frappe-ui/src/components/Skeleton/Skeleton.vue")).default,
}));

import { AreaSidebar, AreaSidebarTarget, hasAreaSidebar } from "@/platform/area-sidebar";

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

async function mountShell() {
  const loading = ref(true);
  const area = ref<"files" | "home" | null>("files");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:any(.*)*", component: { render: () => null } }],
  });
  await router.push("/files");
  const Page = defineComponent({
    setup: () => () =>
      area.value &&
      h(AreaSidebar, { area: area.value, title: area.value === "files" ? "Files" : "Home", loading: loading.value }, () =>
        h("nav", { "data-panel": area.value }, "Panel"),
      ),
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp({
    setup: () => () => h("div", { "data-shell": "" }, [h("div", { "data-rail": "" }), h(AreaSidebarTarget), h("main", [h(Page)])]),
  });
  app.use(router);
  app.mount(root);
  await nextTick();
  cleanup = () => {
    app.unmount();
    root.remove();
  };
  const sidebar = () => root.querySelector<HTMLElement>("#suite-area-sidebar > [data-area-sidebar]");
  return { root, loading, area, sidebar };
}

describe("AreaSidebar on desktop", () => {
  it("draws a fixed-width sidebar in the shell slot, the same width while loading", async () => {
    const { root, loading, area, sidebar } = await mountShell();

    expect(sidebar()?.style.width).toBe("14rem");
    expect(sidebar()?.getAttribute("role")).toBe("complementary");
    expect(sidebar()?.getAttribute("aria-label")).toBe("Files");
    expect(sidebar()?.querySelector("[data-area-sidebar-skeleton]")).not.toBeNull();
    expect(root.querySelector("main [data-area-sidebar]")).toBeNull();

    loading.value = false;
    await nextTick();
    expect(sidebar()?.style.width).toBe("14rem");
    expect(sidebar()?.querySelector("[data-panel='files']")).not.toBeNull();
    expect(sidebar()?.querySelector("[data-area-sidebar-skeleton]")).toBeNull();
    expect(hasAreaSidebar("files")).toBe(true);

    area.value = "home";
    await nextTick();
    expect(sidebar()?.getAttribute("aria-label")).toBe("Home");
    expect(sidebar()?.style.width).toBe("14rem");
    expect(hasAreaSidebar("files")).toBe(false);
    expect(hasAreaSidebar("home")).toBe(true);

    area.value = null;
    await nextTick();
    expect(sidebar()).toBeNull();
    expect(hasAreaSidebar("home")).toBe(false);
  });
});
