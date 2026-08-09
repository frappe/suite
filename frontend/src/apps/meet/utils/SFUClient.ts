// Copyright (c) 2025, Frappe and contributors
// For license information, please see license.txt

import { frappeRequest } from "frappe-ui";
import type {
	AppData,
	DtlsParameters,
	IceCandidate,
	IceParameters,
	MediaKind,
	RtpCapabilities,
	RtpParameters,
} from "mediasoup-client/types";
import {
	isUnknownRecord,
	type JoinPayload,
	type JoinRoomMediaState,
	type JoinUserData,
	normalizeJoinPayload,
} from "../types";
import {
	normalizeParticipantData,
	type ParticipantData,
} from "./media/ParticipantManager";
import { normalizeCodecStrategy } from "./media/codecStrategy";
import type { E2eeEpochEnvelope } from "./media/E2EEEpochSignaling";
import { getE2EETransformCapability } from "./media/e2ee";
import type { SignalChannel } from "./media/SignalChannel";
import type { ClientTelemetryEvent } from "./telemetry/ClientTelemetry";

export interface ConnectionDetails {
	authToken: string | null;
	meetingId: string | null;
	userId: string | null;
	sfuUrl: string | null;
	sfuPort: string | null;
	tokenExpiresAt: number | null;
	codecStrategy: string;
	e2eeRequired: boolean;
	isHost: boolean;
	isCohost: boolean;
	userData?: JoinUserData;
}

/**
 * Map a join/API payload that already includes SFU fields into ConnectionDetails.
 * Prefer this over a second Frappe round-trip when join_meeting already returned
 * auth_token + sfu_url. Lobby-only payloads (lobby_token / waiting) return null.
 */
export function connectionDetailsFromJoinPayload(
	payload: JoinPayload,
	options: {
		guestAuthToken?: string | null;
		guestId?: string | null;
		guestName?: string | null;
		expectedMeetingId?: string | null;
	} = {},
): ConnectionDetails | null {
	if (payload.lobby_token && !payload.auth_token && !options.guestAuthToken) {
		return null;
	}
	if (payload.status === "waiting_for_approval") {
		return null;
	}

	const authToken =
		(typeof payload.auth_token === "string" && payload.auth_token) ||
		(typeof options.guestAuthToken === "string" && options.guestAuthToken) ||
		null;
	const sfuUrl =
		typeof payload.sfu_url === "string" && payload.sfu_url
			? payload.sfu_url
			: null;
	if (!authToken || !sfuUrl) {
		return null;
	}

	const meetingId =
		typeof payload.meeting_id === "string" ? payload.meeting_id : null;
	if (
		options.expectedMeetingId &&
		meetingId &&
		meetingId !== options.expectedMeetingId
	) {
		return null;
	}

	const expiresInSeconds =
		typeof payload.expires_in === "number" && payload.expires_in > 0
			? payload.expires_in
			: 3600;

	const isGuest = Boolean(
		options.guestId ||
			options.guestAuthToken ||
			payload.guest_id ||
			payload.user_data?.is_guest,
	);

	if (options.guestId) {
		const payloadGuestId =
			typeof payload.guest_id === "string" ? payload.guest_id : null;
		if (payloadGuestId && payloadGuestId !== options.guestId) {
			return null;
		}
	}

	const userId = options.guestId
		? options.guestId
		: (typeof payload.user_id === "string" && payload.user_id) || null;

	return {
		authToken,
		meetingId: meetingId || options.expectedMeetingId || null,
		userId,
		sfuUrl,
		sfuPort:
			payload.sfu_port != null && payload.sfu_port !== ""
				? String(payload.sfu_port)
				: null,
		userData:
			payload.user_data ||
			(isGuest
				? {
						name: options.guestName || payload.guest_name || "Guest",
						is_guest: true,
					}
				: undefined),
		tokenExpiresAt: Date.now() + expiresInSeconds * 1000,
		codecStrategy: normalizeCodecStrategy(payload.codec_strategy || "svc"),
		e2eeRequired: Boolean(payload.e2ee_required),
		isHost: Boolean(payload.is_host),
		isCohost: Boolean(payload.is_cohost),
	};
}

interface ConnectionStatus {
	connected: boolean;
	meetingId: string | null;
	userId: string | null;
	socketId: string | null;
}

interface SFUResponse {
	success: boolean;
	error?: string;
}

export interface SFUWebRtcTransportResponse {
	id: string;
	iceParameters: IceParameters;
	iceCandidates: IceCandidate[];
	dtlsParameters: DtlsParameters;
}

export interface SFUProducerResponse {
	id: string;
}

export interface SFUConsumerResponse {
	id: string;
	producerId: string;
	kind: MediaKind;
	rtpParameters: RtpParameters;
	isScreen?: boolean;
	appData?: AppData;
	senderId?: number;
}

export interface SFUExistingProducer {
	id: string;
	participantId: string;
	kind?: MediaKind;
	isScreen: boolean;
}

export interface ProducerCloseMetadata {
	reason?: "user-click" | "track-ended" | "publish-failed" | "cleanup";
	source?: "screen-share";
	producerId?: string;
	details?: {
		trackId?: string;
		trackReadyState?: MediaStreamTrackState;
		trackSettings?: MediaTrackSettings;
		message?: string;
	};
}

export interface ScreenShareSignalData extends ProducerCloseMetadata {
	startedAt?: number;
	stoppedAt?: number;
}

type SFUEventHandler = (...args: unknown[]) => void;

export type SFURequestErrorCode = "DISCONNECTED" | "TIMEOUT";

export class SFURequestError extends Error {
	readonly code: SFURequestErrorCode;

	constructor(code: SFURequestErrorCode, message: string) {
		super(message);
		this.name = "SFURequestError";
		this.code = code;
	}
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function requireJoinPayload(value: unknown, context: string): JoinPayload {
	const payload = normalizeJoinPayload(value);
	if (!payload) throw new Error(`Invalid ${context} response`);
	return payload;
}

function requireString(value: unknown, field: string, context: string): string {
	if (typeof value !== "string" || !value) {
		throw new Error(`Invalid ${context} response: missing ${field}`);
	}
	return value;
}

function requireObject(value: unknown, context: string): Record<string, unknown> {
	if (!isUnknownRecord(value)) throw new Error(`Invalid ${context} response`);
	return value;
}

function normalizeExistingProducer(value: unknown): SFUExistingProducer | null {
	if (!isUnknownRecord(value) || typeof value.id !== "string") return null;
	const participantId = [value.participantId, value.user_id, value.userId].find(
		(candidate): candidate is string => typeof candidate === "string" && !!candidate,
	);
	if (!participantId) return null;
	return {
		id: value.id,
		participantId,
		kind: value.kind === "audio" || value.kind === "video" ? value.kind : undefined,
		isScreen: value.isScreen === true,
	};
}

function normalizeRtpCapabilities(value: unknown): RtpCapabilities {
	const payload = requireObject(value, "router RTP capabilities");
	const codecs = payload.codecs;
	if (!Array.isArray(codecs)) {
		throw new Error("Invalid router RTP capabilities response: missing codecs");
	}
	for (const codec of codecs) {
		if (
			!isUnknownRecord(codec) ||
			typeof codec.mimeType !== "string" ||
			typeof codec.clockRate !== "number"
		) {
			throw new Error("Invalid router RTP capabilities response: malformed codec");
		}
	}
	return payload as RtpCapabilities;
}

function normalizeTransportResponse(value: unknown): SFUWebRtcTransportResponse {
	const payload = requireObject(value, "WebRTC transport");
	if (
		typeof payload.id !== "string" ||
		!isUnknownRecord(payload.iceParameters) ||
		!Array.isArray(payload.iceCandidates) ||
		!isUnknownRecord(payload.dtlsParameters)
	) {
		throw new Error("Invalid WebRTC transport response");
	}
	return {
		id: payload.id,
		iceParameters: payload.iceParameters as IceParameters,
		iceCandidates: payload.iceCandidates as IceCandidate[],
		dtlsParameters: payload.dtlsParameters as DtlsParameters,
	};
}

function normalizeConsumerResponse(value: unknown): SFUConsumerResponse {
	const payload = requireObject(value, "consumer");
	if (
		typeof payload.id !== "string" ||
		typeof payload.producerId !== "string" ||
		(payload.kind !== "audio" && payload.kind !== "video") ||
		!isUnknownRecord(payload.rtpParameters)
	) {
		throw new Error("Invalid consumer response");
	}
	return {
		id: payload.id,
		producerId: payload.producerId,
		kind: payload.kind,
		rtpParameters: payload.rtpParameters as RtpParameters,
		isScreen: payload.isScreen === true,
		appData: isUnknownRecord(payload.appData) ? payload.appData : undefined,
		senderId: typeof payload.senderId === "number" ? payload.senderId : undefined,
	};
}

export class SFUClient {
	signalChannel: SignalChannel;
	connected: boolean;
	connectionDetails: ConnectionDetails;
	eventHandlers: Map<string, SFUEventHandler>;
	private eventListeners: Map<string, Set<SFUEventHandler>>;
	isRefreshingToken: boolean;
	tokenRefreshTimer: ReturnType<typeof setTimeout> | null;
	ownSenderId: number | null;
	private pendingRequestRejectors: Set<(error: SFURequestError) => void>;

	constructor(signalChannel: SignalChannel) {
		this.signalChannel = signalChannel;
		this.connected = false;
		this.connectionDetails = {
			authToken: null,
			meetingId: null,
			userId: null,
			sfuUrl: null,
			sfuPort: null,
			tokenExpiresAt: null,
			codecStrategy: "svc",
			e2eeRequired: false,
			isHost: false,
			isCohost: false,
		};
		this.eventHandlers = new Map();
		this.eventListeners = new Map();
		this.isRefreshingToken = false;
		this.tokenRefreshTimer = null;
		this.ownSenderId = null;
		this.pendingRequestRejectors = new Set();
		this.setupDefaultHandlers();
	}

	getOwnSenderId(): number | null {
		return this.ownSenderId;
	}

	setOwnSenderId(senderId: number | null): void {
		this.ownSenderId = senderId;
	}

	// ==================== CONNECTION MANAGEMENT ====================

	async connect(
		meetingId: string,
		guestAuthToken: string | null = null,
		prefetchedDetails: ConnectionDetails | null = null,
	): Promise<boolean> {
		if (this.connected) {
			const connectionDetails = await this.getConnectionDetails(
				meetingId,
				guestAuthToken,
				prefetchedDetails,
			);
			this.connectionDetails = connectionDetails;
			this.signalChannel.updateAuth(connectionDetails.authToken ?? "");
			this.scheduleTokenRefresh();
			return true;
		}

		try {
			const connectionDetails = await this.getConnectionDetails(
				meetingId,
				guestAuthToken,
				prefetchedDetails,
			);
			this.connectionDetails = connectionDetails;
			this.scheduleTokenRefresh();

			const { origin, socketPath } = this.getSFUEndpoint();
			await this.signalChannel.connect({
				origin,
				path: socketPath,
				auth: { token: connectionDetails.authToken ?? "" },
			});

			this.connected = true;
			this.registerEventHandlers();

			return true;
		} catch (error) {
			console.error("SFU connection failed:", error);
			throw error;
		}
	}

	async getConnectionDetails(
		meetingId: string,
		guestAuthToken: string | null = null,
		prefetchedDetails: ConnectionDetails | null = null,
	): Promise<ConnectionDetails> {
		if (
			prefetchedDetails?.authToken &&
			prefetchedDetails?.sfuUrl &&
			(!prefetchedDetails.meetingId ||
				prefetchedDetails.meetingId === meetingId)
		) {
			return {
				...prefetchedDetails,
				meetingId,
			};
		}

		if (guestAuthToken) {
			const guestId = sessionStorage.getItem("guest_id");
			const guestName = sessionStorage.getItem("guest_name");
			const guestMeetingId = sessionStorage.getItem("guest_meeting_id");

			if (!guestId || guestMeetingId !== meetingId) {
				throw new Error("Guest session incomplete or invalid for this meeting");
			}

			try {
				const response = requireJoinPayload(await frappeRequest({
					url: "suite.meet.api.meeting.get_guest_sfu_connection_details",
					params: {
						meeting_id: meetingId,
						guest_token: guestAuthToken,
					},
				}), "guest SFU connection details");
				const sfuUrl = requireString(
					response.sfu_url,
					"sfu_url",
					"guest SFU connection details",
				);

				return {
					authToken: guestAuthToken,
					meetingId: meetingId,
					userId: guestId,
					sfuUrl,
					sfuPort: response.sfu_port == null ? null : String(response.sfu_port),
					userData: {
						name: guestName ?? undefined,
						is_guest: true,
					},
					tokenExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
					codecStrategy: response.codec_strategy || "svc",
					e2eeRequired: Boolean(response.e2ee_required),
					isHost: Boolean(response.is_host),
					isCohost: Boolean(response.is_cohost),
				};
			} catch (error) {
				console.error("Failed to get guest SFU connection details:", error);
				throw error;
			}
		}

		const response = requireJoinPayload(await frappeRequest({
			url: "suite.meet.api.meeting.get_sfu_connection_details",
			params: { meeting_id: meetingId },
		}), "SFU connection details");
		const authToken = requireString(
			response.auth_token,
			"auth_token",
			"SFU connection details",
		);
		const responseMeetingId = requireString(
			response.meeting_id,
			"meeting_id",
			"SFU connection details",
		);
		const userId = requireString(
			response.user_id,
			"user_id",
			"SFU connection details",
		);
		const sfuUrl = requireString(
			response.sfu_url,
			"sfu_url",
			"SFU connection details",
		);

		const expiresInSeconds =
			typeof response.expires_in === "number" ? response.expires_in : 3600;
		const tokenExpiresAt = Date.now() + expiresInSeconds * 1000;

		return {
			authToken,
			meetingId: responseMeetingId,
			userId,
			sfuUrl,
			sfuPort: response.sfu_port == null ? null : String(response.sfu_port),
			userData: response.user_data,
			tokenExpiresAt,
			codecStrategy: normalizeCodecStrategy(response.codec_strategy || "svc"),
			e2eeRequired: Boolean(response.e2ee_required),
			isHost: Boolean(response.is_host),
			isCohost: Boolean(response.is_cohost),
		};
	}

	getSFUEndpoint(): { origin: string; socketPath: string } {
		const { sfuUrl, sfuPort } = this.connectionDetails;

		if (!sfuUrl) {
			throw new Error("SFU URL not configured");
		}

		const urlObj = new URL(sfuUrl);
		const isSecured = urlObj.protocol === "https:";

		const origin = isSecured
			? urlObj.origin
			: `${urlObj.protocol}//${urlObj.hostname}:${sfuPort}`;

		// If the URL has a pathname (e.g. /sfu), use it as the socket.io path prefix.
		// Otherwise fall back to the default /socket.io/.
		const basePath = urlObj.pathname.replace(/\/$/, ""); // strip trailing slash
		const socketPath = basePath ? `${basePath}/socket.io` : "/socket.io";

		return { origin, socketPath };
	}

	disconnect(): void {
		this.rejectPendingRequests(
			new SFURequestError("DISCONNECTED", "Disconnected from SFU"),
		);
		this.signalChannel.disconnect();
		this.clearTokenRefreshTimer();
		this.connected = false;
		this.connectionDetails = {
			authToken: null,
			meetingId: null,
			userId: null,
			sfuUrl: null,
			sfuPort: null,
			tokenExpiresAt: null,
			codecStrategy: "svc",
			e2eeRequired: false,
			isHost: false,
			isCohost: false,
		};
		this.isRefreshingToken = false;
	}

	// ==================== TOKEN MANAGEMENT ====================

	clearTokenRefreshTimer(): void {
		if (this.tokenRefreshTimer) {
			clearTimeout(this.tokenRefreshTimer);
			this.tokenRefreshTimer = null;
		}
	}

	scheduleTokenRefresh(bufferMs = 5 * 60 * 1000): void {
		// 5 minutes before expiry
		this.clearTokenRefreshTimer();

		const { tokenExpiresAt, meetingId } = this.connectionDetails;

		if (!tokenExpiresAt || !meetingId) {
			return;
		}

		const delay = tokenExpiresAt - Date.now() - bufferMs;

		if (delay <= 0) {
			this.refreshToken().catch((error: unknown) => {
				console.error("Immediate token refresh failed:", error);
			});
			return;
		}

		this.tokenRefreshTimer = setTimeout(async () => {
			try {
				await this.refreshToken();
			} catch (error: unknown) {
				console.error("Scheduled token refresh failed:", error);
			}
		}, delay);
	}

	async refreshToken(
		options: { skipServerUpdate?: boolean } = {},
	): Promise<string> {
		const { skipServerUpdate = false } = options;
		if (this.isRefreshingToken) {
			return "";
		}

		try {
			this.isRefreshingToken = true;

		const response = requireJoinPayload(await frappeRequest({
				url: "suite.meet.api.meeting.refresh_sfu_token",
				params: { meeting_id: this.connectionDetails.meetingId },
			}), "SFU token refresh");
			const authToken = requireString(
				response.auth_token,
				"auth_token",
				"SFU token refresh",
			);

			const expiresInSeconds =
				typeof response.expires_in === "number" ? response.expires_in : 3600;

			this.connectionDetails.authToken = authToken;
			this.connectionDetails.tokenExpiresAt =
				Date.now() + expiresInSeconds * 1000;
			this.connectionDetails.codecStrategy = normalizeCodecStrategy(
				response.codec_strategy || this.connectionDetails.codecStrategy,
			);
			this.connectionDetails.e2eeRequired =
				this.connectionDetails.e2eeRequired || Boolean(response.e2ee_required);

			this.signalChannel.updateAuth(authToken);

			if (!skipServerUpdate && this.connected) {
				await this.sendRequest("auth:update_token", {
					token: authToken,
				});
			} else if (!this.connected) {
				console.log(
					"Skipping server token sync because socket is disconnected",
				);
			}

			this.scheduleTokenRefresh();

			return authToken;
		} catch (error) {
			console.warn("Token refresh failed:", error);
			throw error;
		} finally {
			this.isRefreshingToken = false;
		}
	}

	isTokenExpiringSoon(): boolean {
		const { tokenExpiresAt, authToken } = this.connectionDetails;

		if (tokenExpiresAt) {
			return tokenExpiresAt - Date.now() < 5 * 60 * 1000; // 5 minutes
		}

		if (!authToken) {
			return false;
		}

		try {
			const payload = JSON.parse(atob(authToken.split(".")[1])) as {
				exp: number;
			};
			const expiryTime = payload.exp * 1000;
			const timeUntilExpiry = expiryTime - Date.now();

			return timeUntilExpiry < 5 * 60 * 1000;
		} catch (error: unknown) {
			console.warn("Could not check token expiry:", error);
			return false;
		}
	}

	// ==================== EVENT HANDLING ====================

	setupDefaultHandlers(): void {
		const defaultHandlers: Record<string, SFUEventHandler> = {
			connect: () => {
				this.connected = true;
			},
			disconnect: () => {
				this.connected = false;
			},
			connect_error: (error: unknown) => {
				console.error("SFU connection error:", error);
				this.connected = false;
			},
			reconnect: (attemptNumber: unknown) => {
				console.log(`SFU reconnected after ${attemptNumber} attempts`);
				this.connected = true;
			},
			reconnect_error: (error: unknown) => {
				console.error("SFU reconnection failed:", error);
			},
			reconnect_attempt: async () => {
				if (this.isTokenExpiringSoon()) {
					try {
						const newToken = await this.refreshToken({
							skipServerUpdate: true,
						});
						if (newToken) {
							this.signalChannel.updateAuth(newToken);
						}
						console.log("Updated socket auth token for reconnection");
					} catch (error: unknown) {
						console.error(
							"Failed to refresh token during reconnection:",
							error,
						);
					}
				}
			},
			participant_joined: () => {},
			participant_left: () => {},
			producer_created: () => {},
			producer_closed: () => {},
			consumer_created: () => {},
			consumer_closed: () => {},
			media_control_update: () => {},
			host_control_update: () => {},
			screen_share_started: () => {},
			screen_share_stopped: () => {},
			webrtc_offer: () => {},
			webrtc_answer: () => {},
			ice_candidate: () => {},
			"chat:message": () => {},
			active_speaker: () => {},
			hand_raised: () => {},
			existing_raised_hands: () => {},
		};

		for (const [event, handler] of Object.entries(defaultHandlers)) {
			this.addEventListener(event, handler);
		}
	}

	registerEventHandlers(): void {
		for (const [event, handler] of this.eventHandlers.entries()) {
			this.signalChannel.on(event, handler);
		}
	}

	on(event: string, handler: SFUEventHandler): void {
		const hadDispatcher = this.eventHandlers.has(event);
		this.addEventListener(event, handler);
		if (this.connected && !hadDispatcher) {
			this.signalChannel.on(event, this.eventHandlers.get(event) as SFUEventHandler);
		}
	}

	off(event: string, handler?: SFUEventHandler): void {
		if (handler) {
			const listeners = this.eventListeners.get(event);
			listeners?.delete(handler);
			if (listeners?.size) return;
		}

		const dispatcher = this.eventHandlers.get(event);
		if (dispatcher) {
			this.signalChannel.off(event, dispatcher);
		}
		this.eventHandlers.delete(event);
		this.eventListeners.delete(event);
	}

	private addEventListener(event: string, handler: SFUEventHandler): void {
		let listeners = this.eventListeners.get(event);
		if (!listeners) {
			listeners = new Set();
			this.eventListeners.set(event, listeners);
		}
		listeners.add(handler);

		if (this.eventHandlers.has(event)) return;
		this.eventHandlers.set(event, (...args: unknown[]) => {
			for (const listener of this.eventListeners.get(event) || []) {
				listener(...args);
			}
		});
	}

	// ==================== WEBRTC OPERATIONS ====================

	async getRouterRtpCapabilities(): Promise<RtpCapabilities> {
		const response = requireObject(await this.sendRequest(
			"get_router_rtp_capabilities",
			{},
		), "router RTP capabilities");
		return normalizeRtpCapabilities(response.rtpCapabilities ?? response);
	}

	async createWebRtcTransport(
		direction: "send" | "recv",
	): Promise<SFUWebRtcTransportResponse> {
		return normalizeTransportResponse(await this.sendRequest("create_webrtc_transport", {
			direction,
			encryptionEnabled: this.connectionDetails.e2eeRequired,
		}));
	}

	async connectWebRtcTransport(
		transportId: string,
		dtlsParameters: DtlsParameters,
	): Promise<void> {
		console.log(`Connecting transport ${transportId} to SFU...`);
		console.log("DTLS Parameters:", dtlsParameters);

		await this.sendRequest("connect_webrtc_transport", {
			transportId,
			dtlsParameters,
		});

		console.log(`Transport ${transportId} connected successfully`);
	}

	async restartWebRtcTransportIce(transportId: string): Promise<IceParameters> {
		const response = requireObject(await this.sendRequest("restart_webrtc_transport_ice", {
			transportId,
		}), "ICE restart");
		if (!isUnknownRecord(response.iceParameters)) {
			throw new Error("Invalid ICE restart response");
		}
		return response.iceParameters as IceParameters;
	}

	async createProducer(
		transportId: string,
		rtpParameters: RtpParameters,
		kind: MediaKind,
		appData: AppData = {},
	): Promise<SFUProducerResponse> {
		const response = requireObject(await this.sendRequest("create_producer", {
			transportId,
			rtpParameters,
			kind,
			appData,
		}), "producer");
		return { id: requireString(response.id, "id", "producer") };
	}

	async createConsumer(
		transportId: string,
		producerId: string,
		rtpCapabilities: RtpCapabilities,
	): Promise<SFUConsumerResponse> {
		console.log(`Creating consumer for producer ${producerId} @ ${Date.now()}`);
		return normalizeConsumerResponse(await this.sendRequest("create_consumer", {
			transportId,
			producerId,
			rtpCapabilities,
		}));
	}

	async closeProducer(
		producerId: string,
		metadata: ProducerCloseMetadata = {},
	): Promise<unknown> {
		return this.sendRequest("close_producer", { producerId, ...metadata });
	}

	async pauseProducer(producerId: string): Promise<unknown> {
		return this.sendRequest("pause_producer", { producerId });
	}

	async resumeProducer(producerId: string): Promise<unknown> {
		return this.sendRequest("resume_producer", { producerId });
	}

	async closeConsumer(consumerId: string): Promise<unknown> {
		return this.sendRequest("close_consumer", { consumerId });
	}

	async requestConsumerKeyFrame(consumerId: string): Promise<unknown> {
		return this.sendRequest("request_consumer_keyframe", { consumerId });
	}

	async updateConsumerPreferences({
		consumerId,
		visible,
		width,
		height,
	}: {
		consumerId: string;
		visible: boolean;
		width: number;
		height: number;
	}): Promise<unknown> {
		return this.sendRequest("consumer:update_preferences", {
			consumerId,
			visible: Boolean(visible),
			width: Math.round(width),
			height: Math.round(height),
		});
	}

	// ==================== ROOM OPERATIONS ====================

	async getExistingProducers(
		roomId: string | null = null,
	): Promise<SFUExistingProducer[]> {
		const requestData = roomId ? { roomId } : {};
		const response = requireObject(await this.sendRequest(
			"get_existing_producers",
			requestData,
		), "existing producers");
		if (!Array.isArray(response.producers)) return [];
		return response.producers
			.map(normalizeExistingProducer)
			.filter((producer): producer is SFUExistingProducer => producer !== null);
	}

	async getRoomParticipants(): Promise<ParticipantData[]> {
		const response = requireObject(await this.sendRequest(
			"get_room_participants",
			{},
		), "room participants");
		if (!Array.isArray(response.participants)) return [];
		return response.participants
			.map(normalizeParticipantData)
			.filter((participant): participant is ParticipantData => participant !== null);
	}

	// ==================== ROOM MANAGEMENT ====================

	async joinRoom(
		roomId: string,
		userData: JoinUserData,
		mediaState: JoinRoomMediaState,
	): Promise<{ success: boolean; senderId?: number }> {
		const e2eeMode = this.getE2EEMode();
		const e2eeShouldBeActive = this.isE2EERequired();
		const result = (await this.sendRequest("join_room", {
			roomId,
			userData,
			mediaState,
			e2ee: {
				enabled: e2eeShouldBeActive,
				capability: {
					supported: e2eeMode !== "none",
					mode: e2eeMode,
				},
			},
		}));
		const response = requireObject(result, "join room");
		if (response.success !== true) throw new Error("Invalid join room response");
		const normalized = {
			success: true,
			senderId: typeof response.senderId === "number" ? response.senderId : undefined,
		};
		if (normalized.senderId !== undefined) {
			this.setOwnSenderId(normalized.senderId);
		}
		return normalized;
	}

	setE2EERequired(required: boolean): void {
		this.connectionDetails.e2eeRequired = required;
	}

	isE2EERequired(): boolean {
		return this.connectionDetails.e2eeRequired;
	}

	getE2EEMode(): "insertable-streams" | "rtp-script-transform" | "none" {
		const capability = getE2EETransformCapability();
		if (capability === "legacy-insertable-streams") return "insertable-streams";
		return capability;
	}

	isInsertableStreamsSupported(): boolean {
		return getE2EETransformCapability() !== "none";
	}

	// ==================== SIGNALING OPERATIONS ====================
	sendClientTelemetry(event: ClientTelemetryEvent): void {
		this.sendEvent("client_telemetry", event);
	}

	sendWebRtcOffer(targetUser: unknown, signalData: unknown): void {
		this.sendEvent("webrtc_offer", { targetUser, signalData });
	}

	sendWebRtcAnswer(targetUser: unknown, signalData: unknown): void {
		this.sendEvent("webrtc_answer", { targetUser, signalData });
	}

	sendIceCandidate(targetUser: unknown, signalData: unknown): void {
		this.sendEvent("ice_candidate", { targetUser, signalData });
	}

	sendE2EEEpochEnvelope(envelope: E2eeEpochEnvelope): void {
		this.sendEvent("e2ee:epoch", envelope);
	}

	// ==================== MEDIA CONTROL ====================

	sendMediaControl(action: unknown): void {
		this.sendEvent("media_control", { action });
	}

	sendScreenShare(
		action: "start_share" | "stop_share",
		shareData: ScreenShareSignalData = {},
	): void {
		this.sendEvent("screen_share", { action, shareData });
	}

	// ==================== CHAT OPERATIONS ====================

	async sendChatMessage(
		message: string,
		options: { clientId?: unknown } = {},
	): Promise<{ success: boolean; timestamp: string }> {
		if (!this.connected) {
			throw new Error("Not connected to SFU");
		}

		const payload: Record<string, string> = { message: String(message || "") };
		if (options.clientId) {
			payload.clientId = String(options.clientId);
		}

		return (await this.sendRequest("chat:send", payload)) as {
			success: boolean;
			timestamp: string;
		};
	}

	// ==================== REACTION OPERATIONS ====================

	sendReaction(reactionType: string): void {
		if (!this.connected) {
			throw new Error("Not connected to SFU");
		}

		this.sendEvent("reaction:send", { reaction: reactionType });
	}

	sendRaiseHand(raised: boolean): Promise<unknown> {
		if (!this.connected) {
			throw new SFURequestError("DISCONNECTED", "Not connected to SFU");
		}
		return this.sendRequest("raise_hand", { raised });
	}

	// ==================== UTILITY METHODS ====================

	async sendRequest(
		event: string,
		data: unknown,
		timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.connected) {
				reject(new SFURequestError("DISCONNECTED", "Not connected to SFU"));
				return;
			}

			let settled = false;
			const finish = (callback: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.pendingRequestRejectors.delete(rejectPending);
				callback();
			};
			const rejectPending = (error: SFURequestError) => {
				finish(() => reject(error));
			};
			const timeout = setTimeout(() => {
				rejectPending(
					new SFURequestError(
						"TIMEOUT",
						`SFU request timed out: ${event}`,
					),
				);
			}, timeoutMs);
			this.pendingRequestRejectors.add(rejectPending);

			try {
				this.signalChannel.emit(event, data, (rawResponse: unknown) => {
					finish(() => {
						if (
							!isUnknownRecord(rawResponse) ||
							typeof rawResponse.success !== "boolean"
						) {
							reject(new Error(`Malformed SFU response: ${event}`));
							return;
						}
						const response: SFUResponse = {
							...rawResponse,
							success: rawResponse.success,
							error:
								typeof rawResponse.error === "string"
									? rawResponse.error
									: undefined,
						};
						if (response.success) {
							resolve(response);
						} else {
							const error = new Error(
								response.error || `Request failed: ${event}`,
							);
							console.error(`SFU request failed (${event}):`, response.error);
							reject(error);
						}
					});
				});
			} catch (error) {
				finish(() => reject(error));
			}
		});
	}

	private rejectPendingRequests(error: SFURequestError): void {
		const pending = Array.from(this.pendingRequestRejectors);
		this.pendingRequestRejectors.clear();
		for (const reject of pending) {
			reject(error);
		}
	}

	sendEvent(event: string, data: unknown): void {
		if (!this.connected) {
			throw new Error("Not connected to SFU");
		}
		this.signalChannel.emit(event, data);
	}

	isConnected(): boolean {
		return this.connected;
	}

	getMeetingId(): string | null {
		return this.connectionDetails.meetingId;
	}

	getUserId(): string | null {
		return this.connectionDetails.userId;
	}

	getCodecStrategy(): string {
		return this.connectionDetails.codecStrategy || "svc";
	}

	getConnectionStatus(): ConnectionStatus {
		return {
			connected: this.connected,
			meetingId: this.connectionDetails.meetingId,
			userId: this.connectionDetails.userId,
			socketId: this.signalChannel.id(),
		};
	}
}
