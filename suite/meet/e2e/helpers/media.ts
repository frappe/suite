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

	// Headless CI sometimes attaches a live track but leaves the element paused.
	await video.evaluate(async (element) => {
		const videoEl = element as HTMLVideoElement;
		videoEl.muted = true;
		if (videoEl.paused) {
			try {
				await videoEl.play();
			} catch {
				// Autoplay may still fail; the poll below is the real assertion.
			}
		}
	});

	// Single poll: live track + enough decoded media to prove remote video works.
	// readyState >= 2 (HAVE_CURRENT_DATA) is enough; requiring 4 (HAVE_ENOUGH_DATA)
	// is flaky under CI load even when frames are clearly rendering.
	await expect
		.poll(
			async () =>
				video.evaluate((element) => {
					const videoEl = element as HTMLVideoElement;
					const quality = videoEl.getVideoPlaybackQuality?.();
					const stream = videoEl.srcObject as MediaStream | null;
					const videoTrack = stream?.getVideoTracks()[0] ?? null;
					const decodedFrames = quality?.totalVideoFrames ?? 0;
					const hasPixels = videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
					const hasPlayback =
						videoEl.currentTime > 0 || decodedFrames > 0 || hasPixels;
					return {
						decodedFrames,
						hasPlayback,
						height: videoEl.videoHeight,
						ok:
							videoTrack?.readyState === "live" &&
							videoEl.readyState >= 2 &&
							hasPlayback,
						readyState: videoEl.readyState,
						trackState: videoTrack?.readyState ?? null,
						width: videoEl.videoWidth,
					};
				}),
			{ timeout: 45_000 },
		)
		.toMatchObject({ ok: true, trackState: "live" });
}
