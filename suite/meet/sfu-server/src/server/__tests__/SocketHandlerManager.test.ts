import { describe, expect, it, vi } from 'vitest';
import {
	createManager,
	createMockSocket,
	type MockSocket,
	type TypedSocket,
} from './test-helpers';

function connectFullSocket(
	harness: ReturnType<typeof createManager>,
	overrides: Partial<MockSocket> = {},
): MockSocket {
	const socket = harness.createSocket(overrides);
	harness.connect(socket);
	return socket;
}

function emitJoin(
	socket: MockSocket,
	opts: {
		roomId?: string;
		name?: string;
		userId?: string;
		avatar?: string;
		isGuest?: boolean;
		audioEnabled?: boolean;
		videoEnabled?: boolean;
	} = {},
): void {
	socket.fire(
		'join_room',
		{
			roomId: opts.roomId ?? 'room-1',
			userData: {
				name: opts.name ?? 'Alice',
				userId: opts.userId ?? 'user-1',
				avatar: opts.avatar ?? '',
				is_guest: opts.isGuest ?? false,
			},
			mediaState: {
				audio_enabled: opts.audioEnabled ?? true,
				video_enabled: opts.videoEnabled ?? true,
			},
		},
		() => {},
	);
}

describe('SocketHandlerManager characterization', () => {
	it('middleware rejects sockets when authentication fails', () => {
		const harness = createManager();
		const socket = createMockSocket();
		const next = vi.fn();

		harness.authManager.authenticateSocket.mockReturnValue(false);
		harness.io.middlewareFn?.(socket, next);

		expect(next).toHaveBeenCalledWith(expect.any(Error));
		expect(next.mock.calls[0]?.[0].message).toBe('Authentication failed');
	});

	it('middleware proceeds without an error when authentication succeeds', () => {
		const harness = createManager();
		const socket = createMockSocket();
		const next = vi.fn();

		harness.authManager.authenticateSocket.mockReturnValue(true);
		harness.io.middlewareFn?.(socket, next);

		expect(next).toHaveBeenCalledWith();
	});

	it('join_room with scope:full adds the socket to fullAccessSockets, calls mediasoup.createRoom + addPeer, and emits existing_raised_hands to the joiner', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, { id: 'sock-A' });

		emitJoin(socket);

		await new Promise((r) => setImmediate(r));

		expect(harness.mediasoup.createRoom).toHaveBeenCalledTimes(1);
		expect(harness.mediasoup.createRoom).toHaveBeenCalledWith(
			'room-1',
			expect.any(Function),
		);
		expect(harness.mediasoup.addPeer).toHaveBeenCalledWith(
			'room-1',
			'user-1',
			expect.objectContaining({
				userId: 'user-1',
				name: 'Alice',
				audio_enabled: true,
				video_enabled: true,
			}),
		);
		expect(socket.joinCalls).toContain('room-1');

		const existingHands = socket.emitCalls.find(
			(c) => c.event === 'existing_raised_hands',
		);
		expect(existingHands).toBeDefined();
		expect(existingHands?.data).toEqual({ hands: {} });

		const participantJoined = socket.emitCalls.find(
			(c) => c.event === 'participant_joined',
		);
		expect(participantJoined).toBeDefined();
		expect(participantJoined?.data).toEqual(
			expect.objectContaining({
				roomId: 'room-1',
				participantId: 'user-1',
				userData: expect.objectContaining({ userId: 'user-1', name: 'Alice' }),
			}),
		);
	});

	it('join_room with scope:presence-preview tracks the socket in previewSockets, skips mediasoup.addPeer, and still emits existing_raised_hands', async () => {
		const harness = createManager();
		const socket = createMockSocket({
			scope: 'presence-preview',
			userId: 'preview-1',
			userName: 'Watcher',
			meetingId: 'room-1',
			id: 'sock-P',
		});
		harness.connect(socket);

		emitJoin(socket, { name: 'Watcher', userId: 'preview-1' });

		await new Promise((r) => setImmediate(r));

		expect(harness.mediasoup.createRoom).toHaveBeenCalledTimes(1);
		expect(harness.mediasoup.addPeer).not.toHaveBeenCalled();
		expect(socket.joinCalls).toContain('room-1');
		expect(
			socket.emitCalls.some((c) => c.event === 'existing_raised_hands'),
		).toBe(true);
		expect(socket.emitCalls.some((c) => c.event === 'participant_joined')).toBe(
			false,
		);
	});

	it('join_room returns an authentication error when socket identity fields are missing', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			userId: undefined,
			meetingId: undefined,
		});
		const callback = vi.fn();

		socket.fire(
			'join_room',
			{
				roomId: 'room-1',
				userData: {
					name: 'Alice',
					userId: 'user-1',
					avatar: '',
					is_guest: false,
				},
				mediaState: {
					audio_enabled: true,
					video_enabled: true,
				},
			},
			callback,
		);
		await new Promise((r) => setImmediate(r));

		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'Authentication required',
		});
		expect(harness.mediasoup.createRoom).not.toHaveBeenCalled();
	});

	it('disconnect of a full-access socket removes the peer, broadcasts participant_left, and closes the room when the last full-access socket leaves', async () => {
		const harness = createManager();

		const stay = connectFullSocket(harness, {
			id: 'sock-stay',
			userId: 'stay-1',
		});
		emitJoin(stay, { userId: 'stay-1', name: 'Stay' });
		await new Promise((r) => setImmediate(r));

		const socket = connectFullSocket(harness, {
			id: 'sock-X',
			userId: 'user-1',
		});
		emitJoin(socket);
		await new Promise((r) => setImmediate(r));
		expect(harness.mediasoup.addPeer).toHaveBeenCalled();

		(harness.mediasoup.addPeer as ReturnType<typeof vi.fn>).mockClear();
		(harness.mediasoup.removePeer as ReturnType<typeof vi.fn>).mockClear();
		(harness.mediasoup.closeRoom as ReturnType<typeof vi.fn>).mockClear();
		socket.emitCalls.length = 0;
		stay.emitCalls.length = 0;

		socket.fire('disconnect');
		await new Promise((r) => setImmediate(r));

		expect(harness.mediasoup.removePeer).toHaveBeenCalledWith(
			'room-1',
			'user-1',
		);
		expect(stay.emitCalls.some((c) => c.event === 'participant_left')).toBe(
			true,
		);
		expect(harness.mediasoup.closeRoom).not.toHaveBeenCalled();

		stay.fire('disconnect');
		await new Promise((r) => setImmediate(r));

		expect(harness.mediasoup.removePeer).toHaveBeenCalledWith(
			'room-1',
			'stay-1',
		);
		expect(harness.mediasoup.closeRoom).toHaveBeenCalledWith('room-1');
	});

	it('disconnect of an older duplicate full-access socket does not remove the current peer', async () => {
		const harness = createManager();

		const older = connectFullSocket(harness, {
			id: 'sock-old',
			userId: 'user-1',
		});
		emitJoin(older);
		await new Promise((r) => setImmediate(r));

		const current = connectFullSocket(harness, {
			id: 'sock-current',
			userId: 'user-1',
		});
		emitJoin(current);
		await new Promise((r) => setImmediate(r));

		(harness.mediasoup.removePeer as ReturnType<typeof vi.fn>).mockClear();
		older.fire('disconnect');
		await new Promise((r) => setImmediate(r));

		expect(harness.mediasoup.removePeer).not.toHaveBeenCalled();

		current.fire('disconnect');
		await new Promise((r) => setImmediate(r));

		expect(harness.mediasoup.removePeer).toHaveBeenCalledWith(
			'room-1',
			'user-1',
		);
	});

	it('leave_room from an older duplicate socket still closes an empty room', async () => {
		const harness = createManager();

		const older = connectFullSocket(harness, {
			id: 'sock-old',
			userId: 'user-1',
		});
		emitJoin(older);
		await new Promise((r) => setImmediate(r));

		const current = connectFullSocket(harness, {
			id: 'sock-current',
			userId: 'user-1',
		});
		emitJoin(current);
		await new Promise((r) => setImmediate(r));

		current.leave('room-1:full');
		(harness.mediasoup.removePeer as ReturnType<typeof vi.fn>).mockClear();
		(harness.mediasoup.closeRoom as ReturnType<typeof vi.fn>).mockClear();

		older.fire('leave_room');
		await new Promise((r) => setImmediate(r));

		expect(harness.mediasoup.removePeer).not.toHaveBeenCalled();
		expect(harness.mediasoup.closeRoom).toHaveBeenCalledWith('room-1');
	});

	it('host_control with mute_participant sends host_control_update to the target; non-host gets sfu_error and target gets nothing', async () => {
		const harness = createManager();

		const host = connectFullSocket(harness, {
			id: 'sock-host',
			userId: 'host-1',
			userName: 'Host',
			isHost: true,
			isCohost: false,
		});
		emitJoin(host, { userId: 'host-1', name: 'Host' });
		await new Promise((r) => setImmediate(r));

		const target = connectFullSocket(harness, {
			id: 'sock-target',
			userId: 'target-1',
			userName: 'Target',
			isHost: false,
			isCohost: false,
		});
		emitJoin(target, { userId: 'target-1', name: 'Target' });
		await new Promise((r) => setImmediate(r));

		harness.io.socketsAdapterRooms.set('room-1', new Set([host.id, target.id]));

		target.emitCalls.length = 0;
		host.emitCalls.length = 0;

		host.fire('host_control', {
			action: 'mute_participant',
			targetParticipantId: 'target-1',
		});

		const targetUpdate = target.emitCalls.find(
			(c) => c.event === 'host_control_update',
		);
		expect(targetUpdate).toBeDefined();
		expect(targetUpdate?.data).toEqual(
			expect.objectContaining({
				action: 'mute_participant',
				targetParticipantId: 'target-1',
				hostId: 'host-1',
			}),
		);
		expect(host.emitCalls.some((c) => c.event === 'sfu_error')).toBe(false);

		const nonHost = connectFullSocket(harness, {
			id: 'sock-nonhost',
			userId: 'rando-1',
			userName: 'Rando',
			isHost: false,
			isCohost: false,
		});
		emitJoin(nonHost, { userId: 'rando-1', name: 'Rando' });
		await new Promise((r) => setImmediate(r));

		const anotherTarget = connectFullSocket(harness, {
			id: 'sock-target-2',
			userId: 'target-2',
			userName: 'Target2',
			isHost: false,
			isCohost: false,
		});
		emitJoin(anotherTarget, { userId: 'target-2', name: 'Target2' });
		await new Promise((r) => setImmediate(r));

		nonHost.emitCalls.length = 0;
		anotherTarget.emitCalls.length = 0;

		nonHost.fire('host_control', {
			action: 'mute_participant',
			targetParticipantId: 'target-2',
		});

		const nonHostErr = nonHost.emitCalls.find((c) => c.event === 'sfu_error');
		expect(nonHostErr).toBeDefined();
		expect(nonHostErr?.data).toEqual(
			expect.objectContaining({
				error: 'Only host or co-host can control participants',
			}),
		);
		expect(
			anotherTarget.emitCalls.some((c) => c.event === 'host_control_update'),
		).toBe(false);
	});

	it('create_producer broadcasts screen producers to existing full-access participants', async () => {
		const harness = createManager();

		const sharer = connectFullSocket(harness, {
			id: 'sock-sharer',
			userId: 'sharer-1',
		});
		emitJoin(sharer, { userId: 'sharer-1', name: 'Sharer' });
		await new Promise((r) => setImmediate(r));

		const viewer = connectFullSocket(harness, {
			id: 'sock-viewer',
			userId: 'viewer-1',
		});
		emitJoin(viewer, { userId: 'viewer-1', name: 'Viewer' });
		await new Promise((r) => setImmediate(r));

		viewer.emitCalls.length = 0;
		const callback = vi.fn();

		sharer.fire(
			'create_producer',
			{
				transportId: 'transport-1',
				rtpParameters: {},
				kind: 'video',
				appData: { type: 'screen' },
			},
			callback,
		);
		await new Promise((r) => setImmediate(r));

		expect(callback).toHaveBeenCalledWith(
			expect.objectContaining({ success: true, isScreen: true }),
		);
		expect(viewer.emitCalls).toContainEqual({
			event: 'producer_created',
			data: expect.objectContaining({
				participantId: 'sharer-1',
				producerId: 'producer-1',
				kind: 'video',
				isScreen: true,
			}),
		});
	});

	it('chat:send broadcasts to other full-access participants in the same room and not back to the sender', async () => {
		const harness = createManager();

		const sender = connectFullSocket(harness, {
			id: 'sock-sender',
			userId: 'sender-1',
			userName: 'Sender',
		});
		emitJoin(sender, { userId: 'sender-1', name: 'Sender' });
		await new Promise((r) => setImmediate(r));

		const receiver = connectFullSocket(harness, {
			id: 'sock-receiver',
			userId: 'receiver-1',
			userName: 'Receiver',
		});
		emitJoin(receiver, { userId: 'receiver-1', name: 'Receiver' });
		await new Promise((r) => setImmediate(r));

		sender.emitCalls.length = 0;
		receiver.emitCalls.length = 0;

		sender.fire('chat:send', { message: 'hello world' });

		const receiverMsg = receiver.emitCalls.find(
			(c) => c.event === 'chat:message',
		);
		expect(receiverMsg).toBeDefined();
		expect(receiverMsg?.data).toEqual(
			expect.objectContaining({
				roomId: 'room-1',
				message: 'hello world',
				fromUser: 'sender-1',
				fromName: 'Sender',
				timestamp: expect.any(String),
			}),
		);

		const senderChatMessages = sender.emitCalls.filter(
			(c) => c.event === 'chat:message',
		);
		expect(senderChatMessages.length).toBe(1);
		expect(senderChatMessages[0]?.data).toEqual(
			expect.objectContaining({
				fromUser: 'sender-1',
				message: 'hello world',
			}),
		);
	});

	it('chat:send with hostOnlyChat enabled and a non-host sender returns sfu_error HOST_ONLY_CHAT and broadcasts no chat:message', async () => {
		const harness = createManager();

		const host = connectFullSocket(harness, {
			id: 'sock-host-chat',
			userId: 'host-chat-1',
			userName: 'HostChat',
			isHost: true,
			isCohost: false,
		});
		emitJoin(host, { userId: 'host-chat-1', name: 'HostChat' });
		await new Promise((r) => setImmediate(r));

		host.fire('chat:toggle_restriction', { enabled: true });
		expect(
			host.emitCalls.some((c) => c.event === 'chat:restriction_updated'),
		).toBe(true);

		const nonHost = connectFullSocket(harness, {
			id: 'sock-nonhost',
			userId: 'non-host-1',
			userName: 'NonHost',
			isHost: false,
			isCohost: false,
		});
		emitJoin(nonHost, { userId: 'non-host-1', name: 'NonHost' });
		await new Promise((r) => setImmediate(r));

		nonHost.emitCalls.length = 0;
		host.emitCalls.length = 0;
		nonHost.fire('chat:send', { message: 'should be blocked' });

		const err = nonHost.emitCalls.find((c) => c.event === 'sfu_error');
		expect(err).toBeDefined();
		expect(err?.data).toEqual(
			expect.objectContaining({
				error: 'Only hosts and co-hosts can send messages right now.',
				code: 'HOST_ONLY_CHAT',
			}),
		);
		expect(host.emitCalls.some((c) => c.event === 'chat:message')).toBe(false);
		expect(nonHost.emitCalls.some((c) => c.event === 'chat:message')).toBe(
			false,
		);
	});

	it('raise_hand round-trip: raised:true stores timestamp and broadcasts, raised:false clears the entry and broadcasts with raised:false', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'sock-rh',
			userId: 'rh-1',
		});
		emitJoin(socket, { userId: 'rh-1' });
		await new Promise((r) => setImmediate(r));
		socket.emitCalls.length = 0;

		socket.fire('raise_hand', { raised: true }, () => {});

		const raised = socket.emitCalls.find((c) => c.event === 'hand_raised');
		expect(raised).toBeDefined();
		expect(raised?.data).toEqual(
			expect.objectContaining({ participantId: 'rh-1', raised: true }),
		);

		socket.emitCalls.length = 0;
		socket.fire('raise_hand', { raised: false }, () => {});

		const lowered = socket.emitCalls.find((c) => c.event === 'hand_raised');
		expect(lowered).toBeDefined();
		expect(lowered?.data).toEqual(
			expect.objectContaining({ participantId: 'rh-1', raised: false }),
		);
	});

	describe('idle expiry sweep', () => {
		it('disconnects sockets whose token has expired, leaves non-expired ones alone', () => {
			const harness = createManager();
			const expired = connectFullSocket(harness, { id: 'sock-exp' });
			const fresh = connectFullSocket(harness, { id: 'sock-fresh' });

			const expiredSocket = expired as unknown as { tokenExpiresAt: number };
			const freshSocket = fresh as unknown as { tokenExpiresAt: number };
			expiredSocket.tokenExpiresAt = Date.now() - 1000;
			freshSocket.tokenExpiresAt = Date.now() + 60_000;

			harness.manager['sweepExpiredSockets']();

			expect(harness.authManager.triggerTokenExpiry).toHaveBeenCalledWith(
				expired,
				'idle_sweep',
			);
			expect(harness.authManager.triggerTokenExpiry).not.toHaveBeenCalledWith(
				fresh,
				expect.anything(),
			);
		});
	});
});
