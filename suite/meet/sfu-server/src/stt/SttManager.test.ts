import type { Producer, Router } from 'mediasoup/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioIngester } from './AudioIngester';
import type { ISttClient, ISttStream } from './SttClient';
import { SttManager } from './SttManager';

function createSttClient(available = true) {
	let onAvailable: (() => void) | undefined;
	const client: ISttClient = {
		isAvailable: () => available,
		onAvailable: (listener) => {
			onAvailable = listener;
		},
		createStream: vi.fn<() => Promise<ISttStream>>(),
	};
	return { client, recover: () => onAvailable?.() };
}

describe('SttManager', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('restarts subscribed rooms when the STT service recovers', async () => {
		const sttClient = createSttClient();
		const manager = new SttManager({ sttClient: sttClient.client });
		const restartRoom = vi.fn<() => Promise<void>>().mockResolvedValue();
		manager.beginSession('room-1', 'socket-1');
		manager.setRestartRoomTranscription(restartRoom);

		sttClient.recover();
		await vi.waitFor(() => expect(restartRoom).toHaveBeenCalledWith('room-1'));
	});

	it('reports real constructed configuration and availability', () => {
		const disabled = new SttManager({ allowMockFallback: false });
		const developmentMock = new SttManager({ allowMockFallback: true });
		const unavailableClient = createSttClient(false);
		const unavailable = new SttManager({ sttClient: unavailableClient.client });

		expect(disabled.isAvailable()).toBe(false);
		expect(developmentMock.isAvailable()).toBe(true);
		expect(unavailable.isAvailable()).toBe(false);
		expect(() => unavailable.beginSession('room-1', 'socket-1')).toThrow(
			'STT is unavailable',
		);
	});

	it('passes only room subscribers to the transcript emitter', () => {
		const sttClient = createSttClient();
		const manager = new SttManager({ sttClient: sttClient.client });
		const emit = vi.fn();
		manager.beginSession('room-1', 'socket-1');
		manager.setEmitToSubscribers(emit);

		const internals = manager as unknown as {
			handleTranscript: (
				roomId: string,
				participantId: string,
				participantName: string,
				text: string,
				isFinal: boolean,
				durationMs: number,
			) => void;
		};
		internals.handleTranscript(
			'room-1',
			'participant-1',
			'Alice',
			'Hello',
			true,
			100,
		);

		expect(emit).toHaveBeenCalledWith(
			'room-1',
			new Set(['socket-1']),
			'stt:segment',
			expect.objectContaining({ roomId: 'room-1' }),
		);
	});

	it('emits the logical participant ID while retaining the peer ID for the session', async () => {
		vi.spyOn(AudioIngester.prototype, 'start').mockResolvedValue();
		const sttClient = createSttClient(true);
		const manager = new SttManager({ sttClient: sttClient.client });
		const emit = vi.fn();
		manager.setGetRouter(() => ({}) as Router);
		manager.beginSession('room-1', 'socket-1');
		manager.setEmitToSubscribers(emit);
		const start = manager.startTranscription as unknown as (
			roomId: string,
			peerId: string,
			participantName: string,
			producer: Producer,
			participantId: string,
		) => Promise<void>;

		await start.call(
			manager,
			'room-1',
			'peer-connection-id',
			'Alice',
			{ id: 'producer-1', closed: false } as Producer,
			'user@example.com',
		);
		const internals = manager as unknown as {
			activeSessions: Map<string, AudioIngester>;
		};
		const ingester = internals.activeSessions.get(
			'room-1:peer-connection-id:producer-1',
		)! as unknown as {
			onTranscript: (
				text: string,
				isFinal: boolean,
				durationMs: number,
			) => void;
		};
		ingester.onTranscript('Hello', true, 100);

		expect(emit).toHaveBeenCalledWith(
			'room-1',
			new Set(['socket-1']),
			'stt:segment',
			expect.objectContaining({
				segment: expect.objectContaining({
					participantId: 'user@example.com',
					participantName: 'Alice',
				}),
			}),
		);
	});

	it('replaces only the ingester whose Realtime stream closed', async () => {
		vi.spyOn(AudioIngester.prototype, 'start').mockResolvedValue();
		const stop = vi.spyOn(AudioIngester.prototype, 'stop').mockResolvedValue();
		const sttClient = createSttClient(true);
		const manager = new SttManager({ sttClient: sttClient.client });
		manager.setGetRouter(() => ({}) as Router);
		manager.beginSession('room-1', 'socket-1');
		const producerA = { id: 'producer-a', closed: false } as Producer;
		const producerB = { id: 'producer-b', closed: false } as Producer;

		await manager.startTranscription(
			'room-1',
			'participant-a',
			'Alice',
			producerA,
		);
		await manager.startTranscription(
			'room-1',
			'participant-b',
			'Bob',
			producerB,
		);
		const internals = manager as unknown as {
			activeSessions: Map<string, AudioIngester>;
		};
		const failed = internals.activeSessions.get(
			'room-1:participant-a:producer-a',
		)!;
		const healthy = internals.activeSessions.get(
			'room-1:participant-b:producer-b',
		)!;
		const failedInternals = failed as unknown as {
			onUnexpectedStreamClose: () => void;
		};

		failedInternals.onUnexpectedStreamClose();

		await vi.waitFor(() => {
			expect(
				internals.activeSessions.get('room-1:participant-a:producer-a'),
			).not.toBe(failed);
		});
		expect(stop).toHaveBeenCalledOnce();
		expect(stop.mock.contexts[0]).toBe(failed);
		expect(
			internals.activeSessions.get('room-1:participant-b:producer-b'),
		).toBe(healthy);
		expect(internals.activeSessions).toHaveLength(2);
		expect(AudioIngester.prototype.start).toHaveBeenCalledTimes(3);
	});

	it('keeps retrying after a replacement stream fails to start', async () => {
		vi.useFakeTimers();
		const start = vi
			.spyOn(AudioIngester.prototype, 'start')
			.mockResolvedValueOnce()
			.mockRejectedValueOnce(new Error('replacement failed'))
			.mockResolvedValueOnce();
		vi.spyOn(AudioIngester.prototype, 'stop').mockResolvedValue();
		const sttClient = createSttClient(true);
		const manager = new SttManager({ sttClient: sttClient.client });
		manager.setGetRouter(() => ({}) as Router);
		manager.beginSession('room-1', 'socket-1');
		const producer = { id: 'producer-a', closed: false } as Producer;
		await manager.startTranscription(
			'room-1',
			'participant-a',
			'Alice',
			producer,
		);
		const internals = manager as unknown as {
			activeSessions: Map<string, AudioIngester>;
		};
		const sessionKey = 'room-1:participant-a:producer-a';
		const failed = internals.activeSessions.get(sessionKey)!;

		(
			failed as unknown as { onUnexpectedStreamClose: () => void }
		).onUnexpectedStreamClose();
		await vi.advanceTimersByTimeAsync(0);

		expect(start).toHaveBeenCalledTimes(2);
		expect(internals.activeSessions.get(sessionKey)).toBeUndefined();

		await vi.advanceTimersByTimeAsync(1000);

		expect(start).toHaveBeenCalledTimes(3);
		expect(internals.activeSessions.get(sessionKey)).toBeDefined();
		expect(internals.activeSessions.get(sessionKey)).not.toBe(failed);
	});

	it('blocks new sessions until overlapping room stops finish', async () => {
		vi.spyOn(AudioIngester.prototype, 'start').mockResolvedValue();
		let finishStop: () => void = () => {};
		vi.spyOn(AudioIngester.prototype, 'stop').mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishStop = resolve;
				}),
		);
		const sttClient = createSttClient(true);
		const manager = new SttManager({ sttClient: sttClient.client });
		manager.setGetRouter(() => ({}) as Router);
		manager.beginSession('room-1', 'socket-1');
		await manager.startTranscription('room-1', 'participant-a', 'Alice', {
			id: 'producer-a',
			closed: false,
		} as Producer);

		const firstStop = manager.stopRoom('room-1');
		const secondStop = manager.stopRoom('room-1');
		expect(manager.beginSession('room-1', 'socket-2')).toBe(false);

		finishStop();
		await Promise.all([firstStop, secondStop]);
		expect(manager.beginSession('room-1', 'socket-2')).toBe(true);
	});
});
