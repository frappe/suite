import type { Server, Socket } from 'socket.io';
import { describe, expect, it } from 'vitest';
import type { UserData } from '../../types';
import { RoomRegistry } from '../RoomRegistry';

interface EmissionFixture {
	event: string;
	data: {
		roomId?: string;
		participantId?: string;
		producerId?: string;
		isScreen?: boolean;
		shareData?: { producerId: string };
	};
}

function makeSocket(id: string): Socket {
	const emitCalls: { event: string; data: unknown }[] = [];
	const sock = {
		id,
		emit(event: string, data?: unknown) {
			emitCalls.push({ event, data });
			return true;
		},
		_emitCalls: emitCalls,
		join() {},
		leave() {},
		disconnect() {},
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

function addRecorderSocket(
	setup: ReturnType<typeof makeIo>,
	roomId: string,
	sock: Socket,
) {
	setup.sockets.set(sock.id, sock);
	setup.joinRoom(sock.id, `${roomId}:recorders`);
}

describe('RoomRegistry', () => {
	it('acquires the first participant connection', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const first = makeSocket('first');

		const result = registry.acquireParticipant(first, 'r1', 'p1', 'device-1');

		expect(result).toMatchObject({ status: 'acquired' });
		expect(first.participantConnectionId).toBe('device-1');
		expect(first.participantOwnershipId).toBe(
			result.status === 'conflict' ? undefined : result.ownershipId,
		);
		expect(registry.hasHumanParticipants('r1')).toBe(true);
		expect(registry.getParticipantSocketIds('r1', 'p1')).toEqual(['first']);
	});

	it('is idempotent for the same socket and connection ID', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const socket = makeSocket('first');
		const first = registry.acquireParticipant(socket, 'r1', 'p1', 'device-1');
		const repeated = registry.acquireParticipant(
			socket,
			'r1',
			'p1',
			'device-1',
		);

		expect(repeated).toEqual({
			status: 'idempotent',
			ownershipId: first.status === 'conflict' ? '' : first.ownershipId,
		});
	});

	it('reconnects a stable connection ID on a new socket', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const oldSocket = makeSocket('old');
		const replacement = makeSocket('replacement');
		const old = registry.acquireParticipant(oldSocket, 'r1', 'p1', 'device-1');
		const result = registry.acquireParticipant(
			replacement,
			'r1',
			'p1',
			'device-1',
		);

		expect(result).toMatchObject({
			status: 'reconnect',
			replacedSocket: oldSocket,
		});
		expect(result.status === 'conflict' ? '' : result.ownershipId).not.toBe(
			old.status === 'conflict' ? '' : old.ownershipId,
		);
		expect(registry.getParticipantSocketIds('r1', 'p1')).toEqual([
			'replacement',
		]);
	});

	it('returns a conflict for another connection without mutating ownership', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const incumbent = makeSocket('incumbent');
		const challenger = makeSocket('challenger');
		const first = registry.acquireParticipant(
			incumbent,
			'r1',
			'p1',
			'device-1',
		);
		const result = registry.acquireParticipant(
			challenger,
			'r1',
			'p1',
			'device-2',
		);

		expect(result).toEqual({
			status: 'conflict',
			conflictId: first.status === 'conflict' ? '' : first.ownershipId,
		});
		expect(challenger.participantOwnershipId).toBeUndefined();
		expect(registry.getParticipantSocketIds('r1', 'p1')).toEqual(['incumbent']);
	});

	it('takes over with the current conflict ID', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const incumbent = makeSocket('incumbent');
		const challenger = makeSocket('challenger');
		registry.acquireParticipant(incumbent, 'r1', 'p1', 'device-1');
		const conflict = registry.acquireParticipant(
			challenger,
			'r1',
			'p1',
			'device-2',
		);
		const result = registry.acquireParticipant(
			challenger,
			'r1',
			'p1',
			'device-2',
			conflict.status === 'conflict' ? conflict.conflictId : '',
		);

		expect(result).toMatchObject({
			status: 'takeover',
			replacedSocket: incumbent,
		});
		expect(registry.getParticipantSocketIds('r1', 'p1')).toEqual([
			'challenger',
		]);
	});

	it('rejects a stale conflict ID after another takeover', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const incumbent = makeSocket('incumbent');
		const firstChallenger = makeSocket('challenger-1');
		const secondChallenger = makeSocket('challenger-2');
		const initial = registry.acquireParticipant(
			incumbent,
			'r1',
			'p1',
			'device-1',
		);
		const staleConflictId =
			initial.status === 'conflict' ? '' : initial.ownershipId;
		registry.acquireParticipant(
			firstChallenger,
			'r1',
			'p1',
			'device-2',
			staleConflictId,
		);
		const result = registry.acquireParticipant(
			secondChallenger,
			'r1',
			'p1',
			'device-3',
			staleConflictId,
		);

		expect(result).toMatchObject({ status: 'conflict' });
		expect(result.status === 'conflict' && result.conflictId).not.toBe(
			staleConflictId,
		);
		expect(registry.getParticipantSocketIds('r1', 'p1')).toEqual([
			'challenger-1',
		]);
	});

	it('does not let an old ownership generation release its replacement', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const oldSocket = makeSocket('old');
		const replacement = makeSocket('replacement');
		registry.acquireParticipant(oldSocket, 'r1', 'p1', 'device-1');
		registry.acquireParticipant(replacement, 'r1', 'p1', 'device-1');

		expect(registry.releaseParticipant(oldSocket, 'r1', 'p1')).toBe(false);
		expect(registry.hasHumanParticipants('r1')).toBe(true);
	});

	it('releases the current ownership generation', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const socket = makeSocket('current');
		registry.acquireParticipant(socket, 'r1', 'p1', 'device-1');

		expect(registry.releaseParticipant(socket, 'r1', 'p1')).toBe(true);
		expect(registry.hasHumanParticipants('r1')).toBe(false);
	});

	it('blocks a room-scoped banned participant until room cleanup', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);

		registry.revokeParticipant('r1', 'guest_1');
		expect(registry.isParticipantRevoked('r1', 'guest_1')).toBe(true);
		expect(registry.isParticipantRevoked('r2', 'guest_1')).toBe(false);

		registry.cleanupRoom('r1');
		expect(registry.isParticipantRevoked('r1', 'guest_1')).toBe(false);
	});

	it('does not revoke a removed participant', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);

		expect(registry.isParticipantRevoked('r1', 'guest_1')).toBe(false);
	});

	it('assigns independent E2EE sender IDs to participant connections', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);

		const first = registry.assignSenderId('r1', 'peer-1');
		const second = registry.assignSenderId('r1', 'peer-2');

		expect(first).not.toBe(second);
		expect(registry.assignSenderId('r1', 'peer-1')).toBe(first);
		registry.removeSender('r1', 'peer-1');
		expect(registry.getParticipantToSender().get('r1')?.get('peer-2')).toBe(
			second,
		);
	});

	it('does not count preview or recorder sockets as humans', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);

		registry.joinScope(makeSocket('preview'), 'r1', 'presence-preview');
		registry.joinRecorder(makeSocket('recorder'), 'r1', 'recorder-1');

		expect(registry.hasHumanParticipants('r1')).toBe(false);
	});

	it('preserves replacement recorder ownership and only clears the active owner', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const oldSocket = makeSocket('old');
		const replacement = makeSocket('replacement');
		Object.assign(oldSocket, {
			recordingClaims: { recording_id: 'recording-1' },
		});
		Object.assign(replacement, {
			recordingClaims: { recording_id: 'recording-1' },
		});

		registry.activateRecorder(oldSocket, 'recording-1', 'job-1');
		registry.joinRecorder(oldSocket, 'r1', 'recorder:recording-1');
		registry.activateRecorder(replacement, 'recording-1', 'job-1');
		registry.joinRecorder(replacement, 'r1', 'recorder:recording-1');

		expect(
			registry.leaveRecorder(oldSocket, 'r1', 'recorder:recording-1'),
		).toBe(false);
		expect(registry.isRecorderPeer('r1', 'recorder:recording-1')).toBe(true);
		expect(
			registry.leaveRecorder(replacement, 'r1', 'recorder:recording-1'),
		).toBe(true);
		expect(registry.isRecorderPeer('r1', 'recorder:recording-1')).toBe(false);
	});

	it('releases proof-complete recorder ownership before room join', () => {
		const { io } = makeIo();
		const registry = new RoomRegistry(io);
		const disconnected = makeSocket('disconnected');
		const nextJob = makeSocket('next-job');
		Object.assign(disconnected, {
			recordingClaims: { recording_id: 'recording-1' },
		});
		Object.assign(nextJob, {
			recordingClaims: { recording_id: 'recording-1' },
		});

		registry.activateRecorder(disconnected, 'recording-1', 'job-1');
		registry.deactivateRecorder(disconnected);
		expect(() =>
			registry.activateRecorder(nextJob, 'recording-1', 'job-2'),
		).not.toThrow();
		registry.deactivateRecorder(disconnected);
		expect(() =>
			registry.activateRecorder(makeSocket('conflict'), 'recording-1', 'job-3'),
		).toThrow('already connected');
	});

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

		it('does not send generic or full-access events to recorders', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);
			const recorder = makeSocket('recorder-1');
			addRecorderSocket(setup, 'r1', recorder);

			registry.emitToFullAccessParticipants('r1', 'host_control_update', {
				private: true,
			});

			expect(
				(recorder as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([]);
		});

		it('sends explicitly allowlisted shared-stage events to recorders', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);
			const recorder = makeSocket('recorder-1');
			addRecorderSocket(setup, 'r1', recorder);

			registry.emitActiveSpeaker('r1', ['p1']);
			registry.emitProducerCreated('r1', {
				participantId: 'p1',
				producerId: 'producer-1',
				kind: 'video',
				paused: false,
				isScreen: false,
			});
			registry.emitProducerClosed('r1', {
				participantId: 'p1',
				producerId: 'producer-1',
				isScreen: false,
				reason: 'private diagnostic',
				details: { message: 'private diagnostic' },
			});
			registry.emitScreenShare('r1', 'screen_share_started', {
				participantId: 'p1',
				shareData: { producerId: 'screen-1', details: { private: true } },
				timestamp: 'ts',
			});
			registry.emitScreenShare('r1', 'screen_share_stopped', {
				participantId: 'p1',
				producerId: 'screen-1',
				timestamp: 'ts',
			});
			registry.emitReaction('r1', {
				roomId: 'r1',
				reaction: 'wave',
				fromUser: 'p1',
				fromName: 'Alice',
				timestamp: 'ts',
			});
			registry.emitRaisedHand('r1', {
				participantId: 'p1',
				raised: true,
				timestamp: 'ts',
			});
			registry.emitPublicChat('r1', {
				roomId: 'r1',
				message: 'hello',
				fromUser: 'p1',
				fromName: 'Alice',
				timestamp: 'ts',
				clientId: 'private-correlation-id',
			});
			registry.emitMediaControlUpdate('r1', {
				participantId: 'p1',
				action: 'mute',
				timestamp: 'ts',
			});

			expect(
				(
					recorder as unknown as { _emitCalls: { event: string }[] }
				)._emitCalls.map((call) => call.event),
			).toEqual([
				'active_speaker',
				'producer_created',
				'producer_closed',
				'screen_share_started',
				'screen_share_stopped',
				'reaction:message',
				'hand_raised',
				'chat:message',
				'media_control_update',
			]);
			const calls = (
				recorder as unknown as {
					_emitCalls: EmissionFixture[];
				}
			)._emitCalls;
			expect(
				calls.find((call) => call.event === 'producer_closed')?.data,
			).toEqual({
				roomId: 'r1',
				participantId: 'p1',
				producerId: 'producer-1',
				isScreen: false,
			});
			expect(
				calls.find((call) => call.event === 'chat:message')?.data,
			).not.toHaveProperty('clientId');
			expect(
				calls.find((call) => call.event === 'screen_share_started')?.data,
			).toEqual({
				participantId: 'p1',
				shareData: { producerId: 'screen-1' },
				timestamp: 'ts',
			});
			expect(
				calls.find((call) => call.event === 'screen_share_stopped')?.data,
			).toEqual({
				participantId: 'p1',
				producerId: 'screen-1',
				timestamp: 'ts',
			});
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
			audio_enabled: true,
			video_enabled: true,
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

		it('participant events reach recorders without account or guest state', () => {
			const setup = makeIo();
			const registry = new RoomRegistry(setup.io);
			const recorder = makeSocket('recorder-1');
			addRecorderSocket(setup, 'r1', recorder);

			registry.emitParticipantEvent('r1', 'participant_joined', 'p1', userData);
			registry.emitParticipantEvent('r1', 'participant_left', 'p1');

			expect(
				(recorder as unknown as { _emitCalls: unknown[] })._emitCalls,
			).toEqual([
				{
					event: 'participant_joined',
					data: {
						roomId: 'r1',
						participantId: 'p1',
						userData: {
							name: 'Alice',
							avatar: 'a.png',
							audio_enabled: true,
							video_enabled: true,
						},
					},
				},
				{
					event: 'participant_left',
					data: { roomId: 'r1', participantId: 'p1' },
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
