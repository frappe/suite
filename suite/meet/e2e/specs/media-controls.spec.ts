import { test, expect, joinHostAndGuest } from "../fixtures/test";
import {
	expectRemoteVideoReceiving,
	expectVideoReceiving,
} from "../helpers/media";

test.describe("Media controls", () => {
	test("camera and microphone toggles are reflected remotely", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guest = await createParticipant();

		await joinHostAndGuest(
			hostPage,
			guest,
			meetingId,
			`Guest Media ${test.info().parallelIndex}`,
		);
		await expectRemoteVideoReceiving(guest.page, "Administrator");

		await hostPage.getByTestId("toolbar-camera").click();
		await hostPage.getByTestId("toolbar-microphone").click();

		const hostTile = guest.page.getByTestId("participant-tile-Administrator");
		await expect(hostTile).toBeVisible();
		await expect(hostTile).toHaveAttribute("data-audio-enabled", "false");
		await expect(hostTile).toHaveAttribute("data-video-enabled", "false");
	});

	test("screen sharing creates a dedicated remote tile", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guest = await createParticipant();

		await joinHostAndGuest(
			hostPage,
			guest,
			meetingId,
			`Guest Screen ${test.info().parallelIndex}`,
		);

		await hostPage.getByTestId("toolbar-screen-share").click();

		await expect(guest.page.locator("[data-tile-id^='screenshare-']")).toHaveCount(1);
		await expect(guest.page.getByText("Administrator's screen")).toBeVisible();
		await expectVideoReceiving(
			guest.page.locator("[data-tile-id^='screenshare-'] video").first(),
		);

		await hostPage.getByTestId("toolbar-screen-share").click();

		await expect(guest.page.locator("[data-tile-id^='screenshare-']")).toHaveCount(0);
		await expect(guest.page.getByText("Administrator's screen")).toHaveCount(0);
	});
});
