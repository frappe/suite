import { EventEmitter } from 'node:events';
import { fromPartial } from '@total-typescript/shoehorn';
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
	const observer = fromPartial<AudioLevelObserver>(
		Object.assign(emitter, {
			close: vi.fn(),
		}),
	);
	return observer;
}

function makeWorker(opts: { router: Router }): Worker {
	return fromPartial<Worker>({
		createRouter: vi.fn(async () => opts.router),
	});
}

function makeWebRtcServer(): WebRtcServer {
	return fromPartial<WebRtcServer>({ close: vi.fn() });
}

function makeRouter(): Router {
	const emitter = new EventEmitter();
	return fromPartial<Router>(
		Object.assign(emitter, {
			close: vi.fn(),
			rtpCapabilities: { codecs: [], headerExtensions: [] },
			canConsume: vi.fn().mockReturnValue(true),
			createAudioLevelObserver: vi.fn(async () => makeAudioLevelObserver()),
		}),
	);
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
			producers: new Map(),
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

		const roomA = await mgr.createRoom('r1', 1, worker, webRtcServer, codecs);
		const routerSpy = vi.mocked(worker.createRouter);
		expect(routerSpy).toHaveBeenCalledTimes(1);
		expect(mgr.getRoom('r1')).toBe(roomA);
		expect(mgr.getRouter('r1')).toBe(router);
		expect(mgr.getRoomCount()).toBe(1);

		const roomB = await mgr.createRoom('r1', 1, worker, webRtcServer, codecs);
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
			1,
			worker,
			webRtcServer,
			codecs,
			onActiveSpeaker,
		);
		addPeersTo(room, 'p1');
		const p1 = room.peers.get('p1')!;
		const fakeProducer = { id: 'prod-1' };
		p1.producers.set('prod-1', fromPartial(fakeProducer));

		const observer = mgr.getRoom('r1')!.audioLevelObserver!;
		observer.emit(
			'volumes',
			fromPartial([{ producer: fakeProducer, volume: -30 }]),
		);

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
			1,
			worker,
			webRtcServer,
			codecs,
			onActiveSpeaker,
		);
		addPeersTo(room, 'p1');
		const p1 = room.peers.get('p1')!;
		const fakeProducer = { id: 'prod-1' };
		p1.producers.set('prod-1', fromPartial(fakeProducer));

		const observer = mgr.getRoom('r1')!.audioLevelObserver!;
		observer.emit(
			'volumes',
			fromPartial([{ producer: fakeProducer, volume: -71 }]),
		);

		expect(onActiveSpeaker).toHaveBeenCalledWith('r1', []);
	});

	it('closeRoom closes the router and removes the room from both maps', async () => {
		const mgr = new RoomManager();
		const router = makeRouter();
		const worker = makeWorker({ router });
		const webRtcServer = makeWebRtcServer();
		await mgr.createRoom('r1', 1, worker, webRtcServer, codecs);

		await mgr.closeRoom('r1');

		expect(vi.mocked(router.close)).toHaveBeenCalled();
		expect(mgr.getRoom('r1')).toBeUndefined();
		expect(mgr.getRouter('r1')).toBeUndefined();
		expect(mgr.getRoomCount()).toBe(0);
	});

	it('closeRoom is a no-op for an unknown room', async () => {
		const mgr = new RoomManager();
		await expect(mgr.closeRoom('nope')).resolves.toBeUndefined();
	});

	it('counts peers across rooms while excluding recorders from participants', async () => {
		const mgr = new RoomManager();
		const first = await mgr.createRoom(
			'r1',
			1,
			makeWorker({ router: makeRouter() }),
			makeWebRtcServer(),
			codecs,
		);
		const second = await mgr.createRoom(
			'r2',
			2,
			makeWorker({ router: makeRouter() }),
			makeWebRtcServer(),
			codecs,
		);
		addPeersTo(first, 'p1', 'recorder:session-1');
		addPeersTo(second, 'p1');

		expect(mgr.getPeerCount()).toBe(3);
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

		await mgr.createRoom('r1', 1, worker1, webRtcServer1, codecs);
		await mgr.createRoom('r2', 2, worker2, webRtcServer2, codecs);

		await mgr.cleanup();

		expect(mgr.getRoomCount()).toBe(0);
		expect(router1.close).toHaveBeenCalled();
		expect(router2.close).toHaveBeenCalled();
	});
});
