export interface CaptureOptions {
	video_enabled: boolean;
	transcription_enabled: boolean;
	language: "en";
}

export const defaultCaptureOptions = (): CaptureOptions => ({
	video_enabled: true,
	transcription_enabled: false,
	language: "en",
});

export function captureLabel(options?: Partial<CaptureOptions> | null) {
	if (!options?.transcription_enabled) return "Recording";
	return options.video_enabled === false ? "Transcription" : "Recording and transcription";
}

export type TranscriptionCaptureState = "capturing" | "complete" | "partial" | "failed";
export type VideoCaptureState = "starting" | "capturing" | "complete" | "failed";
export type CaptureActivity = Partial<CaptureOptions> & {
	transcription_capture_state?: TranscriptionCaptureState;
	video_capture_state?: VideoCaptureState;
};

export function captureActivityLabel(options?: CaptureActivity | null) {
	const video = options?.video_enabled !== false && (!options?.video_capture_state || options.video_capture_state === "capturing");
	const transcription = options?.transcription_enabled && (!options.transcription_capture_state || options.transcription_capture_state === "capturing");
	if (video && transcription) return "Recording and transcription";
	if (video) return "Recording";
	if (transcription) return "Transcription";
	return null;
}

export function captureNotice(options?: CaptureActivity | null) {
	const activity = captureActivityLabel(options);
	if (activity === "Recording and transcription") return "This meeting is being recorded and transcribed";
	if (activity === "Transcription") return "This meeting is being transcribed";
	if (activity === "Recording")
		return options?.transcription_enabled ? "This meeting is being recorded. Transcription capture has ended." : "This meeting is being recorded";
	return "Transcription capture has ended";
}
