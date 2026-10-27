import { describe, expect, it } from "vitest";
import { normalizeJoinPayload } from "./types";
import { captureNotice } from "./utils/capturePresentation";

describe("capture notices on joining", () => {
	it("retains output choices for transcript-only late joiners", () => {
		const payload = normalizeJoinPayload({ recording: { name: "capture", status: "Recording", state_revision: 1, video_enabled: false, transcription_enabled: true, transcription_language: "en" } });
		expect(payload?.recording).toMatchObject({ video_enabled: false, transcription_enabled: true, language: "en" });
		expect(captureNotice(payload?.recording)).toBe("This meeting is being transcribed");
	});
	it("preserves the notice for legacy video-only captures", () => {
		const payload = normalizeJoinPayload({ recording: { name: "recording", status: "Recording", state_revision: 1 } });
		expect(captureNotice(payload?.recording)).toBe("This meeting is being recorded");
	});
	it("preserves ended transcription activity independently from its selected output", () => {
		const payload = normalizeJoinPayload({ recording: { name: "capture", status: "Recording", state_revision: 1, video_enabled: true, transcription_enabled: true, transcription_capture_state: "partial" } });
		expect(payload?.recording).toMatchObject({ video_enabled: true, transcription_enabled: true, transcription_capture_state: "partial" });
		expect(captureNotice(payload?.recording)).toBe("This meeting is being recorded. Transcription capture has ended.");
	});

	it("preserves video failure independently from an active transcription selection", () => {
		const payload = normalizeJoinPayload({ recording: { name: "capture", status: "Recording", state_revision: 2, video_enabled: true, transcription_enabled: true, video_capture_state: "failed", transcription_capture_state: "capturing" } });
		expect(payload?.recording).toMatchObject({ video_enabled: true, video_capture_state: "failed", transcription_capture_state: "capturing" });
		expect(captureNotice(payload?.recording)).toBe("This meeting is being transcribed");
	});

	it("does not announce video before its startup completes", () => {
		const payload = normalizeJoinPayload({ recording: { name: "capture", status: "Recording", state_revision: 2, video_enabled: true, transcription_enabled: true, video_capture_state: "starting", transcription_capture_state: "capturing" } });
		expect(payload?.recording?.video_capture_state).toBe("starting");
		expect(captureNotice(payload?.recording)).toBe("This meeting is being transcribed");
	});

});
