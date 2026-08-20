import { describe, expect, it, vi } from "vitest";
import { ExpectedMediaReconciler } from "../ExpectedMediaReconciler";

const remoteVideo = {
	key: "remote:producer-1",
	direction: "remote" as const,
	media: "video" as const,
	source: "remote" as const,
	desired: true,
};

describe("ExpectedMediaReconciler", () => {
	it("tracks explicit lifecycle stages and verifies health twice", async () => {
		const report = vi.fn();
		let now = 0;
		const reconciler = new ExpectedMediaReconciler(report, () => now);
		reconciler.observe(remoteVideo);
		await reconciler.repair(
			remoteVideo.key,
			"subscription",
			"subscribe",
			vi.fn().mockResolvedValue(undefined),
		);

		expect(
			reconciler.observe({ ...remoteVideo, subscribed: true }).stage,
		).toBe("subscribed");
		now = 500;
		reconciler.observe({
			...remoteVideo,
			subscribed: true,
			flowing: true,
			decoding: true,
		});
		expect(report).not.toHaveBeenCalled();
		reconciler.observe({
			...remoteVideo,
			subscribed: true,
			flowing: true,
			decoding: true,
		});

		expect(reconciler.get(remoteVideo.key)).toMatchObject({
			stage: "decoding",
			attempts: 0,
		});
		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({
				stage: "subscription",
				action: "subscribe",
				outcome: "success",
				durationMs: 500,
			}),
		);
	});

	it("serializes and bounds repairs per expected stream", async () => {
		const report = vi.fn();
		const reconciler = new ExpectedMediaReconciler(report);
		reconciler.observe(remoteVideo);
		const operation = vi.fn().mockResolvedValue(undefined);

		for (let attempt = 0; attempt < 3; attempt++) {
			await Promise.all([
				reconciler.repair(
					remoteVideo.key,
					"subscription",
					"subscribe",
					operation,
				),
				reconciler.repair(
					remoteVideo.key,
					"subscription",
					"subscribe",
					operation,
				),
			]);
		}
		await reconciler.repair(
			remoteVideo.key,
			"subscription",
			"subscribe",
			operation,
		);

		expect(operation).toHaveBeenCalledTimes(3);
		expect(report).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "exhausted", attempt: 3 }),
		);
	});

	it("waits for two media-progress observations before verifying health", async () => {
		const reconciler = new ExpectedMediaReconciler();
		const controller = new AbortController();
		reconciler.observe({ ...remoteVideo, subscribed: true });
		let verified = false;
		const verification = reconciler
			.waitForHealthy(controller.signal, 1000)
			.then(() => {
				verified = true;
			});

		reconciler.observe({
			...remoteVideo,
			subscribed: true,
			flowing: true,
			decoding: true,
		});
		await Promise.resolve();
		expect(verified).toBe(false);
		reconciler.observe({
			...remoteVideo,
			subscribed: true,
			flowing: true,
			decoding: true,
		});

		await expect(verification).resolves.toBeUndefined();
	});
});
