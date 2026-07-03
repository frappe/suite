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

	await expect
		.poll(
			async () =>
				video.evaluate((element) => {
					const videoEl = element as HTMLVideoElement;
					const quality = videoEl.getVideoPlaybackQuality?.();
					const stream = videoEl.srcObject as MediaStream | null;
					const videoTrack = stream?.getVideoTracks()[0] ?? null;
					return {
						currentTime: videoEl.currentTime,
						decodedFrames: quality?.totalVideoFrames ?? 0,
						height: videoEl.videoHeight,
						readyState: videoEl.readyState,
						trackState: videoTrack?.readyState ?? null,
						width: videoEl.videoWidth,
					};
				}),
			{ timeout: 45_000 },
		)
		.toMatchObject({
			readyState: 4,
			trackState: "live",
		});

	await expect
		.poll(
			async () =>
				video.evaluate((element) => {
					const videoEl = element as HTMLVideoElement;
					const quality = videoEl.getVideoPlaybackQuality?.();
					return (
						videoEl.currentTime > 0 &&
						(quality?.totalVideoFrames ?? 0) > 0 &&
						videoEl.videoWidth > 0 &&
						videoEl.videoHeight > 0
					);
				}),
			{ timeout: 45_000 },
		)
		.toBe(true);
}
