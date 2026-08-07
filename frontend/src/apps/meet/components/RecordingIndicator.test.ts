import { createApp } from "vue";
import { describe, expect, it, vi } from "vitest";
import RecordingIndicator from "./RecordingIndicator.vue";

const recording = {
	name: "recording",
	status: "Recording" as const,
	started_at: "2026-08-02T00:00:00Z",
	state_revision: 1,
};

describe("RecordingIndicator", () => {
	it("is informational and disabled for non-hosts", () => {
		const root = document.createElement("div");
		const click = vi.fn();
		const app = createApp(RecordingIndicator, { recording, canStop: false, onClick: click });
		app.mount(root);

		const button = root.querySelector("button") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		button.click();
		expect(click).not.toHaveBeenCalled();
		app.unmount();
	});

	it("opens stop controls for hosts", () => {
		const root = document.createElement("div");
		const click = vi.fn();
		const app = createApp(RecordingIndicator, { recording, canStop: true, onClick: click });
		app.mount(root);

		const button = root.querySelector("button") as HTMLButtonElement;
		expect(button.disabled).toBe(false);
		button.click();
		expect(click).toHaveBeenCalledOnce();
		app.unmount();
	});
});
