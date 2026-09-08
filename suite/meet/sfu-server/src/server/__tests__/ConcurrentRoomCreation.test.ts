import { EventEmitter } from 'node:events';
import type {
	AudioLevelObserver,
	Router,
	WebRtcServer,
	Worker,
} from 'mediasoup/types';
import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config';
import { MediasoupManager } from '../../mediasoup/MediasoupManager';
import { WorkerManager } from '../../mediasoup/WorkerManager';
import { createManager, type MockSocket } from './test-helpers';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function router() {
	return {
		close: vi.fn(),
		createAudioLevelObserver: vi
			.fn()
			.mockResolvedValue(new EventEmitter() as AudioLevelObserver),
	} as unknown as Router;
}

function fixture() {
	const createRouter = vi.fn<Worker['createRouter']>();
	vi.spyOn(WorkerManager.prototype, 'getNextWorker').mockReturnValue({
		id: 1,
		worker: { createRouter } as unknown as Worker,
		webRtcServer: {} as WebRtcServer,
	});
	const media = new MediasoupManager(
		loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret' }).mediasoup,
	);
	const harness = createManager(undefined, undefined, media);
	const sockets = ['alice', 'bob'].map((userId) => {
		const socket = harness.createSocket({ id: userId, userId });
		harness.connect(socket);
		return socket;
	});
	return { media, createRouter, sockets };
}

function join(socket: MockSocket) {
	return new Promise<unknown>((resolve) =>
		socket.fire(
			'join_room',
			{
				roomId: socket.meetingId,
				userData: { name: socket.userId },
				mediaState: { audio_enabled: true, video_enabled: true },
			},
			resolve,
		),
	);
}

afterEach(() => vi.restoreAllMocks());

it('places the next room on the next worker after concurrent first joins', async () => {
	const { media, createRouter, sockets } = fixture();
	createRouter.mockImplementation(async () => router());
	const workers = [1, 2].map((id) => ({
		id,
		worker: { createRouter } as unknown as Worker,
		webRtcServer: {} as WebRtcServer,
	}));
	let nextWorker = 0;
	vi.mocked(WorkerManager.prototype.getNextWorker).mockImplementation(
		() => workers[nextWorker++ % workers.length],
	);
	for (const result of await Promise.all(sockets.map(join)))
		expect(result).toMatchObject({ success: true });
	expect((await media.createRoom('room-2')).workerId).toBe(2);
	expect((await media.createRoom('room-1')).workerId).toBe(1);
	expect((await media.createRoom('room-3')).workerId).toBe(1);
	await media.closeRoom('room-1');
	await media.closeRoom('room-2');
	await media.closeRoom('room-3');
});

it('allows another room to admit a participant while creation is pending', async () => {
	const { media, createRouter, sockets } = fixture();
	const pending = deferred<Router>();
	createRouter.mockReturnValueOnce(pending.promise).mockResolvedValue(router());
	const firstJoin = join(sockets[0]);
	await new Promise((resolve) => setImmediate(resolve));
	sockets[1].meetingId = 'room-2';
	expect(await join(sockets[1])).toMatchObject({ success: true });
	expect(media.getRoomPeers('room-1')).toBeUndefined();
	expect([...media.getRoomPeers('room-2')!.keys()]).toEqual(['bob']);
	pending.resolve(router());
	expect(await firstJoin).toMatchObject({ success: true });
	await media.closeRoom('room-1');
	await media.closeRoom('room-2');
});

it('closes every allocated router after simultaneous joins and room closure', async () => {
	const { media, createRouter, sockets } = fixture();
	const routers: Router[] = [];
	createRouter.mockImplementation(async () => {
		const allocated = router();
		routers.push(allocated);
		return allocated;
	});
	for (const result of await Promise.all(sockets.map(join))) {
		expect(result).toMatchObject({ success: true });
	}
	expect([...media.getRoomPeers('room-1')!.keys()].sort()).toEqual([
		'alice',
		'bob',
	]);
	await media.closeRoom('room-1');
	for (const allocated of routers)
		expect(allocated.close).toHaveBeenCalledOnce();
	expect(routers).toHaveLength(1);
});

it('retains both admitted peers when a concurrent room creation finishes after the first join', async () => {
	const { media, createRouter, sockets } = fixture();
	const first = deferred<Router>();
	const second = deferred<Router>();
	const routers = [router(), router()];
	createRouter
		.mockReturnValueOnce(first.promise)
		.mockReturnValueOnce(second.promise);
	const joins = sockets.map(join);
	await new Promise((resolve) => setImmediate(resolve));
	first.resolve(routers[0]);
	expect(await joins[0]).toMatchObject({ success: true });
	expect(media.getRoomPeers('room-1')?.has('alice')).toBe(true);
	second.resolve(routers[1]);
	expect(await joins[1]).toMatchObject({ success: true });
	expect([...media.getRoomPeers('room-1')!.keys()].sort()).toEqual([
		'alice',
		'bob',
	]);
	expect(createRouter).toHaveBeenCalledTimes(1);
	await media.closeRoom('room-1');
	expect(routers[0].close).toHaveBeenCalledOnce();
});

it.each([
	'router',
	'observer',
])('rolls back concurrent joins on %s failure and permits retry', async (stage) => {
	const { media, createRouter, sockets } = fixture();
	const pending = deferred<Router>();
	const observer = deferred<AudioLevelObserver>();
	const failedRouter = router();
	vi.mocked(failedRouter.createAudioLevelObserver).mockReturnValue(
		observer.promise,
	);
	createRouter.mockReturnValue(pending.promise);
	const joins = sockets.map(join);
	await new Promise((resolve) => setImmediate(resolve));
	if (stage === 'router') pending.reject(new Error('initialization failed'));
	else {
		pending.resolve(failedRouter);
		await new Promise((resolve) => setImmediate(resolve));
		observer.reject(new Error('initialization failed'));
	}
	expect(await Promise.all(joins)).toEqual([
		{ success: false, error: 'initialization failed' },
		{ success: false, error: 'initialization failed' },
	]);
	expect(media.getRoomPeers('room-1')).toBeUndefined();
	if (stage === 'observer') expect(failedRouter.close).toHaveBeenCalledOnce();
	createRouter.mockResolvedValue(router());
	for (const socket of sockets)
		expect(await join(socket)).toMatchObject({ success: true });
	expect([...media.getRoomPeers('room-1')!.keys()].sort()).toEqual([
		'alice',
		'bob',
	]);
	await media.closeRoom('room-1');
});
