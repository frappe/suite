import { createApp, defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  open: vi.fn(),
  dispose: vi.fn(),
  surface: { name: "WriterTestSurface", render: () => null },
  preview: { name: "FileTestSurface", render: () => null },
}));

vi.mock("@/apps/drive", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  return {
    // Stands in for the password form: a click is a right password.
    DriveUnlockScreen: define({
      emits: ["unlocked"],
      setup: (_props, { emit }) => () => render("button", { "data-unlock": "", onClick: () => emit("unlocked") }, "Password required"),
    }),
    isDriveLocked: (error: { type?: string }) => error?.type === "DriveLocked",
    filePreviewSurface: testState.preview,
    openDocumentSession: testState.open,
    driveNodeRoute: (node: string, title: string) => ({
      path: `/d/${node}/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    }),
  };
});

vi.mock("@/composition/documentRegistry", () => ({
  documentTypes: [{
    contentDoctype: "Writer Document",
    newLabel: () => "New document",
    icon: {},
    loadSurface: async () => testState.surface,
  }],
}));

import DocumentHost, { selectDocumentSurface } from "./DocumentHost.vue";
import { TransportError } from "@/platform/transport";
import { GUEST_FRAME_KEY } from "@/shell/guestFrame";

async function mountHost(provide?: (app: ReturnType<typeof createApp>) => void) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/d/:node/:slug?", component: DocumentHost }],
  });
  await router.push("/d/node-1/quarterly-plan");
  await router.isReady();
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(defineComponent({ setup: () => () => h(DocumentHost) }));
  provide?.(app);
  app.use(router);
  app.mount(root);
  return { root, app };
}

const refusal = (status: number, type: string) => new TransportError({ status, type, message: type });

function session(contentDoctype = "Writer Document") {
  return {
    nodeId: "node-1",
    contentDoctype,
    contentDocname: "content-1",
    title: ref("Quarterly plan"),
    state: ref("Active"),
    access: ref({ role: 40 }),
    dispose: testState.dispose,
  } as any;
}

afterEach(() => {
  testState.open.mockReset();
  testState.dispose.mockReset();
  document.body.innerHTML = "";
});

describe("DocumentHost", () => {
  it("selects the registered product adapter and the Drive file surface", async () => {
    const definitions = [{
      contentDoctype: "Writer Document",
      newLabel: () => "New document",
      icon: {},
      loadSurface: async () => testState.surface,
    }] as any;
    expect(await selectDocumentSurface(session(), definitions)).toBe(testState.surface);
    expect(await selectDocumentSurface(session("File"), definitions)).toBe(testState.preview);
    expect(await selectDocumentSurface(session("Unknown"), definitions)).toBeNull();
  });

  it("replacement-navigates a stale decorative slug", async () => {
    testState.open.mockResolvedValue(session());
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/d/:node/:slug?", component: DocumentHost }],
    });
    await router.push("/d/node-1/stale");
    await router.isReady();
    const root = document.createElement("div");
    document.body.append(root);
    const app = createApp(DocumentHost);
    app.use(router);
    app.mount(root);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/d/node-1/quarterly-plan"));
    expect(router.options.history.state.back).toBeFalsy();
    app.unmount();
    expect(testState.dispose).toHaveBeenCalledOnce();
  });

  it("shows the unlock screen in place for a locked link, and opens the document once unlocked", async () => {
    testState.open.mockRejectedValueOnce(refusal(401, "DriveLocked")).mockResolvedValue(session());
    const { root, app } = await mountHost();

    await vi.waitFor(() => expect(root.querySelector("[data-unlock]")).not.toBeNull());
    expect(root.textContent).not.toContain("Quarterly plan");
    root.querySelector<HTMLButtonElement>("[data-unlock]")!.click();

    await vi.waitFor(() => expect(root.querySelector("[data-unlock]")).toBeNull());
    expect(testState.open).toHaveBeenCalledTimes(2);
    app.unmount();
  });

  it("opens again when an open document's access lapses, so an expired ticket asks for the password", async () => {
    const open = session();
    testState.open.mockResolvedValueOnce(open).mockRejectedValue(refusal(401, "DriveLocked"));
    const { root, app } = await mountHost();
    await vi.waitFor(() => expect(testState.open).toHaveBeenCalledOnce());

    open.state.value = "Refused";

    await vi.waitFor(() => expect(root.querySelector("[data-unlock]")).not.toBeNull());
    app.unmount();
  });

  it("asks the guest frame for the Sign-in screen and says nothing about the item", async () => {
    testState.open.mockRejectedValue(refusal(404, "DriveNotFound"));
    const requireSignIn = vi.fn();
    const { root, app } = await mountHost((host) => host.provide(GUEST_FRAME_KEY, { requireSignIn }));

    await vi.waitFor(() => expect(requireSignIn).toHaveBeenCalledOnce());
    expect(root.textContent).not.toMatch(/not found|could not open/i);
    app.unmount();
  });
});
