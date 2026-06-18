import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransportManager } from "../TransportManager";

vi.mock("../codecStrategy", () => ({
	resolveCodecStrategy: vi.fn(),
}));

import { resolveCodecStrategy } from "../codecStrategy";

beforeEach(() => {
	vi.clearAllMocks();
});

function createManager() {
	return new TransportManager();
}

function mockSfuClient(getCodecStrategy?: () => string) {
	return {
		getCodecStrategy: getCodecStrategy ?? (() => "svc"),
		getRouterRtpCapabilities: vi.fn(),
		createWebRtcTransport: vi.fn(),
		connectWebRtcTransport: vi.fn(),
		createProducer: vi.fn(),
		createConsumer: vi.fn(),
		restartWebRtcTransportIce: vi.fn(),
	};
}

describe("getVideoEncodingDecision", () => {
	it("returns resolveCodecStrategy result using sfuClient pref", () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient(() => "simulcast") as never;
		manager.device = { rtpCapabilities: { codecs: [] } } as never;
		manager.routerRtpCapabilities = { codecs: [] };

		vi.mocked(resolveCodecStrategy).mockReturnValue({
			strategy: "simulcast",
			scalabilityMode: null,
			didDowngrade: false,
			requested: "simulcast",
		});

		const result = manager.getVideoEncodingDecision();
		expect(result.strategy).toBe("simulcast");
		expect(resolveCodecStrategy).toHaveBeenCalledWith({
			preference: "simulcast",
			deviceCapabilities: manager.device?.rtpCapabilities,
			routerCapabilities: manager.routerRtpCapabilities,
		});
	});

	it("falls back to svc when sfuClient has no getCodecStrategy", () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		(manager.sfuClient as unknown as Record<string, unknown>).getCodecStrategy =
			undefined;
		manager.device = { rtpCapabilities: { codecs: [] } } as never;
		manager.routerRtpCapabilities = { codecs: [] };

		vi.mocked(resolveCodecStrategy).mockReturnValue({
			strategy: "svc",
			scalabilityMode: "L3T1",
			didDowngrade: false,
			requested: "svc",
		});

		const result = manager.getVideoEncodingDecision();
		expect(resolveCodecStrategy).toHaveBeenCalledWith(
			expect.objectContaining({ preference: "svc" }),
		);
		expect(result.strategy).toBe("svc");
	});
});

describe("getVideoEncodingConfig", () => {
	it("returns svc encoding template for svc strategy camera source", () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.device = { rtpCapabilities: { codecs: [] } } as never;
		manager.routerRtpCapabilities = { codecs: [] };

		vi.mocked(resolveCodecStrategy).mockReturnValue({
			strategy: "svc",
			scalabilityMode: "L3T1",
			didDowngrade: false,
			requested: "svc",
		});

		const config = manager.getVideoEncodingConfig("camera");
		expect(config.decision.strategy).toBe("svc");
		expect(config.decision.scalabilityMode).toBe("L3T1");
		expect(config.encodings).toHaveLength(1);
		expect(
			(config.encodings[0] as unknown as { scalabilityMode: string })
				.scalabilityMode,
		).toBe("L3T1");
	});

	it("returns videoEncodings for simulcast camera source", () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.device = { rtpCapabilities: { codecs: [] } } as never;
		manager.routerRtpCapabilities = { codecs: [] };

		vi.mocked(resolveCodecStrategy).mockReturnValue({
			strategy: "simulcast",
			scalabilityMode: null,
			didDowngrade: false,
			requested: "simulcast",
		});

		const config = manager.getVideoEncodingConfig("camera");
		expect(config.decision.strategy).toBe("simulcast");
		expect(config.decision.scalabilityMode).toBeNull();
		expect(config.encodings).toHaveLength(3);
	});

	it("returns screenEncodings for screen source regardless of strategy", () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.device = { rtpCapabilities: { codecs: [] } } as never;
		manager.routerRtpCapabilities = { codecs: [] };

		vi.mocked(resolveCodecStrategy).mockReturnValue({
			strategy: "simulcast",
			scalabilityMode: null,
			didDowngrade: false,
			requested: "simulcast",
		});

		const config = manager.getVideoEncodingConfig("screen");
		expect(config.decision.strategy).toBe("single");
		expect(config.decision.scalabilityMode).toBeNull();
		expect(config.encodings).toHaveLength(1);
		expect(config.encodings[0].maxBitrate).toBe(2_000_000);
	});
});

describe("extractRouterRtpCapabilities", () => {
	it("extracts rtpCapabilities key from response", () => {
		const manager = createManager();
		const result = (manager as unknown as Record<string, unknown>)
			.extractRouterRtpCapabilities as (resp: unknown) => unknown;
		const response = { rtpCapabilities: { codecs: [] } };
		expect(result(response)).toEqual({ codecs: [] });
	});

	it("returns response as-is when no rtpCapabilities key", () => {
		const manager = createManager();
		const result = (manager as unknown as Record<string, unknown>)
			.extractRouterRtpCapabilities as (resp: unknown) => unknown;
		const response = { codecs: [] };
		expect(result(response)).toEqual(response);
	});
});

describe("getTransportStats / isDeviceLoaded / getDeviceCapabilities", () => {
	it("getTransportStats returns closed state when transports are null", () => {
		const manager = createManager();
		const stats = manager.getTransportStats();
		expect(stats.sendTransport.state).toBe("closed");
		expect(stats.recvTransport.state).toBe("closed");
	});

	it("isDeviceLoaded returns false when no device", () => {
		const manager = createManager();
		expect(manager.isDeviceLoaded()).toBe(false);
	});

	it("getDeviceCapabilities returns null when no device", () => {
		const manager = createManager();
		expect(manager.getDeviceCapabilities()).toBeNull();
	});
});

describe("emitTransportConnectionState", () => {
	it("calls event handler when set", () => {
		const manager = createManager();
		const handler = vi.fn();
		manager.eventHandlers.onTransportConnectionStateChange = handler;
		manager.emitTransportConnectionState("send", "connected");
		expect(handler).toHaveBeenCalledWith({
			direction: "send",
			state: "connected",
		});
	});

	it("does not throw when no event handler set", () => {
		const manager = createManager();
		expect(() => {
			manager.emitTransportConnectionState("recv", "failed");
		}).not.toThrow();
	});
});

describe("restartAllTransportIce", () => {
	it("returns true if at least one transport ice restart succeeds", async () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		const restartIce = vi.fn();
		manager.sendTransport = {
			id: "send-tp",
			connectionState: "connected",
			restartIce,
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		vi.mocked(
			(manager.sfuClient as unknown as Record<string, unknown>)
				.restartWebRtcTransportIce as ReturnType<typeof vi.fn>,
		).mockResolvedValue({ iceParams: true });
		const result = await manager.restartAllTransportIce();
		expect(result).toBe(true);
	});

	it("returns false when all ice restarts fail", async () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.sendTransport = {
			id: "send-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		vi.mocked(
			(manager.sfuClient as unknown as Record<string, unknown>)
				.restartWebRtcTransportIce as ReturnType<typeof vi.fn>,
		).mockRejectedValue(new Error("fail"));
		const result = await manager.restartAllTransportIce();
		expect(result).toBe(false);
	});
});

describe("cleanup", () => {
	it("resets transports and device to null", () => {
		const manager = createManager();
		manager.sendTransport = { close: vi.fn() } as never;
		manager.recvTransport = { close: vi.fn() } as never;
		manager.device = {} as never;
		manager.cleanup();
		expect(manager.sendTransport).toBeNull();
		expect(manager.recvTransport).toBeNull();
		expect(manager.device).toBeNull();
	});
});

describe("getNetworkStats", () => {
	it("returns default values when no transports", async () => {
		const manager = createManager();
		const stats = await manager.getNetworkStats();
		expect(stats.isValid).toBe(false);
		expect(stats.rtt).toBe(0);
		expect(stats.packetLoss).toBe(0);
	});

	it("aggregates RTT from candidate-pair stats", async () => {
		const manager = createManager();
		manager.sendTransport = {
			id: "s",
			connectionState: "connected",
			getStats: vi.fn().mockResolvedValue(
				new Map([
					[
						"pair1",
						{
							type: "candidate-pair",
							state: "succeeded",
							currentRoundTripTime: 0.05,
							availableOutgoingBitrate: 500000,
						},
					],
				]),
			),
		} as never;
		manager.recvTransport = null;
		const stats = await manager.getNetworkStats();
		expect(stats.rtt).toBe(50);
		expect(stats.availableOutgoingBitrate).toBe(500000);
		expect(stats.isValid).toBe(true);
	});

	it("calculates packet loss percentage from inbound-rtp", async () => {
		const manager = createManager();
		manager.recvTransport = {
			id: "r",
			connectionState: "connected",
			getStats: vi.fn().mockResolvedValue(
				new Map([
					[
						"in1",
						{
							type: "inbound-rtp",
							packetsReceived: 80,
							packetsLost: 20,
						},
					],
				]),
			),
		} as never;
		manager.sendTransport = null;
		const stats = await manager.getNetworkStats();
		expect(stats.packetLoss).toBe(20);
		expect(stats.isValid).toBe(true);
	});

	it("includes remote-inbound-rtp RTT in average", async () => {
		const manager = createManager();
		manager.sendTransport = {
			id: "s",
			connectionState: "connected",
			getStats: vi.fn().mockResolvedValue(
				new Map([
					[
						"remote1",
						{
							type: "remote-inbound-rtp",
							roundTripTime: 0.1,
						},
					],
				]),
			),
		} as never;
		manager.recvTransport = null;
		const stats = await manager.getNetworkStats();
		expect(stats.rtt).toBe(100);
		expect(stats.isValid).toBe(true);
	});

	it("averages RTT across multiple reports", async () => {
		const manager = createManager();
		manager.sendTransport = {
			id: "s",
			connectionState: "connected",
			getStats: vi.fn().mockResolvedValue(
				new Map([
					[
						"pair1",
						{
							type: "candidate-pair",
							state: "succeeded",
							currentRoundTripTime: 0.02,
						},
					],
					[
						"pair2",
						{
							type: "candidate-pair",
							state: "succeeded",
							currentRoundTripTime: 0.06,
						},
					],
				]),
			),
		} as never;
		manager.recvTransport = null;
		const stats = await manager.getNetworkStats();
		expect(stats.rtt).toBe(40);
	});

	it("skips disconnected transports", async () => {
		const manager = createManager();
		const getStats = vi.fn();
		manager.sendTransport = {
			id: "s",
			connectionState: "disconnected",
			getStats,
		} as never;
		await manager.getNetworkStats();
		expect(getStats).not.toHaveBeenCalled();
	});
});
