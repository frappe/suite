import type { Server, Socket } from 'socket.io';
import type { MediasoupManager } from '../../mediasoup/MediasoupManager';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SocketData,
} from '../../types';
import type { RateLimiter } from '../../utils/rateLimiter';
import type { AuthManager } from '../AuthManager';
import type { E2EEEpochRelay } from '../E2EEEpochRelay';
import type { E2eeRosterStore } from '../E2eeRosterStore';
import type { RoomRegistry } from '../RoomRegistry';

export type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

export interface HandlerDeps {
	io: Server<ClientToServerEvents, ServerToClientEvents>;
	registry: RoomRegistry;
	mediasoup: MediasoupManager;
	authManager: AuthManager;
	rateLimiter: RateLimiter;
	e2eeEpochRelay: E2EEEpochRelay;
	e2eeRoster: E2eeRosterStore;
}
