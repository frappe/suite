import { createApp, defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("frappe-ui", async () => {
	const { defineComponent } = await import("vue");
	return {
		// Tooltip renders its trigger as a child and does not inherit attributes.
		Tooltip: defineComponent({
			inheritAttrs: false,
			props: ["text", "disabled"],
			setup: (_props, { slots }) => () => slots.default?.(),
		}),
	};
});

import GroupTile from "./GroupTile.vue";

describe("GroupTile", () => {
	it("applies the grid's dimensions to the clickable overflow tile", () => {
		const root = document.createElement("div");
		const app = createApp(
			defineComponent({
				setup: () => () =>
					h(GroupTile, {
						count: 6,
						tooltip: "Hidden participants",
						style: { width: "240px", height: "160px", minWidth: "0" },
					}),
			}),
		);
		app.component("lucide-alert-circle", { render: () => null });
		app.mount(root);
		try {
			const tile = root.querySelector<HTMLElement>('[role="button"]');
			expect(tile?.style.width).toBe("240px");
			expect(tile?.style.height).toBe("160px");
			expect(tile?.style.minWidth).toBe("0px");
		} finally {
			app.unmount();
		}
	});
});
