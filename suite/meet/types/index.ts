export type SFUScope = 'presence-preview' | 'full' | 'recording';

export interface RecordingJoinRequest {
	roomId: string;
}

export interface RecordingProofChallenge {
	protocol_version: 1;
	jti: string;
	socket_id: string;
	nonce: string;
	issued_at: number;
	expires_at: number;
}

export interface RecordingProofRequest {
	protocol_version: 1;
	signature: string;
}

export interface RecorderStageParticipant {
	participant_id: string;
	name: string;
	avatar?: string;
	audio_enabled: boolean;
	video_enabled: boolean;
}

export interface RecorderStageProducer {
	producer_id: string;
	participant_id: string;
	kind: 'audio' | 'video';
	paused: boolean;
	is_screen: boolean;
	observed_at: string;
}

export interface RecorderStageSnapshot {
	protocol_version: 1;
	room_id: string;
	cursor: number;
	observed_at: string;
	participants: RecorderStageParticipant[];
	producers: RecorderStageProducer[];
	raised_hands: Record<string, string>;
	active_speaker_ids: string[];
}

export type RecorderStageProjectionPayload =
	| { type: 'participant_joined'; participant: RecorderStageParticipant }
	| { type: 'participant_updated'; participant: RecorderStageParticipant }
	| { type: 'participant_left'; participant_id: string }
	| { type: 'producer_created'; producer: RecorderStageProducer }
	| { type: 'producer_updated'; producer_id: string; paused: boolean }
	| {
			type: 'producer_closed';
			producer_id: string;
			participant_id: string;
			is_screen: boolean;
	  }
	| {
			type: 'media_control';
			participant_id: string;
			action: MediaControlAction;
	  }
	| { type: 'active_speaker'; participant_ids: string[] }
	| { type: 'hand_raised'; participant_id: string; raised: boolean }
	| { type: 'reaction'; from_user: string; reaction: string }
	| {
			type: 'chat_message';
			message_id: string;
			message: string;
			from_user: string;
			from_name: string;
	  };

export interface RecorderStageProjectionEvent {
	protocol_version: 1;
	room_id: string;
	cursor: number;
	observed_at: string;
	payload: RecorderStageProjectionPayload;
}

export type RecordingProjectionSnapshotResponse =
	| { success: true; snapshot: RecorderStageSnapshot }
	| { success: false; error: string };

export type RecordingProofResponse =
	| { protocol_version: 1; success: true }
	| {
			protocol_version: 1;
			success: false;
			reason_code: 'invalid_proof';
			diagnostic?: string;
	  };

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

export type MediaControlAction = 'mute' | 'unmute' | 'video_off' | 'video_on';

export type HostControlAction =
	| 'mute_participant'
	| 'kick_participant'
	| 'ban_participant'
	| 'lower_hand';

export type ProducerCloseReason =
	| 'user-click'
	| 'track-ended'
	| 'publish-failed'
	| 'cleanup';

export type ProducerCloseSource = 'screen-share';

export interface ProducerCloseTrackSettings {
	aspectRatio?: number;
	autoGainControl?: boolean;
	channelCount?: number;
	deviceId?: string;
	displaySurface?: string;
	echoCancellation?: boolean;
	facingMode?: string;
	frameRate?: number;
	groupId?: string;
	height?: number;
	latency?: number;
	logicalSurface?: boolean;
	noiseSuppression?: boolean;
	restrictOwnAudio?: boolean;
	sampleRate?: number;
	sampleSize?: number;
	screenPixelRatio?: number;
	suppressLocalAudioPlayback?: boolean;
	width?: number;
}

export interface ProducerCloseDetails {
	trackId?: string;
	trackReadyState?: 'live' | 'ended';
	trackSettings?: ProducerCloseTrackSettings;
	message?: string;
}

export interface ScreenShareData {
	streamId?: string;
	kind?: 'video';
	isScreen?: boolean;
	reason?: ProducerCloseReason;
	source?: ProducerCloseSource;
	producerId?: string;
	details?: ProducerCloseDetails;
	startedAt?: number;
	stoppedAt?: number;
}

export interface ChatMessage {
	roomId: string;
	messageId: string;
	message: string;
	fromUser: string;
	fromName: string;
	timestamp: string;
	clientId?: string;
}

export interface PinnedChatMessage {
	messageId: string;
	message: string;
	fromUser: string;
	fromName: string;
	timestamp: string;
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
	userData: UserData | Pick<UserData, 'name' | 'avatar'>;
}

export interface ParticipantLeftEvent {
	roomId: string;
	participantId: string;
}

export type ProducerKind = 'audio' | 'video';

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
	reason?: ProducerCloseReason;
	source?: ProducerCloseSource;
	details?: ProducerCloseDetails;
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
	producerId: string;
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
	quality: 'good' | 'poor' | 'critical';
}

export interface HandRaisedEvent {
	participantId: string;
	raised: boolean;
	timestamp: string;
}

export interface ExistingRaisedHandsEvent {
	hands: Record<string, string>;
}

export interface UpdateTokenRequest {
	token: string;
}

export interface MediaState {
	audio_enabled: boolean;
	video_enabled: boolean;
}

export type E2EEMode = 'insertable-streams' | 'none';

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
	connectionId?: string;
	conflictId?: string;
	userData: UserData;
	mediaState: MediaState;
	e2ee?: E2EESessionMetadata;
}

export interface CreateWebRtcTransportRequest {
	direction: 'send' | 'recv';
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
	action: 'start_share' | 'stop_share';
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
	info: PreviewParticipantInfo['info'] & {
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
