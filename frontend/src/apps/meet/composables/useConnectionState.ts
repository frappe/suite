import { defineStore } from "pinia";
import { ref } from "vue";

export type MeetingRecoveryState =
	| "healthy"
	| "reconnecting"
	| "rejoining"
	| "recovering_send"
	| "recovering_receive"
	| "failed";

export type RecoveryTimelineEntry = {
	at: string;
	state: MeetingRecoveryState;
	detail?: string;
};

const RECOVERY_TIMELINE_LIMIT = 40;

export interface ConnectionState {
	isConnecting: boolean;
	connectionError: string | null;
	isInPreview: boolean;
	isSetupComplete: boolean;
	codecStrategy: string;
	networkQuality: string;
	connectionIssues: string[];
	guestId: string | null;
	guestAuthToken: string | null;
	guestSfuUrl: string | null;
	guestSfuPort: string | null;
	guestSessionToken: string | null;
	recoveryState: MeetingRecoveryState;
	recoveryTimeline: RecoveryTimelineEntry[];
	setRecoveryState: (state: MeetingRecoveryState, detail?: string) => void;
	$reset: () => void;
}

export const useConnectionState = defineStore("meet-connection", () => {
	const isConnecting = ref(false);
	const connectionError = ref<string | null>(null);
	const isInPreview = ref(true);
	const isSetupComplete = ref(false);
	const codecStrategy = ref("svc");
	const networkQuality = ref("good");
	const connectionIssues = ref<string[]>([]);
	const guestId = ref<string | null>(null);
	const guestAuthToken = ref<string | null>(null);
	const guestSfuUrl = ref<string | null>(null);
	const guestSfuPort = ref<string | null>(null);
	const guestSessionToken = ref<string | null>(null);
	const justCreated = ref(false);
	const recoveryState = ref<MeetingRecoveryState>("healthy");
	const recoveryTimeline = ref<RecoveryTimelineEntry[]>([]);

	function setRecoveryState(state: MeetingRecoveryState, detail?: string) {
		recoveryState.value = state;
		recoveryTimeline.value = [
			...recoveryTimeline.value,
			{ at: new Date().toISOString(), state, ...(detail ? { detail } : {}) },
		].slice(-RECOVERY_TIMELINE_LIMIT);
	}

	function $reset() {
		connectionError.value = null;
		isConnecting.value = false;
		isInPreview.value = true;
		isSetupComplete.value = false;
		codecStrategy.value = "svc";
		networkQuality.value = "good";
		connectionIssues.value = [];
		guestId.value = null;
		guestAuthToken.value = null;
		guestSfuUrl.value = null;
		guestSfuPort.value = null;
		guestSessionToken.value = null;
		justCreated.value = false;
		recoveryState.value = "healthy";
		recoveryTimeline.value = [];
	}

	return {
		isConnecting,
		connectionError,
		isInPreview,
		isSetupComplete,
		codecStrategy,
		networkQuality,
		connectionIssues,
		guestId,
		guestAuthToken,
		guestSfuUrl,
		guestSfuPort,
		guestSessionToken,
		justCreated,
		recoveryState,
		recoveryTimeline,
		setRecoveryState,
		$reset,
	};
});
