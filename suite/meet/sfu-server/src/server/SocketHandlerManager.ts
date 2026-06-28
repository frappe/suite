import type { Server, Socket } from 'socket.io';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type {
	ChatMessage,
	ClientToServerEvents,
	ParticipantInfo,
	PreviewParticipantInfo,
	ReactionMessage,
	ServerToClientEvents,
	SocketData,
	UserData,
} from '../types';
import { loggers } from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';
import type { AuthManager } from './AuthManager';
import { E2EEEpochRelay } from './E2EEEpochRelay';
import type { E2eeRosterStore } from './E2eeRosterStore';

type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

export class SocketHandlerManager {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private raisedHands: Record<string, Record<string, string>> = {};
	private rateLimiter: RateLimiter;
	private fullAccessSockets: Map<string, Set<string>> = new Map(); // roomId -> Set<socketId>
	private previewSockets: Map<string, Set<string>> = new Map(); // roomId -> Set<socketId>
	private hostOnlyChat: Record<string, boolean> = {};
	private nextSenderIdByRoom: Map<string, number> = new Map(); // roomId -> next senderId
	private participantToSender: Map<string, Map<string, number>> = new Map(); // roomId -> (participantId -> senderId)
	private e2eeEpochRelay: E2EEEpochRelay;
	private e2eeRoster: E2eeRosterStore;
	private idleExpirySweep: NodeJS.Timeout | null = null;

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		mediasoup: MediasoupManager,
		authManager: AuthManager,
		roster: E2eeRosterStore,
	) {
		this.io = io;
		this.mediasoup = mediasoup;
		this.authManager = authManager;
		this.rateLimiter = new RateLimiter();
		this.e2eeEpochRelay = new E2EEEpochRelay(
			io,
			this.fullAccessSockets,
			this.participantToSender,
		);
		this.e2eeRoster = roster;
		this.e2eeEpochRelay.setRoster(this.e2eeRoster);
		this.mediasoup.onNetworkQualityUpdate((roomId, peerId, quality) => {
			this.emitToFullAccessParticipants(roomId, 'network_quality_update', {
				participantId: peerId,
				quality,
			});
		});
	}

	private isRealParticipant(participantId: string): boolean {
		return !participantId.startsWith('preview-');
	}

	private isDevOrCiEnvironment(): boolean {
		const devEnv = process.env.NODE_ENV === 'development';
		const inCi = process.env.CI === 'true' || !!process.env.GITHUB_ACTIONS;
		return devEnv || inCi;
	}

	private checkSocketRateLimits(
		socket: Socket,
		userLimit: number,
		ipLimit: number,
		windowMs: number,
	): boolean {
		if (this.isDevOrCiEnvironment()) {
			return true;
		}
		const forwardedFor = socket.handshake.headers['x-forwarded-for'];
		const forwarded = socket.handshake.headers.forwarded;

		const getFirstIp = (val?: string | string[]) =>
			(Array.isArray(val) ? val[0] : val)?.split(',')[0]?.trim();

		const clientIp =
			getFirstIp(forwardedFor) ||
			getFirstIp(forwarded) ||
			socket.handshake.address;

		const userKey = `user:${socket.userId}`;
		const ipKey = `ip:${clientIp}`;

		const userAllowed = this.rateLimiter.checkRateLimit(
			userKey,
			userLimit,
			windowMs,
		);
		const ipAllowed = this.rateLimiter.checkRateLimit(ipKey, ipLimit, windowMs);

		if (!userAllowed || !ipAllowed) {
			loggers.socketHandler.warn(
				'Rate limit exceeded: user=%s (allowed=%s), ip=%s (allowed=%s)',
				socket.userId,
				userAllowed,
				clientIp,
				ipAllowed,
			);
		}

		return userAllowed && ipAllowed;
	}

	private findSocketByParticipantId(
		roomId: string,
		participantId: string,
	): TypedSocket | null {
		const socketsInRoom = this.io.sockets.adapter.rooms.get(roomId);
		if (!socketsInRoom) return null;

		for (const socketId of socketsInRoom) {
			const socket = this.io.sockets.sockets.get(socketId) as
				| TypedSocket
				| undefined;
			if (socket && socket.participantId === participantId) {
				return socket;
			}
		}

		return null;
	}

	/**
	 * Emit event only to full-access participants in the room (excludes preview users)
	 */
	private emitToFullAccessParticipants(
		roomId: string,
		event: string,
		data: unknown,
	): void {
		const socketIds = this.fullAccessSockets.get(roomId);
		if (!socketIds) return;

		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId);
			if (socket) {
				// biome-ignore lint/suspicious/noExplicitAny: Internal utility method for type-safe event emission
				(socket as any).emit(event, data);
			}
		}
	}

	/**
	 * Emit event only to preview participants in the room
	 */
	private emitToPreviewParticipants(
		roomId: string,
		event: string,
		data: unknown,
	): void {
		const socketIds = this.previewSockets.get(roomId);
		if (!socketIds) return;

		for (const socketId of socketIds) {
			const socket = this.io.sockets.sockets.get(socketId);
			if (socket) {
				// biome-ignore lint/suspicious/noExplicitAny: Internal utility method for type-safe event emission
				(socket as any).emit(event, data);
			}
		}
	}

	/**
	 * Emit participant events to all participants with proper data sanitization
	 */
	private emitParticipantEvent(
		roomId: string,
		event: 'participant_joined' | 'participant_left',
		participantId: string,
		userData?: UserData,
	): void {
		// Send full data to full-access participants
		if (event === 'participant_joined' && userData) {
			this.emitToFullAccessParticipants(roomId, event, {
				roomId,
				participantId,
				userData,
			});
		} else if (event === 'participant_left') {
			this.emitToFullAccessParticipants(roomId, event, {
				roomId,
				participantId,
			});
		}

		// Send sanitized data to preview participants (only for real participants)
		if (!participantId.startsWith('preview-')) {
			if (event === 'participant_joined' && userData) {
				this.emitToPreviewParticipants(roomId, event, {
					roomId,
					participantId,
					userData: {
						name: userData.name,
						avatar: userData.avatar,
					},
				});
			} else if (event === 'participant_left') {
				this.emitToPreviewParticipants(roomId, event, {
					roomId,
					participantId,
				});
			}
		}
	}

	private async cleanupRoom(roomId: string): Promise<void> {
		this.fullAccessSockets.delete(roomId);
		this.previewSockets.delete(roomId);
		delete this.raisedHands[roomId];
		delete this.hostOnlyChat[roomId];
		this.nextSenderIdByRoom.delete(roomId);
		this.participantToSender.delete(roomId);
		this.e2eeEpochRelay.clearRoom(roomId);
		await this.e2eeRoster.clearRoom(roomId);
		this.mediasoup.closeRoom(roomId);
	}

	private assignSenderId(roomId: string, participantId: string): number {
		const map = this.participantToSender.get(roomId) || new Map();
		const existing = map.get(participantId);
		if (existing !== undefined) {
			return existing;
		}
		const next = this.nextSenderIdByRoom.get(roomId) || 1;
		this.nextSenderIdByRoom.set(roomId, next + 1);
		map.set(participantId, next);
		this.participantToSender.set(roomId, map);
		return next;
	}

	setupSocketHandlers(): void {
		this.io.use((socket, next) => {
			if (!this.authManager.authenticateSocket(socket)) {
				return next(new Error('Authentication failed'));
			}
			next();
		});

		this.io.on('connection', (socket) => {
			loggers.socketHandler.info(
				'New authenticated connection: %s (User: %s)',
				socket.id,
				socket.userId,
			);

			socket.use((_packet, next) => {
				if (this.authManager.isTokenExpired(socket)) {
					this.authManager.triggerTokenExpiry(socket, 'middleware_guard');
					return;
				}

				next();
			});

			this.setupAuthHandlers(socket);

			this.setupRoomHandlers(socket);
			this.setupWebRTCHandlers(socket);
			this.setupMediaControlHandlers(socket);
			this.setupHostControlHandlers(socket);
			this.setupScreenShareHandlers(socket);
			this.setupChatHandlers(socket);
			this.setupReactionHandlers(socket);
			this.setupRaiseHandHandlers(socket);
			this.e2eeEpochRelay.setup(socket);
			this.setupDisconnectHandlers(socket);
			this.setupErrorHandlers(socket);
		});
	}

	private setupAuthHandlers(socket: Socket): void {
		socket.on('auth:update_token', (data, callback) => {
			try {
				const token = typeof data?.token === 'string' ? data.token : null;
				if (!token) {
					callback({ success: false, error: 'Missing token' });
					return;
				}

				this.authManager.updateSocketToken(socket, token);
				callback({ success: true });
			} catch (error) {
				const message = (error as Error).message || 'Token update failed';
				loggers.socketHandler.warn(
					'auth:update_token failed for socket %s: %s',
					socket.id,
					message,
				);
				callback({ success: false, error: message });
				this.authManager.triggerTokenExpiry(socket, 'invalid_refresh_token');
			}
		});

		this.idleExpirySweep = setInterval(
			() => this.sweepExpiredSockets(),
			30_000,
		);
	}

	private sweepExpiredSockets(): void {
		for (const [, socket] of this.io.sockets.sockets) {
			if (this.authManager.isTokenExpired(socket as never)) {
				loggers.authManager.debug(
					'Idle sweep: disconnecting expired socket %s (user %s)',
					socket.id,
					(socket as { userId?: string }).userId,
				);
				this.authManager.triggerTokenExpiry(socket as never, 'idle_sweep');
			}
		}
	}

	stop(): void {
		if (this.idleExpirySweep) {
			clearInterval(this.idleExpirySweep);
			this.idleExpirySweep = null;
		}
	}

	private setupRoomHandlers(socket: Socket): void {
		socket.on('join_room', async (data, callback) => {
			try {
				const { roomId, userData, mediaState, e2ee } = data;
				await this.handleJoinRoom(socket, {
					roomId,
					participantId: socket.userId,
					userData: {
						name: userData.name,
						userId: userData.userId,
						avatar: userData.avatar,
						audio_enabled: mediaState.audio_enabled,
						video_enabled: mediaState.video_enabled,
						is_guest: userData.is_guest,
					},
					e2ee,
				});
				callback({ success: true, senderId: socket.senderId });
				this.requestEpochKeyPackageAfterJoin(socket, roomId, socket.userId);
			} catch (error) {
				loggers.socketHandler.error(
					'Error joining room: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_router_rtp_capabilities', async (_data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const roomId = socket.meetingId;

				loggers.socketHandler.debug(
					'Getting RTP capabilities for room: %s, user: %s',
					roomId,
					socket.userId,
				);

				const rtpCapabilities = this.mediasoup.getRouterRtpCapabilities(roomId);

				callback({ success: true, rtpCapabilities });
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting RTP capabilities: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_existing_producers', async (_data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const roomId = socket.meetingId;
				const userId = socket.userId;

				loggers.socketHandler.debug(
					'Getting existing producers for room: %s, user: %s',
					roomId,
					userId,
				);

				const producers = await this.mediasoup.getExistingProducers(
					roomId,
					userId,
				);

				callback({ success: true, producers });

				// Also emit producer_created events for each existing producer
				for (const producer of producers) {
					socket.emit('producer_created', {
						roomId: producer.roomId,
						producerId: producer.id,
						participantId: producer.user_id,
						kind: producer.kind,
						paused: producer.paused,
						isScreen: producer.isScreen,
					});
				}

				loggers.socketHandler.info(
					'Sent %d existing producers to %s',
					producers.length,
					userId,
				);
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting existing producers: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('get_room_participants', async (_data, callback) => {
			try {
				this.authManager.ensurePresenceAccess(socket);

				if (!this.checkSocketRateLimits(socket, 10, 10, 60 * 1000)) {
					callback({
						success: false,
						error: 'Too many requests. Please try again later.',
					});
					return;
				}

				const roomId = socket.meetingId;
				loggers.socketHandler.debug(
					'Getting room participants for room %s, user %s, scope %s',
					roomId,
					socket.userId,
					socket.scope,
				);
				const participants = this.mediasoup.getRoomParticipants(roomId);

				let responseParticipants: ParticipantInfo[] | PreviewParticipantInfo[] =
					participants;
				if (socket.scope === 'presence-preview') {
					responseParticipants = participants.map((p) => ({
						id: p.id,
						info: {
							name: p.info.name,
							avatar: p.info.avatar,
							is_guest: p.info.is_guest || false,
						},
					}));
				}

				loggers.socketHandler.debug(
					'Found %d participants for room %s',
					responseParticipants.length,
					roomId,
				);
				callback({ success: true, participants: responseParticipants });
			} catch (error) {
				loggers.socketHandler.error(
					'Error getting room participants: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('leave_room', async (data = {}) => {
			const roomId = socket.roomId || data.roomId;
			const participantId = socket.participantId;
			if (roomId && participantId) {
				try {
					await this.mediasoup.removePeer(roomId, participantId);

					if (this.isRealParticipant(participantId)) {
						socket
							.to(roomId)
							.emit('participant_left', { roomId, participantId });
					}

					if (this.raisedHands[roomId]?.[participantId]) {
						delete this.raisedHands[roomId][participantId];
						this.emitToFullAccessParticipants(roomId, 'hand_raised', {
							participantId,
							raised: false,
							timestamp: new Date().toISOString(),
						});
					}

					socket.leave(roomId);
					socket.roomId = undefined;
					loggers.socketHandler.info('%s left room %s', participantId, roomId);
				} catch (e) {
					loggers.socketHandler.warn(
						'leave_room cleanup failed: %s',
						(e as Error).message,
					);
				}
			}
		});
	}

	private async handleJoinRoom(
		socket: Socket,
		data: {
			roomId: string;
			participantId: string;
			userData: UserData;
			e2ee?: {
				enabled?: boolean;
				keyVersion?: string;
				keyProof?: string;
				capability?: {
					supported?: boolean;
				};
			};
		},
	): Promise<void> {
		const { roomId, participantId, userData, e2ee } = data;

		try {
			if (socket.scope === 'full') {
				this.enforceE2EEJoinPolicy(socket, e2ee);
			}

			// Validate that roomId matches the token's meeting_id
			if (socket.meetingId && socket.meetingId !== roomId) {
				throw new Error(
					`Room ID mismatch: token has ${socket.meetingId}, trying to join ${roomId}`,
				);
			}

			await this.mediasoup.createRoom(roomId, (roomId, participantIds) => {
				this.emitToFullAccessParticipants(roomId, 'active_speaker', {
					participantIds,
				});
			});

			socket.join(roomId);

			if (!socket.meetingId) {
				socket.meetingId = roomId;
			}
			socket.roomId = roomId;
			socket.participantId = participantId;

			const senderId = this.assignSenderId(roomId, participantId);
			socket.senderId = senderId;
			// Track socket by scope
			if (socket.scope === 'full') {
				if (!this.fullAccessSockets.has(roomId)) {
					this.fullAccessSockets.set(roomId, new Set());
				}
				this.fullAccessSockets.get(roomId)?.add(socket.id);
				await this.e2eeRoster.add(roomId, {
					participantId,
					senderId,
					isHost: Boolean(socket.isHost),
					joinedAt: Date.now(),
				});
				await this.e2eeEpochRelay.retryPendingCommitRequests(roomId);

				// If this peer is rejoining the room (e.g., host is
				// reconfiguring for E2EE mid-meeting), drop any leftover
				// transports/producers/consumers from the previous session.
				// Otherwise, `getExistingProducers` later returns the stale
				// (non-E2EE) producers, and joiners subscribe to them
				// instead of the new E2EE ones — leaving them reading
				// unencrypted bytes through an E2EE transform.
				const existingPeer = this.mediasoup
					.getRoomPeers?.(roomId)
					?.get(participantId);
				if (existingPeer) {
					loggers.socketHandler.info(
						'Peer %s already in room %s — clearing stale transports/producers before rejoin',
						participantId,
						roomId,
					);
					await this.mediasoup.removePeer(roomId, participantId);
				}

				this.mediasoup.addPeer(roomId, participantId, userData);

				if (this.isRealParticipant(userData.userId)) {
					this.emitParticipantEvent(
						roomId,
						'participant_joined',
						participantId,
						userData,
					);
				}

				loggers.socketHandler.info(
					'User %s joined room %s with media state: audio=%s, video=%s',
					participantId,
					roomId,
					userData.audio_enabled,
					userData.video_enabled,
				);
			} else if (socket.scope === 'presence-preview') {
				if (!this.previewSockets.has(roomId)) {
					this.previewSockets.set(roomId, new Set());
				}
				this.previewSockets.get(roomId)?.add(socket.id);

				loggers.socketHandler.info(
					'Preview user %s observing room %s (not added as peer)',
					participantId,
					roomId,
				);
			}

			socket.emit('existing_raised_hands', {
				hands: this.raisedHands[roomId] || {},
			});
		} catch (error) {
			loggers.socketHandler.error(
				'Error in handleJoinRoom for user %s: %s',
				participantId,
				(error as Error).message,
			);
			throw error;
		}
	}

	private requestEpochKeyPackageAfterJoin(
		socket: Socket,
		roomId: string,
		participantId: string,
	): void {
		if (socket.scope !== 'full' || !socket.e2eeRequired) return;
		const epochNumber = this.e2eeEpochRelay.getCurrentEpochNumber(roomId);
		console.log(
			'[DEBUG-e2ee] SFU: requestEpochKeyPackageAfterJoin (post-ack)',
			{
				roomId,
				participantId,
				isHost: socket.isHost,
				assignedSenderId: socket.senderId,
				epochNumber,
			},
		);
		if (this.fullAccessSockets.get(roomId)?.size === 1) {
			this.e2eeEpochRelay.requestGenesisFromParticipant(roomId, participantId);
			return;
		}
		if (socket.isHost) {
			this.e2eeEpochRelay.requestKeyPackages(roomId, epochNumber, 'enable');
			return;
		}
		this.e2eeEpochRelay.requestKeyPackageFromParticipant(
			roomId,
			participantId,
			epochNumber,
			'join',
		);
	}

	private setupWebRTCHandlers(socket: Socket): void {
		socket.on('create_webrtc_transport', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { direction, encryptionEnabled } = data;
				this.enforceE2EETransportPolicy(socket, {
					encryptionEnabled,
				});
				const roomId = socket.meetingId;
				const userId = socket.userId;

				const transportParams = await this.mediasoup.createWebRtcTransport(
					roomId,
					userId,
					direction,
				);

				callback({ success: true, ...transportParams });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('connect_webrtc_transport', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { transportId, dtlsParameters } = data;
				await this.mediasoup.connectWebRtcTransport(
					transportId,
					dtlsParameters,
				);

				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error connecting WebRTC transport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('restart_webrtc_transport_ice', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { transportId } = data;
				const iceParameters =
					await this.mediasoup.restartWebRtcTransportIce(transportId);

				callback({ success: true, iceParameters });
			} catch (error) {
				loggers.socketHandler.error(
					'Error restarting WebRTC transport ICE: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('create_plain_transport', async (_data, callback) => {
			try {
				const isDev = process.env.NODE_ENV === 'development';
				if (!isDev) {
					throw new Error(
						'PlainTransport creation is not allowed in this environment',
					);
				}

				this.authManager.ensureFullAccess(socket);
				if (socket.e2eeRequired) {
					throw new Error(
						'Plain transport is not allowed when E2EE is required',
					);
				}

				const roomId = socket.meetingId;
				const userId = socket.userId;

				const transportParams = await this.mediasoup.createPlainTransport(
					roomId,
					userId,
				);

				callback({ success: true, ...transportParams });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating PlainTransport: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('create_producer', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				this.enforceE2EEMediaPolicy(socket);
				const { transportId, rtpParameters, kind, appData = {} } = data;
				const startPaused = !!appData.e2eeStartPaused;
				const producer = await this.mediasoup.createProducer(
					transportId,
					rtpParameters,
					kind,
					appData,
					socket.senderId ?? 0,
					startPaused,
				);

				const isScreen =
					(producer.appData && producer.appData.type === 'screen') ||
					appData.type === 'screen';

				callback({ success: true, ...producer, isScreen });

				const roomId = socket.meetingId;
				this.emitToFullAccessParticipants(roomId, 'producer_created', {
					roomId: roomId,
					participantId: socket.userId,
					producerId: producer.id,
					kind: producer.kind,
					paused: startPaused,
					isScreen: isScreen,
				});
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('create_consumer', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				this.enforceE2EEMediaPolicy(socket);
				const { transportId, producerId, rtpCapabilities } = data;
				const consumer = await this.mediasoup.createConsumer(
					transportId,
					producerId,
					rtpCapabilities,
				);

				callback({ success: true, ...consumer });
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('close_producer', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				const ownerCheck = this.assertProducerOwnership(
					producerId,
					socket.userId,
				);
				if (!ownerCheck.ok) {
					callback({ success: false, error: ownerCheck.error });
					return;
				}
				const result = this.mediasoup.closeProducer(producerId);

				callback({ success: true, ...result });

				const roomId = socket.meetingId;
				this.emitToFullAccessParticipants(roomId, 'producer_closed', {
					roomId: roomId,
					participantId: socket.userId,
					producerId,
					isScreen: !!result.isScreen,
				});

				try {
					for (const rc of result.removedConsumers) {
						const targetPeerSocket = Array.from(
							this.io.sockets.sockets.values(),
						).find((s) => s.userId === rc.peerId && s.meetingId === rc.roomId);
						if (targetPeerSocket) {
							targetPeerSocket.emit('consumer_closed', {
								consumerId: rc.consumerId,
							});
						} else {
							this.emitToFullAccessParticipants(roomId, 'consumer_closed', {
								consumerId: rc.consumerId,
								peerId: rc.peerId,
							});
						}
					}
				} catch (e) {
					loggers.socketHandler.warn(
						'Failed to emit consumer_closed notifications: %s',
						(e as Error).message,
					);
				}
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('close_consumer', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { consumerId } = data;
				await this.mediasoup.closeConsumer(consumerId);

				callback({ success: true });
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing consumer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('consumer:update_preferences', async (data, callback) => {
			try {
				const consumerId = data?.consumerId;
				if (!consumerId) {
					callback({ success: false, error: 'Missing consumerId' });
					return;
				}

				const visible = Boolean(data.visible);
				const width = Math.round(data.width);
				const height = Math.round(data.height);

				const result = await this.mediasoup.updateConsumerPreferences({
					consumerId,
					visible,
					width,
					height,
				});

				callback({ success: true, ...result, visible });
			} catch (error) {
				loggers.socketHandler.warn(
					'Error updating consumer preferences: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('request_consumer_keyframe', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { consumerId } = data;
				const consumerData = this.mediasoup.getConsumerData(consumerId);
				if (!consumerData) {
					callback({ success: false, error: 'Consumer not found' });
					return;
				}
				if (consumerData.peerId !== socket.userId) {
					callback({ success: false, error: 'Consumer ownership mismatch' });
					return;
				}
				const requested =
					await this.mediasoup.requestConsumerKeyFrame(consumerId);
				callback({ success: true, requested });
			} catch (error) {
				loggers.socketHandler.error(
					'Error requesting consumer key frame: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('pause_producer', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				const ownerCheck = this.assertProducerOwnership(
					producerId,
					socket.userId,
				);
				if (!ownerCheck.ok) {
					callback({ success: false, error: ownerCheck.error });
					return;
				}
				const paused = await this.mediasoup.pauseProducer(producerId);

				callback({ success: true, paused });
			} catch (error) {
				loggers.socketHandler.error(
					'Error pausing producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('resume_producer', async (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				const ownerCheck = this.assertProducerOwnership(
					producerId,
					socket.userId,
				);
				if (!ownerCheck.ok) {
					callback({ success: false, error: ownerCheck.error });
					return;
				}
				const resumed = await this.mediasoup.resumeProducer(producerId);

				callback({ success: true, resumed });
			} catch (error) {
				loggers.socketHandler.error(
					'Error resuming producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	}

	private assertProducerOwnership(
		producerId: string,
		userId: string,
	): { ok: true } | { ok: false; error: string } {
		const producerData = this.mediasoup.getProducerData(producerId);
		if (!producerData) {
			return { ok: false, error: 'Producer not found' };
		}
		if (producerData.peerId !== userId) {
			loggers.socketHandler.warn(
				'Producer ownership mismatch: user %s attempted to operate producer %s owned by %s',
				userId,
				producerId,
				producerData.peerId,
			);
			return { ok: false, error: 'Not the owner of this producer' };
		}
		return { ok: true };
	}

	private enforceE2EEJoinPolicy(
		socket: Socket,
		e2ee?: {
			enabled?: boolean;
			capability?: { supported?: boolean };
		},
	): void {
		if (!socket.e2eeRequired) {
			socket.e2eeReady = true;
			return;
		}

		if (!e2ee?.enabled) {
			throw new Error('E2EE is required for this room');
		}

		if (!e2ee.capability?.supported) {
			throw new Error('Client does not support required E2EE capabilities');
		}

		socket.e2eeReady = true;
	}

	private enforceE2EETransportPolicy(
		socket: Socket,
		data: {
			encryptionEnabled?: boolean;
		},
	): void {
		if (!socket.e2eeRequired) {
			return;
		}

		if (!socket.e2eeReady) {
			throw new Error('E2EE join handshake not completed');
		}

		if (!data.encryptionEnabled) {
			throw new Error('Encrypted transport is required for this room');
		}
	}

	private enforceE2EEMediaPolicy(socket: Socket): void {
		if (!socket.e2eeRequired) {
			return;
		}

		if (!socket.e2eeReady) {
			throw new Error('E2EE join handshake not completed');
		}
	}

	private setupMediaControlHandlers(socket: Socket): void {
		socket.on('media_control', async (data) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { action } = data;
				const roomId = socket.roomId;

				if (!roomId || !socket.participantId) return;

				try {
					this.mediasoup.applyMediaControl(
						roomId,
						socket.participantId,
						action,
					);
				} catch (e) {
					loggers.socketHandler.warn(
						'Failed to apply media control on server: %s',
						(e as Error).message,
					);
				}

				// If unmuting and hand is raised, lower it automatically
				if (
					action === 'unmute' &&
					this.raisedHands[roomId]?.[socket.participantId]
				) {
					delete this.raisedHands[roomId][socket.participantId];
					this.emitToFullAccessParticipants(roomId, 'hand_raised', {
						participantId: socket.participantId,
						raised: false,
						timestamp: new Date().toISOString(),
					});
				}

				this.emitToFullAccessParticipants(roomId, 'media_control_update', {
					participantId: socket.participantId,
					action,
					timestamp: new Date().toISOString(),
				});
			} catch (error) {
				loggers.socketHandler.warn(
					'media_control handling failed: %s',
					(error as Error).message,
				);
			}
		});
	}

	private setupHostControlHandlers(socket: TypedSocket): void {
		socket.on('host_control', async (data) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { action, targetParticipantId } = data;
				const roomId = socket.roomId;

				if (!roomId || !socket.participantId) {
					socket.emit('sfu_error', {
						error: 'Not in a room',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				if (!socket.isHost && !socket.isCohost) {
					socket.emit('sfu_error', {
						error: 'Only host or co-host can control participants',
						timestamp: new Date().toISOString(),
					});
					loggers.socketHandler.warn(
						'Non-host/co-host %s attempted host control in room %s',
						socket.participantId,
						roomId,
					);
					return;
				}

				if (!this.mediasoup.peerExistsInRoom(roomId, targetParticipantId)) {
					socket.emit('sfu_error', {
						error: 'Target participant not found',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				const targetSocket = this.findSocketByParticipantId(
					roomId,
					targetParticipantId,
				);

				if (!targetSocket) {
					socket.emit('sfu_error', {
						error: 'Target participant socket not found',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				switch (action) {
					case 'mute_participant':
						targetSocket.emit('host_control_update', {
							action,
							targetParticipantId,
							hostId: socket.participantId,
							timestamp: new Date().toISOString(),
						});
						loggers.socketHandler.info(
							'Host %s sent mute command to participant %s in room %s',
							socket.participantId,
							targetParticipantId,
							roomId,
						);
						break;
					case 'kick_participant': {
						const targetSenderId = targetSocket.senderId;
						targetSocket.emit('host_control_update', {
							action,
							targetParticipantId,
							hostId: socket.participantId,
							timestamp: new Date().toISOString(),
						});

						loggers.socketHandler.info(
							'Host %s kicked participant %s (senderId=%s) from room %s',
							socket.participantId,
							targetParticipantId,
							targetSenderId,
							roomId,
						);

						// If the room has E2EE, ask the relay to pick a committer
						// to author a remove commit. The committer's tab will run
						// the actual MLS remove via the EpochProtocolProvider.
						if (targetSocket.e2eeRequired && targetSenderId !== undefined) {
							await this.e2eeEpochRelay.requestCommitForRemoval(
								roomId,
								[targetSenderId],
								this.e2eeEpochRelay.getCurrentEpochNumber(roomId),
							);
						}

						setTimeout(() => {
							if (targetSocket.connected) {
								targetSocket.disconnect(true);
								loggers.socketHandler.info(
									'Forcefully disconnected kicked participant %s',
									targetParticipantId,
								);
							}
						}, 1000);
						break;
					}
					case 'lower_hand':
						if (this.raisedHands[roomId]?.[targetParticipantId]) {
							delete this.raisedHands[roomId][targetParticipantId];
							this.emitToFullAccessParticipants(roomId, 'hand_raised', {
								participantId: targetParticipantId,
								raised: false,
								timestamp: new Date().toISOString(),
							});
							loggers.socketHandler.info(
								'Host %s lowered hand of participant %s',
								socket.participantId,
								targetParticipantId,
							);
						} else {
							socket.emit('sfu_error', {
								error: 'Participant does not have a raised hand',
								timestamp: new Date().toISOString(),
							});
						}
						break;
					default:
						socket.emit('sfu_error', {
							error: 'Invalid host control action',
							timestamp: new Date().toISOString(),
						});
						break;
				}
			} catch (error) {
				loggers.socketHandler.warn(
					'host_control handling failed: %s',
					(error as Error).message,
				);
				socket.emit('sfu_error', {
					error: (error as Error).message,
					timestamp: new Date().toISOString(),
				});
			}
		});
	}

	private setupScreenShareHandlers(socket: Socket): void {
		socket.on('screen_share', (data) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const { action, shareData } = data;
				const roomId = socket.roomId;

				if (!roomId) return;

				if (action === 'start_share') {
					this.emitToFullAccessParticipants(roomId, 'screen_share_started', {
						participantId: socket.participantId,
						shareData,
						timestamp: new Date().toISOString(),
					});
				} else if (action === 'stop_share') {
					this.emitToFullAccessParticipants(roomId, 'screen_share_stopped', {
						participantId: socket.participantId,
						timestamp: new Date().toISOString(),
					});
				}
			} catch (error) {
				loggers.socketHandler.warn(
					'screen_share handling failed: %s',
					(error as Error).message,
				);
			}
		});
	}

	private setupChatHandlers(socket: Socket): void {
		socket.on('chat:toggle_restriction', (data) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;

				if (!roomId || (!socket.isHost && !socket.isCohost)) return;
				const isRestricted = Boolean(data.enabled);
				this.hostOnlyChat[roomId] = isRestricted;

				this.emitToFullAccessParticipants(roomId, 'chat:restriction_updated', {
					enabled: isRestricted,
				});
			} catch (error) {
				loggers.socketHandler.warn('chat:toggle failed', error);
			}
		});

		socket.on('chat:send', (data = {}) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const text = (
					typeof data.message === 'string' ? data.message : ''
				).slice(0, 2000);

				if (
					!roomId ||
					!text.trim() ||
					!socket.participantId ||
					!socket.userName
				) {
					return;
				}

				if (this.hostOnlyChat[roomId] && !socket.isHost && !socket.isCohost) {
					socket.emit('sfu_error', {
						error: 'Only hosts and co-hosts can send messages right now.',
						code: 'HOST_ONLY_CHAT',
						timestamp: new Date().toISOString(),
					});
					return;
				}

				const payload: ChatMessage = {
					roomId,
					message: text,
					fromUser: socket.participantId,
					fromName: socket.userName,
					timestamp: new Date().toISOString(),
				};
				if (data.clientId) payload.clientId = String(data.clientId);

				this.emitToFullAccessParticipants(roomId, 'chat:message', payload);
			} catch (e) {
				loggers.socketHandler.warn(
					'chat:send handling failed: %s',
					(e as Error).message || e,
				);
			}
		});
	}

	private setupReactionHandlers(socket: Socket): void {
		socket.on('reaction:send', (data = {}) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const reaction =
					typeof data.reaction === 'string' ? data.reaction : null;

				if (!roomId || !reaction || !socket.participantId) {
					return;
				}

				const payload: ReactionMessage = {
					roomId,
					reaction,
					fromUser: socket.participantId,
					fromName: socket.userName,
					timestamp: new Date().toISOString(),
				};

				this.emitToFullAccessParticipants(roomId, 'reaction:message', payload);
			} catch (e) {
				loggers.socketHandler.warn(
					'reaction:send handling failed: %s',
					(e as Error).message || e,
				);
			}
		});
	}

	private setupRaiseHandHandlers(socket: Socket): void {
		socket.on('raise_hand', (data, callback) => {
			try {
				this.authManager.ensureFullAccess(socket);
				const roomId = socket.roomId;
				const raised = typeof data?.raised === 'boolean' ? data.raised : false;

				if (!roomId || !socket.participantId) {
					callback({ success: false, error: 'Invalid room or participant' });
					return;
				}

				if (!this.raisedHands[roomId]) {
					this.raisedHands[roomId] = {};
				}

				if (raised) {
					this.raisedHands[roomId][socket.participantId] =
						new Date().toISOString();
				} else {
					delete this.raisedHands[roomId][socket.participantId];
				}

				this.emitToFullAccessParticipants(roomId, 'hand_raised', {
					participantId: socket.participantId,
					raised,
					timestamp: new Date().toISOString(),
				});

				callback({ success: true });
			} catch (e) {
				loggers.socketHandler.warn(
					'raise_hand handling failed: %s',
					(e as Error).message || e,
				);
				callback({ success: false, error: 'Internal error' });
			}
		});
	}

	private setupDisconnectHandlers(socket: Socket): void {
		socket.on('disconnect', async () => {
			this.authManager.cleanupSocket(socket);

			loggers.socketHandler.info(
				'Disconnected: %s (User: %s, Scope: %s)',
				socket.id,
				socket.participantId,
				socket.scope,
			);

			const roomId = socket.roomId;
			const participantId = socket.participantId;

			if (roomId && participantId) {
				try {
					// Remove from scope tracking
					if (socket.scope === 'full') {
						this.fullAccessSockets.get(roomId)?.delete(socket.id);
					} else if (socket.scope === 'presence-preview') {
						this.previewSockets.get(roomId)?.delete(socket.id);
					}

					// Only remove peer if full access
					if (socket.scope === 'full') {
						if (socket.senderId !== undefined) {
							await this.e2eeRoster.remove(roomId, socket.senderId);
							this.e2eeEpochRelay.removePendingJoiner(roomId, socket.senderId);
						}
						this.participantToSender.get(roomId)?.delete(participantId);
						await this.mediasoup.removePeer(roomId, participantId);

						if (this.isRealParticipant(participantId)) {
							this.emitParticipantEvent(
								roomId,
								'participant_left',
								participantId,
							);
						}

						if (this.raisedHands[roomId]?.[participantId]) {
							delete this.raisedHands[roomId][participantId];
							this.emitToFullAccessParticipants(roomId, 'hand_raised', {
								participantId,
								raised: false,
								timestamp: new Date().toISOString(),
							});
						}

						loggers.socketHandler.info(
							'Cleaned up user %s from room %s',
							participantId,
							roomId,
						);
					} else if (socket.scope === 'presence-preview') {
						loggers.socketHandler.info(
							'Preview socket %s disconnected for user %s (no peer to remove)',
							socket.id,
							participantId,
						);
					}

					// Clean up room if empty (no full access or preview sockets)
					const fullAccessCount = this.fullAccessSockets.get(roomId)?.size || 0;
					const previewCount = this.previewSockets.get(roomId)?.size || 0;
					if (fullAccessCount === 0 && previewCount === 0) {
						await this.cleanupRoom(roomId);
					}
				} catch (error) {
					loggers.socketHandler.error('Error handling disconnect: %s', error);
				}
			}
		});
	}

	private setupErrorHandlers(socket: Socket): void {
		socket.on('error', (error) => {
			loggers.socketHandler.error('Socket error for %s: %s', socket.id, error);
			socket.emit('sfu_error', {
				error: (error as Error).message,
				timestamp: new Date().toISOString(),
			});
		});
	}
}
