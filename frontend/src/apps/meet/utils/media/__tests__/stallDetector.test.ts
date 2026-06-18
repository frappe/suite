import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractInboundBytesReceived, StallDetector } from "../stallDetector";

interface MutableSample {
	id: string;
	paused: boolean;
	muted: boolean;
	bytes: number | null;
	createdAt: number;
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

		now += 4_000;
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

		now += 6_000;
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

		now += 4_000;
		sample.bytes = 2000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 6_000;
		sample.bytes = 2000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
	});

	it("reports a stall once until media resumes", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, muted: true });

		det.check([toSample(sample)]);

		now += 6_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);

		now += 5_000;
		expect(det.check([toSample(sample)])).toEqual([]);

		now += 30_000;
		expect(det.check([toSample(sample)])).toEqual([]);

		sample.muted = false;
		sample.bytes = 2000;
		expect(det.check([toSample(sample)])).toEqual([]);

		sample.muted = true;
		expect(det.check([toSample(sample)])).toEqual([]);
		now += 6_000;
		expect(det.check([toSample(sample)])).toEqual(["c1"]);
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

	it("ignores consumers with no bytesReceived (stats unavailable)", () => {
		const det = detector();
		const sample = makeSample({ createdAt: now - 10_000, bytes: null });
		now += 10_000;
		expect(det.check([toSample(sample)])).toEqual([]);
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
			now += 1_000;
			sample.bytes = 1000;
			expect(det.check([audioSample])).toEqual([]);

			now += 1_600;
			sample.bytes = 1000;
			expect(det.check([audioSample])).toEqual(["c1"]);
		});

		it("uses the longer startup window for audio before RTP arrives", () => {
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
			expect(det.check([audioSample])).toEqual([]);
		});

		it("does not report a startup video stall before RTP arrives", () => {
			const det = detector();
			const sample = makeSample({ createdAt: now - 10_000, bytes: 0 });
			const videoSample = { ...toSample(sample), kind: "video" };

			det.check([videoSample]);
			now += 4_000;
			sample.bytes = 0;
			expect(det.check([videoSample])).toEqual([]);

			now += 6_000;
			sample.bytes = 0;
			expect(det.check([videoSample])).toEqual([]);
		});

		it("uses the longer default window for video", () => {
			const det = detector();
			const sample = makeSample({ createdAt: now - 10_000, bytes: 1000 });
			const videoSample = { ...toSample(sample), kind: "video" };

			det.check([videoSample]);
			now += 4_000;
			sample.bytes = 1000;
			expect(det.check([videoSample])).toEqual([]);

			now += 6_000;
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
		expect(
			extractInboundBytesReceived(stats as unknown as RTCStatsReport),
		).toBe(12345);
	});

	it("returns null when no inbound-rtp report is present", () => {
		const stats = new Map<string, { type: string; bytesReceived?: number }>([
			["a", { type: "outbound-rtp", bytesReceived: 999 }],
		]);
		expect(
			extractInboundBytesReceived(stats as unknown as RTCStatsReport),
		).toBeNull();
	});
});
