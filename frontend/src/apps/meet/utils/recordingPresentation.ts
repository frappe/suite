import type { RecordingPreflight } from "../composables/useRecording";

export function getRecordingUnavailableReason(preflight: RecordingPreflight) {
	if (!preflight.global_enabled)
		return {
			title: "Recording is disabled",
			message: "An administrator needs to enable recording for Meet.",
		};
	if (preflight.e2ee_conflict)
		return {
			title: "Capture is unavailable in encrypted meetings",
			message: "Turn off end-to-end encryption before recording or transcribing.",
		};
	if (preflight.transcription_enabled && preflight.transcription_available === false)
		return { title: "Transcription is unavailable", message: "An administrator needs to configure transcription for Meet." };
	if (!preflight.storage_available || (preflight.video_enabled !== false && preflight.budget_bytes <= 0))
		return {
			title: "Drive storage is unavailable",
			message: "The room owner needs enough available Drive storage for a recording.",
		};
	if (!preflight.recorder_available)
		return {
			title: "Recorder service is unavailable",
			message: "Try again shortly or contact your administrator.",
		};
	return {
		title: "Recording is unavailable",
		message: "Check the room settings and try again.",
	};
}
