import { describe, expect, it, vi } from 'vitest';
import {
	createManager,
	createMockSocket,
	type MockSocket,
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
		e2ee?: { enabled?: boolean; capability?: { supported?: boolean } };
	} = {},
	callback: (result: unknown) => void = () => {},
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
			e2ee: opts.e2ee,
		},
		callback,
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

	it('allows plain transports only when runtime configuration enables them', async () => {
		const productionHarness = createManager();
		const productionSocket = connectFullSocket(productionHarness);
		const productionCallback = vi.fn();
		productionSocket.fire('create_plain_transport', {}, productionCallback);
		await new Promise((resolve) => setImmediate(resolve));

		expect(productionCallback).toHaveBeenCalledWith({
			success: false,
			error: 'PlainTransport creation is not allowed in this environment',
		});

		const developmentHarness = createManager(undefined, {
			mode: 'development',
			allowPlainTransport: true,
			bypassRateLimits: true,
		});
		const developmentSocket = connectFullSocket(developmentHarness);
		const developmentCallback = vi.fn();
		developmentSocket.fire('create_plain_transport', {}, developmentCallback);
		await new Promise((resolve) => setImmediate(resolve));

		expect(developmentCallback).toHaveBeenCalledWith({
			success: true,
			id: 'plain-1',
		});
	});

	it('denies producer and token-refresh handlers to recording scope', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			scope: 'recording',
			recordingProofComplete: true,
		});
		const denied = new Error('Insufficient scope for full access');
		harness.authManager.ensureFullAccess.mockImplementation(() => {
			throw denied;
		});
		const producerCallback = vi.fn();
		const refreshCallback = vi.fn();

		socket.fire(
			'create_producer',
			{ kind: 'video', rtpParameters: {}, transportId: 'recv-1' },
			producerCallback,
		);
		socket.fire('auth:update_token', { token: 'replacement' }, refreshCallback);
		await new Promise((resolve) => setImmediate(resolve));

		expect(producerCallback).toHaveBeenCalledWith({
			success: false,
			error: denied.message,
		});
		expect(refreshCallback).toHaveBeenCalledWith({
			success: false,
			error: 'Token refresh is unavailable for recording',
		});
		expect(harness.mediasoup.createProducer).not.toHaveBeenCalled();
	});

	it('denies recording scope from all participant mutation surfaces', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			scope: 'recording',
			recordingProofComplete: true,
			roomId: 'room-1',
			participantId: 'recorder:recording-1',
			userId: 'recorder:recording-1',
		});
		const denied = new Error('Insufficient scope for full access');
		harness.authManager.ensureFullAccess.mockImplementation(() => {
			throw denied;
		});
		const callbackEvents: Array<[string, unknown]> = [
			['close_producer', { producerId: 'producer-1' }],
			['pause_producer', { producerId: 'producer-1' }],
			['resume_producer', { producerId: 'producer-1' }],
			['create_plain_transport', {}],
			['chat:send', { message: 'nope' }],
			['poll:create', { question: 'q', options: [{ text: 'a' }] }],
			['poll:vote', { pollId: 'poll-1', optionId: 'option-1' }],
			['poll:sync_encrypted', { pollId: 'p', question: 'q', options: [] }],
			['raise_hand', { raised: true }],
		];
		for (const [event, data] of callbackEvents) {
			const callback = vi.fn();
			socket.fire(event, data, callback);
			await new Promise((resolve) => setImmediate(resolve));
			expect(callback, event).toHaveBeenCalledWith({
				success: false,
				error: expect.any(String),
			});
		}

		for (const [event, data] of [
			['chat:toggle_restriction', { enabled: true }],
			['reaction:send', { reaction: 'wave' }],
			['media_control', { action: 'mute' }],
			['host_control', { action: 'mute_all' }],
			['screen_share', { action: 'start_share', shareData: {} }],
			['client_telemetry', { event: 'media_stall', media: 'video' }],
		] as Array<[string, unknown]>) {
			socket.fire(event, data);
		}
		await new Promise((resolve) => setImmediate(resolve));

		expect(harness.mediasoup.assertProducerAccess).not.toHaveBeenCalled();
		expect(harness.mediasoup.createPlainTransport).not.toHaveBeenCalled();
		expect(harness.mediasoup.applyMediaControl).not.toHaveBeenCalled();
		expect(socket.emitCalls).not.toContainEqual(
			expect.objectContaining({ event: 'e2ee:epoch' }),
		);
		vi.unstubAllEnvs();
	});

	it('denies recorder send transport while allowing the receive-only path', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			scope: 'recording',
			recordingProofComplete: true,
			userId: 'recorder:recording-1',
		});
		const sendCallback = vi.fn();
		const recvCallback = vi.fn();

		socket.fire('create_webrtc_transport', { direction: 'send' }, sendCallback);
		socket.fire('create_webrtc_transport', { direction: 'recv' }, recvCallback);
		await new Promise((resolve) => setImmediate(resolve));

		expect(sendCallback).toHaveBeenCalledWith({
			success: false,
			error: 'Recorder send transports are not permitted',
		});
		expect(recvCallback).toHaveBeenCalledWith(
			expect.objectContaining({ success: true }),
		);

		const connectCallback = vi.fn();
		const restartCallback = vi.fn();
		socket.fire(
			'connect_webrtc_transport',
			{ transportId: 'transport-1', dtlsParameters: {} },
			connectCallback,
		);
		socket.fire(
			'restart_webrtc_transport_ice',
			{ transportId: 'transport-1' },
			restartCallback,
		);
		await new Promise((resolve) => setImmediate(resolve));
		expect(connectCallback).toHaveBeenCalledWith({ success: true });
		expect(restartCallback).toHaveBeenCalledWith(
			expect.objectContaining({ success: true }),
		);
		expect(harness.mediasoup.connectWebRtcTransport).toHaveBeenCalledWith(
			'transport-1',
			{},
			'room-1',
			'recorder:recording-1',
			'recv',
		);
	});

	it('rejects recorder connect and restart for untracked transports', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			scope: 'recording',
			recordingProofComplete: true,
			userId: 'recorder:recording-1',
			roomId: 'room-1',
		});
		const connectCallback = vi.fn();
		const restartCallback = vi.fn();

		socket.fire(
			'connect_webrtc_transport',
			{ transportId: 'foreign', dtlsParameters: {} },
			connectCallback,
		);
		socket.fire(
			'restart_webrtc_transport_ice',
			{ transportId: 'foreign' },
			restartCallback,
		);
		await new Promise((resolve) => setImmediate(resolve));

		expect(connectCallback).toHaveBeenCalledWith({
			success: false,
			error: 'Recorder may connect only its receive transport',
		});
		expect(restartCallback).toHaveBeenCalledWith({
			success: false,
			error: 'Recorder may restart only its receive transport',
		});
		expect(harness.mediasoup.connectWebRtcTransport).not.toHaveBeenCalled();
		expect(harness.mediasoup.restartWebRtcTransportIce).not.toHaveBeenCalled();
	});

	it('leave_room fully removes recorder membership and media resources', async () => {
		vi.useFakeTimers();
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'recorder-socket',
			scope: 'recording',
			recordingProofComplete: true,
			userId: 'recorder:recording-1',
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		const joinCallback = vi.fn();
		socket.fire('recording:join', { roomId: 'room-1' }, joinCallback);
		await vi.advanceTimersByTimeAsync(0);

		socket.fire('leave_room');
		await vi.advanceTimersByTimeAsync(60_000);

		expect(joinCallback).toHaveBeenCalledWith({ success: true });
		expect(harness.mediasoup.removePeer).toHaveBeenCalledWith(
			'room-1',
			'recorder:recording-1',
		);
		expect(harness.io.socketsAdapterRooms.get('room-1')).not.toContain(
			socket.id,
		);
		expect(
			harness.io.socketsAdapterRooms.get('room-1:recorders'),
		).not.toContain(socket.id);
		expect(harness.mediasoup.closeRoom).toHaveBeenCalledWith('room-1');
		harness.manager.stop();
		vi.useRealTimers();
	});

	it('recording:join sends raised hands that predate the recorder', async () => {
		const harness = createManager();
		const participant = connectFullSocket(harness, {
			id: 'participant-socket',
			userId: 'participant-1',
		});
		emitJoin(participant, { userId: 'participant-1' });
		await new Promise((resolve) => setImmediate(resolve));
		participant.fire('raise_hand', { raised: true }, vi.fn());

		const recorder = connectFullSocket(harness, {
			id: 'recorder-socket',
			scope: 'recording',
			recordingProofComplete: true,
			userId: 'recorder:recording-1',
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		recorder.fire('recording:join', { roomId: 'room-1' }, vi.fn());
		await new Promise((resolve) => setImmediate(resolve));

		expect(recorder.emitCalls).toContainEqual({
			event: 'existing_raised_hands',
			data: { hands: { 'participant-1': expect.any(String) } },
		});
	});

	it('disconnects an unproved recorder after ten seconds and clears the timer on proof', async () => {
		vi.useFakeTimers();
		const grantManager = {
			createChallenge: vi.fn(() => ({ nonce: 'challenge' })),
			verifyProofAndConsume: vi.fn().mockResolvedValue(2_000_000_000),
		};
		const harness = createManager(grantManager as never);
		const unproved = harness.createSocket({
			id: 'unproved',
			scope: 'recording',
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		const unprovedDisconnect = vi.spyOn(unproved, 'disconnect');
		harness.connect(unproved);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(unprovedDisconnect).toHaveBeenCalledWith(true);

		const proved = harness.createSocket({
			id: 'proved',
			scope: 'recording',
			recordingClaims: {
				recording_id: 'recording-2',
				recorder_job_id: 'job-2',
			} as never,
		});
		const provedDisconnect = vi.spyOn(proved, 'disconnect');
		harness.connect(proved);
		proved.fire('recording:proof', { signature: 'valid' }, vi.fn());
		await vi.runAllTicks();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(provedDisconnect).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('disconnects an unproved recorder before any handler can observe room state', () => {
		const grantManager = {
			createChallenge: vi.fn(() => ({ nonce: 'challenge' })),
			verifyProofAndConsume: vi.fn(),
		};
		const harness = createManager(grantManager as never);
		const socket = connectFullSocket(harness, {
			scope: 'recording',
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		const disconnect = vi.spyOn(socket, 'disconnect');
		const next = vi.fn();

		socket.packetMiddleware?.(
			['get_router_rtp_capabilities', {}, vi.fn()],
			next,
		);

		expect(disconnect).toHaveBeenCalledWith(true);
		expect(next).not.toHaveBeenCalled();
		expect(harness.mediasoup.createRoom).not.toHaveBeenCalled();
	});

	it('releases a proved recorder that disconnects before joining', async () => {
		const grantManager = {
			createChallenge: vi.fn(() => ({ nonce: 'challenge' })),
			verifyProofAndConsume: vi.fn().mockResolvedValue(2_000_000_000),
		};
		const harness = createManager(grantManager as never);
		const first = connectFullSocket(harness, {
			id: 'first',
			scope: 'recording',
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		const firstProof = vi.fn();
		first.fire('recording:proof', { signature: 'valid' }, firstProof);
		await new Promise((resolve) => setImmediate(resolve));
		expect(firstProof).toHaveBeenCalledWith({ success: true });

		first.fire('disconnect', 'client namespace disconnect');
		await new Promise((resolve) => setImmediate(resolve));
		const replacement = connectFullSocket(harness, {
			id: 'replacement',
			scope: 'recording',
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-2',
			} as never,
		});
		const replacementProof = vi.fn();
		replacement.fire(
			'recording:proof',
			{ signature: 'valid' },
			replacementProof,
		);
		await new Promise((resolve) => setImmediate(resolve));

		expect(replacementProof).toHaveBeenCalledWith({ success: true });
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

		expect(harness.mediasoup.createRoom).not.toHaveBeenCalled();
		expect(harness.mediasoup.addPeer).not.toHaveBeenCalled();
		expect(socket.joinCalls).toContain('room-1');
		expect(
			socket.emitCalls.some((c) => c.event === 'existing_raised_hands'),
		).toBe(true);
		expect(socket.emitCalls.some((c) => c.event === 'participant_joined')).toBe(
			false,
		);
	});

	it('join_room does not add pending encrypted non-host joiners to the e2ee roster', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'sock-joiner',
			userId: 'joiner-1',
			e2eeRequired: true,
			isHost: false,
		});

		emitJoin(socket, {
			userId: 'joiner-1',
			e2ee: { enabled: true, capability: { supported: true } },
		});
		await new Promise((r) => setImmediate(r));

		expect(socket.senderId).toBeTypeOf('number');
		expect(await harness.roster.get('room-1', socket.senderId ?? -1)).toBe(
			undefined,
		);
	});

	it('join_room reports e2ee admission failures after the join callback succeeds', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'sock-failed-e2ee-admission',
			userId: 'failed-admission-member',
			e2eeRequired: true,
			isHost: false,
		});
		vi.spyOn(harness.roster, 'list').mockRejectedValueOnce(
			new Error('roster unavailable'),
		);

		const callback = vi.fn();
		socket.fire(
			'join_room',
			{
				roomId: 'room-1',
				userData: {
					name: 'Failed Admission',
					userId: 'failed-admission-member',
					avatar: '',
					is_guest: false,
				},
				mediaState: {
					audio_enabled: true,
					video_enabled: true,
				},
				e2ee: { enabled: true, capability: { supported: true } },
			},
			callback,
		);
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));

		expect(callback).toHaveBeenCalledWith({
			success: true,
			senderId: socket.senderId,
		});
		expect(socket.emitCalls).toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({
				type: 'join-status',
				status: 'failed',
				message:
					'Could not set up encryption for this meeting. Please leave and try again.',
			}),
		});
	});

	it('join_room tells a lone encrypted non-host to wait for the host', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'sock-returning-member',
			userId: 'returning-member',
			e2eeRequired: true,
			isHost: false,
		});

		emitJoin(socket, {
			userId: 'returning-member',
			e2ee: { enabled: true, capability: { supported: true } },
		});
		await new Promise((r) => setImmediate(r));

		expect(socket.emitCalls).toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({
				type: 'join-status',
				status: 'pending',
				reason: 'waiting-for-host',
				message:
					'This encrypted meeting needs the host to join before others can enter.',
			}),
		});
	});

	it('join_room asks a lone encrypted host to start encryption with genesis', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'sock-returning-host',
			userId: 'host-1',
			e2eeRequired: true,
			isHost: true,
		});

		emitJoin(socket, {
			userId: 'host-1',
			e2ee: { enabled: true, capability: { supported: true } },
		});
		await new Promise((r) => setImmediate(r));

		expect(socket.emitCalls).toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({
				type: 'genesis-request',
				epochNumber: 1,
				message: 'Starting encryption for this meeting.',
			}),
		});
	});

	it('join_room lets the host start encryption after a non-host is already waiting', async () => {
		const harness = createManager();
		const nonHost = connectFullSocket(harness, {
			id: 'sock-waiting-member',
			userId: 'waiting-member',
			e2eeRequired: true,
			isHost: false,
		});
		emitJoin(nonHost, {
			userId: 'waiting-member',
			e2ee: { enabled: true, capability: { supported: true } },
		});
		await new Promise((r) => setImmediate(r));

		nonHost.emitCalls.length = 0;
		const host = connectFullSocket(harness, {
			id: 'sock-returning-host-after-member',
			userId: 'host-1',
			e2eeRequired: true,
			isHost: true,
		});
		emitJoin(host, {
			userId: 'host-1',
			e2ee: { enabled: true, capability: { supported: true } },
		});
		await new Promise((r) => setImmediate(r));

		expect(host.emitCalls).toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({
				type: 'genesis-request',
				epochNumber: 1,
			}),
		});
		expect(host.emitCalls).not.toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({ type: 'key-package-request' }),
		});
		expect(nonHost.emitCalls).toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({
				type: 'key-package-request',
				epochNumber: 1,
				reason: 'join',
			}),
		});
	});

	it('join_room admits a returning encrypted host through the normal join flow when members are already admitted', async () => {
		const harness = createManager();
		await harness.roster.add('room-1', {
			participantId: 'member-1',
			senderId: 9,
			isHost: false,
			joinedAt: 1,
		});
		const host = connectFullSocket(harness, {
			id: 'sock-returning-host-with-members',
			userId: 'host-1',
			e2eeRequired: true,
			isHost: true,
		});

		emitJoin(host, {
			userId: 'host-1',
			e2ee: { enabled: true, capability: { supported: true } },
		});
		await new Promise((r) => setImmediate(r));

		expect(host.emitCalls).toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({
				type: 'key-package-request',
				epochNumber: 1,
				reason: 'join',
			}),
		});
		expect(host.emitCalls).not.toContainEqual({
			event: 'e2ee:epoch',
			data: expect.objectContaining({
				type: 'key-package-request',
				reason: 'enable',
			}),
		});
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

	it('cleans a human-empty room after a full join fails after claiming occupancy', async () => {
		vi.useFakeTimers();
		const harness = createManager();
		const socket = connectFullSocket(harness);
		const callback = vi.fn();
		vi.spyOn(harness.roster, 'add').mockRejectedValueOnce(
			new Error('roster unavailable'),
		);

		emitJoin(socket, {}, callback);
		await vi.advanceTimersByTimeAsync(0);

		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'roster unavailable',
		});
		expect(harness.mediasoup.closeRoom).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(60_000);
		expect(harness.mediasoup.closeRoom).toHaveBeenCalledWith('room-1');
		harness.manager.stop();
		vi.useRealTimers();
	});

	it('disconnect of a full-access socket removes the peer, broadcasts participant_left, and closes the room after grace when the last human leaves', async () => {
		vi.useFakeTimers();
		const harness = createManager();

		const stay = connectFullSocket(harness, {
			id: 'sock-stay',
			userId: 'stay-1',
		});
		emitJoin(stay, { userId: 'stay-1', name: 'Stay' });
		await vi.advanceTimersByTimeAsync(0);

		const socket = connectFullSocket(harness, {
			id: 'sock-X',
			userId: 'user-1',
		});
		emitJoin(socket);
		await vi.advanceTimersByTimeAsync(0);
		expect(harness.mediasoup.addPeer).toHaveBeenCalled();

		(harness.mediasoup.addPeer as ReturnType<typeof vi.fn>).mockClear();
		(harness.mediasoup.removePeer as ReturnType<typeof vi.fn>).mockClear();
		(harness.mediasoup.closeRoom as ReturnType<typeof vi.fn>).mockClear();
		socket.emitCalls.length = 0;
		stay.emitCalls.length = 0;

		socket.fire('disconnect');
		await vi.advanceTimersByTimeAsync(0);

		expect(harness.mediasoup.removePeer).toHaveBeenCalledWith(
			'room-1',
			'user-1',
		);
		expect(stay.emitCalls.some((c) => c.event === 'participant_left')).toBe(
			true,
		);
		expect(harness.mediasoup.closeRoom).not.toHaveBeenCalled();

		stay.fire('disconnect');
		await vi.advanceTimersByTimeAsync(59_999);

		expect(harness.mediasoup.removePeer).toHaveBeenCalledWith(
			'room-1',
			'stay-1',
		);
		expect(harness.mediasoup.closeRoom).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(harness.mediasoup.closeRoom).toHaveBeenCalledWith('room-1');
		harness.manager.stop();
		vi.useRealTimers();
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

	it('leave_room from one duplicate socket retains the room while another connection remains', async () => {
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
		expect(harness.mediasoup.closeRoom).not.toHaveBeenCalled();
	});

	it('keeps previews connected while grace cleanup evicts recorders and closes media', async () => {
		vi.useFakeTimers();
		const harness = createManager();
		const preview = connectFullSocket(harness, {
			id: 'preview-socket',
			scope: 'presence-preview',
			userId: 'preview-1',
		});
		emitJoin(preview, { userId: 'preview-1' });
		await vi.advanceTimersByTimeAsync(0);

		const human = connectFullSocket(harness, {
			id: 'human-socket',
			userId: 'human-1',
		});
		emitJoin(human, { userId: 'human-1' });
		await vi.advanceTimersByTimeAsync(0);

		const recorder = connectFullSocket(harness, {
			id: 'recorder-socket',
			scope: 'recording',
			recordingProofComplete: true,
			userId: 'recorder:recording-1',
			recordingClaims: {
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
			} as never,
		});
		const disconnectRecorder = vi.spyOn(recorder, 'disconnect');
		recorder.fire('recording:join', { roomId: 'room-1' }, vi.fn());
		await vi.advanceTimersByTimeAsync(0);

		human.fire('disconnect', 'client namespace disconnect');
		await vi.advanceTimersByTimeAsync(60_000);

		expect(disconnectRecorder).toHaveBeenCalledWith(true);
		expect(harness.mediasoup.closeRoom).toHaveBeenCalledWith('room-1');
		expect(harness.io.socketsMap.has(preview.id)).toBe(true);
		expect(harness.io.socketsAdapterRooms.get('room-1:preview')).toContain(
			preview.id,
		);
		harness.manager.stop();
		vi.useRealTimers();
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

	it('allows an encrypted WebRTC transport to connect when E2EE is required', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'sock-e2ee',
			userId: 'e2ee-user',
			e2eeRequired: true,
			e2eeReady: true,
		});

		const createCallback = vi.fn();
		socket.fire(
			'create_webrtc_transport',
			{ direction: 'send', encryptionEnabled: true },
			createCallback,
		);
		await new Promise((r) => setImmediate(r));

		expect(createCallback).toHaveBeenCalledWith(
			expect.objectContaining({ success: true, id: 'transport-1' }),
		);

		const connectCallback = vi.fn();
		socket.fire(
			'connect_webrtc_transport',
			{ transportId: 'transport-1', dtlsParameters: {} },
			connectCallback,
		);
		await new Promise((r) => setImmediate(r));

		expect(connectCallback).toHaveBeenCalledWith({ success: true });
		expect(harness.mediasoup.connectWebRtcTransport).toHaveBeenCalledWith(
			'transport-1',
			{},
			'room-1',
			'e2ee-user',
			undefined,
		);
	});

	it('authenticates and checks consumer room ownership before updating preferences', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			userId: 'viewer-1',
			roomId: 'room-1',
		});
		const callback = vi.fn();

		socket.fire(
			'consumer:update_preferences',
			{ consumerId: 'consumer-1', visible: true, width: 640, height: 360 },
			callback,
		);
		await new Promise((r) => setImmediate(r));

		expect(harness.authManager.ensureMediaConsumerAccess).toHaveBeenCalledWith(
			socket,
		);
		expect(harness.mediasoup.assertConsumerAccess).toHaveBeenCalledWith(
			'consumer-1',
			'room-1',
			'viewer-1',
		);
		expect(callback).toHaveBeenCalledWith({
			success: true,
			paused: false,
			visible: true,
		});
	});

	it('rejects every foreign consumer mutation before side effects', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			scope: 'recording',
			recordingProofComplete: true,
			userId: 'recorder:recording-1',
			roomId: 'room-1',
		});
		harness.mediasoup.assertConsumerAccess.mockImplementation(() => {
			throw new Error('Consumer ownership mismatch');
		});

		for (const [event, data] of [
			['close_consumer', { consumerId: 'foreign' }],
			[
				'consumer:update_preferences',
				{ consumerId: 'foreign', visible: true, width: 640, height: 360 },
			],
			['request_consumer_keyframe', { consumerId: 'foreign' }],
		] as const) {
			const callback = vi.fn();
			socket.fire(event, data, callback);
			await new Promise((resolve) => setImmediate(resolve));
			expect(callback, event).toHaveBeenCalledWith({
				success: false,
				error: 'Consumer ownership mismatch',
			});
		}

		expect(harness.mediasoup.closeConsumer).not.toHaveBeenCalled();
		expect(harness.mediasoup.updateConsumerPreferences).not.toHaveBeenCalled();
		expect(harness.mediasoup.requestConsumerKeyFrame).not.toHaveBeenCalled();
	});

	it('rejects an untracked WebRTC transport connect when E2EE is required', async () => {
		const harness = createManager();
		const socket = connectFullSocket(harness, {
			id: 'sock-e2ee-plain',
			userId: 'e2ee-plain-user',
			e2eeRequired: true,
			e2eeReady: true,
		});
		const callback = vi.fn();

		socket.fire(
			'connect_webrtc_transport',
			{ transportId: 'transport-plain', dtlsParameters: {} },
			callback,
		);
		await new Promise((r) => setImmediate(r));

		expect(callback).toHaveBeenCalledWith({
			success: false,
			error: 'Plain transport is not allowed when E2EE is required',
		});
		expect(harness.mediasoup.connectWebRtcTransport).not.toHaveBeenCalled();
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
		const callback = vi.fn();

		sender.fire('chat:send', { message: 'hello world' }, callback);

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
		expect(callback).toHaveBeenCalledWith({
			success: true,
			timestamp: receiverMsg?.data.timestamp,
		});

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

			const manager = harness.manager as unknown as {
				sweepExpiredSockets(): void;
			};
			manager.sweepExpiredSockets();

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
