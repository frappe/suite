import { describe, expect, it, vi } from 'vitest';
import type { Consumer } from '../../types';
import { MediasoupManager } from '../MediasoupManager';

function makeConsumer(opts: {
	paused: boolean;
	preferredLayers?: { spatialLayer: number; temporalLayer: number } | null;
	currentLayers?: { spatialLayer: number; temporalLayer: number } | null;
}): Consumer {
	return {
		id: 'c1',
		kind: 'video',
		paused: opts.paused,
		preferredLayers: opts.preferredLayers ?? {
			spatialLayer: 1,
			temporalLayer: 1,
		},
		currentLayers: opts.currentLayers ?? {
			spatialLayer: 1,
			temporalLayer: 1,
		},
		rtpParameters: { encodings: [{ scalabilityMode: 'L3T1' }] },
		requestKeyFrame: vi.fn().mockResolvedValue(undefined),
		setPreferredLayers: vi.fn(),
	} as unknown as Consumer;
}

describe('MediasoupManager.updateConsumerPreferences', () => {
	it('requests a keyframe when a paused consumer is resumed with no layer change', async () => {
		const mgr = new MediasoupManager();
		const consumer = makeConsumer({ paused: true });
		vi.spyOn(mgr.consumerManager, 'getConsumerData').mockReturnValue({
			roomId: 'r1',
			peerId: 'p1',
			consumer,
		} as never);
		vi.spyOn(mgr.consumerManager, 'resumeConsumer').mockResolvedValue(true);
		vi.spyOn(
			mgr.consumerManager,
			'setConsumerPreferredLayers',
		).mockResolvedValue(null);

		await mgr.updateConsumerPreferences({
			consumerId: 'c1',
			visible: true,
			width: 640,
			height: 360,
		});

		expect(consumer.requestKeyFrame).toHaveBeenCalledTimes(1);
	});

	it('does not request a keyframe on a running consumer with no layer change', async () => {
		const mgr = new MediasoupManager();
		const consumer = makeConsumer({ paused: false });
		vi.spyOn(mgr.consumerManager, 'getConsumerData').mockReturnValue({
			roomId: 'r1',
			peerId: 'p1',
			consumer,
		} as never);
		vi.spyOn(mgr.consumerManager, 'resumeConsumer').mockResolvedValue(true);
		vi.spyOn(
			mgr.consumerManager,
			'setConsumerPreferredLayers',
		).mockResolvedValue(null);

		await mgr.updateConsumerPreferences({
			consumerId: 'c1',
			visible: true,
			width: 640,
			height: 360,
		});

		expect(consumer.requestKeyFrame).not.toHaveBeenCalled();
	});
});

describe('MediasoupManager.createConsumer', () => {
	it('keeps an existing consumer when its replacement fails', async () => {
		const mgr = new MediasoupManager();
		const internals = mgr as unknown as {
			transportManager: {
				getTransportData: (transportId: string) => unknown;
			};
			producerManager: {
				getProducerData: (producerId: string) => unknown;
			};
			roomManager: { getRoom: (roomId: string) => unknown };
		};
		const existing = { id: 'existing', producerId: 'producer-1' };
		vi.spyOn(internals.transportManager, 'getTransportData').mockReturnValue({
			roomId: 'room-1',
			peerId: 'peer-1',
			transport: {},
		} as never);
		vi.spyOn(internals.producerManager, 'getProducerData').mockReturnValue({
			peerId: 'peer-2',
			producer: { appData: {} },
		} as never);
		vi.spyOn(internals.roomManager, 'getRoom').mockReturnValue({
			router: { canConsume: () => true },
			peers: new Map(),
		} as never);
		vi.spyOn(mgr.consumerManager, 'getConsumersByPeer').mockReturnValue([
			{ consumer: existing } as never,
		]);
		const closeConsumer = vi.spyOn(mgr.consumerManager, 'closeConsumer');
		vi.spyOn(mgr.consumerManager, 'createConsumer').mockRejectedValue(
			new Error('consume failed'),
		);

		await expect(
			mgr.createConsumer('transport-1', 'producer-1', {} as never),
		).rejects.toThrow('consume failed');

		expect(closeConsumer).not.toHaveBeenCalled();
	});
});
