import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config';
import type { Consumer } from '../../types';
import { MediasoupManager } from '../MediasoupManager';

const mediasoupConfig = loadConfig(
	{ JWT_SECRET: 'test', NODE_ENV: 'development' },
	{ cpuCount: 2, localIpv4: '127.0.0.1' },
).mediasoup;

function createManager(): MediasoupManager {
	return new MediasoupManager(mediasoupConfig);
}

function makeConsumer(opts: {
	paused: boolean;
	preferredLayers?: { spatialLayer: number; temporalLayer: number } | null;
	currentLayers?: { spatialLayer: number; temporalLayer: number } | null;
}): Consumer {
	return {
		id: 'c1',
		kind: 'video',
		paused: opts.paused,
		preferredLayers: opts.preferredLayers ?? {
			spatialLayer: 1,
			temporalLayer: 1,
		},
		currentLayers: opts.currentLayers ?? {
			spatialLayer: 1,
			temporalLayer: 1,
		},
		rtpParameters: { encodings: [{ scalabilityMode: 'L3T1' }] },
		requestKeyFrame: vi.fn().mockResolvedValue(undefined),
		setPreferredLayers: vi.fn(),
	} as unknown as Consumer;
}

describe('MediasoupManager.updateConsumerPreferences', () => {
	it('requests a keyframe when a paused consumer is resumed with no layer change', async () => {
		const mgr = createManager();
		const consumer = makeConsumer({ paused: true });
		vi.spyOn(mgr.consumerManager, 'getConsumerData').mockReturnValue({
			roomId: 'r1',
			peerId: 'p1',
			consumer,
		} as never);
		vi.spyOn(mgr.consumerManager, 'resumeConsumer').mockResolvedValue(true);
		vi.spyOn(
			mgr.consumerManager,
			'setConsumerPreferredLayers',
		).mockResolvedValue(null);

		await mgr.updateConsumerPreferences({
			consumerId: 'c1',
			roomId: 'r1',
			peerId: 'p1',
			visible: true,
			width: 640,
			height: 360,
		});

		expect(consumer.requestKeyFrame).toHaveBeenCalledTimes(1);
	});

	it('does not request a keyframe on a running consumer with no layer change', async () => {
		const mgr = createManager();
		const consumer = makeConsumer({ paused: false });
		vi.spyOn(mgr.consumerManager, 'getConsumerData').mockReturnValue({
			roomId: 'r1',
			peerId: 'p1',
			consumer,
		} as never);
		vi.spyOn(mgr.consumerManager, 'resumeConsumer').mockResolvedValue(true);
		vi.spyOn(
			mgr.consumerManager,
			'setConsumerPreferredLayers',
		).mockResolvedValue(null);

		await mgr.updateConsumerPreferences({
			consumerId: 'c1',
			roomId: 'r1',
			peerId: 'p1',
			visible: true,
			width: 640,
			height: 360,
		});

		expect(consumer.requestKeyFrame).not.toHaveBeenCalled();
	});
});

describe('MediasoupManager.createConsumer', () => {
	it('keeps an existing consumer when its replacement fails', async () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			transportManager: {
				getTransportData: (transportId: string) => unknown;
			};
			producerManager: {
				getProducerData: (producerId: string) => unknown;
			};
			roomManager: { getRoom: (roomId: string) => unknown };
		};
		const existing = { id: 'existing', producerId: 'producer-1' };
		vi.spyOn(internals.transportManager, 'getTransportData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-1',
			direction: 'recv',
			transport: {},
		} as never);
		vi.spyOn(internals.producerManager, 'getProducerData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-2',
			producer: { appData: {} },
		} as never);
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue({
			router: { canConsume: () => true },
			peers: new Map(),
		} as never);
		vi.spyOn(mgr.consumerManager, 'getConsumersByPeer').mockReturnValue([
			{ consumer: existing } as never,
		]);
		const closeConsumer = vi.spyOn(mgr.consumerManager, 'closeConsumer');
		vi.spyOn(mgr.consumerManager, 'createConsumer').mockRejectedValue(
			new Error('consume failed'),
		);

		await expect(
			mgr.createConsumer(
				'transport-1',
				'producer-1',
				'room-1',
				'peer-1',
				{} as never,
			),
		).rejects.toThrow('consume failed');

		expect(closeConsumer).not.toHaveBeenCalled();
	});

	it('rejects a consumer removed while creation is completing', async () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			transportManager: { getTransportData: (id: string) => unknown };
			producerManager: { getProducerData: (id: string) => unknown };
			roomManager: { getRoom: (id: string) => unknown };
		};
		vi.spyOn(internals.transportManager, 'getTransportData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-1',
			direction: 'recv',
			transport: {},
		} as never);
		vi.spyOn(internals.producerManager, 'getProducerData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-2',
			producer: { appData: {} },
		} as never);
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue({
			router: { canConsume: () => true },
			peers: new Map([['peer-1', {}]]),
		} as never);
		vi.spyOn(mgr.consumerManager, 'createConsumer').mockResolvedValue({
			id: 'closed-consumer',
			producerId: 'producer-1',
			kind: 'video',
			rtpParameters: {},
			paused: false,
		});

		await expect(
			mgr.createConsumer(
				'transport-1',
				'producer-1',
				'room-1',
				'peer-1',
				{} as never,
			),
		).rejects.toThrow('Failed to create consumer closed-consumer');
	});
});

describe('MediasoupManager participant connections', () => {
	it('stores peer metadata in the room and updates repeated joins in place', async () => {
		const mgr = createManager();
		const room = { peers: new Map() };
		const internals = mgr as unknown as {
			roomManager: { getRoom: (roomId: string) => unknown };
		};
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue(room);

		const first = await mgr.addPeer('room-1', 'peer-1');
		const repeated = await mgr.addPeer('room-1', 'peer-1', {
			name: 'Alice',
			userId: 'user-1',
			audio_enabled: false,
			video_enabled: true,
			senderId: 7,
			isHost: true,
		});

		expect(repeated).toBe(first);
		expect(room.peers.get('peer-1')).toBe(first);
		expect(first.info).toMatchObject({
			name: 'Alice',
			userId: 'user-1',
			audio_enabled: false,
			video_enabled: true,
			senderId: 7,
			isHost: true,
		});
		expect(first.producers.size).toBe(0);
	});

	it('deduplicates participant snapshots while combining connection media', () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			roomManager: { getRoom: (roomId: string) => unknown };
		};
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue({
			peers: new Map([
				[
					'connection-1',
					{
						info: { userId: 'user-1', name: 'Alice', isHost: false },
						producers: new Map([
							['audio', { kind: 'audio', paused: false, appData: {} }],
						]),
					},
				],
				[
					'connection-2',
					{
						info: { userId: 'user-1', name: 'Alice', isHost: true },
						producers: new Map([
							['video', { kind: 'video', paused: false, appData: {} }],
						]),
					},
				],
			]),
		} as never);

		const participants = mgr.getRoomParticipants('room-1');

		expect(participants).toHaveLength(1);
		expect(participants[0]).toMatchObject({
			id: 'user-1',
			user_id: 'user-1',
			is_host: true,
			info: { userId: 'user-1', audio_enabled: true, video_enabled: true },
		});
	});

	it('excludes every connection owned by the requesting participant', async () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			roomManager: { getRoom: (roomId: string) => unknown };
		};
		const producer = (id: string) => ({
			id,
			kind: 'video',
			paused: false,
			appData: {},
		});
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue({
			peers: new Map([
				[
					'connection-1',
					{
						info: { userId: 'user-1' },
						producers: new Map([['own-1', producer('own-1')]]),
					},
				],
				[
					'connection-2',
					{
						info: { userId: 'user-1' },
						producers: new Map([['own-2', producer('own-2')]]),
					},
				],
				[
					'connection-3',
					{
						info: { userId: 'user-2' },
						producers: new Map([['remote', producer('remote')]]),
					},
				],
			]),
		} as never);

		await expect(mgr.getExistingProducers('room-1', 'user-1')).resolves.toEqual(
			[expect.objectContaining({ id: 'remote', user_id: 'user-2' })],
		);
	});
});

describe('MediasoupManager producer cleanup', () => {
	it('finalizes transport-closed producers, consumers, snapshots, and notifications once', async () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			producerManager: {
				createProducer: (...args: unknown[]) => Promise<unknown>;
				getProducerCount: () => number;
			};
			roomManager: { getRoom: (roomId: string) => unknown };
		};
		const producer = Object.assign(new EventEmitter(), {
			id: 'producer-1',
			kind: 'video' as const,
			appData: {},
			paused: false,
			closed: false,
			close: vi.fn(),
		});
		const consumer = Object.assign(new EventEmitter(), {
			id: 'consumer-1',
			producerId: producer.id,
			kind: 'video' as const,
			paused: false,
			rtpParameters: {},
			close: vi.fn(),
			resume: vi.fn(),
			requestKeyFrame: vi.fn().mockResolvedValue(undefined),
		});
		const publisher = {
			info: { userId: 'publisher-1', name: 'Publisher' },
			producers: new Map([[producer.id, producer]]),
		};
		const viewer = {
			info: { userId: 'viewer-1', name: 'Viewer' },
			producers: new Map(),
		};
		const room = {
			peers: new Map([
				['publisher-peer', publisher],
				['viewer-peer', viewer],
			]),
		};
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue(room);
		await internals.producerManager.createProducer(
			{ produce: vi.fn().mockResolvedValue(producer) },
			'room-1',
			'publisher-peer',
			{},
			'video',
		);
		await mgr.consumerManager.createConsumer(
			{
				id: 'recv-1',
				closed: false,
				dtlsState: 'connected',
				consume: vi.fn().mockResolvedValue(consumer),
			} as never,
			producer as never,
			producer.id,
			'room-1',
			'viewer-peer',
			{} as never,
		);
		const onProducerClosed = vi.fn();
		mgr.onProducerClosed(onProducerClosed);

		producer.closed = true;
		producer.emit('transportclose');
		producer.emit('transportclose');

		expect(internals.producerManager.getProducerCount()).toBe(0);
		expect(mgr.consumerManager.getConsumerCount()).toBe(0);
		expect(publisher.producers.has(producer.id)).toBe(false);
		await expect(
			mgr.getExistingProducers('room-1', 'viewer-1'),
		).resolves.toEqual([]);
		expect(onProducerClosed).toHaveBeenCalledTimes(1);
		expect(onProducerClosed).toHaveBeenCalledWith(
			expect.objectContaining({
				roomId: 'room-1',
				peerId: 'publisher-peer',
				participantId: 'publisher-1',
				producerId: 'producer-1',
				removedConsumers: [
					expect.objectContaining({
						consumerId: 'consumer-1',
						peerId: 'viewer-peer',
					}),
				],
			}),
		);
	});
});

describe('MediasoupManager resource access', () => {
	it('removes a peer through each authoritative resource manager', async () => {
		const mgr = createManager();
		const room = {
			peers: new Map([
				['peer-1', { producers: new Map([['producer-1', {}]]) }],
			]),
		};
		const internals = mgr as unknown as {
			roomManager: { getRoom: (id: string) => unknown };
			producerManager: { getProducerIdsByPeer: () => string[] };
			transportManager: { closePeerTransports: (...args: unknown[]) => void };
		};
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue(room);
		vi.spyOn(internals.producerManager, 'getProducerIdsByPeer').mockReturnValue(
			['producer-1'],
		);
		const closeProducer = vi.spyOn(mgr, 'closeProducer');
		const closeConsumers = vi.spyOn(mgr.consumerManager, 'closePeerConsumers');
		const closeTransports = vi.spyOn(
			internals.transportManager,
			'closePeerTransports',
		);

		await mgr.removePeer('room-1', 'peer-1');

		expect(closeProducer).toHaveBeenCalledWith('producer-1');
		expect(closeConsumers).toHaveBeenCalledWith('room-1', 'peer-1');
		expect(closeTransports).toHaveBeenCalledWith('room-1', 'peer-1');
		expect(room.peers.has('peer-1')).toBe(false);
	});

	it('removes every peer resource before closing a populated room', async () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			roomManager: {
				getRoom: (id: string) => unknown;
				closeRoom: (id: string) => Promise<void>;
			};
		};
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue({
			peers: new Map([
				['peer-1', {}],
				['peer-2', {}],
			]),
		} as never);
		const removePeer = vi.spyOn(mgr, 'removePeer').mockResolvedValue(undefined);
		const closeRoom = vi
			.spyOn(internals.roomManager, 'closeRoom')
			.mockResolvedValue(undefined);

		await mgr.closeRoom('room-1');

		expect(removePeer.mock.calls).toEqual([
			['room-1', 'peer-1'],
			['room-1', 'peer-2'],
		]);
		expect(closeRoom).toHaveBeenCalledWith('room-1');
	});

	it('rejects peers joining while their room is closing', async () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			roomManager: {
				getRoom: (id: string) => unknown;
				closeRoom: (id: string) => Promise<void>;
			};
		};
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue({
			peers: new Map([['peer-1', {}]]),
		} as never);
		let release!: () => void;
		const removing = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.spyOn(mgr, 'removePeer').mockReturnValue(removing);
		vi.spyOn(internals.roomManager, 'closeRoom').mockResolvedValue(undefined);

		const closing = mgr.closeRoom('room-1');
		await expect(mgr.addPeer('room-1', 'peer-2')).rejects.toThrow('is closing');
		release();
		await closing;
	});

	it('requires transport room, peer, and direction to match', () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			transportManager: { getTransportData: (id: string) => unknown };
		};
		vi.spyOn(internals.transportManager, 'getTransportData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-1',
			direction: 'send',
			transport: {},
		});

		expect(() => mgr.assertTransportAccess('t1', 'room-2', 'peer-1')).toThrow(
			'Transport ownership mismatch',
		);
		expect(() => mgr.assertTransportAccess('t1', 'room-1', 'peer-2')).toThrow(
			'Transport ownership mismatch',
		);
		expect(() =>
			mgr.assertTransportAccess('t1', 'room-1', 'peer-1', 'recv'),
		).toThrow('is not a recv transport');
	});

	it('rejects a foreign consumer before mutating it', async () => {
		const mgr = createManager();
		vi.spyOn(mgr.consumerManager, 'getConsumerData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-1',
			consumer: {},
		} as never);

		const close = vi.spyOn(mgr.consumerManager, 'closeConsumer');
		const pause = vi.spyOn(mgr.consumerManager, 'pauseConsumer');

		expect(() => mgr.closeConsumer('c1', 'room-2', 'peer-1')).toThrow(
			'Consumer ownership mismatch',
		);
		expect(close).not.toHaveBeenCalled();
		await expect(
			mgr.updateConsumerPreferences({
				consumerId: 'c1',
				roomId: 'room-2',
				peerId: 'peer-1',
				visible: false,
				width: 0,
				height: 0,
			}),
		).rejects.toThrow('Consumer ownership mismatch');
		expect(pause).not.toHaveBeenCalled();
	});

	it('distinguishes a missing keyframe target from a foreign consumer', async () => {
		const mgr = createManager();
		await expect(
			mgr.requestConsumerKeyFrame('missing', 'room-1', 'peer-1'),
		).resolves.toBe(false);

		vi.spyOn(mgr.consumerManager, 'getConsumerData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-2',
			consumer: {},
		} as never);
		await expect(
			mgr.requestConsumerKeyFrame('foreign', 'room-1', 'peer-1'),
		).rejects.toThrow('Consumer ownership mismatch');
	});

	it('rejects a producer from another room when creating a consumer', async () => {
		const mgr = createManager();
		const internals = mgr as unknown as {
			transportManager: { getTransportData: (id: string) => unknown };
			producerManager: { getProducerData: (id: string) => unknown };
		};
		vi.spyOn(internals.transportManager, 'getTransportData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-1',
			direction: 'recv',
			transport: {},
		});
		vi.spyOn(internals.producerManager, 'getProducerData').mockReturnValue({
			roomId: 'room-2',
			peerId: 'peer-2',
			producer: {},
		});

		await expect(
			mgr.createConsumer('t1', 'p1', 'room-1', 'peer-1', {} as never),
		).rejects.toThrow('does not belong to room room-1');
	});
});
