import { beforeEach, describe, expect, it, vi } from "vitest";
import { E2EEMeeting } from "../E2EEMeeting";
import { DefaultE2EETransformPolicy } from "../E2EETransformPolicy";
import type { E2EETransformPolicy } from "../E2EETransformPolicy";
import { TransportManager } from "../TransportManager";

vi.mock("../codecStrategy", () => ({
	resolveCodecStrategy: vi.fn(),
}));

import { resolveCodecStrategy } from "../codecStrategy";

beforeEach(() => {
	vi.clearAllMocks();
	E2EEMeeting.instance = new E2EEMeeting();
});

function createManager() {
	return new TransportManager();
}

function mockedIceRestart(manager: TransportManager) {
	if (!manager.sfuClient) throw new Error("Missing mock SFU client");
	return vi.mocked(manager.sfuClient.restartWebRtcTransportIce);
}

function mockSfuClient(getCodecStrategy?: () => string) {
	return {
		getCodecStrategy: getCodecStrategy ?? (() => "svc"),
		getE2EEMode: vi.fn(() => "none"),
		isE2EERequired: vi.fn(() => false),
		getRouterRtpCapabilities: vi.fn(),
		createWebRtcTransport: vi.fn(),
		connectWebRtcTransport: vi.fn(),
		createProducer: vi.fn(),
		createConsumer: vi.fn(),
		closeProducer: vi.fn().mockResolvedValue(undefined),
		resumeProducer: vi.fn().mockResolvedValue({ success: true, resumed: true }),
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
		Reflect.set(manager.sfuClient, "getCodecStrategy", undefined);
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
			config.encodings[0] && "scalabilityMode" in config.encodings[0]
				? config.encodings[0].scalabilityMode
				: undefined,
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
		expect(config.encodings.map((encoding) => encoding.scaleResolutionDownBy)).toEqual([
			4,
			2,
			undefined,
		]);
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
		expect(config.encodings[0].maxBitrate).toBe(4_000_000);
	});
});

describe("E2EE transport options", () => {
	it("enables legacy encodedInsertableStreams only for legacy mode", () => {
		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);
		const policy = new DefaultE2EETransformPolicy({
			...mockSfuClient(),
			isE2EERequired: vi.fn(() => true),
			getE2EEMode: vi.fn(() => "insertable-streams"),
		} as never);
		const manager = new TransportManager(policy);

		expect(manager.e2eePolicy.legacyInsertableStreamsEnabled).toBe(true);
	});

	it("does not enable legacy encodedInsertableStreams for RTCRtpScriptTransform", () => {
		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);
		const policy = new DefaultE2EETransformPolicy({
			...mockSfuClient(),
			isE2EERequired: vi.fn(() => true),
			getE2EEMode: vi.fn(() => "rtp-script-transform"),
		} as never);
		const manager = new TransportManager(policy);

		expect(manager.e2eePolicy.legacyInsertableStreamsEnabled).toBe(false);
	});

	it("passes sender transform setup through onRtpSender before produce resolves", async () => {
		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);
		const client = {
			...mockSfuClient(),
			isE2EERequired: vi.fn(() => true),
			getE2EEMode: vi.fn(() => "rtp-script-transform"),
			getOwnSenderId: vi.fn(() => 7),
		};
		const policy = new DefaultE2EETransformPolicy(client as never);
		vi.spyOn(policy, "setupSenderTransform").mockResolvedValue(true);
		const manager = new TransportManager(policy);
		manager.initialize(client as never);
		manager.device = { canProduce: vi.fn(() => true) } as never;
		const produce = vi.fn(async () => ({ id: "producer-1", rtpSender: {} }));
		manager.sendTransport = { produce } as never;

		await manager.createProducer({
			id: "track-1",
			kind: "audio",
			readyState: "live",
		} as MediaStreamTrack);

		expect(produce).toHaveBeenCalledWith(
			expect.objectContaining({
				onRtpSender: expect.any(Function),
			}),
		);
	});

	it.each([
		{
			type: "camera",
			kind: "video",
			outcome: "returns false",
			setupSenderTransform: vi.fn().mockResolvedValue(false),
		},
		{
			type: "microphone",
			kind: "audio",
			outcome: "rejects",
			setupSenderTransform: vi.fn().mockRejectedValue(new Error("transform rejected")),
		},
		{
			type: "screen",
			kind: "video",
			outcome: "returns false",
			setupSenderTransform: vi.fn().mockResolvedValue(false),
		},
	] as const)(
		"discards $type producer when sender transform $outcome",
		async ({ type, kind, setupSenderTransform }) => {
			const client = mockSfuClient();
			const policy = {
				transformsEnabled: true,
				legacyInsertableStreamsEnabled: false,
				ownSenderId: 7,
				hasContext: true,
				setSFUClient: vi.fn(),
				assertContextReady: vi.fn(),
				setupSenderTransform,
				preCreateReceiverStreams: vi.fn(),
				setupReceiverTransform: vi.fn(),
			} satisfies E2EETransformPolicy;
			const close = vi.fn();
			const producer = {
				id: `${type}-producer`,
				rtpSender: {},
				close,
			};
			const manager = new TransportManager(policy);
			manager.initialize(client as never);
			manager.device = {
				canProduce: vi.fn(() => true),
				rtpCapabilities: { codecs: [] },
			} as never;
			manager.sendTransport = {
				produce: vi.fn().mockResolvedValue(producer),
			} as never;
			vi.mocked(resolveCodecStrategy).mockReturnValue({
				strategy: "simulcast",
				scalabilityMode: null,
				didDowngrade: false,
				requested: "simulcast",
			});

			await expect(
				manager.createProducer(
					{ id: `${type}-track`, kind, readyState: "live" } as MediaStreamTrack,
					{ type },
				),
			).rejects.toThrow();

			expect(client.resumeProducer).not.toHaveBeenCalled();
			expect(close).toHaveBeenCalledOnce();
			expect(client.closeProducer).toHaveBeenCalledWith(`${type}-producer`, {});
		},
	);

	it("discards an encrypted producer when server resume rejects", async () => {
		const client = mockSfuClient();
		client.resumeProducer.mockRejectedValue(new Error("resume failed"));
		const policy = {
			transformsEnabled: true,
			legacyInsertableStreamsEnabled: false,
			ownSenderId: 7,
			hasContext: true,
			setSFUClient: vi.fn(),
			assertContextReady: vi.fn(),
			setupSenderTransform: vi.fn().mockResolvedValue(true),
			preCreateReceiverStreams: vi.fn(),
			setupReceiverTransform: vi.fn(),
		} satisfies E2EETransformPolicy;
		const producer = {
			id: "resumeless-producer",
			rtpSender: {},
			close: vi.fn(),
		};
		const manager = new TransportManager(policy);
		manager.initialize(client as never);
		manager.device = { canProduce: vi.fn(() => true) } as never;
		manager.sendTransport = {
			produce: vi.fn().mockResolvedValue(producer),
		} as never;

		await expect(
			manager.createProducer({
				id: "microphone-track",
				kind: "audio",
				readyState: "live",
			} as MediaStreamTrack),
		).rejects.toThrow("resume failed");

		expect(producer.close).toHaveBeenCalledOnce();
		expect(client.closeProducer).toHaveBeenCalledWith("resumeless-producer", {});
	});

	it("can retry producer creation when server does not resume it", async () => {
		const client = mockSfuClient();
		client.resumeProducer
			.mockResolvedValueOnce({ success: true, resumed: false })
			.mockResolvedValueOnce({ success: true, resumed: true });
		const policy = {
			transformsEnabled: true,
			legacyInsertableStreamsEnabled: false,
			ownSenderId: 7,
			hasContext: true,
			setSFUClient: vi.fn(),
			assertContextReady: vi.fn(),
			setupSenderTransform: vi.fn().mockResolvedValue(true),
			preCreateReceiverStreams: vi.fn(),
			setupReceiverTransform: vi.fn(),
		} satisfies E2EETransformPolicy;
		const failedProducer = {
			id: "not-resumed-producer",
			rtpSender: {},
			close: vi.fn(),
		};
		const retriedProducer = {
			id: "resumed-producer",
			rtpSender: {},
			close: vi.fn(),
		};
		const manager = new TransportManager(policy);
		manager.initialize(client as never);
		manager.device = { canProduce: vi.fn(() => true) } as never;
		manager.sendTransport = {
			produce: vi
				.fn()
				.mockResolvedValueOnce(failedProducer)
				.mockResolvedValueOnce(retriedProducer),
		} as never;
		const track = {
			id: "microphone-track",
			kind: "audio",
			readyState: "live",
		} as MediaStreamTrack;

		await expect(manager.createProducer(track)).rejects.toThrow(
			"Failed to resume E2EE producer",
		);
		await expect(manager.createProducer(track)).resolves.toBe(retriedProducer);

		expect(failedProducer.close).toHaveBeenCalledOnce();
		expect(retriedProducer.close).not.toHaveBeenCalled();
		expect(client.closeProducer).toHaveBeenCalledOnce();
		expect(client.closeProducer).toHaveBeenCalledWith("not-resumed-producer", {});
		expect(client.resumeProducer).toHaveBeenNthCalledWith(
			1,
			"not-resumed-producer",
		);
		expect(client.resumeProducer).toHaveBeenNthCalledWith(2, "resumed-producer");
	});

	it("can retry producer creation after E2EE setup fails", async () => {
		const client = mockSfuClient();
		const setupSenderTransform = vi
			.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const policy = {
			transformsEnabled: true,
			legacyInsertableStreamsEnabled: false,
			ownSenderId: 7,
			hasContext: true,
			setSFUClient: vi.fn(),
			assertContextReady: vi.fn(),
			setupSenderTransform,
			preCreateReceiverStreams: vi.fn(),
			setupReceiverTransform: vi.fn(),
		} satisfies E2EETransformPolicy;
		const failedProducer = {
			id: "failed-producer",
			rtpSender: {},
			close: vi.fn(),
		};
		const retriedProducer = {
			id: "retried-producer",
			rtpSender: {},
			close: vi.fn(),
		};
		const manager = new TransportManager(policy);
		manager.initialize(client as never);
		manager.device = { canProduce: vi.fn(() => true) } as never;
		manager.sendTransport = {
			produce: vi
				.fn()
				.mockResolvedValueOnce(failedProducer)
				.mockResolvedValueOnce(retriedProducer),
		} as never;
		const track = {
			id: "microphone-track",
			kind: "audio",
			readyState: "live",
		} as MediaStreamTrack;

		await expect(manager.createProducer(track)).rejects.toThrow(
			"Failed to install E2EE sender transform",
		);
		await expect(manager.createProducer(track)).resolves.toBe(retriedProducer);

		expect(failedProducer.close).toHaveBeenCalledOnce();
		expect(retriedProducer.close).not.toHaveBeenCalled();
		expect(client.resumeProducer).toHaveBeenCalledOnce();
		expect(client.resumeProducer).toHaveBeenCalledWith("retried-producer");
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

describe("transport creation", () => {
	it("shares one receive transport across concurrent callers", async () => {
		const manager = createManager();
		const client = mockSfuClient();
		client.createWebRtcTransport.mockResolvedValue({
			id: "recv-tp",
			iceParameters: {},
			iceCandidates: [],
			dtlsParameters: {},
		});
		const transport = {
			id: "recv-tp",
			on: vi.fn(),
			close: vi.fn(),
		} as never;
		manager.sfuClient = client as never;
		manager.device = {
			createRecvTransport: vi.fn(() => transport),
		} as never;

		const [first, second] = await Promise.all([
			manager.createReceiveTransport(),
			manager.createReceiveTransport(),
		]);

		expect(client.createWebRtcTransport).toHaveBeenCalledTimes(1);
		expect(first).toBe(transport);
		expect(second).toBe(transport);
	});

	it("discards a receive transport that finishes after it was closed", async () => {
		const manager = createManager();
		const client = mockSfuClient();
		let resolveTransport: (value: {
			id: string;
			iceParameters: Record<string, never>;
			iceCandidates: never[];
			dtlsParameters: Record<string, never>;
		}) => void = () => {};
		client.createWebRtcTransport.mockReturnValue(
			new Promise((resolve) => {
				resolveTransport = resolve;
			}),
		);
		const transport = {
			id: "stale-recv-tp",
			on: vi.fn(),
			close: vi.fn(),
		} as never;
		manager.sfuClient = client as never;
		manager.device = {
			createRecvTransport: vi.fn(() => transport),
		} as never;

		const creation = manager.createReceiveTransport();
		manager.closeReceiveTransport();
		resolveTransport({
			id: "stale-recv-tp",
			iceParameters: {},
			iceCandidates: [],
			dtlsParameters: {},
		});

		await expect(creation).rejects.toThrow("cancelled");
		expect(transport.close).toHaveBeenCalledTimes(1);
		expect(manager.recvTransport).toBeNull();
	});
});

describe("restartAllTransportIce", () => {
	it("reports a restarted send transport and no receive transport", async () => {
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
		mockedIceRestart(manager).mockResolvedValue({ iceParams: true } as never);
		const result = await manager.restartAllTransportIce();
		expect(result).toEqual({ send: "restarted", recv: "not-needed" });
	});

	it("reports a failed transport restart", async () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.sendTransport = {
			id: "send-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		mockedIceRestart(manager).mockRejectedValue(new Error("fail"));
		const result = await manager.restartAllTransportIce();
		expect(result).toEqual({ send: "failed", recv: "not-needed" });
	});

	it("reports send success and receive failure independently", async () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.sendTransport = {
			id: "send-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		manager.recvTransport = {
			id: "recv-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		mockedIceRestart(manager).mockImplementation((transportId: string) => {
			return transportId === "send-tp"
				? Promise.resolve({ usernameFragment: "u", password: "p" })
				: Promise.reject(new Error("recv failed"));
		});

		await expect(manager.restartAllTransportIce()).resolves.toEqual({
			send: "restarted",
			recv: "failed",
		});
	});

	it("reports both active directions as restarted", async () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.sendTransport = {
			id: "send-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		manager.recvTransport = {
			id: "recv-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		mockedIceRestart(manager).mockResolvedValue({ iceParams: true } as never);

		await expect(manager.restartAllTransportIce()).resolves.toEqual({
			send: "restarted",
			recv: "restarted",
		});
	});

	it("reports send failure and receive success independently", async () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.sendTransport = {
			id: "send-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		manager.recvTransport = {
			id: "recv-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		mockedIceRestart(manager).mockImplementation((transportId: string) => {
			return transportId === "send-tp"
				? Promise.reject(new Error("send failed"))
				: Promise.resolve({ usernameFragment: "u", password: "p" });
		});

		await expect(manager.restartAllTransportIce()).resolves.toEqual({
			send: "failed",
			recv: "restarted",
		});
	});

	it("reports both active directions as failed when neither can restart", async () => {
		const manager = createManager();
		manager.sfuClient = mockSfuClient() as never;
		manager.sendTransport = {
			id: "send-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		manager.recvTransport = {
			id: "recv-tp",
			connectionState: "connected",
			restartIce: vi.fn(),
			close: vi.fn(),
			getStats: vi.fn(),
		} as never;
		mockedIceRestart(manager).mockRejectedValue(new Error("restart failed"));

		await expect(manager.restartAllTransportIce()).resolves.toEqual({
			send: "failed",
			recv: "failed",
		});
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

	it("does not double-count RTT from candidate-pair and remote-inbound-rtp on the same transport", async () => {
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
							currentRoundTripTime: 0.1,
						},
					],
					[
						"remote1",
						{ type: "remote-inbound-rtp", roundTripTime: 0.1 },
					],
					[
						"remote2",
						{ type: "remote-inbound-rtp", roundTripTime: 0.1 },
					],
					[
						"remote3",
						{ type: "remote-inbound-rtp", roundTripTime: 0.1 },
					],
				]),
			),
		} as never;
		manager.recvTransport = null;
		const stats = await manager.getNetworkStats();
		expect(stats.rtt).toBe(100);
		expect(stats.isValid).toBe(true);
	});

	it("falls back to candidate-pair RTT when remote-inbound-rtp is unavailable on the send transport", async () => {
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
							currentRoundTripTime: 0.15,
						},
					],
				]),
			),
		} as never;
		manager.recvTransport = null;
		const stats = await manager.getNetworkStats();
		expect(stats.rtt).toBe(150);
		expect(stats.isValid).toBe(true);
	});
});
