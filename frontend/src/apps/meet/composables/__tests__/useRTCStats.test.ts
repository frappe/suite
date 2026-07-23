import { describe, expect, it } from "vitest";
import {
	calculateBitrate,
	calculatePacketLoss,
	RTC_STATS_POLL_INTERVAL_MS,
} from "../useRTCStats";

describe("RTC stats interval calculations", () => {
	it("refreshes once per second", () => {
		expect(RTC_STATS_POLL_INTERVAL_MS).toBe(1000);
	});

	it("calculates bitrate from cumulative byte counters", () => {
		expect(
			calculateBitrate(
				{ bytes: 1_000, packets: 10, lost: 0, timestamp: 1_000 },
				{ bytes: 251_000, packets: 210, lost: 0, timestamp: 3_000 },
			),
		).toBe(1_000_000);
	});

	it("calculates recent packet loss instead of lifetime loss", () => {
		expect(
			calculatePacketLoss(
				{ bytes: 0, packets: 1_000, lost: 100, timestamp: 1_000 },
				{ bytes: 0, packets: 1_095, lost: 105, timestamp: 3_000 },
			),
		).toBe(5);
	});

	it("ignores reset counters and invalid time ranges", () => {
		const previous = { bytes: 1_000, packets: 100, lost: 10, timestamp: 2_000 };
		expect(calculateBitrate(previous, { bytes: 100, packets: 10, lost: 0, timestamp: 3_000 })).toBeUndefined();
		expect(calculateBitrate(previous, { bytes: 2_000, packets: 200, lost: 20, timestamp: 2_000 })).toBeUndefined();
		expect(calculatePacketLoss(previous, { bytes: 2_000, packets: 90, lost: 5, timestamp: 3_000 })).toBeUndefined();
	});
});
