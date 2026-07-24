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
});
