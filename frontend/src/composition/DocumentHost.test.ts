import { createApp, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  open: vi.fn(),
  dispose: vi.fn(),
  surface: { name: "WriterTestSurface", render: () => null },
  preview: { name: "FileTestSurface", render: () => null },
}));

vi.mock("@/apps/drive", () => ({
  filePreviewSurface: testState.preview,
  openDocumentSession: testState.open,
  driveNodeRoute: (node: string, title: string) => ({
    path: `/d/${node}/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  }),
}));

vi.mock("@/composition/documentRegistry", () => ({
  documentTypes: [{
    contentDoctype: "Writer Document",
    newLabel: () => "New document",
    icon: {},
    loadSurface: async () => testState.surface,
  }],
}));

import DocumentHost, { selectDocumentSurface } from "./DocumentHost.vue";

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
});
