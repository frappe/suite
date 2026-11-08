import { fromPartial } from '@total-typescript/shoehorn';
import type { Producer, Router } from 'mediasoup/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioIngester } from './AudioIngester';
import {
	type ISttClient,
	type ISttStream,
	SttCapacityError,
} from './SttClient';
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

	it('counts subscribed rooms, subscribers, and active ingesters without identifiers', async () => {
		vi.spyOn(AudioIngester.prototype, 'start').mockResolvedValue();
		vi.spyOn(AudioIngester.prototype, 'stop').mockResolvedValue();
		const manager = new SttManager({ sttClient: createSttClient().client });
		manager.setGetRouter(() => fromPartial<Router>({}));
		manager.beginSession('room-1', 'socket-1');
		manager.beginSession('room-1', 'socket-2');
		await manager.startTranscription(
			'room-1',
			'peer-1',
			'Alice',
			fromPartial<Producer>({
				id: 'producer-1',
			}),
		);
		expect(manager.getResourceCounts()).toEqual({
			stt_subscribed_rooms: 1,
			stt_subscribers: 2,
			stt_producer_ingesters: 1,
			stt_realtime_streams: 0,
		});
		await manager.stopRoom('room-1');
	});

	it('retries a rejected stream without replacing healthy participants', async () => {
		const start = vi
			.spyOn(AudioIngester.prototype, 'start')
			.mockRejectedValueOnce(
				new SttCapacityError('STT stream capacity reached'),
			)
			.mockResolvedValue();
		vi.spyOn(AudioIngester.prototype, 'stop').mockResolvedValue();
		const manager = new SttManager({ sttClient: createSttClient().client });
		manager.setGetRouter(() => fromPartial<Router>({}));
		manager.beginSession('room-1', 'socket-1');
		const producer = fromPartial<Producer>({ id: 'producer-1', closed: false });

		await expect(
			manager.startTranscription('room-1', 'peer-1', 'Alice', producer),
		).rejects.toBeInstanceOf(SttCapacityError);
		await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
		expect(manager.isAvailable()).toBe(true);
		await manager.stopRoom('room-1');
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

		const internals = manager;
		internals['handleTranscript'](
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
		manager.setGetRouter(() => fromPartial<Router>({}));
		manager.beginSession('room-1', 'socket-1');
		manager.setEmitToSubscribers(emit);
		const start = manager.startTranscription;

		await start.call(
			manager,
			'room-1',
			'peer-connection-id',
			'Alice',
			fromPartial<Producer>({ id: 'producer-1', closed: false }),
			'user@example.com',
		);
		const internals = manager;
		const ingester = internals['activeSessions'].get(
			'room-1:peer-connection-id:producer-1',
		)!;
		ingester['onTranscript']('Hello', true, 100);

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
		manager.setGetRouter(() => fromPartial<Router>({}));
		manager.beginSession('room-1', 'socket-1');
		const producerA = fromPartial<Producer>({
			id: 'producer-a',
			closed: false,
		});
		const producerB = fromPartial<Producer>({
			id: 'producer-b',
			closed: false,
		});

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
		const internals = manager;
		const failed = internals['activeSessions'].get(
			'room-1:participant-a:producer-a',
		)!;
		const healthy = internals['activeSessions'].get(
			'room-1:participant-b:producer-b',
		)!;
		const failedInternals = failed;

		failedInternals['onUnexpectedStreamClose']();

		await vi.waitFor(() => {
			expect(
				internals['activeSessions'].get('room-1:participant-a:producer-a'),
			).not.toBe(failed);
		});
		expect(stop).toHaveBeenCalledOnce();
		expect(stop.mock.contexts[0]).toBe(failed);
		expect(
			internals['activeSessions'].get('room-1:participant-b:producer-b'),
		).toBe(healthy);
		expect(internals['activeSessions']).toHaveLength(2);
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
		manager.setGetRouter(() => fromPartial<Router>({}));
		manager.beginSession('room-1', 'socket-1');
		const producer = fromPartial<Producer>({ id: 'producer-a', closed: false });
		await manager.startTranscription(
			'room-1',
			'participant-a',
			'Alice',
			producer,
		);
		const internals = manager;
		const sessionKey = 'room-1:participant-a:producer-a';
		const failed = internals['activeSessions'].get(sessionKey)!;

		failed['onUnexpectedStreamClose']();
		await vi.advanceTimersByTimeAsync(0);

		expect(start).toHaveBeenCalledTimes(2);
		expect(internals['activeSessions'].get(sessionKey)).toBeUndefined();

		await vi.advanceTimersByTimeAsync(1000);

		expect(start).toHaveBeenCalledTimes(3);
		expect(internals['activeSessions'].get(sessionKey)).toBeDefined();
		expect(internals['activeSessions'].get(sessionKey)).not.toBe(failed);
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
		manager.setGetRouter(() => fromPartial<Router>({}));
		manager.beginSession('room-1', 'socket-1');
		await manager.startTranscription(
			'room-1',
			'participant-a',
			'Alice',
			fromPartial<Producer>({
				id: 'producer-a',
				closed: false,
			}),
		);

		const firstStop = manager.stopRoom('room-1');
		const secondStop = manager.stopRoom('room-1');
		expect(manager.beginSession('room-1', 'socket-2')).toBe(false);

		finishStop();
		await Promise.all([firstStop, secondStop]);
		expect(manager.beginSession('room-1', 'socket-2')).toBe(true);
	});
	async function recoveryFixture() {
		vi.useFakeTimers();
		const start = vi
			.spyOn(AudioIngester.prototype, 'start')
			.mockResolvedValue();
		vi.spyOn(AudioIngester.prototype, 'stop').mockResolvedValue();
		const manager = new SttManager({ sttClient: createSttClient().client });
		manager.setGetRouter(() => fromPartial<Router>({}));
		manager.beginSession('room-1', 'socket-1');
		const producer = fromPartial<Producer>({ id: 'producer-a', closed: false });
		await manager.startTranscription(
			'room-1',
			'participant-a',
			'Alice',
			producer,
		);
		const sessions = manager['activeSessions'];
		const key = 'room-1:participant-a:producer-a';
		const fail = async () => {
			const current = sessions.get(key)!;
			current['onUnexpectedStreamClose']();
			await vi.advanceTimersByTimeAsync(0);
		};
		return { manager, producer, start, fail };
	}

	it('backs off repeated runtime failures across successful replacements and caps the delay', async () => {
		const { manager, start, fail } = await recoveryFixture();
		for (const expectedDelay of [0, 1000, 5000, 10_000, 10_000]) {
			const startsBeforeFailure = start.mock.calls.length;
			await fail();
			if (expectedDelay > 0) {
				await vi.advanceTimersByTimeAsync(expectedDelay - 1);
				expect(start).toHaveBeenCalledTimes(startsBeforeFailure);
				await vi.advanceTimersByTimeAsync(1);
			}
			expect(start).toHaveBeenCalledTimes(startsBeforeFailure + 1);
		}
		await manager.stopRoom('room-1');
	});

	it('resets backoff after a minute of stable operation', async () => {
		const { manager, start, fail } = await recoveryFixture();
		await fail(); // immediate first replacement
		await fail();
		await vi.advanceTimersByTimeAsync(1000);
		expect(start).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(60_000);
		await fail();
		expect(start).toHaveBeenCalledTimes(4); // stable capture earns immediate retry
		await manager.stopRoom('room-1');
	});

	it('cancels participant retries even when a rejected replacement left no active ingester', async () => {
		const { manager, start, fail } = await recoveryFixture();
		start.mockRejectedValueOnce(new Error('replacement failed'));
		await fail();
		expect(start).toHaveBeenCalledTimes(2);
		await manager.stopTranscription('room-1', 'participant-a');
		await vi.advanceTimersByTimeAsync(60_000);
		expect(start).toHaveBeenCalledTimes(2);
		await manager.stopRoom('room-1');
	});

	it('does not restart a producer that closes during its recovery delay', async () => {
		const { manager, producer, start, fail } = await recoveryFixture();
		await fail();
		await fail();
		expect(start).toHaveBeenCalledTimes(2);
		producer['closed'] = true;
		await vi.advanceTimersByTimeAsync(60_000);
		expect(start).toHaveBeenCalledTimes(2);
		await manager.stopRoom('room-1');
	});
});
