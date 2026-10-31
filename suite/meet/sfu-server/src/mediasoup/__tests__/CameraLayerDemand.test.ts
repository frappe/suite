import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraLayerDemand } from '../CameraLayerDemand';

function producer(overrides = {}) {
	return {
		id: 'camera',
		kind: 'video',
		type: 'simulcast',
		closed: false,
		appData: { cameraLayerDemand: true },
		rtpParameters: { encodings: [{}, {}, {}] },
		observer: new EventEmitter(),
		...overrides,
	};
}
function consumer(id: string, layer: number | null = null) {
	return {
		id,
		producerId: 'camera',
		closed: false,
		paused: false,
		preferredLayers: layer === null ? null : { spatialLayer: layer },
		observer: new EventEmitter(),
	};
}
function setup() {
	vi.useFakeTimers();
	const notify = vi.fn();
	const demand = new CameraLayerDemand(notify);
	const camera = producer();
	demand.addProducer(camera as never, 'room', 'publisher');
	return { notify, demand, camera };
}
afterEach(() => vi.useRealTimers());
describe('camera upload demand', () => {
	it('keeps the lowest stream, delays reductions, and never pauses the camera', () => {
		const { notify } = setup();
		vi.advanceTimersByTime(2999);
		expect(notify).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(notify).toHaveBeenLastCalledWith('room', 'publisher', {
			producerId: 'camera',
			version: 2,
			maxSpatialLayer: 0,
		});
	});
	it('keeps the highest requested layer, even when the receiver currently gets a lower layer', () => {
		const { demand, notify } = setup();
		const thumbnail = consumer('thumbnail', 0),
			pin = consumer('pin', 2);
		demand.addConsumer(thumbnail as never);
		demand.addConsumer({ ...pin, currentLayers: { spatialLayer: 0 } } as never);
		vi.advanceTimersByTime(5000);
		expect(notify).not.toHaveBeenCalled();
		pin.observer.emit('close');
		vi.advanceTimersByTime(3000);
		expect(demand.get('camera')?.maxSpatialLayer).toBe(0);
	});
	it('upgrades immediately for a new receiver, including a recorder with unknown preferences', () => {
		const { demand } = setup();
		vi.advanceTimersByTime(3000);
		const recorder = consumer('recorder');
		demand.addConsumer(recorder as never);
		expect(demand.get('camera')).toEqual({
			producerId: 'camera',
			version: 3,
			maxSpatialLayer: 2,
		});
	});
	it('updates demand when a receiver changes size and cancels reductions when demand returns', () => {
		const { demand, notify } = setup();
		const viewer = consumer('viewer', 0);
		demand.addConsumer(viewer as never);
		vi.advanceTimersByTime(2000);
		viewer.preferredLayers = { spatialLayer: 2 };
		demand.preferencesChanged(viewer as never);
		vi.advanceTimersByTime(4000);
		expect(notify).not.toHaveBeenCalled();
		viewer.preferredLayers = { spatialLayer: 1 };
		demand.preferencesChanged(viewer as never);
		vi.advanceTimersByTime(3000);
		expect(demand.get('camera')?.maxSpatialLayer).toBe(1);
	});
	it('drops demand on pause and restores it on resume without waiting', () => {
		const { demand } = setup();
		const viewer = consumer('viewer', 2);
		demand.addConsumer(viewer as never);
		viewer.paused = true;
		viewer.observer.emit('pause');
		vi.advanceTimersByTime(3000);
		expect(demand.get('camera')?.maxSpatialLayer).toBe(0);
		viewer.paused = false;
		viewer.observer.emit('resume');
		expect(demand.get('camera')?.maxSpatialLayer).toBe(2);
	});
	it('cancels scheduled work when a publication closes or the manager cleans up', () => {
		const { demand, camera, notify } = setup();
		camera.observer.emit('close');
		vi.advanceTimersByTime(3000);
		expect(demand.get('camera')).toBeNull();
		expect(notify).not.toHaveBeenCalled();
		demand.addProducer(producer() as never, 'room', 'publisher');
		demand.cleanup();
		vi.advanceTimersByTime(3000);
		expect(notify).not.toHaveBeenCalled();
	});
	it.each([
		{ kind: 'audio' },
		{ appData: { type: 'screen', cameraLayerDemand: true } },
		{
			type: 'svc',
			rtpParameters: { encodings: [{ scalabilityMode: 'L3T1' }] },
		},
		{ appData: {} },
		{ type: 'simple', rtpParameters: { encodings: [{}] } },
	])('leaves unsupported/legacy publications unchanged: %j', (overrides) => {
		const { demand, camera, notify } = setup();
		camera.observer.emit('close');
		demand.addProducer(producer(overrides) as never, 'room', 'publisher');
		vi.advanceTimersByTime(5000);
		expect(demand.get('camera')).toBeNull();
		expect(notify).not.toHaveBeenCalled();
	});
});
