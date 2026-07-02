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
	avatar?: string;
	audio_enabled: boolean;
	video_enabled: boolean;
	is_guest?: boolean;
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
