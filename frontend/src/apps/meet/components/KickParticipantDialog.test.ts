import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("frappe-ui", async () => {
	const { defineComponent, h } = await import("vue");
	return {
		Button: defineComponent({
			setup(_props, { attrs, slots }) {
				return () => h("button", attrs, slots.default?.());
			},
		}),
		Dialog: defineComponent({
			setup(_props, { slots }) {
				return () => h("div", [slots.default?.(), slots.actions?.()]);
			},
		}),
		FormControl: defineComponent({
			props: { modelValue: Boolean, label: String },
			emits: ["update:modelValue"],
			setup(props, { emit }) {
				return () =>
					h("input", {
						label: props.label,
						type: "checkbox",
						checked: props.modelValue,
						onChange: (event: Event) =>
							emit("update:modelValue", (event.target as HTMLInputElement).checked),
					});
			},
		}),
	};
});

import KickParticipantDialog from "./KickParticipantDialog.vue";

function render(canBan: boolean) {
	const root = document.createElement("div");
	const open = ref(true);
	const confirm = vi.fn();
	const app = createApp(
		defineComponent({
			setup() {
				return () =>
					h(KickParticipantDialog, {
						modelValue: open.value,
						participantName: "Participant",
						canBan,
						"onUpdate:modelValue": (value: boolean) => {
							open.value = value;
						},
						onConfirm: confirm,
					});
			},
		}),
	);
	app.mount(root);
	return { app, confirm, open, root };
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
	const match = [...root.querySelectorAll("button")].find(
		(candidate) => candidate.textContent === text,
	);
	if (!match) throw new Error(`Button not found: ${text}`);
	return match;
}

describe("KickParticipantDialog", () => {
	it("offers Ban for a guest", () => {
		const { app, root } = render(true);
		expect(root.querySelector('input[label="Ban from this meeting?"]')).not.toBeNull();
		app.unmount();
	});

	it("keeps authenticated participant removal remove-only", () => {
		const { app, root } = render(false);
		expect(root.querySelector('input[label="Ban from this meeting?"]')).toBeNull();
		app.unmount();
	});

	it.each(["cancel", "external close"])(
		"resets Ban after %s",
		async (closeMethod) => {
			const { app, confirm, open, root } = render(true);
			root.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
			if (closeMethod === "cancel") button(root, "Cancel").click();
			else open.value = false;
			await nextTick();
			open.value = true;
			await nextTick();

			button(root, "Remove").click();

			expect(confirm).toHaveBeenCalledWith(false);
			app.unmount();
		},
	);
});
