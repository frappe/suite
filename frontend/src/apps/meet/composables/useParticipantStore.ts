import { defineStore } from "pinia";
import { ref } from "vue";
import type {
	Participant,
	ParticipantUpdate,
} from "../utils/media/ParticipantManager";

export interface ParticipantStore {
	participants: Record<string, Participant>;
	remoteVideos: Record<string, HTMLVideoElement>;
	activeSpeakerIds: string[];
	stableSpeakerIds: string[];
	speakerStartTimes: Record<string, number>;
	addParticipant: (participant: Participant) => void;
	removeParticipant: (participantId: string) => void;
	updateParticipant: (
		participantId: string,
		updates: ParticipantUpdate,
	) => void;
	getParticipantName: (participantId: string) => string;
	$reset: () => void;
}

export const useParticipantStore = defineStore("meet-participant", () => {
	const participants = ref<Record<string, Participant>>({});
	const remoteVideos = ref<Record<string, HTMLVideoElement>>({});
	const activeSpeakerIds = ref<string[]>([]);
	const stableSpeakerIds = ref<string[]>([]);
	const speakerStartTimes = ref<Record<string, number>>({});

	function addParticipant(participant: Participant) {
		const userId = participant.user_id;
		if (!userId) return;
		participants.value[userId] = participant;
	}

	function removeParticipant(participantId: string) {
		delete participants.value[participantId];
		const videoEl = remoteVideos.value[participantId];
		const srcObj = (videoEl as HTMLVideoElement)?.srcObject;
		if (srcObj instanceof MediaStream) {
			for (const track of srcObj.getTracks()) {
				track.stop();
			}
			(videoEl as HTMLVideoElement).srcObject = null;
		}
		delete remoteVideos.value[participantId];
	}

	function updateParticipant(
		participantId: string,
		updates: ParticipantUpdate,
	) {
		const participant = participants.value[participantId];
		if (participant) {
			participants.value[participantId] = { ...participant, ...updates };
		}
	}

	function getParticipantName(participantId: string): string {
		const participant = participants.value[participantId];
		return participant?.user_name || participantId;
	}

	function $reset() {
		participants.value = {};
		remoteVideos.value = {};
		activeSpeakerIds.value = [];
		stableSpeakerIds.value = [];
		speakerStartTimes.value = {};
	}

	return {
		participants,
		remoteVideos,
		activeSpeakerIds,
		stableSpeakerIds,
		speakerStartTimes,
		addParticipant,
		removeParticipant,
		updateParticipant,
		getParticipantName,
		$reset,
	};
});
