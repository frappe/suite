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

function makeRouter(): Router {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		close: vi.fn(),
		rtpCapabilities: { codecs: [], headerExtensions: [] },
		canConsume: vi.fn().mockReturnValue(true),
		createAudioLevelObserver: vi.fn(async () => makeAudioLevelObserver()),
	}) as unknown as Router;
}

function addPeersTo(room: Room, ...peerIds: string[]): void {
	for (const id of peerIds) {
		room.peers.set(id, {
			id,
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

		const roomA = await mgr.createRoom('r1', worker, webRtcServer, codecs);
		const routerSpy = worker.createRouter as ReturnType<typeof vi.fn>;
		expect(routerSpy).toHaveBeenCalledTimes(1);
		expect(mgr.getRoom('r1')).toBe(roomA);
		expect(mgr.getRouter('r1')).toBe(router);
		expect(mgr.getRoomCount()).toBe(1);

		const roomB = await mgr.createRoom('r1', worker, webRtcServer, codecs);
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
			worker,
			webRtcServer,
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
			worker,
			webRtcServer,
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
		await mgr.createRoom('r1', worker, webRtcServer, codecs);

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
		const room = await mgr.createRoom('r1', worker, webRtcServer, codecs);
		addPeersTo(room, 'p1', 'p2');

		room.peers.get('p1')!.producers.set('a', {} as never);
		room.peers.get('p1')!.producers.set('b', {} as never);
		room.peers.get('p2')!.consumers.set('c', {} as never);

		const stats = mgr.getRoomStats('r1');
		expect(stats).toEqual(
			expect.objectContaining({
				id: 'r1',
				peerCount: 2,
				peers: ['p1', 'p2'],
				producerCount: 2,
				consumerCount: 1,
			}),
		);

		expect(mgr.getRoomStats('missing')).toBeNull();
	});

	it('cleanup closes every room', async () => {
		const mgr = new RoomManager();
		const router1 = makeRouter();
		const router2 = makeRouter();
		const worker1 = makeWorker({ router: router1 });
		const worker2 = makeWorker({ router: router2 });
		const webRtcServer1 = makeWebRtcServer();
		const webRtcServer2 = makeWebRtcServer();

		await mgr.createRoom('r1', worker1, webRtcServer1, codecs);
		await mgr.createRoom('r2', worker2, webRtcServer2, codecs);

		await mgr.cleanup();

		expect(mgr.getRoomCount()).toBe(0);
		expect(router1.close).toHaveBeenCalled();
		expect(router2.close).toHaveBeenCalled();
	});
});
