import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, nextTick, ref, watchEffect } from "vue";
import { useNetworkQuality } from "../useNetworkQuality";

describe("useNetworkQuality", () => {
	afterEach(() => {
		vi.useRealTimers();
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
		const root = document.createElement("div");

		const TestComponent = defineComponent({
			setup() {
				const { networkQuality } = useNetworkQuality();
				watchEffect(() => {
					observed.value = networkQuality.value;
				});
				return () => null;
			},
		});

		const app = createApp(TestComponent);
		app.provide("sfuManager", sfuManager);
		app.mount(root);

		return { observed, getNetworkStats, unmount: () => app.unmount() };
	};

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

	it("triggers ICE restart when a remote consumer stalls for several polls", async () => {
		vi.useFakeTimers();

		const recoverTransportIce = vi.fn().mockResolvedValue(true);

		const track = { muted: false } as MediaStreamTrack;
		const stats = new Map<string, { type: string; bytesReceived: number }>([
			["in", { type: "inbound-rtp", bytesReceived: 1000 }],
		]);
		const entry = {
			id: "c1",
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
			recoveryManager: {
				recoverTransportIce,
			},
		});

		const observed = ref("unknown");
		const root = document.createElement("div");

		const TestComponent = defineComponent({
			setup() {
				const { networkQuality } = useNetworkQuality();
				watchEffect(() => {
					observed.value = networkQuality.value;
				});
				return () => null;
			},
		});

		const app = createApp(TestComponent);
		app.provide("sfuManager", sfuManager);
		app.mount(root);

		await vi.advanceTimersByTimeAsync(3000);
		expect(recoverTransportIce).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(3000);
		expect(recoverTransportIce).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(3000);
		expect(recoverTransportIce).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(3000);
		expect(recoverTransportIce).toHaveBeenCalledTimes(1);
		expect(recoverTransportIce).toHaveBeenCalledWith(
			expect.stringMatching(/^consumer_stall_/),
		);

		app.unmount();
	});
});
