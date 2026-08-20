import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DecodeStallDetector,
	extractInboundBytesReceived,
	extractInboundRtpCounters,
	StallDetector,
} from "../stallDetector";

interface MutableSample {
	id: string;
	paused: boolean;
	muted: boolean;
	bytes: number | null;
	createdAt: number;
}

interface TestRtpStat {
	type: string;
	kind?: string;
	codecId?: string;
	mimeType?: string;
	bytesReceived?: number;
	framesDecoded?: number;
}

function makeSample(overrides: Partial<MutableSample> = {}): MutableSample {
	return {
		id: "c1",
		paused: false,
		muted: false,
		bytes: 1000,
		createdAt: 0,
		...overrides,
	};
}

function toSample(m: MutableSample) {
	return {
		id: m.id,
		isPaused: () => m.paused,
		isMuted: () => m.muted,
		getBytesReceived: () => m.bytes,
		getCreatedAt: () => m.createdAt,
	};
}

describe("StallDetector", () => {
	let now: number;
	const getNow = () => now;

	beforeEach(() => {
		now = 1_000_000;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function detector() {
		return new StallDetector({ now: getNow });
	}

	it("does not report a fresh consumer before the age threshold", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 1000, bytes: 5000 });
		expect(det.check([toSample(sample)])).toEqual([]);
	});

	it("does not report a paused consumer", () => {
		const det = detector();
		const sample = makeSample({
			createdAt: now - 10_000,
			paused: true,
			muted: false,
			bytes: 5000,
		});
		expect(det.check([toSample(sample)])).toEqual([]);
	});

	it("reports a consumer whose track is muted for the full stall window", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, muted: true });

		det.check([toSample(sample)]);

		now += 14_000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 2_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
	});

	it("reports a consumer whose bytesReceived stops increasing", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });

		expect(det.check([toSample(sample)])).toEqual([]);

		now += 3_000;
		sample.bytes = 1000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 16_000;
		sample.bytes = 1000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
	});

	it("resets the stall timer when bytesReceived starts increasing again", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });

		now += 4_000;
		sample.bytes = 1000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 500;
		sample.bytes = 2000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 14_000;
		sample.bytes = 2000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 16_000;
		sample.bytes = 2000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
	});

	it("retries a persistent stall after the recovery cooldown", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, muted: true });

		det.check([toSample(sample)]);

		now += 16_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);

		now += 5_000;
		expect(det.check([toSample(sample)])).toEqual([]);
		expect(det.hasActiveStall()).toBe(true);

		now += 30_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);

		sample.muted = false;
		sample.bytes = 2000;
		expect(det.check([toSample(sample)])).toEqual([]);

		sample.muted = true;
		expect(det.check([toSample(sample)])).toEqual([]);
		now += 30_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
	});

	it("keeps recovery on cooldown when consumers are replaced", () => {
		const det = new StallDetector({
			now: getNow,
			stallTimeoutMs: 500,
			recoveryCooldownMs: 30_000,
		});
		const first = makeSample({ id: "c1", createdAt: now - 10_000 });

		det.check([toSample(first)]);
		now += 600;
		expect(det.check([toSample(first)])).toEqual([]);
		now += 600;
		expect(det.check([toSample(first)])).toEqual(["c1"]);

		const replacement = makeSample({ id: "c2", createdAt: now - 10_000 });
		det.check([toSample(replacement)]);
		now += 600;
		expect(det.check([toSample(replacement)])).toEqual([]);

		now += 30_000;
		expect(det.check([toSample(replacement)])).toEqual(["c2"]);
	});

	it("clears state for paused consumers", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });

		now += 4_000;
		sample.bytes = 1000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 1_000;
		sample.paused = true;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 30_000;
		sample.paused = false;
		sample.bytes = 5000;
		expect(det.check([toSample(sample)])).toEqual([]);
	});

	it("gives a resumed consumer a fresh first-media deadline", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now, paused: true, bytes: 0 });
		det.check([toSample(sample)]);

		now += 30_000;
		sample.paused = false;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 14_000;
		expect(det.check([toSample(sample)])).toEqual([]);
		now += 1_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
	});

	it("ignores consumers with no bytesReceived (stats unavailable)", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, bytes: null });
		now += 10_000;
		expect(det.check([toSample(sample)])).toEqual([]);
	});

	it("reports an expected consumer that receives no RTP before its deadline", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now, bytes: 0 });

		now += 14_000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 1_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
	});

	it("disposes state for a removed consumer", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });
		det.check([toSample(sample)]);
		det.dispose("c1");
		const fresh = makeSample({ id: "c1", createdAt: now, bytes: 0 });
		expect(det.check([toSample(fresh)])).toEqual([]);
	});

	describe("per-kind timeout", () => {
		it("reports an audio stall after the shorter audio window", () => {
			const det = detector();
			const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });
			const audioSample = { ...toSample(sample), kind: "audio" };

			det.check([audioSample]);
			now += 3_000;
			sample.bytes = 1000;
			expect(det.check([audioSample])).toEqual([]);

			now += 9_000;
			sample.bytes = 1000;
			expect(det.check([audioSample])).toEqual(["c1"]);
		});

		it("uses the longer startup window for audio before reporting no RTP", () => {
			const det = detector();
			const sample = makeSample({ createdAt: now - 10_000, bytes: 0 });
			const audioSample = { ...toSample(sample), kind: "audio" };

			det.check([audioSample]);
			now += 1_000;
			sample.bytes = 0;
			expect(det.check([audioSample])).toEqual([]);

			now += 1_600;
			sample.bytes = 0;
			expect(det.check([audioSample])).toEqual([]);

			now += 5_000;
			sample.bytes = 0;
			expect(det.check([audioSample])).toEqual(["c1"]);
		});

		it("reports startup video that misses the first RTP deadline", () => {
			const det = detector();
			const sample = makeSample({ createdAt: now - 10_000, bytes: 0 });
			const videoSample = { ...toSample(sample), kind: "video" };

			det.check([videoSample]);
			now += 4_000;
			sample.bytes = 0;
			expect(det.check([videoSample])).toEqual([]);

			now += 6_000;
			sample.bytes = 0;
			expect(det.check([videoSample])).toEqual(["c1"]);
		});

		it("uses the longer default window for video", () => {
			const det = detector();
			const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });
			const videoSample = { ...toSample(sample), kind: "video" };

			det.check([videoSample]);
			now += 14_000;
			sample.bytes = 1000;
			expect(det.check([videoSample])).toEqual([]);

			now += 16_000;
			sample.bytes = 1000;
			expect(det.check([videoSample])).toEqual(["c1"]);
		});

		it("honours a custom audioStallTimeoutMs option", () => {
			const det = new StallDetector({ now: getNow, audioStallTimeoutMs: 500 });
			const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });
			const audioSample = { ...toSample(sample), kind: "audio" };

			det.check([audioSample]);
			now += 400;
			sample.bytes = 1000;
			expect(det.check([audioSample])).toEqual([]);

			now += 500;
			sample.bytes = 1000;
			expect(det.check([audioSample])).toEqual(["c1"]);
		});
	});
});

describe("extractInboundBytesReceived", () => {
	it("returns the inbound-rtp bytesReceived", () => {
		const stats = new Map<string, { type: string; bytesReceived?: number }>([
			["a", { type: "outbound-rtp", bytesReceived: 999 }],
			["b", { type: "inbound-rtp", bytesReceived: 12345 }],
		]);
		expect(extractInboundBytesReceived(stats)).toBe(12345);
	});

	it("returns null when no inbound-rtp report is present", () => {
		const stats = new Map<string, { type: string; bytesReceived?: number }>([
			["a", { type: "outbound-rtp", bytesReceived: 999 }],
		]);
		expect(extractInboundBytesReceived(stats)).toBeNull();
	});
});

describe("DecodeStallDetector", () => {
	it("requests a keyframe before recreating video with RTP but no decode progress", () => {
		let now = 100_000;
		const detector = new DecodeStallDetector({ now: () => now });
		let bytes = 1000;
		const sample = () => ({
			id: "video-1",
			isPaused: () => false,
			bytesReceived: bytes,
			framesDecoded: 10,
		});

		expect(detector.check([sample()])).toEqual([]);
		for (let i = 0; i < 5; i++) {
			now += 3000;
			bytes += 1000;
		}
		expect(detector.check([sample()])).toEqual([
			{ consumerId: "video-1", action: "request-keyframe" },
		]);

		for (let i = 0; i < 5; i++) {
			now += 3000;
			bytes += 1000;
		}
		expect(detector.check([sample()])).toEqual([
			{ consumerId: "video-1", action: "recreate" },
		]);
	});

	it("clears decode recovery when frames progress or video is paused", () => {
		let now = 100_000;
		const detector = new DecodeStallDetector({ now: () => now });
		let bytes = 1000;
		let framesDecoded = 10;
		let paused = false;
		const sample = () => ({
			id: "video-1",
			isPaused: () => paused,
			bytesReceived: bytes,
			framesDecoded,
		});

		detector.check([sample()]);
		now += 15_000;
		bytes += 1000;
		expect(detector.check([sample()])).toHaveLength(1);
		framesDecoded += 1;
		bytes += 1000;
		expect(detector.check([sample()])).toEqual([]);

		paused = true;
		now += 30_000;
		bytes += 1000;
		expect(detector.check([sample()])).toEqual([]);
	});
});

describe("extractInboundRtpCounters", () => {
	it("extracts primary inbound video counters and ignores RTX", () => {
		const stats = new Map<string, TestRtpStat>([
			["rtx-codec", { type: "codec", mimeType: "video/rtx" }],
			[
				"rtx",
				{
					type: "inbound-rtp",
					kind: "video",
					codecId: "rtx-codec",
					bytesReceived: 999,
					framesDecoded: 0,
				},
			],
			[
				"primary",
				{
					type: "inbound-rtp",
					kind: "video",
					bytesReceived: 12_000,
					framesDecoded: 42,
				},
			],
		]);

		expect(extractInboundRtpCounters(stats, "video")).toEqual({
			bytesReceived: 12_000,
			framesDecoded: 42,
		});
	});

	it("aggregates multiple primary inbound video reports", () => {
		const stats = new Map<string, TestRtpStat>([
			[
				"first",
				{
					type: "inbound-rtp",
					kind: "video",
					bytesReceived: 4000,
					framesDecoded: 20,
				},
			],
			[
				"second",
				{
					type: "inbound-rtp",
					kind: "video",
					bytesReceived: 6000,
					framesDecoded: 30,
				},
			],
		]);

		expect(extractInboundRtpCounters(stats, "video")).toEqual({
			bytesReceived: 10_000,
			framesDecoded: 50,
		});
	});
});
