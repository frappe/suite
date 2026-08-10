import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { ParticipantConnectionState } from "../utils/sfu/ParticipantConnection";

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

export const useParticipantConnectionState = defineStore(
	"meet-participant-connection",
	() => {
		const lifecycleState = ref<ParticipantConnectionState>("stopped");
		const recoveryTimeline = ref<RecoveryTimelineEntry[]>([]);
		const isConnecting = computed(
			() =>
				lifecycleState.value === "starting" ||
				lifecycleState.value === "syncing",
		);
		const isSetupComplete = computed(
			() =>
				lifecycleState.value === "ready" ||
				lifecycleState.value === "degraded" ||
				lifecycleState.value === "recovering",
		);

		function setLifecycleState(state: ParticipantConnectionState) {
			lifecycleState.value = state;
		}

		function recordRecovery(state: MeetingRecoveryState, detail?: string) {
			recoveryTimeline.value = [
				...recoveryTimeline.value,
				{ at: new Date().toISOString(), state, ...(detail ? { detail } : {}) },
			].slice(-RECOVERY_TIMELINE_LIMIT);
		}

		function $reset() {
			lifecycleState.value = "stopped";
			recoveryTimeline.value = [];
		}

		return {
			lifecycleState,
			recoveryTimeline,
			isConnecting,
			isSetupComplete,
			setLifecycleState,
			recordRecovery,
			$reset,
		};
	},
);
