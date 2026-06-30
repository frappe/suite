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
