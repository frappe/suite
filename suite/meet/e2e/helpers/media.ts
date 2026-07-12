import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function expectRemoteVideoReceiving(
	page: Page,
	participantName: string,
): Promise<void> {
	const tile = page.locator("[data-testid^='participant-tile-']", {
		hasText: participantName,
	});
	await expect(tile).toBeVisible({ timeout: 45_000 });
	await expectVideoReceiving(tile.locator("video").first());
}

export async function expectVideoReceiving(video: Locator): Promise<void> {
	await expect(video).toBeVisible({ timeout: 45_000 });

	await video.evaluate(async (element) => {
		const videoEl = element as HTMLVideoElement;
		videoEl.muted = true;
		if (videoEl.paused) {
			try {
				await videoEl.play();
			} catch {
				// Poll below is the real assertion.
			}
		}
	});

	// Live track + real decode (not metadata-only dimensions).
	await expect
		.poll(
			async () =>
				video.evaluate((element) => {
					const videoEl = element as HTMLVideoElement;
					const quality = videoEl.getVideoPlaybackQuality?.();
					const stream = videoEl.srcObject as MediaStream | null;
					const videoTrack = stream?.getVideoTracks()[0] ?? null;
					const decodedFrames = quality?.totalVideoFrames ?? 0;
					const hasDecodedPlayback =
						decodedFrames > 0 || videoEl.currentTime > 0;
					return {
						ok:
							videoTrack?.readyState === "live" &&
							videoEl.readyState >= 2 &&
							hasDecodedPlayback,
						trackState: videoTrack?.readyState ?? null,
					};
				}),
			{ timeout: 45_000 },
		)
		.toMatchObject({ ok: true, trackState: "live" });
}
