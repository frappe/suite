import { createApp, defineComponent, h, type Component } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("frappe-ui", () => {
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("div", attrs, slots.default?.());
    },
  });
  return {
    PageHeader: passthrough,
    PageHeaderMobile: passthrough,
    PageHeaderTitle: passthrough,
    SidebarItem: passthrough,
    SidebarLabel: passthrough,
  };
});

import { filesArea } from "@/apps/drive";
import ContentPane from "@/shell/ContentPane.vue";
import DocumentFrame from "@/shell/DocumentFrame.vue";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

describe.each([1280, 390])("shell mount seam at %ipx", (width) => {
  it("mounts shell scrolling, content scrolling and a full-pane canvas without product branches", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    const { routes } = await filesArea.loadRoutes();
    const FilesPage = routes[0]?.component as Component;
    const files = mount(
      defineComponent({
        setup: () => () =>
          h(ContentPane, { scroll: "shell" }, { default: () => h(FilesPage) }),
      }),
    );
    expect(files.querySelector('[data-scroll-owner="shell"]')).not.toBeNull();
    expect(
      files.querySelectorAll("[data-files-placeholder] > div > div"),
    ).toHaveLength(200);

    const content = mount(
      defineComponent({
        setup: () => () =>
          h(
            ContentPane,
            { scroll: "content" },
            {
              default: () =>
                h("div", {
                  "data-self-scroll": "",
                  class: "h-full overflow-auto",
                }),
            },
          ),
      }),
    );
    expect(
      content.querySelector('[data-scroll-owner="content"]')?.className,
    ).toContain("overflow-hidden");
    expect(content.querySelector("[data-self-scroll]")?.className).toContain(
      "overflow-auto",
    );

    const documentFrame = mount(
      defineComponent({
        setup: () => () =>
          h(DocumentFrame, null, {
            default: () =>
              h("canvas", { width: 960, height: 540, "data-fixed-canvas": "" }),
          }),
      }),
    );
    expect(
      documentFrame.querySelector("[data-shell-document-frame]")?.className,
    ).toContain("overflow-hidden");
    expect(
      documentFrame.querySelector("[data-fixed-canvas]")?.getAttribute("width"),
    ).toBe("960");
  });
});

function mount(component: Component): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp(component);
  app.mount(root);
  cleanups.push(() => {
    app.unmount();
    root.remove();
  });
  return root;
}
