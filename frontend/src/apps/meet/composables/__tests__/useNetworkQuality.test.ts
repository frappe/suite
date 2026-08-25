import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, nextTick, ref, watchEffect } from "vue";
import { StallDetector } from "../../utils/media/stallDetector";
import { useNetworkQuality } from "../useNetworkQuality";

describe("useNetworkQuality", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	const mountWithStats = (stats: unknown, transportState = "connected") => {
		vi.useFakeTimers();

		const getNetworkStats = vi.fn().mockResolvedValue(stats);
		const sfuManager = ref({
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: transportState },
					recvTransport: { state: transportState },
				}),
				getNetworkStats,
			},
		});

		const observed = ref("unknown");
		const observedDownlink = ref("unknown");
		const root = document.createElement("div");

		const TestComponent = defineComponent({
			setup() {
				const { networkQuality, downlinkQuality } = useNetworkQuality();
				watchEffect(() => {
					observed.value = networkQuality.value;
					observedDownlink.value = downlinkQuality.value;
				});
				return () => null;
			},
		});

		const app = createApp(TestComponent);
		app.provide("sfuManager", sfuManager);
		app.mount(root);

		return {
			observed,
			observedDownlink,
			getNetworkStats,
			unmount: () => app.unmount(),
		};
	};

	it("does not treat packet loss alone as visible downlink degradation", async () => {
		const { observedDownlink, unmount } = mountWithStats({
			rtt: 50,
			packetLoss: 20,
			availableOutgoingBitrate: 900_000,
			timestamp: Date.now(),
			isValid: true,
		});

		await vi.advanceTimersByTimeAsync(6000);
		expect(observedDownlink.value).toBe("good");

		unmount();
	});

	it("keeps quality good when RTT is moderately high but video bitrate is healthy", async () => {
		const { observed, unmount, getNetworkStats } = mountWithStats({
			rtt: 520,
			packetLoss: 1,
			availableOutgoingBitrate: 900_000,
			timestamp: Date.now(),
			isValid: true,
		});

		await vi.advanceTimersByTimeAsync(3000);
		await nextTick();

		expect(getNetworkStats).toHaveBeenCalledTimes(1);
		expect(observed.value).toBe("good");

		unmount();
	});

	it("marks quality poor when RTT is high and available bitrate drops to video degradation levels", async () => {
		const { observed, unmount } = mountWithStats({
			rtt: 520,
			packetLoss: 1,
			availableOutgoingBitrate: 250_000,
			timestamp: Date.now(),
			isValid: true,
		});

		await vi.advanceTimersByTimeAsync(3000);
		await nextTick();

		expect(observed.value).toBe("poor");

		unmount();
	});

	it("marks quality poor when packet loss alone is clearly high", async () => {
		const { observed, unmount } = mountWithStats({
			rtt: 150,
			packetLoss: 10,
			availableOutgoingBitrate: 900_000,
			timestamp: Date.now(),
			isValid: true,
		});

		await vi.advanceTimersByTimeAsync(3000);
		await nextTick();

		expect(observed.value).toBe("poor");

		unmount();
	});

	it("marks quality critical when RTT is severe and bitrate is critically low", async () => {
		const { observed, unmount } = mountWithStats({
			rtt: 950,
			packetLoss: 3,
			availableOutgoingBitrate: 150_000,
			timestamp: Date.now(),
			isValid: true,
		});

		await vi.advanceTimersByTimeAsync(3000);
		await nextTick();

		expect(observed.value).toBe("critical");

		unmount();
	});

	it("suspends stall detection while a transport is failed", async () => {
		const suspend = vi.spyOn(StallDetector.prototype, "suspend");
		const { unmount } = mountWithStats({}, "failed");

		await vi.advanceTimersByTimeAsync(3000);

		expect(suspend).toHaveBeenCalledOnce();
		unmount();
	});

	it("does not reset receive media when a remote participant is muted", async () => {
		vi.useFakeTimers();

		const resetReceiveSide = vi.fn().mockResolvedValue(undefined);
		const stats = new Map<string, { type: string; bytesReceived: number }>([
			["in", { type: "inbound-rtp", bytesReceived: 1000 }],
		]);
		const sfuManager = ref({
			sfuClient: {},
			participantManager: {
				getParticipant: () => ({ audio_enabled: false }),
			},
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: "connected" },
					recvTransport: { state: "connected" },
				}),
				getNetworkStats: vi.fn().mockResolvedValue({
					rtt: 50,
					packetLoss: 0,
					availableOutgoingBitrate: 800_000,
					timestamp: Date.now(),
					isValid: true,
				}),
			},
			mediaManager: {
				consumerManager: {
					getAllConsumers: () => [
						{
							id: "audio-consumer",
							participantId: "muted-participant",
							kind: "audio",
							isScreen: false,
							track: { muted: false } as MediaStreamTrack,
							createdAt: Date.now() - 60_000,
							consumer: {
								paused: false,
								getStats: vi.fn().mockResolvedValue(stats),
							},
						},
					],
				},
			},
			resetReceiveMedia: resetReceiveSide,
		});

		const app = createApp({
			setup: () => {
				useNetworkQuality();
				return () => null;
			},
		});
		app.provide("sfuManager", sfuManager);
		app.mount(document.createElement("div"));

		await vi.advanceTimersByTimeAsync(21_000);

		expect(resetReceiveSide).not.toHaveBeenCalled();
		app.unmount();
	});

	it("recreates only a consumer that misses its first RTP deadline", async () => {
		vi.useFakeTimers();
		const recoverConsumer = vi.fn().mockResolvedValue(undefined);
		const resetReceiveMedia = vi.fn().mockResolvedValue(undefined);
		const requestConsumerKeyFrame = vi.fn().mockResolvedValue(undefined);
		const zeroStats = new Map<string, { type: string; bytesReceived: number }>([
			["in", { type: "inbound-rtp", bytesReceived: 0 }],
		]);
		const consumer = (id: string, adaptivelyPaused = false) => ({
			id,
			participantId: `participant-${id}`,
			producerId: `producer-${id}`,
			kind: "video",
			isScreen: false,
			adaptivelyPaused,
			track: { muted: false } as MediaStreamTrack,
			createdAt: Date.now() - 20_000,
			consumer: {
				paused: false,
				producerPaused: false,
				getStats: vi.fn().mockResolvedValue(zeroStats),
			},
		});
		const expected = consumer("expected");
		const hidden = consumer("hidden", true);
		const sfuManager = ref({
			sfuClient: { requestConsumerKeyFrame },
			participantManager: {
				getParticipant: () => ({ audio_enabled: true, video_enabled: true }),
			},
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: "connected" },
					recvTransport: { state: "connected" },
				}),
				getNetworkStats: vi.fn().mockResolvedValue({
					rtt: 50,
					packetLoss: 0,
					availableOutgoingBitrate: 800_000,
					timestamp: Date.now(),
					isValid: true,
				}),
			},
			mediaManager: {
				consumerManager: {
					getAllConsumers: () => [expected, hidden],
				},
				recoverConsumer,
			},
			resetReceiveMedia,
		});
		const app = createApp({
			setup: () => {
				useNetworkQuality();
				return () => null;
			},
		});
		app.provide("sfuManager", sfuManager);
		app.mount(document.createElement("div"));

		await vi.advanceTimersByTimeAsync(3000);

		expect(recoverConsumer).toHaveBeenCalledOnce();
		expect(recoverConsumer).toHaveBeenCalledWith(expected);
		expect(requestConsumerKeyFrame).not.toHaveBeenCalled();
		expect(resetReceiveMedia).not.toHaveBeenCalled();
		app.unmount();
	});

	it("requests a keyframe before recreating only a decode-stalled consumer", async () => {
		vi.useFakeTimers();
		const recoverConsumer = vi.fn().mockResolvedValue(undefined);
		const resetReceiveMedia = vi.fn().mockResolvedValue(undefined);
		const requestConsumerKeyFrame = vi.fn().mockResolvedValue(undefined);
		const observeRemoteMediaProgress = vi.fn();
		let bytesReceived = 1000;
		const stats = () =>
			new Map<
				string,
				{
					type: string;
					kind: string;
					bytesReceived: number;
					framesDecoded: number;
				}
			>([
				[
					"in",
					{
						type: "inbound-rtp",
						kind: "video",
						bytesReceived: (bytesReceived += 1000),
						framesDecoded: 10,
					},
				],
			]);
		const entry = {
			id: "decode-stalled",
			participantId: "remote-participant",
			producerId: "producer-1",
			kind: "video",
			isScreen: false,
			adaptivelyPaused: false,
			track: { muted: false } as MediaStreamTrack,
			createdAt: Date.now() - 60_000,
			consumer: {
				paused: false,
				producerPaused: false,
				getStats: vi.fn().mockImplementation(async () => stats()),
			},
		};
		const sfuManager = ref({
			sfuClient: { requestConsumerKeyFrame },
			observeRemoteMediaProgress,
			participantManager: {
				getParticipant: () => ({ video_enabled: true }),
			},
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: "connected" },
					recvTransport: { state: "connected" },
				}),
				getNetworkStats: vi.fn().mockResolvedValue({
					rtt: 50,
					packetLoss: 0,
					availableOutgoingBitrate: 800_000,
					timestamp: Date.now(),
					isValid: true,
				}),
			},
			mediaManager: {
				consumerManager: {
					getAllConsumers: () => [entry],
					getConsumer: (id: string) => (id === entry.id ? entry : undefined),
				},
				recoverConsumer,
			},
			resetReceiveMedia,
		});
		const app = createApp({
			setup: () => {
				useNetworkQuality();
				return () => null;
			},
		});
		app.provide("sfuManager", sfuManager);
		app.mount(document.createElement("div"));

		await vi.advanceTimersByTimeAsync(18_000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledOnce();
		expect(recoverConsumer).not.toHaveBeenCalled();
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			true,
			false,
		);

		await vi.advanceTimersByTimeAsync(15_000);
		expect(recoverConsumer).toHaveBeenCalledOnce();
		expect(recoverConsumer).toHaveBeenCalledWith(entry);
		expect(resetReceiveMedia).not.toHaveBeenCalled();
		app.unmount();
	});

	it("restarts only a stalled remote video consumer", async () => {
		vi.useFakeTimers();

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const resetReceiveSide = vi.fn().mockRejectedValue(new Error("snapshot failed"));
		const requestConsumerKeyFrame = vi.fn().mockResolvedValue(undefined);

		const track = { muted: false } as MediaStreamTrack;
		const participant = { video_enabled: false };
		const stats = new Map<string, { type: string; bytesReceived: number }>([
			["in", { type: "inbound-rtp", bytesReceived: 1000 }],
		]);
		const entry = {
			id: "c1",
			participantId: "remote-participant",
			kind: "video",
			isScreen: false,
			track,
			createdAt: Date.now() - 60_000,
			consumer: {
				id: "c1",
				paused: false,
				getStats: vi.fn().mockResolvedValue(stats),
			},
		};

		const sfuManager = ref({
			sfuClient: { requestConsumerKeyFrame },
			participantManager: {
				getParticipant: () => participant,
			},
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: "connected" },
					recvTransport: { state: "connected" },
				}),
				getNetworkStats: vi.fn().mockResolvedValue({
					rtt: 50,
					packetLoss: 0,
					availableOutgoingBitrate: 800_000,
					timestamp: Date.now(),
					isValid: true,
				}),
			},
			mediaManager: {
				consumerManager: {
					getAllConsumers: () => [entry],
				},
			},
			resetReceiveMedia: resetReceiveSide,
		});

		const observedDownlink = ref("unknown");
		const root = document.createElement("div");

		const TestComponent = defineComponent({
			setup() {
				const { downlinkQuality } = useNetworkQuality();
				watchEffect(() => {
					observedDownlink.value = downlinkQuality.value;
				});
				return () => null;
			},
		});

		const app = createApp(TestComponent);
		app.provide("sfuManager", sfuManager);
		app.mount(root);

		await vi.advanceTimersByTimeAsync(21_000);
		expect(resetReceiveSide).not.toHaveBeenCalled();

		participant.video_enabled = true;
		await vi.advanceTimersByTimeAsync(21_000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledOnce();
		expect(observedDownlink.value).toBe("critical");
		expect(requestConsumerKeyFrame).toHaveBeenCalledWith("c1");
		expect(resetReceiveSide).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(9000);
		expect(observedDownlink.value).toBe("critical");
		expect(requestConsumerKeyFrame).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(21_000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledTimes(2);
		expect(resetReceiveSide).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(30_000);
		expect(resetReceiveSide).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			"Failed to reset stalled receive media",
			expect.any(Error),
		);

		await vi.advanceTimersByTimeAsync(21_000);
		expect(resetReceiveSide).toHaveBeenCalledOnce();

		app.unmount();
	});

	it("waits for a fresh stall window after network quality recovers", async () => {
		vi.useFakeTimers();

		const resetReceiveSide = vi.fn().mockResolvedValue(undefined);
		const requestConsumerKeyFrame = vi.fn().mockResolvedValue(undefined);
		const track = { muted: false } as MediaStreamTrack;
		const stats = new Map<string, { type: string; bytesReceived: number }>([
			["in", { type: "inbound-rtp", bytesReceived: 1000 }],
		]);
		const qualityStats = {
			rtt: 1300,
			packetLoss: 20,
			availableOutgoingBitrate: 100_000,
			timestamp: Date.now(),
			isValid: true,
		};
		const sfuManager = ref({
			sfuClient: { requestConsumerKeyFrame },
			participantManager: {
				getParticipant: () => ({ video_enabled: true }),
			},
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: "connected" },
					recvTransport: { state: "connected" },
				}),
				getNetworkStats: vi.fn().mockImplementation(async () => qualityStats),
			},
			mediaManager: {
				consumerManager: {
					getAllConsumers: () => [
						{
							id: "c1",
							kind: "video",
							track,
							createdAt: Date.now() - 60_000,
							consumer: {
								paused: false,
								getStats: vi.fn().mockResolvedValue(stats),
							},
						},
					],
				},
			},
			resetReceiveMedia: resetReceiveSide,
		});

		const app = createApp({
			setup: () => {
				useNetworkQuality();
				return () => null;
			},
		});
		app.provide("sfuManager", sfuManager);
		app.mount(document.createElement("div"));

		await vi.advanceTimersByTimeAsync(30_000);
		expect(resetReceiveSide).not.toHaveBeenCalled();

		qualityStats.rtt = 50;
		qualityStats.packetLoss = 0;
		qualityStats.availableOutgoingBitrate = 800_000;
		await vi.advanceTimersByTimeAsync(3000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledTimes(1);
		expect(resetReceiveSide).not.toHaveBeenCalled();

		app.unmount();
	});

	it("suspends reconciliation while hidden or offline and recovers on resume", async () => {
		vi.useFakeTimers();
		let hidden = false;
		let online = true;
		vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
		vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
		const getNetworkStats = vi.fn().mockResolvedValue({
			rtt: 50,
			packetLoss: 0,
			availableOutgoingBitrate: 800_000,
			isValid: true,
		});
		const reconcileExpectedMedia = vi.fn().mockResolvedValue(undefined);
		const recoverBrowserLifecycle = vi.fn().mockResolvedValue(undefined);
		const sfuManager = ref({
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: "connected" },
					recvTransport: { state: "connected" },
				}),
				getNetworkStats,
			},
			mediaManager: {
				consumerManager: { getAllConsumers: () => [] },
			},
			reconcileExpectedMedia,
			recoverBrowserLifecycle,
		});
		const app = createApp({
			setup: () => (useNetworkQuality(), () => null),
		});
		app.provide("sfuManager", sfuManager);
		app.mount(document.createElement("div"));

		hidden = true;
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(6000);
		expect(getNetworkStats).not.toHaveBeenCalled();
		expect(reconcileExpectedMedia).not.toHaveBeenCalled();

		hidden = false;
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.waitFor(() => expect(recoverBrowserLifecycle).toHaveBeenCalledOnce());
		online = false;
		window.dispatchEvent(new Event("offline"));
		await vi.advanceTimersByTimeAsync(6000);
		expect(getNetworkStats).not.toHaveBeenCalled();

		online = true;
		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() =>
			expect(recoverBrowserLifecycle).toHaveBeenCalledTimes(2),
		);
		app.unmount();
	});

	it("uses fresh media progress baselines after visibility resumes", async () => {
		vi.useFakeTimers();
		let hidden = false;
		vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
		const observeRemoteMediaProgress = vi.fn();
		const stats = new Map([
			[
				"inbound",
				{
					type: "inbound-rtp",
					kind: "video",
					bytesReceived: 1000,
					framesDecoded: 10,
				},
			],
		]);
		const entry = {
			id: "consumer-1",
			producerId: "producer-1",
			participantId: "remote-1",
			kind: "video",
			isScreen: false,
			adaptivelyPaused: false,
			track: { muted: false },
			createdAt: Date.now(),
			consumer: {
				paused: false,
				producerPaused: false,
				getStats: vi.fn().mockResolvedValue(stats),
			},
		};
		const sfuManager = ref({
			participantManager: { getParticipant: () => ({ video_enabled: true }) },
			transportManager: {
				getTransportStats: () => ({
					sendTransport: { state: "connected" },
					recvTransport: { state: "connected" },
				}),
			},
			mediaManager: {
				consumerManager: { getAllConsumers: () => [entry] },
			},
			observeRemoteMediaProgress,
			reconcileExpectedMedia: vi.fn().mockResolvedValue(undefined),
			recoverBrowserLifecycle: vi.fn().mockResolvedValue(undefined),
		});
		const app = createApp({
			setup: () => (useNetworkQuality(), () => null),
		});
		app.provide("sfuManager", sfuManager);
		app.mount(document.createElement("div"));

		await vi.advanceTimersByTimeAsync(3000);
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			true,
			true,
		);
		await vi.advanceTimersByTimeAsync(3000);
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			false,
			false,
		);

		hidden = true;
		document.dispatchEvent(new Event("visibilitychange"));
		hidden = false;
		document.dispatchEvent(new Event("visibilitychange"));
		await vi.advanceTimersByTimeAsync(3000);
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			true,
			true,
		);
		app.unmount();
	});
});
