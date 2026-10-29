import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ConsumerManager } from '../ConsumerManager';

describe('ConsumerManager', () => {
	it('removes consumer bookkeeping when its transport closes', async () => {
		const manager = new ConsumerManager();
		const consumer = Object.assign(new EventEmitter(), {
			id: 'consumer-1',
			kind: 'audio',
			paused: false,
			producerId: 'producer-1',
			rtpParameters: {},
			close: vi.fn(),
			resume: vi.fn(),
		});
		const transport = {
			id: 'transport-1',
			closed: false,
			dtlsState: 'connected',
			consume: vi.fn().mockResolvedValue(consumer),
		};
		await manager.createConsumer(
			transport as never,
			{ closed: false } as never,
			'producer-1',
			'room-1',
			'peer-1',
			{} as never,
		);
		consumer.emit('transportclose');

		expect(manager.getConsumerCount()).toBe(0);
	});

	it('removes and closes a consumer when its initial resume fails', async () => {
		const manager = new ConsumerManager();
		const consumer = Object.assign(new EventEmitter(), {
			id: 'consumer-1',
			kind: 'audio',
			paused: true,
			producerId: 'producer-1',
			rtpParameters: {},
			close: vi.fn(),
			resume: vi.fn().mockRejectedValue(new Error('resume failed')),
		});
		const transport = {
			id: 'transport-1',
			closed: false,
			dtlsState: 'connected',
			consume: vi.fn().mockResolvedValue(consumer),
		};

		await expect(
			manager.createConsumer(
				transport as never,
				{ closed: false } as never,
				'producer-1',
				'room-1',
				'peer-1',
				{} as never,
			),
		).rejects.toThrow('resume failed');

		expect(manager.getConsumerCount()).toBe(0);
		expect(consumer.close).toHaveBeenCalledTimes(1);
	});
});

describe('receiver-ready startup', () => {
	it.each([
		['video', true, false],
		['audio', true, true],
		['video', false, true],
		['video', undefined, true],
	] as const)('starts %s with readiness requested=%s (running=%s)', async (kind, startPaused, running) => {
		const manager = new ConsumerManager();
		const consumer = Object.assign(new EventEmitter(), {
			id: 'fresh', kind, paused: true, rtpParameters: {}, close: vi.fn(),
			resume: vi.fn(async () => { consumer.paused = false; }),
			requestKeyFrame: vi.fn().mockResolvedValue(undefined),
		});
		const response = await manager.createConsumer({ id: 'recv', closed: false, dtlsState: 'connected', consume: vi.fn().mockResolvedValue(consumer) } as never,
			{ closed: false } as never, 'producer', 'room', 'peer', {}, startPaused);
		expect(response.paused).toBe(!running);
		expect(consumer.paused).toBe(!running);
		expect(consumer.resume).toHaveBeenCalledTimes(running ? 1 : 0);
		expect(consumer.requestKeyFrame).toHaveBeenCalledTimes(running && kind === 'video' ? 1 : 0);
		if (!running) {
			expect(await manager.resumeConsumer('fresh')).toBe(true);
			expect(consumer.paused).toBe(false);
		}
		manager.closeConsumer('fresh');
		expect(await manager.resumeConsumer('fresh')).toBe(false);
		expect(consumer.resume).toHaveBeenCalledTimes(1);
	});
});

describe('idempotent resume', () => {
	async function setup() {
		const manager = new ConsumerManager();
		const consumer = Object.assign(new EventEmitter(), {
			id: 'retry', kind: 'video', paused: true, closed: false, rtpParameters: {},
			close: vi.fn(), requestKeyFrame: vi.fn(),
			resume: vi.fn(async () => { consumer.paused = false; }),
		});
		await manager.createConsumer({ id: 'recv', closed: false, dtlsState: 'connected', consume: vi.fn().mockResolvedValue(consumer) } as never,
			{ closed: false } as never, 'producer', 'room', 'peer', {}, true);
		return { manager, consumer };
	}

	it('accepts sequential readiness retries for a live running consumer', async () => {
		const { manager, consumer } = await setup();
		expect(await manager.resumeConsumer('retry')).toBe(true);
		expect(await manager.resumeConsumer('retry')).toBe(true);
		expect(consumer.resume).toHaveBeenCalledTimes(1);
		expect(consumer.requestKeyFrame).not.toHaveBeenCalled();
	});

	it('accepts concurrent readiness retries', async () => {
		const { manager, consumer } = await setup();
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => { finish = resolve; });
		consumer.resume.mockImplementation(async () => { await pending; consumer.paused = false; });
		const first = manager.resumeConsumer('retry');
		const second = manager.resumeConsumer('retry');
		finish();
		expect(await Promise.all([first, second])).toEqual([true, true]);
		expect(consumer.requestKeyFrame).not.toHaveBeenCalled();
	});

	it('rejects missing, closed, and removed-during-resume consumers', async () => {
		const { manager, consumer } = await setup();
		expect(await manager.resumeConsumer('missing')).toBe(false);
		consumer.closed = true;
		expect(await manager.resumeConsumer('retry')).toBe(false);
		consumer.closed = false;
		consumer.resume.mockImplementation(async () => { manager.closeConsumer('retry'); consumer.paused = false; });
		expect(await manager.resumeConsumer('retry')).toBe(false);
	});

	it('rejects a consumer closed while resume is pending', async () => {
		const { manager, consumer } = await setup();
		let finish!: () => void;
		consumer.resume.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
		const result = manager.resumeConsumer('retry');
		consumer.closed = true;
		consumer.paused = false;
		finish();
		expect(await result).toBe(false);
	});

	it('does not acknowledge a failed resume', async () => {
		const { manager, consumer } = await setup();
		consumer.resume.mockRejectedValue(new Error('worker unavailable'));
		expect(await manager.resumeConsumer('retry')).toBe(false);
		expect(consumer.paused).toBe(true);
	});

});
