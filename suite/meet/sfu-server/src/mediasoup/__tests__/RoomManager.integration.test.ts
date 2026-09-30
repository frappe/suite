import * as mediasoup from 'mediasoup';
import type { WebRtcServer } from 'mediasoup/types';
import { afterEach, describe, expect, it } from 'vitest';
import type { RtpCodecCapability } from '../../types';
import { RoomManager } from '../RoomManager';
import type { WorkerEntry } from '../WorkerManager';

describe('RoomManager mediasoup integration', () => {
	const workers: mediasoup.types.Worker[] = [];
	const codecs: RtpCodecCapability[] = [
		{
			kind: 'audio',
			mimeType: 'audio/opus',
			clockRate: 48000,
			channels: 2,
			preferredPayloadType: 111,
		},
	];

	afterEach(() => {
		for (const worker of workers) worker.close();
		workers.length = 0;
	});

	it('pipes RTP between routers on separate workers with the canonical producer ID', async () => {
		const firstWorker = await mediasoup.createWorker();
		const secondWorker = await mediasoup.createWorker();
		workers.push(firstWorker, secondWorker);
		const entries: WorkerEntry[] = [firstWorker, secondWorker].map(
			(worker, index) => ({
				id: index + 1,
				worker,
				webRtcServer: {} as WebRtcServer,
			}),
		);

		const manager = new RoomManager();
		const room = await manager.createRoom('integration', entries, codecs);
		await manager.assignPeerRouter('integration', 'first', 1, codecs);
		const secondAssignment = await manager.assignPeerRouter(
			'integration',
			'second',
			1,
			codecs,
		);
		const sourceTransport = await room.router.createDirectTransport();
		const sourceProducer = await sourceTransport.produce({
			kind: 'audio',
			rtpParameters: {
				codecs: [
					{
						mimeType: 'audio/opus',
						payloadType: 111,
						clockRate: 48000,
						channels: 2,
						parameters: {},
						rtcpFeedback: [],
					},
				],
				encodings: [{ ssrc: 111_111_111 }],
				rtcp: { cname: 'room-manager-integration' },
			},
		});

		const pipe = await manager.retainProducerOnRouter(
			'integration',
			sourceProducer.id,
			room.router.id,
			secondAssignment.router.id,
		);
		expect(pipe?.pipeProducer.id).toBe(sourceProducer.id);

		const destinationTransport =
			await secondAssignment.router.router.createDirectTransport();
		const destinationConsumer = await destinationTransport.consume({
			producerId: sourceProducer.id,
			rtpCapabilities: secondAssignment.router.router.rtpCapabilities,
		});
		const received = new Promise<Buffer>((resolve) => {
			destinationConsumer.once('rtp', resolve);
		});
		const packet = Buffer.alloc(13);
		packet[0] = 0x80;
		packet[1] = 111;
		packet.writeUInt16BE(1, 2);
		packet.writeUInt32BE(960, 4);
		packet.writeUInt32BE(111_111_111, 8);
		packet[12] = 0xf8;
		sourceProducer.send(packet);

		const receivedPacket = await received;
		expect(receivedPacket[0] >> 6).toBe(2);
		expect(receivedPacket[1] & 0x7f).toBe(111);
		expect(receivedPacket.at(-1)).toBe(packet.at(-1));
		await manager.closeRoom('integration');
	}, 15_000);
});
