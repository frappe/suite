import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

type MediaKind = "audio" | "video";
type ReceiverFault = "zero-bytes" | "decode-stall";

export interface VideoProgress {
	currentTime: number;
	decodedFrames: number;
	trackId: string;
}

function remoteVideo(page: Page, participantName: string) {
	return page
		.locator("[data-testid^='participant-tile-']", { hasText: participantName })
		.locator("video")
		.first();
}

export async function readRemoteVideoProgress(
	page: Page,
	participantName: string,
): Promise<VideoProgress> {
	return remoteVideo(page, participantName).evaluate((element, name) => {
		const video = element as HTMLVideoElement;
		const stream = video.srcObject as MediaStream | null;
		const track = stream?.getVideoTracks()[0];
		if (!track) throw new Error(`No remote video track for ${name}`);
		return {
			currentTime: video.currentTime,
			decodedFrames: video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0,
			trackId: track.id,
		};
	}, participantName);
}

export function monitorRemoteVideoContinuity(
	page: Page,
	participantName: string,
): { stop: () => Promise<void> } {
	let stopped = false;
	let failure: unknown;
	const monitoring = (async () => {
		let previous = await readRemoteVideoProgress(page, participantName);
		const trackId = previous.trackId;
		let lastProgressAt = Date.now();
		while (!stopped) {
			await page.waitForTimeout(500);
			const current = await readRemoteVideoProgress(page, participantName);
			if (current.trackId !== trackId) {
				throw new Error(`Healthy ${participantName} video track was replaced`);
			}
			if (
				current.currentTime > previous.currentTime ||
				current.decodedFrames > previous.decodedFrames
			) {
				lastProgressAt = Date.now();
			}
			if (Date.now() - lastProgressAt > 3000) {
				throw new Error(`Healthy ${participantName} video stopped advancing`);
			}
			previous = current;
		}
	})().catch((error) => {
		failure = error;
	});

	return {
		async stop() {
			stopped = true;
			await monitoring;
			if (failure) throw failure;
		},
	};
}

export async function stopLatestLocalTrack(
	page: Page,
	kind: MediaKind,
): Promise<string> {
	const trackId = await page.evaluate((mediaKind) => {
		return window.__meetMediaFaults?.stopLatestLocalTrack(mediaKind) ?? null;
	}, kind);
	if (!trackId) throw new Error(`No live local ${kind} track to stop`);
	return trackId;
}

export async function expectLocalTrackReplaced(
	page: Page,
	kind: MediaKind,
	previousTrackId: string,
): Promise<void> {
	await expect
		.poll(
			async () => {
				const trackId = await page.evaluate(
					(mediaKind) =>
						window.__meetMediaFaults?.latestLocalTrackId(mediaKind) ?? null,
					kind,
				);
				return Boolean(trackId && trackId !== previousTrackId);
			},
			{ timeout: 45_000 },
		)
		.toBe(true);
}

export async function injectRemoteVideoFault(
	page: Page,
	participantName: string,
	fault: ReceiverFault,
): Promise<VideoProgress> {
	const baseline = await readRemoteVideoProgress(page, participantName);
	const injected = await page.evaluate(
		({ trackId, faultName }) =>
			window.__meetMediaFaults?.injectReceiverStats(trackId, faultName) ?? false,
		{ trackId: baseline.trackId, faultName: fault },
	);
	if (!injected) throw new Error(`Could not inject ${fault} for ${participantName}`);
	return baseline;
}

export async function armNextRemoteVideoFault(
	page: Page,
	fault: ReceiverFault,
): Promise<void> {
	await page.evaluate((faultName) => {
		if (!window.__meetMediaFaults) throw new Error("Media fault bridge unavailable");
		window.__meetMediaFaults.armNextVideoReceiverFault(faultName);
	}, fault);
}

export async function setBrowserLifecycle(
	page: Page,
	state: { hidden: boolean; online: boolean },
): Promise<void> {
	await page.evaluate((next) => {
		if (!window.__meetMediaFaults)
			throw new Error("Media fault bridge unavailable");
		window.__meetMediaFaults.setBrowserLifecycle(next);
	}, state);
}

export async function expectRemoteTrackReplaced(
	page: Page,
	participantName: string,
	previousTrackId: string,
	timeoutMs = 90_000,
): Promise<void> {
	await expect
		.poll(
			async () =>
				(await readRemoteVideoProgress(page, participantName)).trackId,
			{ timeout: timeoutMs },
		)
		.not.toBe(previousTrackId);
}

declare global {
	interface Window {
		__meetMediaFaults?: {
			latestLocalTrackId(kind: MediaKind): string | null;
			stopLatestLocalTrack(kind: MediaKind): string | null;
			injectReceiverStats(trackId: string, fault: ReceiverFault): Promise<boolean>;
			armNextVideoReceiverFault(fault: ReceiverFault): void;
			setBrowserLifecycle(state: { hidden: boolean; online: boolean }): void;
		};
	}
}
