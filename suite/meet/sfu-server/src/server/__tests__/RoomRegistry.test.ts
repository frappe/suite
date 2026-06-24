import type { Server, Socket } from 'socket.io';
import { describe, expect, it } from 'vitest';
import type { UserData } from '../../types';
import { RoomRegistry } from '../RoomRegistry';

function makeSocket(id: string): Socket {
	const emitCalls: { event: string; data: unknown }[] = [];
	const sock = {
		id,
		emit(event: string, data?: unknown) {
			emitCalls.push({ event, data });
			return true;
		},
		_emitCalls: emitCalls,
	} as unknown as Socket;
	return sock;
}

function makeIo(): {
	io: Server;
	sockets: Map<string, ReturnType<typeof makeSocket>>;
	rooms: Map<string, Set<string>>;
	joinRoom: (socketId: string, roomId: string) => void;
} {
	const sockets = new Map<string, ReturnType<typeof makeSocket>>();
	const rooms = new Map<string, Set<string>>();
	const joinRoom = (socketId: string, roomId: string) => {
		let set = rooms.get(roomId);
		if (!set) {
			set = new Set();
			rooms.set(roomId, set);
		}
		set.add(socketId);
	};
	const io = {
		sockets: { sockets, adapter: { rooms } },
		to(roomId: string) {
			const ids = rooms.get(roomId) ?? new Set();
			return {
				emit(event: string, data: unknown) {
					for (const id of ids) {
						const s = sockets.get(id);
						if (s) s.emit(event, data);
					}
				},
			};
		},
	} as unknown as Server;
	return { io, sockets, rooms, joinRoom };
}

function addFullSocket(
	setup: ReturnType<typeof makeIo>,
	roomId: string,
	sock: Socket,
) {
	setup.sockets.set(sock.id, sock);
	setup.joinRoom(sock.id, `${roomId}:full`);
}

function addPreviewSocket(
	setup: ReturnType<typeof makeIo>,
	roomId: string,
	sock: Socket,
) {
	setup.sockets.set(sock.id, sock);
	setup.joinRoom(sock.id, `${roomId}:preview`);
}

describe('RoomRegistry', () => {
	describe('raised hands', () => {
		it('stores and clears timestamps per peer; hasRaisedHand reflects state', () => {
			const { io } = makeIo();
			const registry = new RoomRegistry(io);

			expect(registry.hasRaisedHand('r1', 'p1')).toBe(false);
			expect(registry.getRaisedHands('r1')).toEqual({});

			registry.setRaisedHand('r1', 'p1', '2026-01-01T00:00:00.000Z');
			registry.setRaisedHand('r1', 'p2', '2026-01-01T00:00:01.000Z');

			expect(registry.hasRaisedHand('r1', 'p1')).toBe(true);
			expect(registry.hasRaisedHand('r1', 'p2')).toBe(true);
			expect(registry.hasRaisedHand('r1', 'p3')).toBe(false);
			expect(registry.getRaisedHands('r1')).toEqual({
				p1: '2026-01-01T00:00:00.000Z',
				p2: '2026-01-01T00:00:01.000Z',
			});

			registry.clearRaisedHand('r1', 'p1');
			expect(registry.hasRaisedHand('r1', 'p1')).toBe(false);
			expect(registry.getRaisedHands('r1')).toEqual({
				p2: '2026-01-01T00:00:01.000Z',
			});

			registry.clearRaisedHand('r1', 'does-not-exist');
			expect(registry.getRaisedHands('r1')).toEqual({
				p2: '2026-01-01T00:00:01.000Z',
			});
		});
	});

	describe('host-only chat', () => {
		it('toggles the flag and isHostOnlyChat reads it back', () => {
			const { io } = makeIo();
			const registry = new RoomRegistry(io);

			expect(registry.isHostOnlyChat('r1')).toBe(false);
			registry.setHostOnlyChat('r1', true);
			expect(registry.isHostOnlyChat('r1')).toBe(true);
			registry.setHostOnlyChat('r1', false);
			expect(registry.isHostOnlyChat('r1')).toBe(false);
		});
	});

	describe('scope-based emit', () => {
		it('emitToFullAccessParticipants only reaches full sockets, not preview sockets', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			addFullSocket(setup, 'r1', full);
			addPreviewSocket(setup, 'r1', preview);

			registry.emitToFullAccessParticipants('r1', 'hello', { x: 1 });

			expect((full as unknown as { _emitCalls: unknown[] })._emitCalls).toEqual(
				[{ event: 'hello', data: { x: 1 } }],
			);
			expect(
				(preview as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([]);
		});

		it('emitToPreviewParticipants only reaches preview sockets, not full sockets', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			addFullSocket(setup, 'r1', full);
			addPreviewSocket(setup, 'r1', preview);

			registry.emitToPreviewParticipants('r1', 'hi', { y: 2 });

			expect(
				(preview as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([{ event: 'hi', data: { y: 2 } }]);
			expect((full as unknown as { _emitCalls: unknown[] })._emitCalls).toEqual(
				[],
			);
		});

		it('emitToScope is a no-op when the room has no sockets', () => {
			const { io } = makeIo();
			const registry = new RoomRegistry(io);
			expect(() =>
				registry.emitToFullAccessParticipants('nope', 'x', { ok: true }),
			).not.toThrow();
		});
	});

	describe('isEmpty', () => {
		it('reflects socket.io room membership for both scopes', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);

			expect(registry.isEmpty('r1')).toBe(true);

			const full = makeSocket('full-1');
			addFullSocket(setup, 'r1', full);
			expect(registry.isEmpty('r1')).toBe(false);

			setup.rooms.get('r1:full')?.delete(full.id);
			expect(registry.isEmpty('r1')).toBe(true);

			const preview = makeSocket('preview-1');
			addPreviewSocket(setup, 'r1', preview);
			expect(registry.isEmpty('r1')).toBe(false);
		});
	});

	describe('emitParticipantEvent', () => {
		const userData: UserData = {
			name: 'Alice',
			userId: 'u-1',
			avatar: 'a.png',
			is_guest: false,
		};

		it('participant_joined sends full userData to full sockets and a stripped payload to preview sockets', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			addFullSocket(setup, 'r1', full);
			addPreviewSocket(setup, 'r1', preview);

			registry.emitParticipantEvent(
				'r1',
				'participant_joined',
				'u-1',
				userData,
			);

			expect((full as unknown as { _emitCalls: unknown[] })._emitCalls).toEqual(
				[
					{
						event: 'participant_joined',
						data: { roomId: 'r1', participantId: 'u-1', userData },
					},
				],
			);
			expect(
				(preview as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([
				{
					event: 'participant_joined',
					data: {
						roomId: 'r1',
						participantId: 'u-1',
						userData: { name: 'Alice', avatar: 'a.png' },
					},
				},
			]);
		});

		it('participant_joined for a preview-* id only emits to full sockets (preview sockets get nothing)', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			addFullSocket(setup, 'r1', full);
			addPreviewSocket(setup, 'r1', preview);

			registry.emitParticipantEvent(
				'r1',
				'participant_joined',
				'preview-1',
				userData,
			);

			expect(
				(full as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toHaveLength(1);
			expect(
				(preview as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([]);
		});

		it('participant_left broadcasts to both full and preview sockets for a real participant', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			addFullSocket(setup, 'r1', full);
			addPreviewSocket(setup, 'r1', preview);

			registry.emitParticipantEvent('r1', 'participant_left', 'u-1');

			expect((full as unknown as { _emitCalls: unknown[] })._emitCalls).toEqual(
				[
					{
						event: 'participant_left',
						data: { roomId: 'r1', participantId: 'u-1' },
					},
				],
			);
			expect(
				(preview as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([
				{
					event: 'participant_left',
					data: { roomId: 'r1', participantId: 'u-1' },
				},
			]);
		});

		it('participant_left for a preview-* id only reaches full sockets', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);

			const full = makeSocket('full-1');
			const preview = makeSocket('preview-1');
			addFullSocket(setup, 'r1', full);
			addPreviewSocket(setup, 'r1', preview);

			registry.emitParticipantEvent('r1', 'participant_left', 'preview-1');

			expect(
				(full as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toHaveLength(1);
			expect(
				(preview as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([]);
		});
	});

	describe('cleanupRoom', () => {
		it('clears raised hands and host-only chat flag for the room', () => {
			const { io } = makeIo();
			const registry = new RoomRegistry(io);

			registry.setRaisedHand('r1', 'u-1', 'ts');
			registry.setHostOnlyChat('r1', true);

			registry.cleanupRoom('r1');

			expect(registry.getRaisedHands('r1')).toEqual({});
			expect(registry.isHostOnlyChat('r1')).toBe(false);
		});
	});
});
