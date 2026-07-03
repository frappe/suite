import { test, expect, joinFromPreview } from "../fixtures/test";
import { expectRemoteVideoReceiving } from "../helpers/media";

test.describe("Multi participant", () => {
	test("host and two guests see the same meeting", async ({ hostPage, meetingId, createParticipant }) => {
		const guestOne = await createParticipant();
		const guestTwo = await createParticipant();

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);
		await guestOne.joinAsGuest(meetingId, `Guest One ${test.info().parallelIndex}`);
		await guestTwo.joinAsGuest(meetingId, `Guest Two ${test.info().parallelIndex}`);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(3);
		await expectRemoteVideoReceiving(hostPage, "Guest One");
		await expectRemoteVideoReceiving(hostPage, "Guest Two");
		await expectRemoteVideoReceiving(guestOne.page, "Administrator");
		await expectRemoteVideoReceiving(guestTwo.page, "Administrator");
		await hostPage.getByTestId("toolbar-people").click();

		const peoplePanel = hostPage.getByTestId("people-panel");
		await expect(peoplePanel).toContainText("People");
		await expect(peoplePanel).toContainText("Administrator");
		await expect(peoplePanel).toContainText("Guest One");
		await expect(peoplePanel).toContainText("Guest Two");
	});
});
