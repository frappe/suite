import { captureLabel, captureNotice, defaultCaptureOptions, type CaptureOptions, captureActivityLabel, type TranscriptionCaptureState, type VideoCaptureState } from "../utils/capturePresentation";
export type { CaptureOptions } from "../utils/capturePresentation";
import { toast, useCall } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useSocket } from "../socket";
import { submit } from "../utils/request";

type RecordingStatus =
	| "Pending"
	| "Starting"
	| "Recording"
	| "Interrupted"
	| "Stopping"
	| "Processing"
	| "Ready"
	| "Partial"
	| "Failed"
	| "Cancelled"
	| "Captured";

export interface RecordingState extends Partial<CaptureOptions> {
	name: string;
	status: RecordingStatus;
	started_at?: string;
	capture_started_at?: string;
	interruption_id?: string;
	interrupted_at?: string;
	interruption_deadline?: string;
	state_revision: number;
	transcription_capture_state?: TranscriptionCaptureState;
	video_capture_state?: VideoCaptureState;
}

type RecordingCommandResult = Pick<RecordingState, "name" | "status"> &
	Partial<RecordingState>;
type RecordingStartResult = RecordingCommandResult | { status: "Rejected" };

export interface RecordingPreflight {
	eligible: boolean;
	transcription_available?: boolean;
	video_enabled?: boolean;
	transcription_enabled?: boolean;
	global_enabled: boolean;
	e2ee_conflict: boolean;
	storage_available: boolean;
	recorder_available: boolean;
	estimated_seconds: number;
	estimated_bytes: number;
	free_bytes: number;
	budget_bytes: number;
	budget_seconds: number;
	maximum_seconds: number;
}

type RecordingEvent = {
	meeting_id: string;
	recording: RecordingState | null;
};

export function useRecording(meetingId: string) {
	const state = ref<RecordingState | null>(null);
	const globalEnabled = ref(false);
	const requestId = ref<string | null>(null);
	const socket = useSocket();
	let stateVersion = 0;
	let sourceTerminal: { capture: string; state: TranscriptionCaptureState } | null = null;
	let sourceInterrupted: string | null = null;

	function setState(next: RecordingState | null) {
		if (next && sourceTerminal?.capture === next.name && (!next.transcription_capture_state || next.transcription_capture_state === "capturing"))
			next = { ...next, transcription_capture_state: sourceTerminal.state };
		state.value = next;
		stateVersion += 1;
	}

	const stateCall = useCall<RecordingState | null, { meeting_id: string }>({
		url: "/api/v2/method/suite.meet.api.recording.get_state",
		immediate: false,
	});
	const preflightCall = useCall<RecordingPreflight, { meeting_id: string } & CaptureOptions>({
		url: "/api/v2/method/suite.meet.api.recording.get_preflight",
		immediate: false,
	});
	const startCall = useCall<
		RecordingStartResult,
		{ meeting_id: string; request_id: string } & CaptureOptions
	>({
		url: "/api/v2/method/suite.meet.api.recording.start",
		method: "POST",
		immediate: false,
	});
	const stopCall = useCall<RecordingCommandResult | null, { meeting_id: string }>({
		url: "/api/v2/method/suite.meet.api.recording.stop",
		method: "POST",
		immediate: false,
	});

	const isLive = computed(() =>
		["Recording", "Interrupted"].includes(state.value?.status || ""),
	);
	const isCapturing = computed(() => isLive.value && captureActivityLabel(state.value) !== null);
	const isStarting = computed(() =>
		["Pending", "Starting"].includes(state.value?.status || ""),
	);

	async function loadState() {
		try {
			const version = stateVersion;
			const recordingName = state.value?.name;
			const revision = state.value?.state_revision;
			const loaded = (await stateCall.submit({ meeting_id: meetingId })) ?? null;
			if (loaded === null && stateCall.error) throw stateCall.error;
			if (stateVersion !== version) return;
			if (state.value?.state_revision !== revision) return;
			if (
				loaded?.name === recordingName &&
				revision !== undefined &&
				loaded.state_revision < revision
			)
				return;
			const wasLive = isLive.value;
			setState(loaded);
			if (!wasLive && loaded?.status === "Recording") toast.info(captureNotice(loaded));
		} catch {
			// Guests may receive state through the room-scoped realtime channel instead.
		}
	}

	async function getPreflight(options = defaultCaptureOptions()) {
		return submit(preflightCall, { meeting_id: meetingId, ...options });
	}

	async function start(options = defaultCaptureOptions()) {
		if (!options.video_enabled && !options.transcription_enabled)
			throw new Error("Select video recording or transcription");
		if (isLive.value || state.value?.status === "Stopping")
			throw new Error("Stop the active capture before starting another");
		requestId.value ||= crypto.randomUUID();
		const result = await submit(startCall, {
			meeting_id: meetingId,
			request_id: requestId.value,
			...options,
		});
		if (result.status === "Rejected") {
			setState(null);
			requestId.value = null;
			if (options.transcription_enabled) await loadState();
			toast.error(isLive.value && state.value?.transcription_enabled ? "Video recording could not start. Transcription capture continues." : `${captureLabel(options)} capacity is unavailable`);
			return result;
		}
		const preserveLiveState = state.value?.name === result.name && isLive.value && result.state_revision === undefined;
		if (!preserveLiveState) setState({
			...state.value,
			...options,
			...result,
			state_revision: result.state_revision ?? state.value?.state_revision ?? 0,
		});
		if (result.status === "Recording" || options.transcription_enabled) await loadState();
		if (!["Pending", "Starting"].includes(result.status)) requestId.value = null;
		if (["Pending", "Starting"].includes(result.status)) toast.info(`${captureLabel(options)} is starting`);
		else if (result.status === "Stopping")
			toast.error(`${captureLabel(options)} could not start and is stopping`);
		else toast.success(`${captureLabel(options)} started`);
		return result;
	}

	async function stop() {
		const result = await stopCall.submit({ meeting_id: meetingId });
		if (!result) {
			if (stopCall.error) throw stopCall.error;
			return null;
		}
		setState({
			...state.value,
			...result,
			state_revision: result.state_revision ?? state.value?.state_revision ?? 0,
		});
		await loadState();
		toast.info(`${captureLabel(state.value)} is stopping`);
		return result;
	}

	function handleState(event: RecordingEvent) {
		if (event.meeting_id !== meetingId) return;
		if (!event.recording) {
			const wasPending = ["Pending", "Starting"].includes(state.value?.status || "");
			const label = captureLabel(state.value);
			setState(null);
			requestId.value = null;
			if (wasPending) toast.error(`${label} could not start`);
			return;
		}
		if (
			state.value &&
			event.recording.name === state.value.name &&
			event.recording.state_revision < state.value.state_revision
		)
			return;
		const previous = state.value?.status;
		setState(event.recording);
		if (event.recording.status === "Recording" && previous !== "Recording")
			toast.info(captureNotice(event.recording));
		if (event.recording.status === "Interrupted")
			toast.error(`${captureLabel(event.recording)} was interrupted and is trying to recover`);
	}

	function syncTranscriptionCapture(value: unknown) {
		if (typeof value !== "object" || value === null || !("room" in value) || !("capture" in value) || !("state" in value)) return;
		const current = state.value;
		if (!current?.transcription_enabled || value.room !== meetingId || value.capture !== current.name) return;
		const activity = value.state;
		if (activity !== "capturing" && activity !== "complete" && activity !== "partial" && activity !== "failed") return;
		if (sourceTerminal?.capture === current.name && activity === "capturing") return;
		if ("interrupted" in value && value.interrupted === true && sourceInterrupted !== current.name) {
			sourceInterrupted = current.name;
			toast.error("Transcription capture was interrupted. Missing speech will be marked in any recovered transcript.");
		}
		const previous = current.transcription_capture_state;
		if (activity !== "capturing") sourceTerminal = { capture: current.name, state: activity };
		setState({ ...current, transcription_capture_state: activity });
		if (activity !== "capturing" && previous !== activity) {
			if (sourceInterrupted !== current.name)
				toast.info(current.video_enabled === false || current.video_capture_state === "complete" || current.video_capture_state === "failed" || !isLive.value ? "Transcription capture has ended" : "Transcription capture has ended. Video recording continues.");
			void loadState();
		}
	}

	function syncState(recording: RecordingState | null) {
		handleState({ meeting_id: meetingId, recording });
	}

	function setGlobalEnabled(enabled: boolean) {
		globalEnabled.value = enabled;
	}

	onMounted(() => {
		void loadState();
		socket?.on("meeting:recording_state", handleState);
	});
	onUnmounted(() => socket?.off("meeting:recording_state", handleState));

	return {
		state,
		globalEnabled,
		isLive,
		isCapturing,
		syncTranscriptionCapture,
		isStarting,
		preflightLoading: computed(() => preflightCall.loading),
		startLoading: computed(() => startCall.loading),
		stopLoading: computed(() => stopCall.loading),
		getPreflight,
		setGlobalEnabled,
		syncState,
		start,
		stop,
	};
}
