import { EventEmitter } from 'node:events';
import type {
	AudioLevelObserver,
	Router,
	WebRtcServer,
	Worker,
} from 'mediasoup/types';
import { describe, expect, it, vi } from 'vitest';
import type { Room, RtpCodecCapability } from '../../types';
import { RoomManager } from '../RoomManager';
import type { WorkerEntry } from '../WorkerManager';

let routerSequence = 0;

function makeAudioLevelObserver(): AudioLevelObserver {
	const emitter = new EventEmitter();
	const observer = Object.assign(emitter, {
		close: vi.fn(),
	}) as unknown as AudioLevelObserver;
	return observer;
}

function makeWorker(opts: { router: Router }): Worker {
	return {
		createRouter: vi.fn(async () => opts.router),
	} as unknown as Worker;
}

function makeWebRtcServer(): WebRtcServer {
	return { close: vi.fn() } as unknown as WebRtcServer;
}

function makeRouter(id = `router-${++routerSequence}`): Router {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		id,
		close: vi.fn(),
		rtpCapabilities: { codecs: [], headerExtensions: [] },
		canConsume: vi.fn().mockReturnValue(true),
		createAudioLevelObserver: vi.fn(async () => makeAudioLevelObserver()),
		pipeToRouter: vi.fn(async ({ producerId }: { producerId: string }) => ({
			pipeConsumer: {
				id: `pipe-consumer-${producerId}`,
				closed: false,
				close: vi.fn(),
			},
			pipeProducer: { id: producerId, closed: false, close: vi.fn() },
		})),
	}) as unknown as Router;
}

function makeWorkerEntry(
	worker: Worker,
	webRtcServer: WebRtcServer,
	id = 1,
): WorkerEntry {
	return { id, worker, webRtcServer };
}

function addPeersTo(room: Room, ...peerIds: string[]): void {
	for (const id of peerIds) {
		room.peers.set(id, {
			id,
			homeRouterId: room.router.id,
			info: {
				name: id,
				userId: id,
				audio_enabled: false,
				video_enabled: false,
			},
			transports: new Map(),
			producers: new Map(),
			consumers: new Map(),
			joined: new Date(),
		});
	}
}

describe('RoomManager', () => {
	const codecs: RtpCodecCapability[] = [
		{
			kind: 'audio',
			mimeType: 'audio/opus',
			clockRate: 48000,
			channels: 2,
			preferredPayloadType: 111,
		},
	];

	it('createRoom creates a router and an audio level observer; second call returns the same room', async () => {
		const mgr = new RoomManager();
		const router = makeRouter();
		const worker = makeWorker({ router });
		const webRtcServer = makeWebRtcServer();

		const workers = [makeWorkerEntry(worker, webRtcServer)];
		const roomA = await mgr.createRoom('r1', workers, codecs);
		const routerSpy = worker.createRouter as ReturnType<typeof vi.fn>;
		expect(routerSpy).toHaveBeenCalledTimes(1);
		expect(mgr.getRoom('r1')).toBe(roomA);
		expect(mgr.getRouter('r1')).toBe(router);
		expect(mgr.getRoomCount()).toBe(1);

		const roomB = await mgr.createRoom('r1', workers, codecs);
		expect(roomB).toBe(roomA);
		expect(routerSpy).toHaveBeenCalledTimes(1);
	});

	it('createRoom wires the audio level observer volumes event to the active speaker callback', async () => {
		const mgr = new RoomManager();
		const router = makeRouter();
		const worker = makeWorker({ router });
		const webRtcServer = makeWebRtcServer();
		const onActiveSpeaker = vi.fn();

		const room = await mgr.createRoom(
			'r1',
			[makeWorkerEntry(worker, webRtcServer)],
			codecs,
			onActiveSpeaker,
		);
		addPeersTo(room, 'p1');
		const p1 = room.peers.get('p1')!;
		const fakeProducer = { id: 'prod-1' } as { id: string };
		p1.producers.set('prod-1', fakeProducer as never);

		const observer = mgr.getRoom('r1')!
			.audioLevelObserver as unknown as EventEmitter;
		observer.emit('volumes', [{ producer: fakeProducer, volume: -30 }]);

		expect(onActiveSpeaker).toHaveBeenCalledWith('r1', ['p1']);
	});

	it('createRoom ignores volumes below the threshold', async () => {
		const mgr = new RoomManager();
		const router = makeRouter();
		const worker = makeWorker({ router });
		const webRtcServer = makeWebRtcServer();
		const onActiveSpeaker = vi.fn();

		const room = await mgr.createRoom(
			'r1',
			[makeWorkerEntry(worker, webRtcServer)],
			codecs,
			onActiveSpeaker,
		);
		addPeersTo(room, 'p1');
		const p1 = room.peers.get('p1')!;
		const fakeProducer = { id: 'prod-1' } as { id: string };
		p1.producers.set('prod-1', fakeProducer as never);

		const observer = mgr.getRoom('r1')!
			.audioLevelObserver as unknown as EventEmitter;
		observer.emit('volumes', [{ producer: fakeProducer, volume: -71 }]);

		expect(onActiveSpeaker).toHaveBeenCalledWith('r1', []);
	});

	it('closeRoom closes the router and removes the room from both maps', async () => {
		const mgr = new RoomManager();
		const router = makeRouter();
		const worker = makeWorker({ router });
		const webRtcServer = makeWebRtcServer();
		await mgr.createRoom('r1', [makeWorkerEntry(worker, webRtcServer)], codecs);

		await mgr.closeRoom('r1');

		expect(router.close as ReturnType<typeof vi.fn>).toHaveBeenCalled();
		expect(mgr.getRoom('r1')).toBeUndefined();
		expect(mgr.getRouter('r1')).toBeUndefined();
		expect(mgr.getRoomCount()).toBe(0);
	});

	it('closeRoom is a no-op for an unknown room', async () => {
		const mgr = new RoomManager();
		await expect(mgr.closeRoom('nope')).resolves.toBeUndefined();
	});

	it('getRoomStats aggregates peer/producer/consumer counts', async () => {
		const mgr = new RoomManager();
		const router = makeRouter();
		const worker = makeWorker({ router });
		const webRtcServer = makeWebRtcServer();
		const room = await mgr.createRoom(
			'r1',
			[makeWorkerEntry(worker, webRtcServer)],
			codecs,
		);
		addPeersTo(room, 'p1', 'p2', 'recorder:session-1');

		room.peers.get('p1')!.producers.set('a', {} as never);
		room.peers.get('p1')!.producers.set('b', {} as never);
		room.peers.get('p2')!.consumers.set('c', {} as never);

		const stats = mgr.getRoomStats('r1');
		expect(stats).toEqual(
			expect.objectContaining({
				id: 'r1',
				peerCount: 3,
				participantCount: 2,
				peers: ['p1', 'p2', 'recorder:session-1'],
				producerCount: 2,
				consumerCount: 1,
			}),
		);

		expect(mgr.getRoomStats('missing')).toBeNull();
		expect(mgr.getParticipantCount()).toBe(2);
	});

	it('cleanup closes every room', async () => {
		const mgr = new RoomManager();
		const router1 = makeRouter();
		const router2 = makeRouter();
		const worker1 = makeWorker({ router: router1 });
		const worker2 = makeWorker({ router: router2 });
		const webRtcServer1 = makeWebRtcServer();
		const webRtcServer2 = makeWebRtcServer();

		await mgr.createRoom(
			'r1',
			[makeWorkerEntry(worker1, webRtcServer1)],
			codecs,
		);
		await mgr.createRoom(
			'r2',
			[makeWorkerEntry(worker2, webRtcServer2, 2)],
			codecs,
		);

		await mgr.cleanup();

		expect(mgr.getRoomCount()).toBe(0);
		expect(router1.close).toHaveBeenCalled();
		expect(router2.close).toHaveBeenCalled();
	});

	it('fills the active router before lazily activating the next worker', async () => {
		const mgr = new RoomManager();
		const router1 = makeRouter('router-1');
		const router2 = makeRouter('router-2');
		const worker1 = makeWorker({ router: router1 });
		const worker2 = makeWorker({ router: router2 });
		await mgr.createRoom(
			'r1',
			[
				makeWorkerEntry(worker1, makeWebRtcServer(), 1),
				makeWorkerEntry(worker2, makeWebRtcServer(), 2),
			],
			codecs,
		);

		const first = await mgr.assignPeerRouter('r1', 'p1', 2, codecs);
		const second = await mgr.assignPeerRouter('r1', 'p2', 2, codecs);
		const third = await mgr.assignPeerRouter('r1', 'p3', 2, codecs);

		expect(first).toMatchObject({
			router: { id: 'router-1' },
			activated: false,
		});
		expect(second).toMatchObject({
			router: { id: 'router-1' },
			activated: false,
		});
		expect(third).toMatchObject({
			router: { id: 'router-2' },
			activated: true,
		});
		expect(worker2.createRouter).toHaveBeenCalledTimes(1);
	});

	it('shares an on-demand pipe and closes it after its final consumer', async () => {
		const mgr = new RoomManager();
		const router1 = makeRouter('router-1');
		const router2 = makeRouter('router-2');
		await mgr.createRoom(
			'r1',
			[
				makeWorkerEntry(makeWorker({ router: router1 }), makeWebRtcServer(), 1),
				makeWorkerEntry(makeWorker({ router: router2 }), makeWebRtcServer(), 2),
			],
			codecs,
		);
		await mgr.assignPeerRouter('r1', 'p1', 1, codecs);
		await mgr.assignPeerRouter('r1', 'p2', 1, codecs);

		const first = await mgr.retainProducerOnRouter(
			'r1',
			'producer-1',
			'router-1',
			'router-2',
		);
		const second = await mgr.retainProducerOnRouter(
			'r1',
			'producer-1',
			'router-1',
			'router-2',
		);

		expect(second).toBe(first);
		expect(router1.pipeToRouter).toHaveBeenCalledTimes(1);
		mgr.releaseProducerOnRouter('r1', 'producer-1', 'router-2');
		expect(mgr.getPipeRepresentation('r1', 'producer-1', 'router-2')).toBe(
			first,
		);
		mgr.releaseProducerOnRouter('r1', 'producer-1', 'router-2');
		expect(
			mgr.getPipeRepresentation('r1', 'producer-1', 'router-2'),
		).toBeUndefined();
		expect(first?.pipeProducer.close).toHaveBeenCalledTimes(1);
		expect(first?.pipeConsumer.close).toHaveBeenCalledTimes(1);
	});

	it('closes a spill router that finishes activating after its room closes', async () => {
		const mgr = new RoomManager();
		const router1 = makeRouter('router-1');
		const router2 = makeRouter('router-2');
		let finishActivation!: () => void;
		const activationGate = new Promise<void>((resolve) => {
			finishActivation = resolve;
		});
		const worker2 = {
			createRouter: vi.fn(async () => {
				await activationGate;
				return router2;
			}),
		} as unknown as Worker;
		await mgr.createRoom(
			'r1',
			[
				makeWorkerEntry(makeWorker({ router: router1 }), makeWebRtcServer(), 1),
				makeWorkerEntry(worker2, makeWebRtcServer(), 2),
			],
			codecs,
		);
		await mgr.assignPeerRouter('r1', 'p1', 1, codecs);
		const assigning = mgr.assignPeerRouter('r1', 'p2', 1, codecs);
		await vi.waitFor(() =>
			expect(worker2.createRouter).toHaveBeenCalledTimes(1),
		);

		await mgr.closeRoom('r1');
		finishActivation();

		await expect(assigning).rejects.toThrow('closed while activating a router');
		expect(router2.close).toHaveBeenCalledTimes(1);
	});

	it('waits for an in-flight primary router before closing the room', async () => {
		const mgr = new RoomManager();
		const router = makeRouter('router-1');
		let finishCreation!: () => void;
		const creationGate = new Promise<void>((resolve) => {
			finishCreation = resolve;
		});
		const worker = {
			createRouter: vi.fn(async () => {
				await creationGate;
				return router;
			}),
		} as unknown as Worker;
		const creating = mgr.createRoom(
			'r1',
			[makeWorkerEntry(worker, makeWebRtcServer())],
			codecs,
		);
		await vi.waitFor(() =>
			expect(worker.createRouter).toHaveBeenCalledTimes(1),
		);

		const closing = mgr.closeRoom('r1');
		finishCreation();
		await creating;
		await closing;

		expect(router.close).toHaveBeenCalledTimes(1);
		expect(mgr.getRoom('r1')).toBeUndefined();
	});

	it('includes in-flight room creation in global cleanup', async () => {
		const mgr = new RoomManager();
		const router = makeRouter('router-1');
		let finishCreation!: () => void;
		const creationGate = new Promise<void>((resolve) => {
			finishCreation = resolve;
		});
		const worker = {
			createRouter: vi.fn(async () => {
				await creationGate;
				return router;
			}),
		} as unknown as Worker;
		const creating = mgr.createRoom(
			'r1',
			[makeWorkerEntry(worker, makeWebRtcServer())],
			codecs,
		);
		await vi.waitFor(() =>
			expect(worker.createRouter).toHaveBeenCalledTimes(1),
		);

		const cleanup = mgr.cleanup();
		finishCreation();
		await creating;
		await cleanup;

		expect(router.close).toHaveBeenCalledTimes(1);
		expect(mgr.getRoomCount()).toBe(0);
		await expect(
			mgr.createRoom(
				'r2',
				[makeWorkerEntry(makeWorker({ router }), makeWebRtcServer())],
				codecs,
			),
		).rejects.toThrow('shutting down');
	});
});
