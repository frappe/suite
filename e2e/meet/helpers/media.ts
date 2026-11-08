import { expect, type Locator, type Page } from "@playwright/test";

export async function expectRemoteVideoReceiving(page: Page, participantName: string): Promise<void> {
	const tile = page.locator("[data-testid^='participant-tile-']", {
		hasText: participantName,
	});
	await expect(tile).toBeVisible({ timeout: 45_000 });
	await expectVideoReceiving(tile.locator("video").first());
}

export async function expectVideoReceiving(video: Locator): Promise<void> {
	await expect(video).toBeVisible({ timeout: 45_000 });

	await video.evaluate((element) => {
		if (!(element instanceof HTMLVideoElement)) throw new Error("Expected a video element");
		const videoEl = element;
		videoEl.muted = true;
		if (videoEl.paused) {
			void videoEl.play().catch(() => {
				// Poll below is the real assertion.
			});
		}
	});

	const getPlaybackState = async () =>
		video.evaluate((element) => {
			if (!(element instanceof HTMLVideoElement)) throw new Error("Expected a video element");
			const videoEl = element;
			const quality = videoEl.getVideoPlaybackQuality?.();
			const stream = videoEl.srcObject;
			if (stream !== null && !(stream instanceof MediaStream)) throw new Error("Expected a media stream");
			const videoTrack = stream?.getVideoTracks()[0] ?? null;
			const decodedFrames = quality?.totalVideoFrames ?? 0;
			const hasDecodedPlayback = decodedFrames > 0 || videoEl.currentTime > 0;
			return {
				currentTime: videoEl.currentTime,
				decodedFrames,
				hasDecodedPlayback,
				isLive: videoTrack?.readyState === "live",
				isReady: videoEl.readyState >= 2,
			};
		});

	// A live track with dimensions can still be a frozen frame, so first wait
	// for playback and then require it to progress from a fresh baseline.
	await expect.poll(getPlaybackState, { timeout: 45_000 }).toMatchObject({
		hasDecodedPlayback: true,
		isLive: true,
		isReady: true,
	});

	const baseline = await getPlaybackState();
	await expect
		.poll(
			async () => {
				const current = await getPlaybackState();
				return current.currentTime > baseline.currentTime || current.decodedFrames > baseline.decodedFrames;
			},
			{ timeout: 10_000 },
		)
		.toBe(true);
}
