import type { Server } from 'socket.io';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';
import { loggers } from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';
import type { AuthManager } from './AuthManager';
import { E2EEEpochRelay } from './E2EEEpochRelay';
import type { E2eeCoordinatorPersistence } from './E2eeCoordinatorPersistence';
import type { E2eeRosterStore } from './E2eeRosterStore';
import { registerAuthHandlers } from './handlers/AuthHandlers';
import { registerChatHandlers } from './handlers/ChatHandlers';
import { registerConsumerHandlers } from './handlers/ConsumerHandlers';
import { registerDisconnectHandlers } from './handlers/DisconnectHandlers';
import { registerErrorHandlers } from './handlers/ErrorHandlers';
import type { HandlerDeps } from './handlers/Handler';
import { registerHostControlHandlers } from './handlers/HostControlHandlers';
import { registerMediaControlHandlers } from './handlers/MediaControlHandlers';
import { registerProducerHandlers } from './handlers/ProducerHandlers';
import { registerRaiseHandHandlers } from './handlers/RaiseHandHandlers';
import { registerReactionHandlers } from './handlers/ReactionHandlers';
import { registerRoomJoinHandlers } from './handlers/RoomJoinHandlers';
import { registerRoomQueryHandlers } from './handlers/RoomQueryHandlers';
import { registerScreenShareHandlers } from './handlers/ScreenShareHandlers';
import { registerWebRtcTransportHandlers } from './handlers/WebRtcTransportHandlers';
import { RoomRegistry } from './RoomRegistry';

export class SocketHandlerManager {
	private io: Server<ClientToServerEvents, ServerToClientEvents>;
	private mediasoup: MediasoupManager;
	private authManager: AuthManager;
	private registry: RoomRegistry;
	private rateLimiter: RateLimiter;
	private e2eeEpochRelay: E2EEEpochRelay;
	private registerHandlers: ((socket: import('socket.io').Socket) => void)[];
	private idleExpirySweep: NodeJS.Timeout | null = null;

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		mediasoup: MediasoupManager,
		authManager: AuthManager,
		roster: E2eeRosterStore,
		coordinatorPersistence?: E2eeCoordinatorPersistence,
	) {
		this.io = io;
		this.mediasoup = mediasoup;
		this.authManager = authManager;
		this.rateLimiter = new RateLimiter();
		this.registry = new RoomRegistry(io);
		this.e2eeEpochRelay = new E2EEEpochRelay(
			io,
			this.registry.getFullAccessSockets(),
			this.registry.getParticipantToSender(),
			coordinatorPersistence,
			this.rateLimiter,
		);
		this.e2eeEpochRelay.setRoster(roster);

		const deps: HandlerDeps = {
			io,
			registry: this.registry,
			mediasoup,
			authManager,
			rateLimiter: this.rateLimiter,
			e2eeEpochRelay: this.e2eeEpochRelay,
			e2eeRoster: roster,
		};

		this.registerHandlers = [
			registerAuthHandlers(deps),
			registerRoomJoinHandlers(deps),
			registerRoomQueryHandlers(deps),
			registerWebRtcTransportHandlers(deps),
			registerProducerHandlers(deps),
			registerConsumerHandlers(deps),
			registerMediaControlHandlers(deps),
			registerHostControlHandlers(deps),
			registerScreenShareHandlers(deps),
			registerChatHandlers(deps),
			registerReactionHandlers(deps),
			registerRaiseHandHandlers(deps),
			registerDisconnectHandlers(deps),
			registerErrorHandlers(deps),
		];

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
				return next(new Error('Authentication failed'));
			}
			next();
		});

		this.io.on('connection', (socket) => {
			socket.use((_packet, next) => {
				if (this.authManager.isTokenExpired(socket)) {
					this.authManager.triggerTokenExpiry(socket, 'middleware_guard');
					return;
				}
				next();
			});

			for (const register of this.registerHandlers) {
				register(socket);
			}
			this.e2eeEpochRelay.setup(socket);
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
}
