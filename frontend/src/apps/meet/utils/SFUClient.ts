// Copyright (c) 2025, Frappe and contributors
// For license information, please see license.txt

import { frappeRequest } from "frappe-ui";
import { normalizeCodecStrategy } from "./media/codecStrategy";
import type { E2eeEpochEnvelope } from "./media/E2EEEpochSignaling";
import { getE2EETransformCapability } from "./media/e2ee";
import type { SignalChannel } from "./media/SignalChannel";

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
	userData?: Record<string, unknown>;
}

/**
 * Map a join/API payload that already includes SFU fields into ConnectionDetails.
 * Prefer this over a second Frappe round-trip when join_meeting already returned
 * auth_token + sfu_url. Lobby-only payloads (lobby_token / waiting) return null.
 */
export function connectionDetailsFromJoinPayload(
	payload: Record<string, unknown>,
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
			(payload.user_data as Record<string, unknown> | undefined)?.is_guest,
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
			(payload.user_data as Record<string, unknown> | undefined) ||
			(isGuest
				? {
						name: options.guestName || payload.guest_name || "Guest",
						is_guest: true,
					}
				: undefined),
		tokenExpiresAt: Date.now() + expiresInSeconds * 1000,
		codecStrategy: normalizeCodecStrategy(
			(payload.codec_strategy as string) || "svc",
		),
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
	[key: string]: unknown;
}

interface SFUConnectionDetailsResponse {
	sfu_url: string;
	sfu_port: string;
	auth_token: string;
	user_id: string;
	meeting_id: string;
	user_data: Record<string, unknown>;
	expires_in: number;
	codec_strategy: string;
	e2ee_required?: boolean;
	is_host?: boolean;
	is_cohost?: boolean;
}

interface SFUGuestConnectionDetailsResponse {
	sfu_url: string;
	sfu_port: string;
	codec_strategy: string;
	e2ee_required?: boolean;
	is_host?: boolean;
	is_cohost?: boolean;
}

interface SFUTokenRefreshResponse {
	auth_token: string;
	expires_in: number;
	codec_strategy: string;
	e2ee_required?: boolean;
}

interface SFURouterCapabilitiesResponse {
	rtpCapabilities: unknown;
	[key: string]: unknown;
}

interface SFUWebRtcTransportResponse {
	id: string;
	iceParameters: unknown;
	iceCandidates: unknown;
	dtlsParameters: unknown;
	[key: string]: unknown;
}

interface SFUProducerResponse {
	id: string;
	[key: string]: unknown;
}

interface SFUConsumerResponse {
	id: string;
	producerId: string;
	kind: string;
	rtpParameters: unknown;
	isScreen?: boolean;
	appData?: {
		type?: string;
	};
	senderId?: number;
	[key: string]: unknown;
}

interface SFUParticipantsResponse {
	participants: unknown[];
	[key: string]: unknown;
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

export class SFUClient {
	signalChannel: SignalChannel;
	connected: boolean;
	connectionDetails: ConnectionDetails;
	eventHandlers: Map<string, SFUEventHandler>;
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
				const response = (await frappeRequest({
					url: "suite.meet.api.meeting.get_guest_sfu_connection_details",
					params: {
						meeting_id: meetingId,
						guest_token: guestAuthToken,
					},
				})) as SFUGuestConnectionDetailsResponse;

				return {
					authToken: guestAuthToken,
					meetingId: meetingId,
					userId: guestId,
					sfuUrl: response.sfu_url,
					sfuPort: response.sfu_port,
					userData: {
						name: guestName,
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

		const response = (await frappeRequest({
			url: "suite.meet.api.meeting.get_sfu_connection_details",
			params: { meeting_id: meetingId },
		})) as SFUConnectionDetailsResponse;

		const expiresInSeconds =
			typeof response.expires_in === "number" ? response.expires_in : 3600;
		const tokenExpiresAt = Date.now() + expiresInSeconds * 1000;

		return {
			authToken: response.auth_token,
			meetingId: response.meeting_id,
			userId: response.user_id,
			sfuUrl: response.sfu_url,
			sfuPort: response.sfu_port,
			userData: response.user_data,
			tokenExpiresAt,
			codecStrategy: normalizeCodecStrategy(response.codec_strategy),
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

			const response = (await frappeRequest({
				url: "suite.meet.api.meeting.refresh_sfu_token",
				params: { meeting_id: this.connectionDetails.meetingId },
			})) as SFUTokenRefreshResponse;

			const expiresInSeconds =
				typeof response.expires_in === "number" ? response.expires_in : 3600;

			this.connectionDetails.authToken = response.auth_token;
			this.connectionDetails.tokenExpiresAt =
				Date.now() + expiresInSeconds * 1000;
			this.connectionDetails.codecStrategy = normalizeCodecStrategy(
				response.codec_strategy || this.connectionDetails.codecStrategy,
			);
			this.connectionDetails.e2eeRequired =
				this.connectionDetails.e2eeRequired || Boolean(response.e2ee_required);

			this.signalChannel.updateAuth(response.auth_token);

			if (!skipServerUpdate && this.connected) {
				await this.sendRequest("auth:update_token", {
					token: response.auth_token,
				});
			} else if (!this.connected) {
				console.log(
					"Skipping server token sync because socket is disconnected",
				);
			}

			this.scheduleTokenRefresh();

			return response.auth_token;
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
			this.eventHandlers.set(event, handler);
		}
	}

	registerEventHandlers(): void {
		for (const [event, handler] of this.eventHandlers.entries()) {
			this.signalChannel.on(event, handler);
		}
	}

	on(event: string, handler: SFUEventHandler): void {
		this.eventHandlers.set(event, handler);
		this.signalChannel.on(event, handler);
	}

	off(event: string): void {
		const handler = this.eventHandlers.get(event);
		if (handler) {
			this.signalChannel.off(event, handler);
		}
		this.eventHandlers.delete(event);
	}

	// ==================== WEBRTC OPERATIONS ====================

	async getRouterRtpCapabilities(): Promise<unknown> {
		const resp = (await this.sendRequest(
			"get_router_rtp_capabilities",
			{},
		)) as SFURouterCapabilitiesResponse;
		try {
			const payload = resp?.rtpCapabilities || resp;
			return JSON.parse(JSON.stringify(payload));
		} catch (err: unknown) {
			console.warn("Failed to deep-clone router RTP capabilities:", err);
			return resp?.rtpCapabilities || resp;
		}
	}

	async createWebRtcTransport(direction: string): Promise<{
		id: string;
		iceParameters: unknown;
		iceCandidates: unknown;
		dtlsParameters: unknown;
	}> {
		const response = (await this.sendRequest("create_webrtc_transport", {
			direction,
			encryptionEnabled: this.connectionDetails.e2eeRequired,
		})) as SFUWebRtcTransportResponse;
		try {
			const clean = JSON.parse(JSON.stringify(response));
			const { id, iceParameters, iceCandidates, dtlsParameters } = clean;
			return { id, iceParameters, iceCandidates, dtlsParameters };
		} catch (err: unknown) {
			console.warn(
				"Failed to deep-clone transport response, returning raw response",
				err,
			);
			const { id, iceParameters, iceCandidates, dtlsParameters } = response;
			return { id, iceParameters, iceCandidates, dtlsParameters };
		}
	}

	async connectWebRtcTransport(
		transportId: string,
		dtlsParameters: unknown,
	): Promise<void> {
		console.log(`Connecting transport ${transportId} to SFU...`);
		console.log("DTLS Parameters:", dtlsParameters);

		await this.sendRequest("connect_webrtc_transport", {
			transportId,
			dtlsParameters,
		});

		console.log(`Transport ${transportId} connected successfully`);
	}

	async restartWebRtcTransportIce(transportId: string): Promise<unknown> {
		const response = (await this.sendRequest("restart_webrtc_transport_ice", {
			transportId,
		})) as Record<string, unknown>;
		return response.iceParameters;
	}

	async createProducer(
		transportId: string,
		rtpParameters: unknown,
		kind: string,
		appData: unknown = {},
	): Promise<SFUProducerResponse> {
		return (await this.sendRequest("create_producer", {
			transportId,
			rtpParameters,
			kind,
			appData,
		})) as SFUProducerResponse;
	}

	async createConsumer(
		transportId: string,
		producerId: string,
		rtpCapabilities: unknown,
	): Promise<SFUConsumerResponse> {
		console.log(`Creating consumer for producer ${producerId} @ ${Date.now()}`);
		return (await this.sendRequest("create_consumer", {
			transportId,
			producerId,
			rtpCapabilities,
		})) as SFUConsumerResponse;
	}

	async closeProducer(
		producerId: string,
		metadata: Record<string, unknown> = {},
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

	async getExistingProducers(roomId: string | null = null): Promise<unknown[]> {
		const requestData = roomId ? { roomId } : {};
		const response = (await this.sendRequest(
			"get_existing_producers",
			requestData,
		)) as Record<string, unknown>;
		return (response.producers as unknown[]) || [];
	}

	async getRoomParticipants(): Promise<unknown[]> {
		const response = (await this.sendRequest(
			"get_room_participants",
			{},
		)) as SFUParticipantsResponse;
		return response.participants || [];
	}

	// ==================== ROOM MANAGEMENT ====================

	async joinRoom(
		roomId: string,
		userData: unknown,
		mediaState: unknown,
	): Promise<unknown> {
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
		})) as { success?: boolean; senderId?: number };
		if (result && typeof result.senderId === "number") {
			this.setOwnSenderId(result.senderId);
		}
		return result;
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

	sendScreenShare(action: unknown, shareData: unknown = {}): void {
		this.sendEvent("screen_share", { action, shareData });
	}

	// ==================== CHAT OPERATIONS ====================

	sendChatMessage(message: string, options: { clientId?: unknown } = {}): void {
		if (!this.connected) {
			throw new Error("Not connected to SFU");
		}

		const payload: Record<string, string> = { message: String(message || "") };
		if (options.clientId) {
			payload.clientId = String(options.clientId);
		}

		this.sendEvent("chat:send", payload);
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
				this.signalChannel.emit(event, data, (response: SFUResponse) => {
					finish(() => {
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
