import { describe, expect, it, vi } from "vitest";
import { ClientTelemetry } from "../ClientTelemetry";

describe("ClientTelemetry", () => {
	it("reports first media once per kind", () => {
		const sendClientTelemetry = vi.fn();
		let now = 100;
		const telemetry = new ClientTelemetry(
			{ sendClientTelemetry },
			true,
			() => now,
		);
		now = 350;

		telemetry.markFirstRemoteMedia("video");
		telemetry.markFirstRemoteMedia("video");

		expect(sendClientTelemetry).toHaveBeenCalledOnce();
		expect(sendClientTelemetry).toHaveBeenCalledWith({
			event: "first_remote_media",
			media: "video",
			durationMs: 250,
		});
	});

	it("starts first-media timing when connection setup begins", () => {
		const sendClientTelemetry = vi.fn();
		let now = 100;
		const telemetry = new ClientTelemetry(
			{ sendClientTelemetry },
			true,
			() => now,
		);
		now = 1_000;
		telemetry.startSession();
		now = 1_250;

		telemetry.markFirstRemoteMedia("audio");

		expect(sendClientTelemetry).toHaveBeenCalledWith(
			expect.objectContaining({ durationMs: 250 }),
		);
	});

	it("reports a bounded directional recovery outcome", () => {
		const sendClientTelemetry = vi.fn();
		let now = 100;
		const telemetry = new ClientTelemetry(
			{ sendClientTelemetry },
			true,
			() => now,
		);

		telemetry.recordRecoveryState("recovering_receive", "consumer_stall_1");
		now = 600;
		telemetry.recordRecoveryState("healthy");

		expect(sendClientTelemetry).toHaveBeenCalledWith({
			event: "recovery",
			direction: "recv",
			trigger: "stall",
			outcome: "success",
			durationMs: 500,
		});
	});

	it("does nothing when the session is not sampled", () => {
		const sendClientTelemetry = vi.fn();
		const telemetry = new ClientTelemetry({ sendClientTelemetry }, false);

		telemetry.markFirstRemoteMedia("audio");
		telemetry.reportMediaStalls(["audio", "video"]);

		expect(sendClientTelemetry).not.toHaveBeenCalled();
	});

	it("reports bounded recovery exhaustion", () => {
		const sendClientTelemetry = vi.fn();
		const telemetry = new ClientTelemetry({ sendClientTelemetry }, true);

		telemetry.reportRecoveryExhausted({
			subsystem: "consumer",
			direction: "recv",
			reason: "retry_limit",
		});

		expect(sendClientTelemetry).toHaveBeenCalledWith({
			event: "recovery_exhausted",
			subsystem: "consumer",
			direction: "recv",
			reason: "retry_limit",
		});
	});

	it("reports expected-media repair outcomes", () => {
		const sendClientTelemetry = vi.fn();
		const telemetry = new ClientTelemetry({ sendClientTelemetry }, true);

		telemetry.reportMediaRepair({
			media: "video",
			source: "remote",
			stage: "subscription",
			action: "subscribe",
			attempt: 1,
			outcome: "success",
			durationMs: 500,
		});

		expect(sendClientTelemetry).toHaveBeenCalledWith({
			event: "media_repair",
			media: "video",
			source: "remote",
			stage: "subscription",
			action: "subscribe",
			attempt: 1,
			outcome: "success",
			durationMs: 500,
		});
	});

	it("throttles and bounds sampled network quality", () => {
		const sendClientTelemetry = vi.fn();
		let now = 0;
		const telemetry = new ClientTelemetry(
			{ sendClientTelemetry },
			true,
			() => now,
		);

		telemetry.reportNetworkQuality({
			rtt: 100,
			packetLoss: 150,
			availableOutgoingBitrate: Number.POSITIVE_INFINITY,
		});
		now = 1_000;
		telemetry.reportNetworkQuality({
			rtt: 200,
			packetLoss: 5,
			availableOutgoingBitrate: 500_000,
		});

		expect(sendClientTelemetry).toHaveBeenCalledOnce();
		expect(sendClientTelemetry).toHaveBeenCalledWith({
			event: "network_quality",
			rttMs: 100,
			packetLossPercent: 100,
			availableOutgoingBitrate: 0,
		});
	});
});
