import { createApp, defineComponent, h, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { RecordingPreflight } from "../composables/useRecording";

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

const eligible: RecordingPreflight = { eligible: true, global_enabled: true, e2ee_conflict: false, storage_available: true, recorder_available: true, estimated_seconds: 100, estimated_bytes: 100, free_bytes: 100, budget_bytes: 100, budget_seconds: 100, maximum_seconds: 14400 };
const settle = async () => { await nextTick(); await Promise.resolve(); await nextTick(); };
function setup(refresh = vi.fn(async () => eligible)) {
	const confirm = vi.fn(async () => undefined);
	const root = document.createElement("div");
	const app = createApp(RecordingPreflightDialog, { open: true, preflight: eligible, refresh, confirm });
	app.mount(root);
	const switches = root.querySelectorAll("input");
	const toggle = async (index: number) => { switches[index].checked = !switches[index].checked; switches[index].dispatchEvent(new Event("change", { bubbles: true })); await settle(); };
	return { root, confirm, refresh, toggle, unmount: () => app.unmount() };
}

describe("capture output selection", () => {
	it("checks combined capture and blocks a server rejection", async () => {
		const view = setup(vi.fn(async () => ({ ...eligible, eligible: false, e2ee_conflict: true })));
		await view.toggle(1);
		expect(view.refresh).toHaveBeenCalledWith({ video_enabled: true, transcription_enabled: true, language: "en" });
		expect(view.root.textContent).toContain("Capture is unavailable in encrypted meetings");
		expect(view.root.querySelector("button")?.disabled).toBe(true);
		view.root.querySelector("button")?.click();
		expect(view.confirm).not.toHaveBeenCalled();
		view.unmount();
	});
	it("does not enable start while a newer availability check is pending", async () => {
		let finishFirst!: (value: RecordingPreflight) => void;
		let finishSecond!: (value: RecordingPreflight) => void;
		const first = new Promise<RecordingPreflight>((resolve) => { finishFirst = resolve; });
		const second = new Promise<RecordingPreflight>((resolve) => { finishSecond = resolve; });
		const refresh = vi.fn(async () => eligible).mockImplementationOnce(() => first).mockImplementationOnce(() => second);
		const view = setup(refresh);
		await view.toggle(1);
		await view.toggle(0);
		finishFirst(eligible);
		await settle();
		expect(view.root.querySelector("button")?.disabled).toBe(true);
		finishSecond({ ...eligible, eligible: false, transcription_enabled: true, transcription_available: false });
		await settle();
		expect(view.root.querySelector("button")?.disabled).toBe(true);
		expect(view.root.textContent).toContain("Transcription is unavailable");
		view.unmount();
	});

});
