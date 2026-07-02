export type SFUScope = "presence-preview" | "full";

export interface UserData {
	name: string;
	userId: string;
	avatar?: string;
	audio_enabled: boolean;
	video_enabled: boolean;
	is_guest?: boolean;
}

export interface ParticipantInfo {
	id: string;
	user_id: string;
	senderId?: number;
	sender_id?: number;
	is_host?: boolean;
	info: {
		name?: string;
		userId: string;
		avatar?: string;
		audio_enabled: boolean;
		video_enabled: boolean;
		is_guest?: boolean;
	};
}

export interface PreviewParticipantInfo {
	id: string;
	info: {
		name?: string;
		avatar?: string;
	};
}

export type MediaControlAction = "mute" | "unmute" | "video_off" | "video_on";

export type HostControlAction =
	| "mute_participant"
	| "kick_participant"
	| "lower_hand";

export interface ScreenShareData {
	streamId?: string;
	kind?: "video";
	isScreen?: boolean;
	reason?: string;
	source?: string;
	producerId?: string;
	details?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ChatMessage {
	roomId: string;
	message: string;
	fromUser: string;
	fromName: string;
	timestamp: string;
	clientId?: string;
}

export interface ReactionMessage {
	roomId: string;
	reaction: string;
	fromUser: string;
	fromName: string;
	timestamp: string;
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

export type ProducerKind = "audio" | "video";

export interface ProducerCreatedEvent {
	roomId: string;
	producerId: string;
	participantId: string;
	kind: ProducerKind;
	paused: boolean;
	isScreen: boolean;
}

export interface ProducerClosedEvent {
	roomId: string;
	producerId: string;
	participantId: string;
	isScreen: boolean;
	reason?: string;
	source?: string;
	details?: Record<string, unknown>;
}

export interface ConsumerClosedEvent {
	consumerId: string;
	peerId?: string;
}

export interface MediaControlUpdateEvent {
	participantId: string;
	action: MediaControlAction;
	timestamp: string;
}

export interface HostControlUpdateEvent {
	action: HostControlAction;
	targetParticipantId: string;
	hostId: string;
	timestamp: string;
}

export interface ScreenShareStartedEvent {
	participantId: string;
	shareData: ScreenShareData;
	timestamp: string;
}

export interface ScreenShareStoppedEvent {
	participantId: string;
	timestamp: string;
	reason?: string;
}

export interface ActiveSpeakerEvent {
	participantIds: string[];
}

export interface SFUErrorEvent {
	error: string;
	timestamp: string;
}

export interface AuthExpiredEvent {
	timestamp: string;
	reason: string;
}

export interface NetworkQualityUpdateEvent {
	participantId: string;
	quality: "good" | "poor" | "critical";
}

export interface HandRaisedEvent {
	participantId: string;
	raised: boolean;
	timestamp: string;
}

export interface ExistingRaisedHandsEvent {
	hands: Record<string, boolean>;
}

export interface UpdateTokenRequest {
	token: string;
}

export interface MediaState {
	audio_enabled: boolean;
	video_enabled: boolean;
}

export type E2EEMode = "insertable-streams" | "none";

export interface E2EECapability {
	supported: boolean;
	mode: E2EEMode;
}

export interface E2EESessionMetadata {
	enabled: boolean;
	capability: E2EECapability;
	ecdhPublicKey?: string;
}

export interface JoinRoomRequest {
	roomId: string;
	userData: UserData;
	mediaState: MediaState;
	e2ee?: E2EESessionMetadata;
}

export interface CreateWebRtcTransportRequest {
	direction: "send" | "recv";
	encryptionEnabled?: boolean;
}

export interface MediaControlRequest {
	action: MediaControlAction;
}

export interface HostControlRequest {
	action: HostControlAction;
	targetParticipantId: string;
}

export interface ScreenShareRequest {
	action: "start_share" | "stop_share";
	shareData?: ScreenShareData;
}

export interface ChatSendRequest {
	message: string;
	clientId?: string;
}

export interface ReactionSendRequest {
	reaction: string;
	clientId?: string;
}

export interface ConsumerUpdatePreferencesRequest {
	consumerId: string;
	visible: boolean;
	width?: number;
	height?: number;
}

export interface RaiseHandRequest {
	raised: boolean;
}

export interface LeaveRoomRequest {
	roomId?: string;
}

export interface PresenceTokenResponse {
	auth_token?: string;
	sfu_url?: string;
	sfu_port?: number;
	error?: string;
}

export interface PresenceParticipant extends PreviewParticipantInfo {
	user_id?: string;
	info: PreviewParticipantInfo["info"] & {
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
