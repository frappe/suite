import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TransportManager } from '../TransportManager';

function makeTransport(id: string) {
	const observer = new EventEmitter();
	return Object.assign(new EventEmitter(), {
		id,
		observer,
		iceParameters: {},
		iceCandidates: [],
		dtlsParameters: {},
		close: vi.fn(() => observer.emit('close')),
	});
}

const options = {
	enableTcp: true,
	initialAvailableOutgoingBitrate: 1_000_000,
};

describe('TransportManager', () => {
	it('shares one transport across concurrent receive creation requests', async () => {
		const manager = new TransportManager();
		const transport = makeTransport('recv-1');
		const router = {
			createWebRtcTransport: vi.fn().mockResolvedValue(transport),
		};

		const [first, second] = await Promise.all([
			manager.createWebRtcTransport(
				'room-1',
				'peer-1',
				router as never,
				{} as never,
				'recv',
				options,
			),
			manager.createWebRtcTransport(
				'room-1',
				'peer-1',
				router as never,
				{} as never,
				'recv',
				options,
			),
		]);

		expect(router.createWebRtcTransport).toHaveBeenCalledTimes(1);
		expect(first.id).toBe('recv-1');
		expect(second.id).toBe('recv-1');
		expect(manager.getTransportCount()).toBe(1);
	});

	it('closes the previous receive transport when replacing it', async () => {
		const manager = new TransportManager();
		const first = makeTransport('recv-1');
		const second = makeTransport('recv-2');
		const router = {
			createWebRtcTransport: vi
				.fn()
				.mockResolvedValueOnce(first)
				.mockResolvedValueOnce(second),
		};

		await manager.createWebRtcTransport(
			'room-1',
			'peer-1',
			router as never,
			{} as never,
			'recv',
			options,
		);
		await manager.createWebRtcTransport(
			'room-1',
			'peer-1',
			router as never,
			{} as never,
			'recv',
			options,
		);

		expect(first.close).toHaveBeenCalledTimes(1);
		expect(manager.getTransport('recv-1')).toBeUndefined();
		expect(manager.getTransport('recv-2')).toBe(second);
		expect(manager.getTransportCount()).toBe(1);
	});

	it('discards a transport that finishes after the peer was removed', async () => {
		const manager = new TransportManager();
		const transport = makeTransport('stale-recv');
		let resolveTransport: (
			transport: ReturnType<typeof makeTransport>,
		) => void = () => {};
		const router = {
			createWebRtcTransport: vi.fn().mockReturnValue(
				new Promise((resolve) => {
					resolveTransport = resolve;
				}),
			),
		};

		const creation = manager.createWebRtcTransport(
			'room-1',
			'peer-1',
			router as never,
			{} as never,
			'recv',
			options,
		);
		manager.closePeerTransports('room-1', 'peer-1');
		resolveTransport(transport);

		await expect(creation).rejects.toThrow('cancelled');
		expect(transport.close).toHaveBeenCalledTimes(1);
		expect(manager.getTransportCount()).toBe(0);
	});
});
