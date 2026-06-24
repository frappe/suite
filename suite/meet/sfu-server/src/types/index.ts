import type { AudioLevelObserver } from 'mediasoup/node/lib/AudioLevelObserverTypes';
import type { Consumer } from 'mediasoup/node/lib/ConsumerTypes';
import type { Producer } from 'mediasoup/node/lib/ProducerTypes';
import type { Router } from 'mediasoup/node/lib/RouterTypes';
import type {
	RouterRtpCodecCapability,
	RtpCodecCapability,
} from 'mediasoup/node/lib/rtpParametersTypes';
import type {
	AppData,
	RtpCapabilities,
	RtpParameters,
} from 'mediasoup/node/lib/types';
import type {
	DtlsParameters,
	IceCandidate,
	IceParameters,
	WebRtcTransport,
} from 'mediasoup/node/lib/WebRtcTransportTypes';
import type {
	WorkerLogLevel,
	WorkerSettings,
} from 'mediasoup/node/lib/WorkerTypes';
import type {
	ActiveSpeakerEvent,
	AuthExpiredEvent,
	ChatMessage,
	ChatSendRequest,
	ConsumerClosedEvent,
	ConsumerUpdatePreferencesRequest,
	CreateWebRtcTransportRequest,
	ExistingRaisedHandsEvent,
	HandRaisedEvent,
	HostControlRequest,
	HostControlUpdateEvent,
	JoinRoomRequest,
	LeaveRoomRequest,
	MediaControlAction,
	MediaControlRequest,
	MediaControlUpdateEvent,
	NetworkQualityUpdateEvent,
	ParticipantInfo,
	ParticipantJoinedEvent,
	ParticipantLeftEvent,
	PreviewParticipantInfo,
	ProducerClosedEvent,
	ProducerCreatedEvent,
	RaiseHandRequest,
	ReactionMessage,
	ReactionSendRequest,
	ScreenShareRequest,
	ScreenShareStartedEvent,
	ScreenShareStoppedEvent,
	SFUErrorEvent,
	SFUScope,
	UpdateTokenRequest,
	UserData,
} from '../../../types';

// Re-export mediasoup types
export type {
	ActiveSpeakerEvent,
	AppData,
	AudioLevelObserver,
	AuthExpiredEvent,
	ChatMessage,
	ChatSendRequest,
	Consumer,
	ConsumerClosedEvent,
	ConsumerUpdatePreferencesRequest,
	CreateWebRtcTransportRequest,
	DtlsParameters,
	ExistingRaisedHandsEvent,
	HandRaisedEvent,
	HostControlRequest,
	HostControlUpdateEvent,
	IceCandidate,
	IceParameters,
	JoinRoomRequest,
	LeaveRoomRequest,
	MediaControlAction,
	MediaControlRequest,
	MediaControlUpdateEvent,
	NetworkQualityUpdateEvent,
	ParticipantInfo,
	ParticipantJoinedEvent,
	ParticipantLeftEvent,
	PreviewParticipantInfo,
	Producer,
	ProducerClosedEvent,
	ProducerCreatedEvent,
	RaiseHandRequest,
	ReactionMessage,
	ReactionSendRequest,
	Router,
	RouterRtpCodecCapability,
	RtpCapabilities,
	RtpCodecCapability,
	RtpParameters,
	ScreenShareRequest,
	ScreenShareStartedEvent,
	ScreenShareStoppedEvent,
	SFUErrorEvent,
	SFUScope,
	UpdateTokenRequest,
	UserData,
	WebRtcTransport,
	WorkerLogLevel,
	WorkerSettings,
};

// Socket.IO types
export interface ServerToClientEvents {
	participant_joined: (data: ParticipantJoinedEvent) => void;
	participant_left: (data: ParticipantLeftEvent) => void;
	producer_created: (data: ProducerCreatedEvent) => void;
	producer_closed: (data: ProducerClosedEvent) => void;
	consumer_closed: (data: ConsumerClosedEvent) => void;
	media_control_update: (data: MediaControlUpdateEvent) => void;
	host_control_update: (data: HostControlUpdateEvent) => void;
	screen_share_started: (data: ScreenShareStartedEvent) => void;
	screen_share_stopped: (data: ScreenShareStoppedEvent) => void;
	'chat:message': (data: ChatMessage) => void;
	'chat:restriction_updated': (data: { enabled: boolean }) => void;
	'reaction:message': (data: ReactionMessage) => void;
	active_speaker: (data: ActiveSpeakerEvent) => void;
	sfu_error: (data: SFUErrorEvent) => void;
	'auth:expired': (data: AuthExpiredEvent) => void;
	hand_raised: (data: HandRaisedEvent) => void;
	existing_raised_hands: (data: ExistingRaisedHandsEvent) => void;
	network_quality_update: (data: NetworkQualityUpdateEvent) => void;
}

export interface ClientToServerEvents {
	'auth:update_token': (
		data: UpdateTokenRequest,
		callback: (response: SFUResponse) => void,
	) => void;
	join_room: (
		data: JoinRoomRequest,
		callback: (response: SFUResponse) => void,
	) => void;
	get_router_rtp_capabilities: (
		data: Record<string, never>,
		callback: (response: RouterRtpCapabilitiesResponse) => void,
	) => void;
	create_webrtc_transport: (
		data: CreateWebRtcTransportRequest,
		callback: (response: WebRTCTransportResponse) => void,
	) => void;
	connect_webrtc_transport: (
		data: { transportId: string; dtlsParameters: DtlsParameters },
		callback: (response: SFUResponse) => void,
	) => void;
	restart_webrtc_transport_ice: (
		data: { transportId: string },
		callback: (response: TransportIceRestartResponse) => void,
	) => void;
	create_producer: (
		data: {
			transportId: string;
			rtpParameters: RtpParameters;
			kind: 'audio' | 'video';
			appData?: Record<string, unknown>;
		},
		callback: (response: ProducerResponse) => void,
	) => void;
	create_consumer: (
		data: {
			transportId: string;
			producerId: string;
			rtpCapabilities: RtpCapabilities;
		},
		callback: (response: ConsumerResponse) => void,
	) => void;
	close_producer: (
		data: { producerId: string },
		callback: (response: CloseProducerResponse) => void,
	) => void;
	pause_producer: (
		data: { producerId: string },
		callback: (response: SFUResponse & { paused?: boolean }) => void,
	) => void;
	resume_producer: (
		data: { producerId: string },
		callback: (response: SFUResponse & { resumed?: boolean }) => void,
	) => void;
	close_consumer: (
		data: { consumerId: string },
		callback: (response: SFUResponse) => void,
	) => void;
	get_existing_producers: (
		data: Record<string, never>,
		callback: (response: ExistingProducersResponse) => void,
	) => void;
	get_room_participants: (
		data: Record<string, never>,
		callback: (response: RoomParticipantsResponse) => void,
	) => void;
	media_control: (data: MediaControlRequest) => void;
	host_control: (data: HostControlRequest) => void;
	screen_share: (data: ScreenShareRequest) => void;
	'chat:send': (data: ChatSendRequest) => void;
	'chat:toggle_restriction': (data: { enabled: boolean }) => void;
	'reaction:send': (data: ReactionSendRequest) => void;
	'consumer:update_preferences': (
		data: ConsumerUpdatePreferencesRequest,
		callback: (response: ConsumerPreferenceResponse) => void,
	) => void;
	raise_hand: (
		data: RaiseHandRequest,
		callback: (response: SFUResponse) => void,
	) => void;
	leave_room: (data?: LeaveRoomRequest) => void;
}

export interface SocketData {
	userId: string;
	userName: string;
	meetingId: string;
	site?: string;
	isHost: boolean;
	isGuest?: boolean;
	roomId?: string;
	participantId?: string;
	scope?: SFUScope;
}

export interface SFUResponse {
	success: boolean;
	error?: string;
}

export interface RouterRtpCapabilitiesResponse extends SFUResponse {
	rtpCapabilities: RtpCapabilities;
}

export interface WebRTCTransportResponse extends SFUResponse {
	id: string;
	iceParameters: IceParameters;
	iceCandidates: IceCandidate[];
	dtlsParameters: DtlsParameters;
}

export interface TransportIceRestartResponse extends SFUResponse {
	iceParameters: IceParameters;
}

export interface ProducerResponse extends SFUResponse, ProducerInfo {
	isScreen: boolean;
}

export interface ConsumerResponse extends SFUResponse, ConsumerInfo {}

export interface CloseProducerResponse
	extends SFUResponse,
		CloseProducerResult {}

export interface ConsumerPreferenceResponse extends SFUResponse {
	appliedLayers?: {
		spatialLayer: number | null;
		temporalLayer: number | null;
	};
	paused?: boolean;
	visible?: boolean;
}

export interface ExistingProducersResponse extends SFUResponse {
	producers: ExistingProducer[];
}

export interface RoomParticipantsResponse extends SFUResponse {
	participants: ParticipantInfo[] | PreviewParticipantInfo[];
}

export interface ProducerInfo {
	id: string;
	kind: 'audio' | 'video';
	appData: Record<string, unknown>;
}
export interface ConsumerInfo {
	id: string;
	producerId: string;
	kind: 'audio' | 'video';
	rtpParameters: RtpParameters;
	paused: boolean;
}

export interface CloseProducerResult {
	isScreen: boolean;
	removedConsumers: Array<{
		consumerId: string;
		peerId: string;
		roomId: string;
	}>;
}

export interface ExistingProducer {
	id: string;
	roomId: string;
	user_id: string;
	kind: 'audio' | 'video';
	paused: boolean;
	isScreen: boolean;
}

// Mediasoup Manager types
export interface Room {
	id: string;
	router: Router;
	audioLevelObserver: AudioLevelObserver;
	peers: Map<string, Peer>;
	created: Date;
}

export interface Peer {
	id: string;
	info: PeerInfo;
	transports: Map<string, WebRtcTransport>;
	producers: Map<string, Producer>;
	consumers: Map<string, Consumer>;
	joined: Date;
}

export interface PeerInfo extends UserData {}

export interface TransportData {
	roomId: string;
	peerId: string;
	transport: WebRtcTransport;
}

export interface ProducerData {
	roomId: string;
	peerId: string;
	producer: Producer;
}

export interface ConsumerData {
	roomId: string;
	peerId: string;
	consumer: Consumer;
}

export interface RoomStats {
	id: string;
	created: Date;
	peerCount: number;
	peers: string[];
	producerCount?: number;
	consumerCount?: number;
}

// Configuration types
export interface MediasoupConfig {
	numWorkers: number;
	worker: WorkerSettings;
	router: RouterConfig;
	webRtcTransport: WebRTCTransportOptions;
}

export interface RouterConfig {
	mediaCodecs: RouterRtpCodecCapability[];
}

export interface WebRTCTransportOptions {
	listenIps: Array<{ ip: string; announcedIp: string }>;
	enableUdp: boolean;
	enableTcp: boolean;
	preferUdp: boolean;
	portRange: { min: number; max: number };
	maxIncomingBitrate: number;
	maxOutgoingBitrate: number;
	initialAvailableOutgoingBitrate: number;
	iceServers: Array<{ urls: string[] }>;
	iceTransportPolicy: string;
}

// JWT types
export interface JWTPayload {
	user_id: string;
	user_name: string;
	meeting_id: string;
	user_avatar?: string;
	is_host: boolean;
	is_cohost?: boolean;
	scope?: SFUScope;
	session_id?: string;
	exp?: number;
	iat?: number;
	site?: string;
}

// Server types
export interface ServerConfig {
	port: number;
	host: string;
	jwtSecret: string;
}

export interface HealthStats {
	status: 'healthy';
	uptime: number;
	rooms: number;
	peers: number;
}

// Socket.IO module augmentation
declare module 'socket.io' {
	interface Socket {
		userId: string;
		userName: string;
		meetingId: string;
		site?: string;
		isHost: boolean;
		isCohost: boolean;
		roomId?: string;
		participantId?: string;
		currentToken?: string;
		tokenExpiresAt?: number;
		scope?: SFUScope;
	}
}
