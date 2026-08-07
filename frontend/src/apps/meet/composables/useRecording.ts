import { toast, useCall } from "frappe-ui";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useSocket } from "../socket";

export type RecordingStatus =
	| "Pending"
	| "Recording"
	| "Interrupted"
	| "Stopping"
	| "Processing"
	| "Ready"
	| "Partial"
	| "Failed";

export interface RecordingState {
	name: string;
	status: RecordingStatus;
	started_at?: string;
	capture_started_at?: string;
	state_revision: number;
}

type RecordingCommandResult = Pick<RecordingState, "name" | "status"> &
	Partial<RecordingState>;
type RecordingStartResult = RecordingCommandResult | { status: "Rejected" };

export interface RecordingPreflight {
	eligible: boolean;
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
	const requestId = ref<string | null>(null);
	const socket = useSocket();

	const stateCall = useCall<RecordingState | null, { meeting_id: string }>({
		url: "/api/v2/method/suite.meet.api.recording.get_state",
		immediate: false,
	});
	const preflightCall = useCall<RecordingPreflight, { meeting_id: string }>({
		url: "/api/v2/method/suite.meet.api.recording.get_preflight",
		immediate: false,
	});
	const startCall = useCall<
		RecordingStartResult,
		{ meeting_id: string; request_id: string }
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
		["Recording", "Interrupted", "Stopping"].includes(state.value?.status || ""),
	);
	const isStarting = computed(() => state.value?.status === "Pending");

	async function loadState() {
		try {
			state.value = (await stateCall.submit({ meeting_id: meetingId })) ?? null;
		} catch {
			// Guests may receive state through the room-scoped realtime channel instead.
		}
	}

	async function getPreflight() {
		return preflightCall.submit({ meeting_id: meetingId });
	}

	async function start() {
		requestId.value ||= crypto.randomUUID();
		const result = await startCall.submit({
			meeting_id: meetingId,
			request_id: requestId.value,
		});
		if (result.status === "Rejected") {
			state.value = null;
			requestId.value = null;
			toast.error("Recording capacity is unavailable");
			return result;
		}
		state.value = {
			...state.value,
			...result,
			state_revision: result.state_revision ?? state.value?.state_revision ?? 0,
		};
		if (result.status === "Recording") await loadState();
		if (result.status !== "Pending") requestId.value = null;
		if (result.status === "Pending") toast.info("Recording is starting");
		else if (result.status === "Stopping")
			toast.error("Recording could not start and is stopping");
		else toast.success("Recording started");
		return result;
	}

	async function stop() {
		const result = await stopCall.submit({ meeting_id: meetingId });
		if (result) {
			state.value = {
				...state.value,
				...result,
				state_revision: result.state_revision ?? state.value?.state_revision ?? 0,
			};
			await loadState();
		}
		toast.info("Recording is stopping");
		return result;
	}

	function handleState(event: RecordingEvent) {
		if (event.meeting_id !== meetingId) return;
		if (!event.recording) {
			const wasPending = state.value?.status === "Pending";
			state.value = null;
			requestId.value = null;
			if (wasPending) toast.error("Recording could not start");
			return;
		}
		if (
			state.value &&
			event.recording.state_revision < state.value.state_revision
		)
			return;
		const previous = state.value?.status;
		state.value = event.recording;
		if (event.recording.status === "Recording" && previous !== "Recording")
			toast.info("This meeting is being recorded");
		if (event.recording.status === "Interrupted")
			toast.error("Recording was interrupted and is trying to recover");
	}

	onMounted(() => {
		void loadState();
		socket?.on("meeting:recording_state", handleState);
	});
	onUnmounted(() => socket?.off("meeting:recording_state", handleState));

	return {
		state,
		isLive,
		isStarting,
		preflightLoading: computed(() => preflightCall.loading),
		startLoading: computed(() => startCall.loading),
		stopLoading: computed(() => stopCall.loading),
		getPreflight,
		start,
		stop,
	};
}
