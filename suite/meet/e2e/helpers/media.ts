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

	// Live track + evidence of actual decode/playback.
	// Do not treat videoWidth/Height alone as success — browsers can set those from
	// SDP/track metadata (HAVE_METADATA) before any frame is decoded.
	// readyState >= 2 is HAVE_CURRENT_DATA (frame data for the current position);
	// requiring 4 (HAVE_ENOUGH_DATA) is flaky under CI load.
	await expect
		.poll(
			async () =>
				video.evaluate((element) => {
					const videoEl = element as HTMLVideoElement;
					const quality = videoEl.getVideoPlaybackQuality?.();
					const stream = videoEl.srcObject as MediaStream | null;
					const videoTrack = stream?.getVideoTracks()[0] ?? null;
					const decodedFrames = quality?.totalVideoFrames ?? 0;
					// currentTime advancing or decoded frames — not dimensions alone.
					const hasDecodedPlayback =
						decodedFrames > 0 || videoEl.currentTime > 0;
					return {
						currentTime: videoEl.currentTime,
						decodedFrames,
						hasDecodedPlayback,
						height: videoEl.videoHeight,
						ok:
							videoTrack?.readyState === "live" &&
							videoEl.readyState >= 2 &&
							hasDecodedPlayback,
						readyState: videoEl.readyState,
						trackState: videoTrack?.readyState ?? null,
						width: videoEl.videoWidth,
					};
				}),
			{ timeout: 45_000 },
		)
		.toMatchObject({ ok: true, trackState: "live" });
}
