import { createApp, defineComponent, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  push: vi.fn(),
  markRead: vi.fn(),
  loadNode: vi.fn(),
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
          [props.label || slots.default?.(), slots.suffix?.()],
        );
    },
  });
  const Popover = defineComponent({
    emits: ["update:open"],
    setup(_props, { emit, slots }) {
      return () =>
        h("div", [
          h(
            "div",
            { onClick: () => emit("update:open", true) },
            slots.trigger?.(),
          ),
          slots.default?.(),
        ]);
    },
  });
  return { Button, Popover, ScrollArea: passthrough, Skeleton: passthrough };
});

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: state.push }),
}));

vi.mock("@/apps/drive", () => ({
  driveNodeRoute: (node: { name: string }) => `/d/${node.name}/item`,
}));

vi.mock("@/composition/notifications/client", () => ({
  notificationsFeed: () => ({ test: "feed" }),
  notificationUnreadCount: () => ({ test: "count" }),
  markNotificationsRead: { test: "mark-read" },
  loadNotificationNode: state.loadNode,
}));

vi.mock("@/platform/server-state", () => ({
  useQuery: (source: unknown) => {
    if (typeof source === "function") {
      return {
        rows: [notification()],
        status: "success",
        error: null,
        hasNext: false,
        isFetchingNext: false,
        refetch: vi.fn(),
        fetchNext: vi.fn(),
      };
    }
    return { data: { unread: 1 }, status: "success", error: null };
  },
  useMutation: () => ({
    isPending: false,
    error: null,
    run: state.markRead,
  }),
}));

import NotificationsBell from "@/composition/notifications/NotificationsBell.vue";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  state.push.mockReset();
  state.markRead.mockReset();
  state.loadNode.mockReset();
});

describe("Notifications bell", () => {
  it("does not mark anything read when opened", async () => {
    const root = mount();
    const bell = root.querySelector(
      '[aria-label="Notifications"]',
    ) as HTMLButtonElement;

    bell.click();
    await nextTick();

    expect(state.markRead).not.toHaveBeenCalled();
  });

  it("marks only the clicked row read before navigating to its node", async () => {
    state.markRead.mockResolvedValue({ read: 1 });
    state.loadNode.mockResolvedValue({
      name: "node-1",
      title: "Plan",
      kind: "document",
    });
    const root = mount();
    const row = [...root.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Project plan"),
    );

    row?.click();
    await nextTick();
    await nextTick();
    await nextTick();

    expect(state.markRead).toHaveBeenCalledWith({
      notifications: ["notice-1"],
    });
    expect(state.loadNode).toHaveBeenCalledWith("node-1");
    expect(state.push).toHaveBeenCalledWith("/d/node-1/item");
    expect(state.markRead.mock.invocationCallOrder[0]!).toBeLessThan(
      state.loadNode.mock.invocationCallOrder[0]!,
    );
    expect(state.loadNode.mock.invocationCallOrder[0]!).toBeLessThan(
      state.push.mock.invocationCallOrder[0]!,
    );
  });

  it("marks every remaining row only through the explicit action", async () => {
    state.markRead.mockResolvedValue({ read: 1 });
    const root = mount();
    const markAll = [...root.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Mark all read",
    );

    markAll?.click();
    await nextTick();

    expect(state.markRead).toHaveBeenCalledWith({ all: true });
    expect(state.push).not.toHaveBeenCalled();
  });
});

function mount(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp(NotificationsBell);
  app.mount(root);
  cleanups.push(() => {
    app.unmount();
    root.remove();
  });
  return root;
}

function notification() {
  return {
    name: "notice-1",
    read: 0,
    creation: new Date().toISOString(),
    activity: {
      name: "activity-1",
      node: "node-1",
      action: "shared",
      actor: "Faris",
      at: new Date().toISOString(),
      via_link: null,
      client: null,
      detail: { title: "Project plan" },
    },
  };
}
