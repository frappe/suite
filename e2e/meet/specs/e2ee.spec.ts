import type { Page } from "@playwright/test";
import {
	test,
	expect,
	joinFromPreview,
	joinHostAndGuest,
	appUrl,
} from "../fixtures/test";
import { meetHostName } from "../helpers/auth";
import {
	expectRemoteVideoReceiving,
	expectVideoReceiving,
} from "../helpers/media";

async function expectParticipantsAndVideo(
	hostPage: Page,
	guestPage: Page,
	guestName: string,
): Promise<void> {
	await Promise.all([
		expect(hostPage.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		}),
		expect(guestPage.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		}),
	]);
	await expectRemoteVideoReceiving(guestPage, meetHostName);
	await expectRemoteVideoReceiving(hostPage, guestName);
}

async function openMeetingAccessSettings(page: Page): Promise<void> {
	await page.getByRole("button", { name: "More options" }).click();
	await page.getByRole("menuitem", { name: "Settings" }).click();
	// Tab renamed to "Controls"; SettingsNavItem is role=tab (frappe-ui TabsTrigger)
	await page.getByRole("tab", { name: "Controls" }).click();
}

async function enableE2EEInSettings(page: Page): Promise<void> {
	await openMeetingAccessSettings(page);
	const toggle = page.getByRole("switch", { name: "End-to-end encryption" });
	await expect(toggle).toBeVisible();
	if (!(await toggle.isChecked())) {
		await toggle.click();
		await expect(toggle).toBeChecked({ timeout: 15_000 });
		await expect(page.getByText("Encryption fingerprint")).toBeVisible({
			timeout: 30_000,
		});
	}
	const settingsDialog = page.getByRole("dialog", { name: "Settings" });
	await expect(async () => {
		if (await settingsDialog.isVisible()) {
			await page.keyboard.press("Escape");
		}
		await expect(settingsDialog).not.toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 10_000 });
}

async function openMeetingInformation(page: Page): Promise<void> {
	await page.getByRole("button", { name: "More options" }).click();
	await page.getByRole("menuitem", { name: "Meeting information" }).click();
}

async function readFingerprint(page: Page): Promise<string> {
	await openMeetingInformation(page);
	const section = page
		.locator("label", { hasText: "Encryption fingerprint" })
		.locator("xpath=..");
	await expect(section).toBeVisible({ timeout: 30_000 });
	return (await section.locator("pre").innerText()).trim();
}

async function expectScreenShareReceiving(page: Page): Promise<void> {
	const tile = page.locator("[data-tile-id^='screenshare-']");
	await expect(tile).toHaveCount(1, { timeout: 45_000 });
	await expect(page.getByText(`${meetHostName}'s screen`)).toBeVisible();
	await expectVideoReceiving(tile.locator("video").first());
}

async function clickScreenShare(page: Page): Promise<void> {
	await page
		.locator('button[aria-label="Toggle Screen Share"]')
		.evaluate((button) => (button as HTMLButtonElement).click());
}

async function forceSFUReconnect(page: Page): Promise<void> {
	await page.context().setOffline(true);
	await page.waitForTimeout(1500);
	await page.context().setOffline(false);
}

function capturePageErrors(page: Page, filterPatterns: string[] = []) {
	const errors: string[] = [];
	const logs: string[] = [];
	const onPageError = (error: Error) => errors.push(error.stack ?? error.message);
	const onConsole = (message: { type(): string; text(): string }) => {
		const text = message.text();
		logs.push(`[${message.type()}] ${text}`);
		if (message.type() !== "error") return;
		if (filterPatterns.some((p) => text.includes(p))) return;
		errors.push(text);
	};
	page.on("pageerror", onPageError);
	page.on("console", onConsole);
	return {
		assertNoErrors() {
			page.off("pageerror", onPageError);
			page.off("console", onConsole);
			expect(errors).toEqual([]);
		},
	};
}

test.describe("E2EE", () => {
	// Join first so media is healthy, then enable E2EE (avoids host-only avatar on CI).
	test("participants keep video after E2EE is enabled", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestName = "Guest E2EE";
		const guest = await createParticipant();

		await joinHostAndGuest(hostPage, guest, meetingId, guestName);
		await expectParticipantsAndVideo(hostPage, guest.page, guestName);

		await enableE2EEInSettings(hostPage);

		await expectParticipantsAndVideo(hostPage, guest.page, guestName);
	});

	test.describe("heavy coverage", () => {
		test.describe.configure({ timeout: 90_000 });

	test("active participants keep receiving streams after E2EE is enabled mid-call", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestName = "Guest Convert E2EE";
		const guest = await createParticipant();

		await joinHostAndGuest(hostPage, guest, meetingId, guestName);

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);

		const hostErrors = capturePageErrors(hostPage);
		await enableE2EEInSettings(hostPage);
		hostErrors.assertNoErrors();

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);
	});

	test("a participant can rejoin an E2EE meeting after leaving", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestName = "Guest Rejoin E2EE";
		const guest = await createParticipant();

		await joinHostAndGuest(hostPage, guest, meetingId, guestName);

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);

		await enableE2EEInSettings(hostPage);

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);

		await guest.page.goto(appUrl("/meet/"));
		await guest.page.waitForTimeout(2000);

		const hostErrors = capturePageErrors(hostPage);
		const guestErrors = capturePageErrors(guest.page, [
			"refresh_sfu_token",
			"403 (FORBIDDEN)",
		]);
		await guest.joinAsGuest(meetingId, guestName);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		});
		await expect(guest.page.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		});
		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);
		hostErrors.assertNoErrors();
		guestErrors.assertNoErrors();
	});

	test("the host can leave and rejoin an E2EE meeting while a guest stays", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestName = "Guest Host Rejoin E2EE";
		const guest = await createParticipant();

		await joinHostAndGuest(hostPage, guest, meetingId, guestName);

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);

		await enableE2EEInSettings(hostPage);

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);

		await hostPage.goto(appUrl("/meet/"));

		await expect(guest.page.locator("[data-participant-id]")).toHaveCount(1, {
			timeout: 30_000,
		});
		await expect(
			guest.page.getByRole("toolbar", { name: "Meeting controls" }),
		).toBeVisible();

		const teardownErrors = [
			"request_consumer_keyframe",
			"refresh_sfu_token",
			"403 (FORBIDDEN)",
		];
		const hostErrors = capturePageErrors(hostPage, teardownErrors);
		const guestErrors = capturePageErrors(guest.page, teardownErrors);

		await hostPage.goto(appUrl(`/meet/${meetingId}`));
		await joinFromPreview(hostPage);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 45_000,
		});
		await expect(guest.page.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 45_000,
		});

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);
		hostErrors.assertNoErrors();
		guestErrors.assertNoErrors();
	});

	test("screen share streams stay healthy in an E2EE meeting", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestName = "Guest Screen E2EE";
		const guest = await createParticipant();

		await joinHostAndGuest(hostPage, guest, meetingId, guestName);

		await expectRemoteVideoReceiving(guest.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestName);

		await enableE2EEInSettings(hostPage);

		const hostErrors = capturePageErrors(hostPage, ["request_consumer_keyframe"]);
		const guestErrors = capturePageErrors(guest.page, ["request_consumer_keyframe"]);
		await clickScreenShare(hostPage);

		await expectScreenShareReceiving(guest.page);
		await clickScreenShare(hostPage);
		await expect(guest.page.locator("[data-tile-id^='screenshare-']")).toHaveCount(0);
		hostErrors.assertNoErrors();
		guestErrors.assertNoErrors();
	});

	test("multiple participants can join an active E2EE meeting and see the same fingerprint", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestAName = "Guest Fingerprint A";
		const guestBName = "Guest Fingerprint B";
		const guestCName = "Guest Fingerprint C";
		const guestA = await createParticipant();
		const guestB = await createParticipant();
		const guestC = await createParticipant();

		await joinHostAndGuest(hostPage, guestA, meetingId, guestAName);

		await expectRemoteVideoReceiving(guestA.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestAName);

		await enableE2EEInSettings(hostPage);

		await expectRemoteVideoReceiving(guestA.page, meetHostName);
		await expectRemoteVideoReceiving(hostPage, guestAName);

		await guestB.joinAsGuest(meetingId, guestBName);
		await guestC.joinAsGuest(meetingId, guestCName);

		await Promise.all([
			expect(hostPage.locator("[data-participant-id]")).toHaveCount(4, {
				timeout: 45_000,
			}),
			expect(guestA.page.locator("[data-participant-id]")).toHaveCount(4, {
				timeout: 45_000,
			}),
			expect(guestB.page.locator("[data-participant-id]")).toHaveCount(4, {
				timeout: 45_000,
			}),
			expect(guestC.page.locator("[data-participant-id]")).toHaveCount(4, {
				timeout: 45_000,
			}),
		]);

		await expectRemoteVideoReceiving(hostPage, guestAName);
		await expectRemoteVideoReceiving(hostPage, guestBName);
		await expectRemoteVideoReceiving(hostPage, guestCName);
		await expectRemoteVideoReceiving(guestA.page, meetHostName);
		await expectRemoteVideoReceiving(guestB.page, meetHostName);
		await expectRemoteVideoReceiving(guestC.page, meetHostName);

		const [guestAFingerprint, guestBFingerprint, guestCFingerprint] =
			await Promise.all([
				readFingerprint(guestA.page),
				readFingerprint(guestB.page),
				readFingerprint(guestC.page),
			]);
		expect(guestBFingerprint).toBe(guestAFingerprint);
		expect(guestCFingerprint).toBe(guestAFingerprint);
	});
	});

	test("participants recover advancing streams after an SFU reconnect in an E2EE meeting", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		test.setTimeout(90_000);
		const meetingId = await createMeeting();
		const guestName = "Guest Reconnect E2EE";
		const guest = await createParticipant();

		await joinHostAndGuest(hostPage, guest, meetingId, guestName);
		await expectParticipantsAndVideo(hostPage, guest.page, guestName);
		await enableE2EEInSettings(hostPage);
		await expectParticipantsAndVideo(hostPage, guest.page, guestName);

		const guestErrors = capturePageErrors(guest.page, [
			"refresh_sfu_token",
			"403 (FORBIDDEN)",
			"request_consumer_keyframe",
			"ERR_INTERNET_DISCONNECTED",
			"Failed to load MediaPipe Selfie Segmentation model",
			"Background effects processing error",
		]);
		const hostErrors = capturePageErrors(hostPage, ["request_consumer_keyframe"]);
		await forceSFUReconnect(guest.page);

		await expectParticipantsAndVideo(hostPage, guest.page, guestName);
		hostErrors.assertNoErrors();
		guestErrors.assertNoErrors();
	});
});
