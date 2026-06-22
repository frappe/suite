import type { Server } from 'socket.io';
import type { MediasoupManager } from '../mediasoup/MediasoupManager';
import type { ClientToServerEvents, ServerToClientEvents } from '../types';
import { RateLimiter } from '../utils/rateLimiter';
import type { AuthManager } from './AuthManager';
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
	private registerHandlers: ((socket: import('socket.io').Socket) => void)[];

	constructor(
		io: Server<ClientToServerEvents, ServerToClientEvents>,
		mediasoup: MediasoupManager,
		authManager: AuthManager,
	) {
		this.io = io;
		this.mediasoup = mediasoup;
		this.authManager = authManager;
		this.rateLimiter = new RateLimiter();
		this.registry = new RoomRegistry(io);

		const deps: HandlerDeps = {
			io,
			registry: this.registry,
			mediasoup,
			authManager,
			rateLimiter: this.rateLimiter,
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
		});
	}
}
