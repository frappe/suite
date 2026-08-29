import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type Ref, ref } from "vue";
import type { SFUMeetingManager } from "../../utils/SFUMeetingManager";
import { useNetworkQuality } from "../useNetworkQuality";

describe("useNetworkQuality", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("mirrors monitor state and stops it on unmount", async () => {
		vi.useFakeTimers();
		const getNetworkStats = vi.fn().mockResolvedValue({
			rtt: 950,
			packetLoss: 3,
			availableOutgoingBitrate: 150_000,
			timestamp: Date.now(),
			isValid: true,
		});
		const manager = ref({
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
			participantManager: { getParticipant: () => undefined },
			reconcileExpectedMedia: vi.fn().mockResolvedValue(undefined),
			resetReceiveMedia: vi.fn().mockResolvedValue(undefined),
		}) as unknown as Ref<SFUMeetingManager | null>;
		let quality: ReturnType<typeof useNetworkQuality> | undefined;
		const app = createApp({
			setup() {
				quality = useNetworkQuality(manager);
				return () => null;
			},
		});
		app.mount(document.createElement("div"));

		await vi.advanceTimersByTimeAsync(3000);
		expect(quality?.networkQuality.value).toBe("critical");
		expect(quality?.downlinkQuality.value).toBe("good");
		expect(quality?.isTransportFailed.value).toBe(false);

		app.unmount();
		await vi.advanceTimersByTimeAsync(3000);
		expect(getNetworkStats).toHaveBeenCalledOnce();
	});
});
