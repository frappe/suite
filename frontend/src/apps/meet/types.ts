export type Platform = "win" | "mac" | "linux" | "unknown";

export interface FrappeRequestError extends Error {
	messages: string[];
	exc_type: string;
}

export interface ParticipantPreview {
	user_id: string;
	full_name: string;
	avatar_url?: string;
	has_video: boolean;
	has_audio: boolean;
	is_guest?: boolean;
}

export interface PresenceTokenResponse {
	auth_token?: string;
	sfu_url?: string;
	sfu_port?: number;
	error?: string;
	expires_in?: number;
}

export interface PresenceParticipant {
	user_id?: string;
	id: string;
	info: {
		name?: string;
		avatar?: string;
		userId?: string;
		audio_enabled?: boolean;
		video_enabled?: boolean;
		is_guest?: boolean;
	};
}

export interface PresenceParticipantsResponse {
	success: boolean;
	participants?: PresenceParticipant[];
	error?: string;
}

export interface PresenceJoinResponse {
	success: boolean;
	error?: string;
}

export interface UserData {
	name: string;
	userId: string;
	avatar?: string | null;
	audio_enabled: boolean;
	video_enabled: boolean;
	is_guest?: boolean;
	isHost?: boolean;
}

export interface JoinUserData {
	name?: string;
	userId?: string;
	avatar?: string | null;
	audio_enabled?: boolean;
	video_enabled?: boolean;
	is_guest?: boolean;
	isHost?: boolean;
}

export interface JoinPayload {
	status?: string;
	lobby_token?: string;
	auth_token?: string;
	guest_id?: string;
	guest_name?: string;
	meeting_id?: string;
	user_id?: string;
	sfu_url?: string;
	sfu_port?: string | number;
	expires_in?: number;
	codec_strategy?: string;
	e2ee_required?: boolean;
	is_host?: boolean;
	is_cohost?: boolean;
	host_only_chat?: boolean;
	recording_enabled?: boolean;
	user_data?: JoinUserData;
	recording?: {
		name: string;
		status:
			| "Pending"
			| "Recording"
			| "Interrupted"
			| "Stopping"
			| "Processing"
			| "Ready"
			| "Partial"
			| "Failed";
		started_at?: string;
		capture_started_at?: string;
		state_revision: number;
	} | null;
}

export interface JoinRoomMediaState {
	audio_enabled?: boolean;
	video_enabled?: boolean;
}

export interface DeviceChangedEvent {
	type: "camera" | "microphone" | "speaker";
	deviceId: string;
}

export function isUnknownRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function normalizeJoinUserData(value: unknown): JoinUserData | undefined {
	if (!isUnknownRecord(value)) return undefined;
	return {
		name: optionalString(value.name),
		userId: optionalString(value.userId),
		avatar:
			value.avatar === null ? null : optionalString(value.avatar),
		audio_enabled: optionalBoolean(value.audio_enabled),
		video_enabled: optionalBoolean(value.video_enabled),
		is_guest: optionalBoolean(value.is_guest),
		isHost: optionalBoolean(value.isHost),
	};
}

const RECORDING_STATUSES = new Set<NonNullable<JoinPayload["recording"]>["status"]>([
	"Pending",
	"Recording",
	"Interrupted",
	"Stopping",
	"Processing",
	"Ready",
	"Partial",
	"Failed",
]);

function normalizeRecording(value: unknown): JoinPayload["recording"] | undefined {
	if (value === null) return null;
	if (
		!isUnknownRecord(value) ||
		typeof value.name !== "string" ||
		typeof value.status !== "string" ||
		!RECORDING_STATUSES.has(
			value.status as NonNullable<JoinPayload["recording"]>["status"],
		) ||
		typeof value.state_revision !== "number"
	) {
		return undefined;
	}
	return {
		name: value.name,
		status: value.status as NonNullable<JoinPayload["recording"]>["status"],
		started_at: optionalString(value.started_at),
		capture_started_at: optionalString(value.capture_started_at),
		state_revision: value.state_revision,
	};
}

export function normalizeJoinPayload(value: unknown): JoinPayload | null {
	if (!isUnknownRecord(value)) return null;
	const sfuPort =
		typeof value.sfu_port === "string" || typeof value.sfu_port === "number"
			? value.sfu_port
			: undefined;
	return {
		status: optionalString(value.status),
		lobby_token: optionalString(value.lobby_token),
		auth_token: optionalString(value.auth_token),
		guest_id: optionalString(value.guest_id),
		guest_name: optionalString(value.guest_name),
		meeting_id: optionalString(value.meeting_id),
		user_id: optionalString(value.user_id),
		sfu_url: optionalString(value.sfu_url),
		sfu_port: sfuPort,
		expires_in:
			typeof value.expires_in === "number" ? value.expires_in : undefined,
		codec_strategy: optionalString(value.codec_strategy),
		e2ee_required: optionalBoolean(value.e2ee_required),
		is_host: optionalBoolean(value.is_host),
		is_cohost: optionalBoolean(value.is_cohost),
		host_only_chat: optionalBoolean(value.host_only_chat),
		recording_enabled: optionalBoolean(value.recording_enabled),
		user_data: normalizeJoinUserData(value.user_data),
		recording: normalizeRecording(value.recording),
	};
}

export interface ParticipantJoinedEvent {
	roomId: string;
	participantId: string;
	userData: UserData;
}

export interface ParticipantLeftEvent {
	roomId: string;
	participantId: string;
}

export interface PollOption {
	id: string;
	text: string;
	votes: number;
}

export interface PollPayloadFE {
    pollId: string;
    createdBy: string;
    createdByName?: string;
    question: string;
    options: PollOption[];
    isActive: boolean;
    hasVoted?: boolean;
    createdAt?: string;
}
