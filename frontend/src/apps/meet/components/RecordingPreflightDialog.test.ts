import { createApp, defineComponent, h, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { CaptureOptions } from "../utils/capturePresentation";

vi.mock("frappe-ui", () => ({
	toast: {}, useCall: vi.fn(),
	Dialog: defineComponent({ props: ["actions"], setup(props, { slots }) {
		return () => h("section", [slots.default?.(), ...props.actions.map((action: { label: string; disabled?: boolean; onClick: (context: { close: () => void }) => void }) => h("button", { disabled: action.disabled, onClick: () => action.onClick({ close: vi.fn() }) }, action.label))]);
	} }),
	Switch: defineComponent({ props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"], setup(props, { emit }) {
		return () => h("label", [props.label, h("input", { type: "checkbox", checked: props.modelValue, disabled: props.disabled, onChange: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).checked) })]);
	} }),
	Alert: defineComponent({ props: ["title"], setup(props) { return () => h("p", props.title); } }),
}));
import RecordingPreflightDialog from "./RecordingPreflightDialog.vue";

const settle = async () => { await nextTick(); await Promise.resolve(); await nextTick(); };
function setup(confirm: (options: CaptureOptions) => Promise<unknown> = vi.fn(async () => undefined)) {
	const root = document.createElement("div");
	const app = createApp(RecordingPreflightDialog, { open: true, confirm });
	app.mount(root);
	const switches = root.querySelectorAll("input");
	const toggle = async (index: number) => { switches[index].checked = !switches[index].checked; switches[index].dispatchEvent(new Event("change", { bubbles: true })); await settle(); };
	return { root, confirm, toggle, unmount: () => app.unmount() };
}

describe("capture output selection", () => {
	it("makes no start request while editing, and disables Start with neither selected", async () => {
		const view = setup();
		await view.toggle(1);
		await view.toggle(0);
		await view.toggle(1);
		expect(view.confirm).not.toHaveBeenCalled();
		expect(view.root.querySelector("button")?.disabled).toBe(true);
		expect(view.root.textContent).not.toContain("Select video recording or transcription");
		view.root.querySelector("button")?.click();
		expect(view.confirm).not.toHaveBeenCalled();
		await view.toggle(1);
		view.root.querySelector("button")?.click();
		await settle();
		expect(view.confirm).toHaveBeenCalledExactlyOnceWith({ video_enabled: false, transcription_enabled: true, language: "en" });
		view.unmount();
	});

	it("shows a start rejection and lets the host change selection and retry", async () => {
		const confirm = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("Transcription capacity is currently unavailable"));
		const view = setup(confirm);
		await view.toggle(1);
		await view.toggle(0);
		view.root.querySelector("button")?.click();
		await settle();
		expect(view.root.textContent).toContain("Transcription capacity is currently unavailable");
		expect(view.root.querySelector("button")?.disabled).toBe(false);
		await view.toggle(0);
		await view.toggle(1);
		expect(view.root.textContent).not.toContain("Transcription capacity is currently unavailable");
		expect(view.confirm).toHaveBeenCalledTimes(1);
		view.root.querySelector("button")?.click();
		await settle();
		expect(view.confirm).toHaveBeenLastCalledWith({ video_enabled: true, transcription_enabled: false, language: "en" });
		view.unmount();
	});

	it("does not submit another start or change selection while a start is pending", async () => {
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => { finish = resolve; });
		const confirm = vi.fn(() => pending);
		const view = setup(confirm);
		view.root.querySelector("button")?.click();
		await settle();
		expect(view.root.querySelector("button")?.disabled).toBe(true);
		expect([...view.root.querySelectorAll("input")].every((input) => input.disabled)).toBe(true);
		view.root.querySelector("button")?.click();
		expect(confirm).toHaveBeenCalledTimes(1);
		finish();
		await settle();
		view.unmount();
	});
});
