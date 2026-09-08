import type {
	RecorderStageParticipant,
	RecorderStageProducer,
	RecorderStageProjectionEvent,
	RecorderStageProjectionPayload,
	RecorderStageSnapshot,
	RecordingProjectionSnapshotResponse,
	RecordingProofChallenge,
	RecordingProofResponse,
} from "../../suite/meet/types";

interface RecorderParticipantUserData {
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

export interface ProducerEvent {
	producerId: string;
	participantId: string;
	isScreen: boolean;
}

type RecordingChallengeMessage = RecordingProofChallenge;

const exactKeys = (
	value: object,
	required: readonly string[],
	optional: readonly string[] = [],
): boolean => {
	const keys = Object.keys(value);
	return (
		required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key))
	);
};

const optionalString = (value: unknown): value is string | undefined =>
	value === undefined || typeof value === "string";
const optionalBoolean = (value: unknown): value is boolean | undefined =>
	value === undefined || typeof value === "boolean";
const optionalAvatar = (value: unknown): value is string | null | undefined =>
	value === undefined || value === null || typeof value === "string";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = Record<string, JsonValue>;
const jsonValue = (value: unknown): value is JsonValue => {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	)
		return true;
	if (Array.isArray(value)) return value.every(jsonValue);
	return record(value);
};
const record = (value: unknown): value is JsonObject =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	Object.values(value).every(jsonValue);
const nonemptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;
const canonicalTimestamp = (value: unknown): value is string => {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
	)
		return false;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};
const stringArray = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every(nonemptyString);

const parseStageParticipant = (
	value: unknown,
): RecorderStageParticipant | null => {
	if (
		!record(value) ||
		!exactKeys(
			value,
			["participant_id", "name", "audio_enabled", "video_enabled"],
			["avatar"],
		) ||
		!nonemptyString(value.participant_id) ||
		!nonemptyString(value.name) ||
		(typeof value.avatar !== "undefined" && !nonemptyString(value.avatar)) ||
		typeof value.audio_enabled !== "boolean" ||
		typeof value.video_enabled !== "boolean"
	)
		return null;
	return {
		participant_id: value.participant_id,
		name: value.name,
		...(typeof value.avatar === "string" ? { avatar: value.avatar } : {}),
		audio_enabled: value.audio_enabled,
		video_enabled: value.video_enabled,
	};
};

const parseStageProducer = (value: unknown): RecorderStageProducer | null => {
	if (
		!record(value) ||
		!exactKeys(value, [
			"producer_id",
			"participant_id",
			"kind",
			"paused",
			"is_screen",
			"observed_at",
		]) ||
		!nonemptyString(value.producer_id) ||
		!nonemptyString(value.participant_id) ||
		(value.kind !== "audio" && value.kind !== "video") ||
		typeof value.paused !== "boolean" ||
		typeof value.is_screen !== "boolean" ||
		(value.is_screen === true && value.kind !== "video") ||
		!canonicalTimestamp(value.observed_at)
	)
		return null;
	return {
		producer_id: value.producer_id,
		participant_id: value.participant_id,
		kind: value.kind,
		paused: value.paused,
		is_screen: value.is_screen,
		observed_at: value.observed_at,
	};
};

const parseProjectionPayload = (
	value: unknown,
): RecorderStageProjectionPayload | null => {
	if (!record(value) || !nonemptyString(value.type)) return null;
	switch (value.type) {
		case "participant_joined":
		case "participant_updated": {
			if (!exactKeys(value, ["type", "participant"])) return null;
			const participant = parseStageParticipant(value.participant);
			return participant ? { type: value.type, participant } : null;
		}
		case "participant_left":
			return exactKeys(value, ["type", "participant_id"]) &&
				nonemptyString(value.participant_id)
				? { type: value.type, participant_id: value.participant_id }
				: null;
		case "producer_created": {
			if (!exactKeys(value, ["type", "producer"])) return null;
			const producer = parseStageProducer(value.producer);
			return producer ? { type: value.type, producer } : null;
		}
		case "producer_updated":
			return exactKeys(value, ["type", "producer_id", "paused"]) &&
				nonemptyString(value.producer_id) &&
				typeof value.paused === "boolean"
				? {
						type: value.type,
						producer_id: value.producer_id,
						paused: value.paused,
					}
				: null;
		case "producer_closed":
			return exactKeys(value, [
				"type",
				"producer_id",
				"participant_id",
				"is_screen",
			]) &&
				nonemptyString(value.producer_id) &&
				nonemptyString(value.participant_id) &&
				typeof value.is_screen === "boolean"
				? {
						type: value.type,
						producer_id: value.producer_id,
						participant_id: value.participant_id,
						is_screen: value.is_screen,
					}
				: null;
		case "media_control":
			return exactKeys(value, ["type", "participant_id", "action"]) &&
				nonemptyString(value.participant_id) &&
				(value.action === "mute" ||
					value.action === "unmute" ||
					value.action === "video_off" ||
					value.action === "video_on")
				? {
						type: value.type,
						participant_id: value.participant_id,
						action: value.action,
					}
				: null;
		case "active_speaker":
			return exactKeys(value, ["type", "participant_ids"]) &&
				stringArray(value.participant_ids)
				? { type: value.type, participant_ids: value.participant_ids }
				: null;
		case "hand_raised":
			return exactKeys(value, ["type", "participant_id", "raised"]) &&
				nonemptyString(value.participant_id) &&
				typeof value.raised === "boolean"
				? {
						type: value.type,
						participant_id: value.participant_id,
						raised: value.raised,
					}
				: null;
		case "reaction":
			return exactKeys(value, ["type", "from_user", "reaction"]) &&
				nonemptyString(value.from_user) &&
				nonemptyString(value.reaction)
				? {
						type: value.type,
						from_user: value.from_user,
						reaction: value.reaction,
					}
				: null;
		case "chat_message":
			return exactKeys(value, [
				"type",
				"message_id",
				"message",
				"from_user",
				"from_name",
			]) &&
				nonemptyString(value.message_id) &&
				nonemptyString(value.message) &&
				nonemptyString(value.from_user) &&
				nonemptyString(value.from_name)
				? {
						type: value.type,
						message_id: value.message_id,
						message: value.message,
						from_user: value.from_user,
						from_name: value.from_name,
					}
				: null;
		default:
			return null;
	}
};

export const parseRecorderStageSnapshot = (
	value: unknown,
): RecorderStageSnapshot | null => {
	if (
		!record(value) ||
		!exactKeys(value, [
			"protocol_version",
			"room_id",
			"cursor",
			"observed_at",
			"participants",
			"producers",
			"raised_hands",
			"active_speaker_ids",
		]) ||
		value.protocol_version !== 1 ||
		!nonemptyString(value.room_id) ||
		!Number.isSafeInteger(value.cursor) ||
		(value.cursor as number) < 0 ||
		!canonicalTimestamp(value.observed_at) ||
		!Array.isArray(value.participants) ||
		!Array.isArray(value.producers) ||
		!record(value.raised_hands) ||
		!stringArray(value.active_speaker_ids)
	)
		return null;
	const participants: RecorderStageParticipant[] = [];
	for (const participantValue of value.participants) {
		const participant = parseStageParticipant(participantValue);
		if (!participant) return null;
		participants.push(participant);
	}
	const producers: RecorderStageProducer[] = [];
	for (const producerValue of value.producers) {
		const producer = parseStageProducer(producerValue);
		if (!producer) return null;
		producers.push(producer);
	}
	const observedAt = value.observed_at;
	const participantIds = new Set(
		participants.flatMap((participant) =>
			participant ? [participant.participant_id] : [],
		),
	);
	const producerIds = new Set(
		producers.flatMap((producer) => (producer ? [producer.producer_id] : [])),
	);
	if (
		participantIds.size !== participants.length ||
		producerIds.size !== producers.length ||
		producers.some(
			(producer) =>
				!participantIds.has(producer.participant_id) ||
				producer.observed_at > observedAt,
		) ||
		Object.entries(value.raised_hands).some(
			([participantId, timestamp]) =>
				!participantIds.has(participantId) || !canonicalTimestamp(timestamp),
		) ||
		new Set(value.active_speaker_ids).size !== value.active_speaker_ids.length ||
		value.active_speaker_ids.some((id) => !participantIds.has(id))
	)
		return null;
	return {
		protocol_version: 1,
		room_id: value.room_id,
		cursor: Number(value.cursor),
		observed_at: observedAt,
		participants,
		producers,
		raised_hands: Object.fromEntries(
			Object.entries(value.raised_hands).map(([participantId, timestamp]) => [
				participantId,
				String(timestamp),
			]),
		),
		active_speaker_ids: value.active_speaker_ids,
	};
};

export const parseRecordingProjectionSnapshotResponse = (
	value: unknown,
): RecordingProjectionSnapshotResponse | null => {
	if (!record(value) || typeof value.success !== "boolean") return null;
	if (value.success) {
		if (!exactKeys(value, ["success", "snapshot"])) return null;
		const snapshot = parseRecorderStageSnapshot(value.snapshot);
		return snapshot ? { success: true, snapshot } : null;
	}
	return exactKeys(value, ["success", "error"]) && nonemptyString(value.error)
		? { success: false, error: value.error }
		: null;
};

export const parseRecorderStageProjectionEvent = (
	value: unknown,
): RecorderStageProjectionEvent | null => {
	if (
		!record(value) ||
		!exactKeys(value, [
			"protocol_version",
			"room_id",
			"cursor",
			"observed_at",
			"payload",
		]) ||
		value.protocol_version !== 1 ||
		!nonemptyString(value.room_id) ||
		!Number.isSafeInteger(value.cursor) ||
		(value.cursor as number) <= 0 ||
		!canonicalTimestamp(value.observed_at)
	)
		return null;
	const payload = parseProjectionPayload(value.payload);
	return payload
		? {
				protocol_version: 1,
				room_id: value.room_id,
				cursor: value.cursor as number,
				observed_at: value.observed_at,
				payload,
			}
		: null;
};

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
	)
		return null;
	return {
		name,
		avatar,
		audio_enabled: audioEnabled,
		video_enabled: videoEnabled,
		is_guest: isGuest,
	};
};

export const parseConsumerId = (value: unknown): string | null => {
	if (typeof value !== "object" || value === null) return null;
	const consumerId = "consumerId" in value ? value.consumerId : undefined;
	return typeof consumerId === "string" && consumerId ? consumerId : null;
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
	const userData =
		userDataValue === undefined
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
	)
		return null;
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
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!exactKeys(value, [
			"protocol_version",
			"jti",
			"socket_id",
			"nonce",
			"issued_at",
			"expires_at",
		])
	)
		return null;
	const protocolVersion =
		"protocol_version" in value ? value.protocol_version : undefined;
	const jti = "jti" in value ? value.jti : undefined;
	const socketId = "socket_id" in value ? value.socket_id : undefined;
	const nonce = "nonce" in value ? value.nonce : undefined;
	const issuedAt = "issued_at" in value ? value.issued_at : undefined;
	const expiresAt = "expires_at" in value ? value.expires_at : undefined;
	if (
		protocolVersion !== 1 ||
		typeof jti !== "string" ||
		!jti ||
		typeof socketId !== "string" ||
		!socketId ||
		typeof nonce !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(nonce) ||
		typeof issuedAt !== "number" ||
		!Number.isSafeInteger(issuedAt) ||
		typeof expiresAt !== "number" ||
		!Number.isSafeInteger(expiresAt) ||
		expiresAt - issuedAt !== 10
	)
		return null;
	return {
		protocol_version: protocolVersion,
		jti,
		socket_id: socketId,
		nonce,
		issued_at: issuedAt,
		expires_at: expiresAt,
	};
};

export const parseRecordingProofResponse = (
	value: unknown,
): RecordingProofResponse | null => {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	if (
		!("protocol_version" in value) ||
		value.protocol_version !== 1 ||
		!("success" in value)
	)
		return null;
	if (
		value.success === true &&
		exactKeys(value, ["protocol_version", "success"])
	) {
		return { protocol_version: 1, success: true };
	}
	if (
		value.success === false &&
		exactKeys(
			value,
			["protocol_version", "success", "reason_code"],
			["diagnostic"],
		) &&
		"reason_code" in value &&
		value.reason_code === "invalid_proof" &&
		(!("diagnostic" in value) ||
			(typeof value.diagnostic === "string" && value.diagnostic.length <= 256))
	)
		return {
			protocol_version: 1,
			success: false,
			reason_code: "invalid_proof",
			...("diagnostic" in value
				? { diagnostic: value.diagnostic as string }
				: {}),
		};
	return null;
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
): {
	participantId: string;
	consumerId: string;
	producerId: string;
	stream: MediaStream;
} | null => {
	if (typeof value !== "object" || value === null) return null;
	const participantId =
		"participantId" in value ? value.participantId : undefined;
	const stream = "stream" in value ? value.stream : undefined;
	const consumer = "consumer" in value ? value.consumer : undefined;
	if (
		typeof participantId !== "string" ||
		!participantId ||
		typeof MediaStream === "undefined" ||
		!(stream instanceof MediaStream) ||
		typeof consumer !== "object" ||
		consumer === null ||
		!("id" in consumer) ||
		typeof consumer.id !== "string" ||
		!consumer.id ||
		!("producerId" in consumer) ||
		typeof consumer.producerId !== "string" ||
		!consumer.producerId
	)
		return null;
	return {
		participantId,
		consumerId: consumer.id,
		producerId: consumer.producerId,
		stream,
	};
};
