import { createApp, defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, describe, expect, it } from "vitest";

import { installPageMeta, usePageTitle } from "@/platform/page-meta";

let cleanup: (() => void) | undefined;

afterEach(() => cleanup?.());

describe("page metadata navigation", () => {
  it("uses the active view title and restores the next route fallback after unmount", async () => {
    const LivePage = defineComponent({
      setup() {
        usePageTitle(() => "Live document title");
        return () => h("div");
      },
    });
    const PlainPage = defineComponent({ setup: () => () => h("div") });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/document",
          component: LivePage,
          meta: { title: "Document fallback" },
        },
        { path: "/home", component: PlainPage, meta: { title: "Home" } },
      ],
    });
    const removeMeta = installPageMeta(router);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const app = createApp({ setup: () => () => h(RouterView) });
    app.use(router);

    cleanup = () => {
      app.unmount();
      removeMeta();
      root.remove();
    };

    await router.push("/document");
    await router.isReady();
    app.mount(root);
    await nextTick();
    expect(document.title).toBe("Live document title");

    await router.push("/home");
    await nextTick();
    expect(document.title).toBe("Home");
  });
});
