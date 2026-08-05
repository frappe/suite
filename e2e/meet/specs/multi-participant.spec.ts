import { test, expect, joinFromPreview, appUrl } from "../fixtures/test";
import { meetHostName } from "../helpers/auth";
import { expectRemoteVideoReceiving } from "../helpers/media";

test.describe("Multi participant", () => {
	test("host and two guests see the same meeting", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestOne = await createParticipant();
		const guestTwo = await createParticipant();
		const guestOneName = `Guest One ${test.info().parallelIndex}`;
		const guestTwoName = `Guest Two ${test.info().parallelIndex}`;

		await Promise.all([
			(async () => {
				await hostPage.goto(appUrl(`/meet/${meetingId}`));
				await joinFromPreview(hostPage);
			})(),
			guestOne.joinAsGuest(meetingId, guestOneName),
			guestTwo.joinAsGuest(meetingId, guestTwoName),
		]);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(3);
		await Promise.all([
			expectRemoteVideoReceiving(hostPage, "Guest One"),
			expectRemoteVideoReceiving(hostPage, "Guest Two"),
			expectRemoteVideoReceiving(guestOne.page, meetHostName),
			expectRemoteVideoReceiving(guestTwo.page, meetHostName),
		]);
		await hostPage.getByRole("button", { name: "Show Participants" }).click();

		const peoplePanel = hostPage.getByTestId("people-panel");
		await expect(peoplePanel).toContainText("People");
		await expect(peoplePanel).toContainText(meetHostName);
		await expect(peoplePanel).toContainText("Guest One");
		await expect(peoplePanel).toContainText("Guest Two");
	});
});
