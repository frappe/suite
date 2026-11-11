import { describe, expect, it, vi } from "vitest";
import { CameraLayerController } from "../CameraLayerController";

function setup() {
	const handlers = new Map<string, (data?: unknown) => void>();
	const client = {
		on: vi.fn((event, handler) => handlers.set(event, handler)),
		off: vi.fn((event) => handlers.delete(event)),
		getCameraLayerDemand: vi.fn().mockResolvedValue(null),
	};
	const controller = new CameraLayerController();
	controller.initialize(client as never);
	const producer = {
		id: "camera",
		kind: "video",
		closed: false,
		appData: { type: "camera" },
		rtpParameters: { codecs: [], encodings: [{}, {}, {}] },
		observer: { once: vi.fn() },
		setMaxSpatialLayer: vi.fn().mockResolvedValue(undefined),
	};
	const command = (layer: number, version: number, id = "camera") =>
		handlers.get("producer:camera_layers")?.({
			producerId: id,
			maxSpatialLayer: layer,
			version,
		});
	return { controller, client, producer, command, handlers };
}
const flush = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
describe("camera publisher quality control", () => {
	it("serializes sender changes and restores high quality when an upgrade arrives during a downgrade", async () => {
		const { controller, producer, command } = setup();
		let complete!: () => void;
		producer.setMaxSpatialLayer.mockImplementationOnce(
			() => new Promise<void>((r) => (complete = r)),
		);
		controller.addProducer(producer as never);
		command(0, 2);
		command(2, 3);
		expect(producer.setMaxSpatialLayer.mock.calls).toEqual([[0]]);
		complete();
		await flush();
		expect(producer.setMaxSpatialLayer.mock.calls).toEqual([[0], [2]]);
	});
	it("rejects old versions, malformed layers, and unrelated publication commands", async () => {
		const { controller, producer, command, handlers } = setup();
		controller.addProducer(producer as never);
		command(1, 4);
		await flush();
		command(0, 3);
		command(0, 5, "old-camera");
		command(9, 5);
		handlers.get("producer:camera_layers")?.({
			producerId: "camera",
			version: 6,
			maxSpatialLayer: -1,
		});
		await flush();
		expect(producer.setMaxSpatialLayer.mock.calls).toEqual([[1]]);
	});
	it("refreshes on signaling reconnect without letting an old snapshot override a newer event", async () => {
		const { controller, client, producer, command, handlers } = setup();
		let resolve!: (value: unknown) => void;
		client.getCameraLayerDemand.mockImplementationOnce(
			() => new Promise((r) => (resolve = r)),
		);
		controller.addProducer(producer as never);
		command(1, 4);
		await flush();
		resolve({ producerId: "camera", version: 2, maxSpatialLayer: 0 });
		await flush();
		expect(producer.setMaxSpatialLayer.mock.calls).toEqual([[1]]);
		client.getCameraLayerDemand.mockResolvedValue({
			producerId: "camera",
			version: 5,
			maxSpatialLayer: 2,
		});
		handlers.get("reconnect")?.();
		await flush();
		expect(producer.setMaxSpatialLayer.mock.calls).toEqual([[1], [2]]);
	});
	it("restores full quality and disables optimisation after a sender failure", async () => {
		const { controller, producer, command } = setup();
		controller.addProducer(producer as never);
		command(0, 2);
		await flush();
		producer.setMaxSpatialLayer.mockRejectedValueOnce(new Error("busy"));
		command(2, 3);
		await flush();
		expect(producer.setMaxSpatialLayer.mock.calls).toEqual([[0], [2], [2]]);
		command(0, 4);
		await flush();
		expect(producer.setMaxSpatialLayer).toHaveBeenCalledTimes(3);
		controller.cleanup();
	});
	it("recovers actual sender quality when an upgrade reports success without applying", async () => {
		const { controller, producer, command } = setup();
		let active = [true, true, true], cached: number | undefined, failUpgrade = true;
		controller.addProducer({ ...producer,
			get maxSpatialLayer() { return cached; },
			rtpSender: { getParameters: () => ({ encodings: active.map(active => ({ active })) }) },
			setMaxSpatialLayer: async (layer: number) => {
				cached = layer;
				if (layer === 0) active = [true, false, false];
				else if (failUpgrade) failUpgrade = false; // Browser ignored the upgrade.
				else active = [true, true, true];
			},
		} as never);
		command(0, 2); await flush();
		expect(active).toEqual([true, false, false]);
		command(2, 3); await flush();
		expect(active).toEqual([true, true, true]);
		command(0, 4); await flush();
		expect(active).toEqual([true, true, true]);
	});

	it("ignores outstanding snapshots after cleanup", async () => {
		const { controller, client, producer } = setup();
		let resolve!: (value: unknown) => void;
		client.getCameraLayerDemand.mockImplementation(
			() => new Promise((r) => (resolve = r)),
		);
		controller.addProducer(producer as never);
		controller.cleanup();
		resolve({ producerId: "camera", version: 2, maxSpatialLayer: 0 });
		await flush();
		expect(producer.setMaxSpatialLayer).not.toHaveBeenCalled();
	});
	it.each([
		{ kind: "audio" },
		{ appData: { type: "screen" } },
		{ rtpParameters: { encodings: [{ scalabilityMode: "L3T1" }] } },
	])("does not modify unsupported publication %j", async (overrides) => {
		const { controller, producer, command, client } = setup();
		controller.addProducer({ ...producer, ...overrides } as never);
		command(0, 2);
		await flush();
		expect(producer.setMaxSpatialLayer).not.toHaveBeenCalled();
		expect(client.getCameraLayerDemand).not.toHaveBeenCalled();
	});
});
