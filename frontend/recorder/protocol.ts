export interface RecorderParticipantUserData {
	name?: string;
	avatar?: string | null;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
}

export interface RecorderParticipantData {
	participantId?: string;
	user_id?: string;
	user_name?: string;
	avatar?: string | null;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
	userData?: RecorderParticipantUserData;
}

export interface RecorderParticipantUpdate {
	participantId?: string;
	user_id?: string;
	user_name?: string;
	avatar?: string | null;
	initials?: string;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
	userData?: RecorderParticipantUserData;
}

export type ParticipantMessage =
	| { type: "participant-joined"; value: RecorderParticipantData & { participantId: string } }
	| { type: "participant-left"; value: { participantId: string } };

export interface ProducerEvent {
	producerId: string;
	participantId: string;
	isScreen: boolean;
}

export type ProducerMessage =
	| { type: "producer-created"; value: ProducerEvent }
	| { type: "producer-closed"; value: ProducerEvent };

export type LegacyMediaControlAction =
	| "mute"
	| "unmute"
	| "video_off"
	| "video_on";

export type MediaControlAction =
	| LegacyMediaControlAction
	| { type: "audio" | "video"; enabled: boolean };

export type MediaControlMessage =
	| { participantId: string; action: LegacyMediaControlAction }
	| { participantId: string; action: { type: "audio" | "video"; enabled: boolean } };

export interface ParticipantSnapshot {
	id: string;
	user_id?: string;
	info: RecorderParticipantUserData & { user_name?: string };
}

export interface ProducerSnapshot {
	id: string;
	participantId: string;
	isScreen: boolean;
}

export interface ChatMessage {
	fromUser?: string;
	fromName?: string;
	message: string;
	timestamp?: string;
}

export interface RecordingChallengeMessage {
	version: 1;
	jti: string;
	socket_id: string;
	nonce: string;
	issued_at: number;
	expires_at: number;
}

const optionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === "string";
const optionalBoolean = (value: unknown): value is boolean | undefined =>
	value === undefined || typeof value === "boolean";
const optionalAvatar = (value: unknown): value is string | null | undefined =>
	value === undefined || value === null || typeof value === "string";

const parseParticipantUserData = (
	value: unknown,
): RecorderParticipantUserData | null => {
	if (typeof value !== "object" || value === null) return null;
	const name = "name" in value ? value.name : undefined;
	const avatar = "avatar" in value ? value.avatar : undefined;
	const audioEnabled =
		"audio_enabled" in value ? value.audio_enabled : undefined;
	const videoEnabled =
		"video_enabled" in value ? value.video_enabled : undefined;
	const isGuest = "is_guest" in value ? value.is_guest : undefined;
	if (
		!optionalString(name) ||
		!optionalAvatar(avatar) ||
		!optionalBoolean(audioEnabled) ||
		!optionalBoolean(videoEnabled) ||
		!optionalBoolean(isGuest)
	) return null;
	return {
		name,
		avatar,
		audio_enabled: audioEnabled,
		video_enabled: videoEnabled,
		is_guest: isGuest,
	};
};

export const parseParticipantMessage = (
	type: ParticipantMessage["type"],
	value: unknown,
): ParticipantMessage | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantId =
		"participantId" in value ? value.participantId : undefined;
	if (typeof participantId !== "string" || !participantId) return null;
	if (type === "participant-left") {
		return { type, value: { participantId } };
	}
	const userDataValue = "userData" in value ? value.userData : undefined;
	const userData =
		userDataValue === undefined ? undefined : parseParticipantUserData(userDataValue);
	if (userDataValue !== undefined && !userData) return null;
	return { type, value: { participantId, ...(userData ? { userData } : {}) } };
};

export const parseProducerMessage = (
	type: ProducerMessage["type"],
	value: unknown,
): ProducerMessage | null => {
	if (typeof value !== "object" || value === null) return null;
	const producerId = "producerId" in value ? value.producerId : undefined;
	const participantId =
		"participantId" in value ? value.participantId : undefined;
	const isScreen = "isScreen" in value ? value.isScreen : false;
	if (
		typeof producerId !== "string" ||
		!producerId ||
		typeof participantId !== "string" ||
		!participantId ||
		typeof isScreen !== "boolean"
	) return null;
	return { type, value: { producerId, participantId, isScreen } };
};

export const parseParticipantSnapshot = (
	value: unknown,
): ParticipantSnapshot | null => {
	if (typeof value !== "object" || value === null) return null;
	const id = "id" in value ? value.id : undefined;
	const userId = "user_id" in value ? value.user_id : undefined;
	const infoValue = "info" in value ? value.info : undefined;
	if (
		typeof id !== "string" ||
		!id ||
		!optionalString(userId) ||
		typeof infoValue !== "object" ||
		infoValue === null
	) return null;
	const info = parseParticipantUserData(infoValue);
	const userName = "user_name" in infoValue ? infoValue.user_name : undefined;
	if (!info || !optionalString(userName)) return null;
	return { id, user_id: userId, info: { ...info, user_name: userName } };
};

export const parseProducerSnapshot = (
	value: unknown,
): ProducerSnapshot | null => {
	if (typeof value !== "object" || value === null) return null;
	const id = "id" in value ? value.id : undefined;
	const participantId = "participantId" in value
		? value.participantId
		: "user_id" in value
			? value.user_id
			: "userId" in value
				? value.userId
				: undefined;
	const isScreen = "isScreen" in value ? value.isScreen : false;
	if (
		typeof id !== "string" ||
		!id ||
		typeof participantId !== "string" ||
		!participantId ||
		typeof isScreen !== "boolean"
	) return null;
	return { id, participantId, isScreen };
};

export const parseMediaControlMessage = (
	value: unknown,
): MediaControlMessage | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantId =
		"participantId" in value ? value.participantId : undefined;
	const action = "action" in value ? value.action : undefined;
	if (typeof participantId !== "string" || !participantId) return null;
	if (
		action === "mute" ||
		action === "unmute" ||
		action === "video_off" ||
		action === "video_on"
	) return { participantId, action };
	if (typeof action !== "object" || action === null) return null;
	const actionType = "type" in action ? action.type : undefined;
	const enabled = "enabled" in action ? action.enabled : undefined;
	if (
		(actionType !== "audio" && actionType !== "video") ||
		typeof enabled !== "boolean"
	) return null;
	return { participantId, action: { type: actionType, enabled } };
};

export const parseConsumerId = (value: unknown): string | null => {
	if (typeof value !== "object" || value === null) return null;
	const consumerId = "consumerId" in value ? value.consumerId : undefined;
	return typeof consumerId === "string" && consumerId ? consumerId : null;
};

export const parseParticipantId = (value: unknown): string | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantId =
		"participantId" in value ? value.participantId : undefined;
	return typeof participantId === "string" && participantId
		? participantId
		: null;
};

export const parseActiveSpeakers = (value: unknown): string[] | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantIds =
		"participantIds" in value ? value.participantIds : undefined;
	return Array.isArray(participantIds) &&
		participantIds.every((id) => typeof id === "string" && id)
		? participantIds
		: null;
};

export const parseReaction = (
	value: unknown,
): { fromUser: string; reaction: string } | null => {
	if (typeof value !== "object" || value === null) return null;
	const fromUser = "fromUser" in value ? value.fromUser : undefined;
	const reaction = "reaction" in value ? value.reaction : undefined;
	return typeof fromUser === "string" && fromUser &&
		typeof reaction === "string" && reaction
		? { fromUser, reaction }
		: null;
};

export const parseHandChange = (
	value: unknown,
): { participantId: string; raised: boolean; timestamp: string } | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantId =
		"participantId" in value ? value.participantId : undefined;
	const raised = "raised" in value ? value.raised : undefined;
	const timestamp = "timestamp" in value ? value.timestamp : undefined;
	if (
		typeof participantId !== "string" ||
		!participantId ||
		typeof raised !== "boolean" ||
		!optionalString(timestamp)
	) return null;
	return {
		participantId,
		raised,
		timestamp: timestamp || new Date().toISOString(),
	};
};

export const parseRaisedHands = (
	value: unknown,
): Record<string, string> | null => {
	if (typeof value !== "object" || value === null || !("hands" in value))
		return null;
	const hands = value.hands;
	if (typeof hands !== "object" || hands === null || Array.isArray(hands))
		return null;
	const entries = Object.entries(hands);
	if (entries.some(([, timestamp]) => typeof timestamp !== "string")) return null;
	return Object.fromEntries(entries);
};

export const parseChatMessage = (value: unknown): ChatMessage | null => {
	if (typeof value !== "object" || value === null) return null;
	const fromUser = "fromUser" in value ? value.fromUser : undefined;
	const fromName = "fromName" in value ? value.fromName : undefined;
	const message = "message" in value ? value.message : undefined;
	const timestamp = "timestamp" in value ? value.timestamp : undefined;
	if (
		!optionalString(fromUser) ||
		!optionalString(fromName) ||
		typeof message !== "string" ||
		!message ||
		!optionalString(timestamp)
	) return null;
	return { fromUser, fromName, message, timestamp };
};

export const parseParticipantUpdate = (
	value: unknown,
): RecorderParticipantUpdate | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantId =
		"participantId" in value ? value.participantId : undefined;
	const userId = "user_id" in value ? value.user_id : undefined;
	const userName = "user_name" in value ? value.user_name : undefined;
	const avatar = "avatar" in value ? value.avatar : undefined;
	const initials = "initials" in value ? value.initials : undefined;
	const audioEnabled =
		"audio_enabled" in value ? value.audio_enabled : undefined;
	const videoEnabled =
		"video_enabled" in value ? value.video_enabled : undefined;
	const isGuest = "is_guest" in value ? value.is_guest : undefined;
	const userDataValue = "userData" in value ? value.userData : undefined;
	const userData = userDataValue === undefined
		? undefined
		: parseParticipantUserData(userDataValue);
	if (
		!optionalString(participantId) ||
		!optionalString(userId) ||
		!optionalString(userName) ||
		!optionalAvatar(avatar) ||
		!optionalString(initials) ||
		!optionalBoolean(audioEnabled) ||
		!optionalBoolean(videoEnabled) ||
		!optionalBoolean(isGuest) ||
		(userDataValue !== undefined && !userData)
	) return null;
	return {
		...("participantId" in value ? { participantId } : {}),
		...("user_id" in value ? { user_id: userId } : {}),
		...("user_name" in value ? { user_name: userName } : {}),
		...("avatar" in value ? { avatar } : {}),
		...("initials" in value ? { initials } : {}),
		...("audio_enabled" in value ? { audio_enabled: audioEnabled } : {}),
		...("video_enabled" in value ? { video_enabled: videoEnabled } : {}),
		...("is_guest" in value ? { is_guest: isGuest } : {}),
		...("userData" in value ? { userData: userData || undefined } : {}),
	};
};

export const parseRecordingChallenge = (
	value: unknown,
): RecordingChallengeMessage | null => {
	if (typeof value !== "object" || value === null) return null;
	const version = "version" in value ? value.version : undefined;
	const jti = "jti" in value ? value.jti : undefined;
	const socketId = "socket_id" in value ? value.socket_id : undefined;
	const nonce = "nonce" in value ? value.nonce : undefined;
	const issuedAt = "issued_at" in value ? value.issued_at : undefined;
	const expiresAt = "expires_at" in value ? value.expires_at : undefined;
	if (
		version !== 1 ||
		typeof jti !== "string" || !jti ||
		typeof socketId !== "string" || !socketId ||
		typeof nonce !== "string" || !nonce ||
		typeof issuedAt !== "number" || !Number.isFinite(issuedAt) ||
		typeof expiresAt !== "number" || !Number.isFinite(expiresAt)
	) return null;
	return { version, jti, socket_id: socketId, nonce, issued_at: issuedAt, expires_at: expiresAt };
};

export const parseRequestResponse = (
	value: unknown,
): { success: boolean; error?: string } | null => {
	if (typeof value !== "object" || value === null) return null;
	const success = "success" in value ? value.success : undefined;
	const error = "error" in value ? value.error : undefined;
	if (typeof success !== "boolean" || !optionalString(error)) return null;
	return { success, error };
};

export const parseScreenShareStarted = (
	value: unknown,
): { participantId: string; consumerId: string; stream: MediaStream } | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantId = "participantId" in value ? value.participantId : undefined;
	const stream = "stream" in value ? value.stream : undefined;
	const consumer = "consumer" in value ? value.consumer : undefined;
	if (
		typeof participantId !== "string" || !participantId ||
		(typeof MediaStream === "undefined" || !(stream instanceof MediaStream)) ||
		typeof consumer !== "object" || consumer === null ||
		!("id" in consumer) || typeof consumer.id !== "string" || !consumer.id
	) return null;
	return { participantId, consumerId: consumer.id, stream };
};
