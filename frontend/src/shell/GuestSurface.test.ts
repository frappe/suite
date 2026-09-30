import { createApp, defineComponent, h, inject, nextTick } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import GuestSurface from "@/shell/GuestSurface.vue";
import { GUEST_FRAME_KEY } from "@/platform/contracts";

vi.mock("frappe-ui", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    Button: define({
      props: { label: String },
      emits: ["click"],
      setup: (props, { emit }) => () => render("button", { onClick: () => emit("click") }, props.label),
    }),
    DesktopShell: define({ setup: (_props, { slots }) => () => render("main", slots.default?.()) }),
  };
});

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  vi.restoreAllMocks();
});

/** A page that cannot be read without the link, as a refused node route behaves. */
const RefusedPage = defineComponent({
  setup() {
    inject(GUEST_FRAME_KEY)?.requireSignIn();
    return () => h("p", "Quarterly plan");
  },
});
const ReadablePage = defineComponent({ setup: () => () => h("p", "Shared folder") });

async function mountFrame(path: string, withPage = true) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/d/:node", component: RefusedPage },
      { path: "/drive/f/:node", component: ReadablePage },
    ],
  });
  await router.push(path);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp({
    setup: () => () => h(GuestSurface, null, withPage ? { default: () => h(RouterView) } : {}),
  });
  app.use(router);
  app.mount(root);
  await nextTick();
  cleanup = () => {
    app.unmount();
    root.remove();
  };
  return { root, router };
}

describe("the guest frame", () => {
  it("shows the shared page under a header with only the Suite mark and Sign in", async () => {
    const { root } = await mountFrame("/drive/f/folder-1");

    expect(root.querySelector("header")?.textContent).toBe("Frappe SuiteSign in");
    expect(root.textContent).toContain("Shared folder");
    expect(root.textContent).not.toContain("Sign in to open this");
  });

  it("shows the Sign-in screen for a page the visitor cannot read, and never names the item", async () => {
    const { root, router } = await mountFrame("/d/doc-1?view=comments");
    await nextTick();
    const refused = root.textContent;
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });
    root.querySelector<HTMLButtonElement>("main button")?.click();

    await router.push("/drive/f/folder-1");
    await nextTick();

    expect(refused).toContain("Sign in to open this");
    expect(refused).toContain("If someone sent you a share link, open that link.");
    expect(refused).not.toContain("Quarterly plan");
    expect(assign).toHaveBeenCalledWith("/login?redirect-to=%2Fd%2Fdoc-1%3Fview%3Dcomments");
    expect(root.textContent).toContain("Shared folder");
  });

  it("never carries a fragment, and so no share-link token, into the Sign-in redirect", async () => {
    const { root } = await mountFrame("/d/doc-1?view=comments#link=L000000000000000000001&x=1");
    await nextTick();
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign });

    root.querySelector<HTMLButtonElement>("header button")?.click();

    expect(assign).toHaveBeenCalledWith("/login?redirect-to=%2Fd%2Fdoc-1%3Fview%3Dcomments");
  });

  it("shows the Sign-in screen when it has no page to show", async () => {
    const { root } = await mountFrame("/d/doc-1", false);

    expect(root.textContent).toContain("Sign in to open this");
  });
});
