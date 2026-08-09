/**
 * Participant Manager
 * Handles participant state management and updates
 */

export interface Participant {
	user_id: string;
	user_name: string;
	avatar: string | null;
	initials: string;
	participantId?: string;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
	isHost?: boolean;
	networkQuality?: string;
	userData?: ParticipantUserData;
	isLocalScreenShare?: boolean;
}

export interface ParticipantUserData {
	name?: string;
	avatar?: string | null;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
	isHost?: boolean;
}

export interface ParticipantData {
	participantId?: string;
	user_id?: string;
	user_name?: string;
	userData?: ParticipantUserData;
	avatar?: string | null;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
	isHost?: boolean;
	networkQuality?: string;
	senderId?: number;
	sender_id?: number;
	is_host?: boolean;
}

export type ParticipantUpdate = Partial<Participant>;

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
		updates: ParticipantUpdate,
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
			isHost: participantData.userData?.isHost ?? participantData.isHost,
			networkQuality: participantData.networkQuality,
			participantId: participantData.participantId,
			userData: participantData.userData,
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
		updates: ParticipantUpdate,
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

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: object, key: string): string | undefined {
	if (!(key in value)) return undefined;
	const field = Reflect.get(value, key);
	return typeof field === "string" ? field : undefined;
}

function booleanField(value: object, key: string): boolean | undefined {
	if (!(key in value)) return undefined;
	const field = Reflect.get(value, key);
	return typeof field === "boolean" ? field : undefined;
}

function numberField(value: object, key: string): number | undefined {
	if (!(key in value)) return undefined;
	const field = Reflect.get(value, key);
	return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function normalizeUserData(value: unknown): ParticipantUserData | undefined {
	if (!isObject(value)) return undefined;
	const avatar = "avatar" in value && value.avatar === null
		? null
		: stringField(value, "avatar");
	return {
		name: stringField(value, "name"),
		avatar,
		audio_enabled: booleanField(value, "audio_enabled"),
		video_enabled: booleanField(value, "video_enabled"),
		is_guest: booleanField(value, "is_guest"),
		isHost: booleanField(value, "isHost"),
	};
}

export function normalizeParticipantData(value: unknown): ParticipantData | null {
	if (!isObject(value)) return null;
	const participantId = stringField(value, "participantId");
	const userId = stringField(value, "user_id") ?? stringField(value, "id");
	if (!participantId && !userId) return null;
	const nestedUserData =
		"userData" in value
			? normalizeUserData(value.userData)
			: "info" in value
				? normalizeUserData(value.info)
				: undefined;
	const avatar = "avatar" in value && value.avatar === null
		? null
		: stringField(value, "avatar");
	return {
		participantId: participantId ?? userId,
		user_id: userId ?? participantId,
		user_name: stringField(value, "user_name") ?? nestedUserData?.name,
		userData: nestedUserData,
		avatar,
		audio_enabled: booleanField(value, "audio_enabled"),
		video_enabled: booleanField(value, "video_enabled"),
		is_guest: booleanField(value, "is_guest"),
		isHost: booleanField(value, "isHost"),
		networkQuality: stringField(value, "networkQuality"),
		senderId: numberField(value, "senderId"),
		sender_id: numberField(value, "sender_id"),
		is_host: booleanField(value, "is_host"),
	};
}
