/**
 * Participant Manager
 * Handles participant state management and updates
 */

export interface Participant {
	user_id: string;
	user_name: string;
	avatar: string | null;
	initials: string;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
	[key: string]: unknown;
}

export interface ParticipantData {
	participantId?: string;
	user_id?: string;
	user_name?: string;
	userData?: {
		name?: string;
		avatar?: string | null;
		audio_enabled?: boolean;
		video_enabled?: boolean;
		is_guest?: boolean;
	};
	avatar?: string | null;
	[key: string]: unknown;
}

interface MediaStateUpdate {
	audioEnabled?: boolean;
	videoEnabled?: boolean;
}

interface ParticipantEventHandlers {
	onParticipantAdded?: (participant: Participant) => void;
	onParticipantRemoved?: (
		participantId: string,
		participant: Participant,
	) => void;
	onParticipantUpdated?: (
		participantId: string,
		updatedParticipant: Participant,
		updates: Record<string, unknown>,
	) => void;
	onAllParticipantsCleared?: (participantIds: string[]) => void;
}

export class ParticipantManager {
	participants: Map<string, Participant>;
	eventHandlers: ParticipantEventHandlers;

	constructor() {
		this.participants = new Map();
		this.eventHandlers = {};
	}

	setEventHandlers(handlers: ParticipantEventHandlers): void {
		this.eventHandlers = { ...this.eventHandlers, ...handlers };
	}

	addParticipant(participantData: ParticipantData): Participant {
		const displayName =
			participantData.userData?.name || participantData.user_name || "";
		const participant: Participant = {
			user_id:
				participantData.participantId || (participantData.user_id as string),
			user_name: displayName,
			avatar:
				participantData.userData?.avatar || participantData.avatar || null,
			initials: this.generateInitials(
				displayName || participantData.participantId || "",
			),
			audio_enabled: participantData.userData?.audio_enabled,
			video_enabled: participantData.userData?.video_enabled,
			is_guest: participantData.userData?.is_guest,
			...participantData,
		};

		this.participants.set(participant.user_id, participant);

		if (this.eventHandlers.onParticipantAdded) {
			this.eventHandlers.onParticipantAdded(participant);
		}

		return participant;
	}

	removeParticipant(participantId: string): Participant | undefined {
		const participant = this.participants.get(participantId);
		if (participant) {
			this.participants.delete(participantId);

			if (this.eventHandlers.onParticipantRemoved) {
				this.eventHandlers.onParticipantRemoved(participantId, participant);
			}
		}
		return participant;
	}

	updateParticipant(
		participantId: string,
		updates: Record<string, unknown>,
	): Participant | null {
		const participant = this.participants.get(participantId);
		if (participant) {
			const updatedParticipant = { ...participant, ...updates };
			this.participants.set(participantId, updatedParticipant);

			if (this.eventHandlers.onParticipantUpdated) {
				this.eventHandlers.onParticipantUpdated(
					participantId,
					updatedParticipant,
					updates,
				);
			}
			return updatedParticipant;
		}
		return null;
	}

	getParticipant(participantId: string): Participant | undefined {
		return this.participants.get(participantId);
	}

	getAllParticipants(): Participant[] {
		return Array.from(this.participants.values());
	}

	getParticipantsMap(): Map<string, Participant> {
		return new Map(this.participants);
	}

	updateMediaState(
		participantId: string,
		{ audioEnabled, videoEnabled }: MediaStateUpdate,
	): Participant | null {
		const updates: Record<string, boolean> = {};
		if (typeof audioEnabled !== "undefined") {
			updates.audio_enabled = audioEnabled;
		}
		if (typeof videoEnabled !== "undefined") {
			updates.video_enabled = videoEnabled;
		}

		if (Object.keys(updates).length > 0) {
			return this.updateParticipant(participantId, updates);
		}
		return null;
	}

	hasParticipant(participantId: string): boolean {
		return this.participants.has(participantId);
	}

	getParticipantCount(): number {
		return this.participants.size;
	}

	getVideoEnabledParticipants(): Participant[] {
		return this.getAllParticipants().filter((p) => p.video_enabled);
	}

	getAudioEnabledParticipants(): Participant[] {
		return this.getAllParticipants().filter((p) => p.audio_enabled);
	}

	generateInitials(name: string): string {
		if (!name) return "UN";
		return name
			.split(" ")
			.map((n) => n[0])
			.join("")
			.toUpperCase()
			.slice(0, 2);
	}

	clear(): void {
		const participantIds = Array.from(this.participants.keys());
		this.participants.clear();

		if (this.eventHandlers.onAllParticipantsCleared) {
			this.eventHandlers.onAllParticipantsCleared(participantIds);
		}
	}

	syncParticipants(serverParticipants: ParticipantData[] = []): void {
		const currentIds = new Set(this.participants.keys());
		const serverIds = new Set<string>();

		for (const serverParticipant of serverParticipants) {
			const participantId =
				serverParticipant.participantId || serverParticipant.user_id || "";
			serverIds.add(participantId);

			if (this.hasParticipant(participantId)) {
				this.updateParticipant(participantId, serverParticipant);
			} else {
				this.addParticipant(serverParticipant);
			}
		}

		for (const currentId of currentIds) {
			if (!serverIds.has(currentId)) {
				this.removeParticipant(currentId);
			}
		}
	}
}
