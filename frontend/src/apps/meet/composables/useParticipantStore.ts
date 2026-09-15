import { defineStore } from "pinia";
import type {
	Participant,
	ParticipantUpdate,
} from "../utils/media/ParticipantManager";

export const useParticipantStore = defineStore("meet-participant", {
	state: () => ({
		participants: {} as Record<string, Participant>,
		activeSpeakerIds: [] as string[],
		stableSpeakerIds: [] as string[],
		speakerStartTimes: {} as Record<string, number>,
	}),
	actions: {
		addParticipant(participant: Participant) {
			const userId = participant.user_id;
			if (userId) this.participants[userId] = participant;
		},
		removeParticipant(participantId: string) {
			delete this.participants[participantId];
		},
		updateParticipant(participantId: string, updates: ParticipantUpdate) {
			const participant = this.participants[participantId];
			if (participant) {
				this.participants[participantId] = { ...participant, ...updates };
			}
		},
		getParticipantName(participantId: string): string {
			return this.participants[participantId]?.user_name || participantId;
		},
	},
});

export type ParticipantStore = ReturnType<typeof useParticipantStore>;
