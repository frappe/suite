import type { Server, Socket } from 'socket.io';
import { vi } from 'vitest';
import type { MediasoupManager } from '../../mediasoup/MediasoupManager';
import type {
	ClientToServerEvents,
	ServerToClientEvents,
	SFUScope,
	SocketData,
} from '../../types';
import type { AuthManager } from '../AuthManager';
import { SocketHandlerManager } from '../SocketHandlerManager';

export type TypedSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	SocketData
>;

export interface MockSocket extends TypedSocket {
	fire(event: string, ...args: unknown[]): void;
	emitCalls: { event: string; data: unknown }[];
	toEmits: { roomId: string; event: string; data: unknown }[];
	joinCalls: string[];
}

const SOCKET_DEFAULTS = {
	id: 'sock-1',
	userId: 'user-1',
	userName: 'Alice',
	meetingId: 'room-1',
	site: undefined as string | undefined,
	isHost: false,
	isCohost: false,
	scope: 'full' as SFUScope,
};

export function createMockSocket(
	partial: Partial<TypedSocket> = {},
	adapterRooms: Map<string, Set<string>> | null = null,
): MockSocket {
	const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
	const emitCalls: { event: string; data: unknown }[] = [];
	const toEmits: { roomId: string; event: string; data: unknown }[] = [];
	const joinCalls: string[] = [];

	const socket = {
		...SOCKET_DEFAULTS,
		handshake: {
			address: '127.0.0.1',
			headers: {} as Record<string, string | string[] | undefined>,
		},
		connected: true,
		...partial,
		on(event: string, handler: (...args: unknown[]) => void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return this;
		},
		emit(event: string, data?: unknown) {
			emitCalls.push({ event, data });
			return true;
		},
		to(roomId: string) {
			return {
				emit(event: string, data?: unknown) {
					toEmits.push({ roomId, event, data });
					return true;
				},
			};
		},
		join(roomId: string) {
			joinCalls.push(roomId);
			if (adapterRooms) {
				let set = adapterRooms.get(roomId);
				if (!set) {
					set = new Set();
					adapterRooms.set(roomId, set);
				}
				set.add(socket.id);
			}
			return Promise.resolve(this);
		},
		leave(roomId: string) {
			if (adapterRooms) {
				adapterRooms.get(roomId)?.delete(socket.id);
			}
			return this;
		},
		disconnect(_close: boolean) {
			return socket;
		},
		use() {
			return this;
		},
		fire(event: string, ...args: unknown[]) {
			const list = handlers.get(event) ?? [];
			for (const h of list) h(...args);
		},
		emitCalls,
		toEmits,
		joinCalls,
	} as unknown as MockSocket;

	return socket;
}

interface MockServer {
	io: Server<ClientToServerEvents, ServerToClientEvents>;
	middlewareFn: ((s: Socket, next: (err?: Error) => void) => void) | null;
	connectionFn: ((s: Socket) => void) | null;
	socketsAdapterRooms: Map<string, Set<string>>;
	socketsMap: Map<string, Socket>;
}

function createMockServer(): MockServer {
	const socketsAdapterRooms = new Map<string, Set<string>>();
	const socketsMap = new Map<string, Socket>();

	const mock: MockServer = {
		io: undefined as unknown as Server<
			ClientToServerEvents,
			ServerToClientEvents
		>,
		middlewareFn: null,
		connectionFn: null,
		socketsAdapterRooms,
		socketsMap,
	};

	const io = {
		use(fn: (s: Socket, next: (err?: Error) => void) => void) {
			mock.middlewareFn = fn;
			return io;
		},
		on(event: string, fn: (s: Socket) => void) {
			if (event === 'connection') mock.connectionFn = fn;
			return io;
		},
		sockets: {
			adapter: { rooms: socketsAdapterRooms },
			sockets: socketsMap,
		},
	} as unknown as Server<ClientToServerEvents, ServerToClientEvents>;

	mock.io = io;
	return mock;
}

function createMockMediasoupManager(): MediasoupManager {
	return {
		onNetworkQualityUpdate: vi.fn().mockReturnValue(() => {}),
		createRoom: vi.fn().mockResolvedValue({
			peers: new Map(),
			activeSpeakerObserver: null,
		}),
		closeRoom: vi.fn().mockResolvedValue(undefined),
		addPeer: vi.fn(),
		removePeer: vi.fn().mockResolvedValue(undefined),
		peerExistsInRoom: vi.fn().mockReturnValue(true),
	} as unknown as MediasoupManager;
}

function createMockAuthManager(): AuthManager {
	return {
		authenticateSocket: vi.fn().mockReturnValue(true),
		ensureFullAccess: vi.fn(),
		ensurePresenceAccess: vi.fn(),
		isTokenExpired: vi.fn((socket: { tokenExpiresAt?: number }) => {
			if (!socket?.tokenExpiresAt) return false;
			return Date.now() >= socket.tokenExpiresAt;
		}),
		triggerTokenExpiry: vi.fn(),
		cleanupSocket: vi.fn(),
	} as unknown as AuthManager;
}

interface ManagerHarness {
	manager: SocketHandlerManager;
	io: MockServer;
	mediasoup: ReturnType<typeof createMockMediasoupManager>;
	authManager: ReturnType<typeof createMockAuthManager>;
	connect(socket: MockSocket): void;
	createSocket(overrides?: Partial<TypedSocket>): MockSocket;
}

export function createManager(): ManagerHarness {
	const io = createMockServer();
	const mediasoup = createMockMediasoupManager();
	const authManager = createMockAuthManager();
	const manager = new SocketHandlerManager(io.io, mediasoup, authManager);
	manager.setupSocketHandlers();

	const connect = (socket: MockSocket) => {
		if (!io.connectionFn) throw new Error('No connection handler registered');
		io.socketsMap.set(socket.id, socket);
		io.connectionFn(socket);
	};

	const createSocket = (overrides: Partial<TypedSocket> = {}): MockSocket => {
		const socket = createMockSocket(overrides, io.socketsAdapterRooms);
		io.socketsMap.set(socket.id, socket);
		const origDisconnect = socket.disconnect.bind(socket);
		(socket as { disconnect: (close: boolean) => void }).disconnect = (
			close: boolean,
		) => {
			// Mirror socket.io's auto-leave-on-disconnect: remove the socket
			// from every adapter room it joined.
			for (const [roomId, ids] of io.socketsAdapterRooms) {
				ids.delete(socket.id);
				if (ids.size === 0) io.socketsAdapterRooms.delete(roomId);
			}
			io.socketsMap.delete(socket.id);
			return origDisconnect(close);
		};
		return socket;
	};

	return { manager, io, mediasoup, authManager, connect, createSocket };
}
