import { afterEach, expect, it, vi } from "vitest";
import { NetworkStatsTracker } from "../NetworkStatsTracker";

afterEach(() => vi.useRealTimers());

it("discards loss accumulated during a suspended sampling interval", () => {
	vi.useFakeTimers();
	const tracker = new NetworkStatsTracker();
	const sample = (received: number, lost: number) =>
		tracker.sample("recv", "t", [
			{
				id: "camera",
				type: "inbound-rtp",
				packetsReceived: received,
				packetsLost: lost,
			},
		]);
	sample(100, 0);
	vi.advanceTimersByTime(3000);
	expect(sample(200, 0).packetLoss).toBe(0);
	vi.advanceTimersByTime(60_000);
	expect(sample(300, 100).packetLoss).toBeNull();
	vi.advanceTimersByTime(3000);
	expect(sample(400, 100).packetLoss).toBe(0);
});
