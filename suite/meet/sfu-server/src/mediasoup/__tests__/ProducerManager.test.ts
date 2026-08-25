import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ProducerManager } from '../ProducerManager';

function makeProducer() {
	return Object.assign(new EventEmitter(), {
		id: 'producer-1',
		kind: 'video' as const,
		appData: {},
		closed: false,
		close: vi.fn(),
	});
}

describe('ProducerManager', () => {
	it('reports transport closure for central producer finalization', async () => {
		const manager = new ProducerManager();
		const producer = makeProducer();
		const transport = { produce: vi.fn().mockResolvedValue(producer) };
		const transportClosed = vi.fn();
		manager.on('producer_transport_closed', transportClosed);

		await manager.createProducer(
			transport as never,
			'room-1',
			'peer-1',
			{} as never,
			'video',
		);
		producer.emit('transportclose');

		expect(transportClosed).toHaveBeenCalledWith('producer-1');
	});

	it('finalizes repeated close requests once', async () => {
		const manager = new ProducerManager();
		const producer = makeProducer();
		producer.close.mockImplementation(() => {
			producer.closed = true;
			producer.emit('transportclose');
		});
		const transport = { produce: vi.fn().mockResolvedValue(producer) };
		const closed = vi.fn();
		manager.on('producer_closed', closed);

		await manager.createProducer(
			transport as never,
			'room-1',
			'peer-1',
			{} as never,
			'video',
		);
		manager.closeProducer('producer-1');
		manager.closeProducer('producer-1');

		expect(producer.close).toHaveBeenCalledTimes(1);
		expect(closed).toHaveBeenCalledTimes(1);
		expect(manager.getProducerCount()).toBe(0);
	});
});
