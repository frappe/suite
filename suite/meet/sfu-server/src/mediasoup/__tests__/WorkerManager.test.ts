import { describe, expect, it, vi } from 'vitest';
import { WorkerManager } from '../WorkerManager';

const { createWebRtcServer } = vi.hoisted(() => ({
	createWebRtcServer: vi.fn(async () => ({ close: vi.fn() })),
}));

vi.mock('mediasoup', () => ({
	createWorker: vi.fn(async () => ({
		on: vi.fn(),
		close: vi.fn(),
		createWebRtcServer,
	})),
}));

describe('WorkerManager', () => {
	it('requests an 8 MiB UDP receive buffer for every worker listener', async () => {
		const manager = new WorkerManager();
		await manager.initialize(
			2,
			{},
			{
				listenIp: '127.0.0.1',
				announcedAddress: '127.0.0.1',
				basePort: 40000,
			},
		);
		for (const port of [40000, 40001]) {
			expect(createWebRtcServer).toHaveBeenCalledWith({
				listenInfos: [
					{
						protocol: 'udp',
						ip: '127.0.0.1',
						announcedAddress: '127.0.0.1',
						port,
						recvBufferSize: 8388608,
					},
				],
			});
		}
		await manager.cleanup();
	});
});
