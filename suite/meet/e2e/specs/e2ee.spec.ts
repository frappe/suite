import type { Page } from "@playwright/test";
import { test, expect, joinFromPreview, appUrl } from "../fixtures/test";

async function openMeetingAccessSettings(page: Page): Promise<void> {
	await page.getByTestId("toolbar-more").click();
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await page.getByRole("button", { name: "Meeting Access" }).click();
}

async function enableE2EEInSettings(page: Page): Promise<void> {
	await openMeetingAccessSettings(page);
	const toggle = page.getByRole("switch", { name: "End-to-end encryption" });
	await expect(toggle).toBeVisible();
	await toggle.click();
	await expect(toggle).toBeChecked({ timeout: 15_000 });
	await expect(page.getByText("Encryption fingerprint")).toBeVisible({
		timeout: 30_000,
	});
}

async function expectRemoteVideoReceiving(
	page: Page,
	participantName: string,
): Promise<void> {
	const tile = page.locator("[data-testid^='participant-tile-']", {
		hasText: participantName,
	});
	await expect(tile).toBeVisible({ timeout: 45_000 });
	const video = tile.locator("video").first();
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

test.describe("E2EE (v2 ECDH handshake)", () => {
	test("participants can join an E2EE meeting without a passphrase", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();

		await hostPage.goto(appUrl(`/meet/${meetingId}`));
		await joinFromPreview(hostPage);

		await enableE2EEInSettings(hostPage);

		const guest = await createParticipant();
		await guest.joinAsGuest(meetingId, "Guest E2EE");

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		});
		await expect(guest.page.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		});
		await expectRemoteVideoReceiving(guest.page, "Administrator");
		await expectRemoteVideoReceiving(hostPage, "Guest E2EE");
	});

	test("active participants keep receiving streams after E2EE is enabled mid-call", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestName = "Guest Convert E2EE";
		const guest = await createParticipant();

		await hostPage.goto(appUrl(`/meet/${meetingId}`));
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, guestName);

		await expectRemoteVideoReceiving(guest.page, "Administrator");
		await expectRemoteVideoReceiving(hostPage, guestName);

		await enableE2EEInSettings(hostPage);

		await expectRemoteVideoReceiving(guest.page, "Administrator");
		await expectRemoteVideoReceiving(hostPage, guestName);
	});
});
