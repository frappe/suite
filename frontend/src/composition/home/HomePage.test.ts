import { createApp, defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  recentFails: true,
  upcomingFails: false,
  push: vi.fn(),
  createDocument: vi.fn(),
}));

vi.mock("frappe-ui", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("div", attrs, slots.default?.());
    },
  });
  const Button = defineComponent({
    inheritAttrs: false,
    props: { label: String },
    emits: ["click"],
    setup(props, { attrs, emit, slots }) {
      return () =>
        h(
          "button",
          { ...attrs, onClick: (event: Event) => emit("click", event) },
          props.label || slots.default?.(),
        );
    },
  });
  const Dropdown = defineComponent({
    props: { options: { type: Array, default: () => [] } },
    setup(props, { slots }) {
      return () =>
        h("div", [
          slots.default?.(),
          ...(
            props.options as Array<{ label: string; onClick?: () => void }>
          ).map((option) =>
            h("button", { onClick: option.onClick }, option.label),
          ),
        ]);
    },
  });
  return {
    Button,
    Dialog: passthrough,
    Dropdown,
    FormControl: passthrough,
    PageHeader: passthrough,
    PageHeaderMobile: passthrough,
    PageHeaderTitle: passthrough,
    ScrollArea: passthrough,
    Skeleton: passthrough,
    toast: { success: vi.fn() },
  };
});

vi.mock("frappe-ui/list", async () => {
  const { defineComponent, h } = await import("vue");
  const component = (includeLabel = false) =>
    defineComponent({
      inheritAttrs: false,
      props: { label: String },
      setup(props, { attrs, slots }) {
        return () =>
          h("div", attrs, [
            includeLabel ? props.label : null,
            slots.default?.(),
          ]);
      },
    });
  return {
    List: component(),
    ListCell: component(),
    ListGroup: component(true),
    ListRow: component(),
  };
});

vi.mock("vue-router", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    RouterLink: defineComponent({
      setup(_props, { slots }) {
        return () => h("a", slots.default?.());
      },
    }),
    useRouter: () => ({ push: state.push }),
  };
});

vi.mock("@/shell/useIsMobile", async () => {
  const { ref } = await import("vue");
  return { isMobile: ref(false) };
});

vi.mock("@/apps/drive", () => ({
  driveRecents: () => ({ test: "recent" }),
  createDriveDocument: () => ({ test: "create-document" }),
  driveNodeRoute: (node: { name: string }) => `/d/${node.name}/document`,
}));

vi.mock("@/apps/calendar", () => ({
  upcomingEvents: () => ({ test: "upcoming" }),
}));

vi.mock("@/apps/meet", () => ({
  createRoom: { test: "create-room" },
  scheduleMeeting: { test: "schedule-meeting" },
}));

vi.mock("@/platform/server-state", () => ({
  useQuery: (descriptor: { test?: string }) => {
    if (descriptor.test === "recent") {
      return state.recentFails
        ? failedQuery("Recent failed")
        : successfulRows([
            {
              name: "node-1",
              title: "Roadmap",
              kind: "document",
              content_doctype: "Writer Document",
              mime: null,
              opened_at: new Date().toISOString(),
            },
          ]);
    }
    return state.upcomingFails
      ? failedQuery("Upcoming failed")
      : successfulData([
          {
            id: "event-1",
            title: "Design review",
            start: new Date().toISOString(),
            conferencing: null,
          },
        ]);
  },
  useMutation: (descriptor: { test?: string }) => ({
    isPending: false,
    error: null,
    run:
      descriptor.test === "create-document"
        ? state.createDocument
        : vi.fn().mockResolvedValue(undefined),
  }),
}));

import HomePage from "@/composition/home/HomePage.vue";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  state.push.mockReset();
  state.createDocument.mockReset();
  state.recentFails = true;
  state.upcomingFails = false;
});

describe("Home page", () => {
  it("keeps Upcoming rendered when Recent fails", () => {
    const root = mount();

    expect(root.querySelector('[data-testid="recent-error"]')).not.toBeNull();
    expect(
      root.querySelector('[data-testid="upcoming-rows"]')?.textContent,
    ).toContain("Design review");
  });

  it("keeps Recent rendered when Upcoming fails", () => {
    state.recentFails = false;
    state.upcomingFails = true;
    const root = mount();

    expect(
      root.querySelector('[data-testid="recent-rows"]')?.textContent,
    ).toContain("Roadmap");
    expect(root.querySelector('[data-testid="upcoming-error"]')).not.toBeNull();
  });

  it.each([
    ["Document", "Writer Document"],
    ["Spreadsheet", "Sheet"],
    ["Presentation", "Presentation"],
  ])(
    "creates a %s through generic Drive creation and navigates to it",
    async (label, contentDoctype) => {
      state.createDocument.mockResolvedValue({ name: "new-node" });
      const root = mount();
      const documentButton = [...root.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      );

      documentButton?.click();
      await nextTick();
      await nextTick();

      expect(state.createDocument).toHaveBeenCalledWith({
        content_doctype: contentDoctype,
      });
      expect(state.push).toHaveBeenCalledWith("/d/new-node/document");
    },
  );
});

function mount(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp(HomePage);
  app.mount(root);
  cleanups.push(() => {
    app.unmount();
    root.remove();
  });
  return root;
}

function failedQuery(message: string) {
  return {
    data: undefined,
    rows: [],
    status: "error",
    error: { message },
    refetch: vi.fn(),
  };
}

function successfulRows(rows: unknown[]) {
  return {
    data: { rows },
    rows,
    status: "success",
    error: null,
    refetch: vi.fn(),
  };
}

function successfulData(data: unknown) {
  return {
    data,
    rows: [],
    status: "success",
    error: null,
    refetch: vi.fn(),
  };
}
