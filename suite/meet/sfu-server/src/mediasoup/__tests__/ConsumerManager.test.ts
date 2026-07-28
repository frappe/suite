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
		const onClose = vi.fn();
		manager.onClose(onClose);

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
		expect(onClose).toHaveBeenCalledWith(
			expect.objectContaining({
				roomId: 'room-1',
				peerId: 'peer-1',
				transportId: 'transport-1',
			}),
		);
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
