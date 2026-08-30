import type { Server } from 'socket.io';
import type { SFUConfig } from '../config';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { Telemetry } from '../telemetry/Telemetry';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';
import { loggers } from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';
import type { AuthManager } from './AuthManager';
import { E2EEEpochRelay } from './E2EEEpochRelay';
import type { E2eeCoordinatorPersistence } from './E2eeCoordinatorPersistence';
import type { E2eeRosterStore } from './E2eeRosterStore';
import { registerAuthHandlers } from './handlers/AuthHandlers';
import { registerChatHandlers } from './handlers/ChatHandlers';
import { registerClientTelemetryHandlers } from './handlers/ClientTelemetryHandlers';
import { registerConsumerHandlers } from './handlers/ConsumerHandlers';
import { registerDisconnectHandlers } from './handlers/DisconnectHandlers';
import { registerErrorHandlers } from './handlers/ErrorHandlers';
import type { HandlerDeps } from './handlers/Handler';
import { registerHostControlHandlers } from './handlers/HostControlHandlers';
import { registerMediaControlHandlers } from './handlers/MediaControlHandlers';
import { registerPollHandlers } from './handlers/PollHandlers';
import { registerProducerHandlers } from './handlers/ProducerHandlers';
import { registerRaiseHandHandlers } from './handlers/RaiseHandHandlers';
import { registerReactionHandlers } from './handlers/ReactionHandlers';
import { registerRoomJoinHandlers } from './handlers/RoomJoinHandlers';
import { registerRoomQueryHandlers } from './handlers/RoomQueryHandlers';
import { registerScreenShareHandlers } from './handlers/ScreenShareHandlers';
import { registerWebRtcTransportHandlers } from './handlers/WebRtcTransportHandlers';
import type { RecordingGrantManager } from './RecordingGrantManager';
import { RoomLifecycleCoordinator } from './RoomLifecycleCoordinator';
import { RoomRegistry } from './RoomRegistry';

const RECORDING_PROOF_TIMEOUT_MS = 10_000;

export class SocketHandlerManager {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private registry: RoomRegistry;
	private rateLimiter: RateLimiter;
	private e2eeEpochRelay: E2EEEpochRelay;
	private roomLifecycle: RoomLifecycleCoordinator;
	private telemetry: Telemetry;
	private registerHandlers: ((socket: import('socket.io').Socket) => void)[];
	private idleExpirySweep: NodeJS.Timeout | null = null;

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		mediasoup: MediasoupManager,
		authManager: AuthManager,
		telemetry: Telemetry,
		roster: E2eeRosterStore,
		private readonly runtime: SFUConfig['runtime'],
		coordinatorPersistence?: E2eeCoordinatorPersistence,
		private readonly recordingGrantManager?: RecordingGrantManager,
	) {
		this.io = io;
		this.mediasoup = mediasoup;
		this.authManager = authManager;
		this.telemetry = telemetry;
		this.rateLimiter = new RateLimiter();
		this.registry = new RoomRegistry(io);
		this.e2eeEpochRelay = new E2EEEpochRelay(
			io,
			this.registry.getFullAccessSockets(),
			this.registry.getParticipantToSender(),
			coordinatorPersistence,
			this.rateLimiter,
			telemetry,
			this.runtime.bypassRateLimits,
		);
		this.e2eeEpochRelay.setRoster(roster);
		this.roomLifecycle = new RoomLifecycleCoordinator(
			this.registry,
			this.e2eeEpochRelay,
			roster,
			this.mediasoup,
		);

		const deps: HandlerDeps = {
			io,
			registry: this.registry,
			roomLifecycle: this.roomLifecycle,
			mediasoup,
			authManager,
			rateLimiter: this.rateLimiter,
			e2eeEpochRelay: this.e2eeEpochRelay,
			e2eeRoster: roster,
			telemetry,
			runtime: this.runtime,
		};

		this.registerHandlers = [
			registerAuthHandlers(deps),
			registerClientTelemetryHandlers(deps),
			registerRoomJoinHandlers(deps),
			registerRoomQueryHandlers(deps),
			registerWebRtcTransportHandlers(deps),
			registerProducerHandlers(deps),
			registerConsumerHandlers(deps),
			registerMediaControlHandlers(deps),
			registerHostControlHandlers(deps),
			registerScreenShareHandlers(deps),
			registerPollHandlers(deps),
			registerChatHandlers(deps),
			registerReactionHandlers(deps),
			registerRaiseHandHandlers(deps),
			registerDisconnectHandlers(deps),
			registerErrorHandlers(deps),
		];

		this.mediasoup.onProducerClosed((event) => {
			this.registry.emitProducerClosed(event.roomId, {
				participantId: event.participantId,
				producerId: event.producerId,
				isScreen: event.isScreen,
				reason: event.reason,
				source: event.source,
				details: event.details,
			});
			for (const removed of event.removedConsumers) {
				const targetSocket = Array.from(this.io.sockets.sockets.values()).find(
					(socket) =>
						socket.peerId === removed.peerId &&
						socket.roomId === removed.roomId,
				);
				if (targetSocket) {
					targetSocket.emit('consumer_closed', {
						consumerId: removed.consumerId,
					});
				} else {
					this.registry.emitToFullAccessParticipants(
						event.roomId,
						'consumer_closed',
						{
							consumerId: removed.consumerId,
							peerId: removed.peerId,
						},
					);
				}
			}
		});

		this.mediasoup.onNetworkQualityUpdate((roomId, peerId, quality) => {
			this.registry.emitToFullAccessParticipants(
				roomId,
				'network_quality_update',
				{
					participantId: peerId,
					quality,
				},
			);
		});
	}

	setupSocketHandlers(): void {
		this.io.use((socket, next) => {
			if (!this.authManager.authenticateSocket(socket)) {
				this.telemetry.socketConnections.inc({ outcome: 'failure' });
				loggers.telemetry.event('socket_connection', { outcome: 'failure' });
				this.telemetry.authEvents.inc({
					stage: 'connection',
					reason: 'invalid_token',
					outcome: 'failure',
				});
				return next(new Error('Authentication failed'));
			}
			this.telemetry.socketConnections.inc({ outcome: 'success' });
			loggers.telemetry.event('socket_connection', { outcome: 'success' });
			this.telemetry.authEvents.inc({
				stage: 'connection',
				reason: 'valid',
				outcome: 'success',
			});
			next();
		});

		this.io.on('connection', (socket) => {
			let challenge =
				socket.scope === 'recording' &&
				socket.recordingClaims &&
				this.recordingGrantManager
					? this.recordingGrantManager.createChallenge(
							socket.recordingClaims,
							socket.id,
						)
					: undefined;
			let proofTimeout: NodeJS.Timeout | undefined;
			const clearProofTimeout = () => {
				if (proofTimeout) clearTimeout(proofTimeout);
				proofTimeout = undefined;
			};
			if (challenge) {
				proofTimeout = setTimeout(() => {
					proofTimeout = undefined;
					if (!socket.recordingProofComplete) socket.disconnect(true);
				}, RECORDING_PROOF_TIMEOUT_MS);
				proofTimeout.unref();
				socket.once('disconnect', clearProofTimeout);
			}
			socket.use((packet, next) => {
				if (socket.scope === 'recording' && !socket.recordingProofComplete) {
					if (packet[0] !== 'recording:proof') {
						socket.disconnect(true);
						return;
					}
				}
				if (this.authManager.isTokenExpired(socket)) {
					this.telemetry.authEvents.inc({
						stage: 'expiry',
						reason: 'middleware_guard',
						outcome: 'failure',
					});
					this.authManager.triggerTokenExpiry(socket, 'middleware_guard');
					if (packet[0] !== 'auth:update_token') return;
				}
				next();
			});

			if (challenge && this.recordingGrantManager) {
				const manager = this.recordingGrantManager;
				socket.once('recording:proof', async (data, callback) => {
					try {
						const claims = socket.recordingClaims;
						if (!claims || !challenge || typeof data?.signature !== 'string')
							throw new Error('Invalid recording proof');
						const expiresAt = await manager.verifyProofAndConsume(
							claims,
							challenge,
							data.signature,
							socket.id,
						);
						this.registry.activateRecorder(
							socket,
							claims.recording_id,
							claims.recorder_job_id,
						);
						socket.recordingProofComplete = true;
						clearProofTimeout();
						socket.tokenExpiresAt = expiresAt * 1000;
						challenge = undefined;
						callback({ success: true });
					} catch (error) {
						clearProofTimeout();
						callback({ success: false, error: (error as Error).message });
						socket.disconnect(true);
					}
				});
				socket.emit('recording:challenge', challenge);
			}

			for (const register of this.registerHandlers) {
				register(socket);
			}
			if (socket.scope !== 'recording') this.e2eeEpochRelay.setup(socket);
		});

		this.idleExpirySweep = setInterval(
			() => this.sweepExpiredSockets(),
			30_000,
		);
	}

	private sweepExpiredSockets(): void {
		for (const [, socket] of this.io.sockets.sockets) {
			if (this.authManager.isTokenExpired(socket as never)) {
				this.telemetry.authEvents.inc({
					stage: 'expiry',
					reason: 'idle_sweep',
					outcome: 'failure',
				});
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
		this.roomLifecycle.stop();
		if (this.idleExpirySweep) {
			clearInterval(this.idleExpirySweep);
			this.idleExpirySweep = null;
		}
	}
}
