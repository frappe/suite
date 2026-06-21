import type { Page } from "@playwright/test";
import { test, expect, joinFromPreview, appUrl } from "../fixtures/test";

async function openMeetingAccessSettings(page: Page): Promise<void> {
	await page.getByTestId("toolbar-more").click();
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await page.getByRole("tab", { name: "Meeting Access" }).click();
}

async function enableE2EEInSettings(page: Page): Promise<void> {
	await openMeetingAccessSettings(page);
	const toggle = page.getByTestId("e2ee-toggle");
	await toggle.waitFor({ state: "visible" });
	await toggle.click();
	await expect(toggle).toBeDisabled({ timeout: 15_000 });
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
		await guest.joinMeeting(meetingId);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		});
		await expect(guest.page.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 30_000,
		});
	});
});
