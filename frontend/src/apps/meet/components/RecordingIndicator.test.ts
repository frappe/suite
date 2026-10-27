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
	it("identifies a transcript-only capture without suggesting video", () => {
		const root = document.createElement("div");
		const app = createApp(RecordingIndicator, { recording: { ...recording, video_enabled: false, transcription_enabled: true } });
		app.mount(root);
		expect(root.querySelector("button")?.getAttribute("label")).toContain("Transcription");
		expect(root.querySelector("button")?.getAttribute("tooltip")).toBe("This meeting is being transcribed");
		app.unmount();
	});

	it("shows only ongoing video after transcription capture ends", () => {
		const root = document.createElement("div");
		const app = createApp(RecordingIndicator, { recording: { ...recording, video_enabled: true, transcription_enabled: true, transcription_capture_state: "complete" } });
		app.mount(root);
		expect(root.querySelector("button")?.getAttribute("label")).toContain("Recording");
		expect(root.querySelector("button")?.getAttribute("label")).not.toContain("transcription");
		app.unmount();
	});

	it("shows only ongoing transcription after video fails", () => {
		const root = document.createElement("div");
		const app = createApp(RecordingIndicator, { recording: { ...recording, video_enabled: true, transcription_enabled: true, transcription_capture_state: "capturing", video_capture_state: "failed" } });
		app.mount(root);
		expect(root.querySelector("button")?.getAttribute("label")).toContain("Transcription");
		expect(root.querySelector("button")?.getAttribute("label")).not.toContain("Recording");
		expect(root.querySelector("button")?.getAttribute("tooltip")).toBe("This meeting is being transcribed");
		app.unmount();
	});

});
