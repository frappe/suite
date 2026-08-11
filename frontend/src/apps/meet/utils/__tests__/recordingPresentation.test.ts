import { describe, expect, it } from "vitest";
import type { RecordingPreflight } from "../../composables/useRecording";
import { getRecordingUnavailableReason } from "../recordingPresentation";

const preflight: RecordingPreflight = {
	eligible: false,
	global_enabled: true,
	e2ee_conflict: false,
	storage_available: true,
	recorder_available: true,
	estimated_seconds: 3600,
	estimated_bytes: 100,
	free_bytes: 100,
	budget_bytes: 100,
	budget_seconds: 3600,
	maximum_seconds: 14400,
};

describe("recording preflight presentation", () => {
	it("distinguishes encrypted meetings", () => {
		const reason = getRecordingUnavailableReason({
			...preflight,
			e2ee_conflict: true,
		});
		expect(reason.title).toBe("Encrypted meetings can't be recorded");
	});

	it("distinguishes recorder service outages", () => {
		const reason = getRecordingUnavailableReason({
			...preflight,
			recorder_available: false,
		});
		expect(reason.title).toBe("Recorder service is unavailable");
	});
});
