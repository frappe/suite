import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Joining and leaving", () => {
	test("host can join a new meeting and leave it", async ({ hostPage, createMeetingViaUi }) => {
		const meetingId = await createMeetingViaUi();

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);

		await hostPage.getByTestId("toolbar-end-call").click();

		await hostPage.waitForURL(/\/meet\/?$/);
		await expect(hostPage.getByTestId("home-page")).toBeVisible();
	});

	test("guest can join an open meeting from the preview", async ({ createParticipant, meetingId }) => {
		const guest = await createParticipant();

		await guest.joinAsGuest(meetingId, `Guest ${test.info().parallelIndex}`);

		await expect(guest.page.getByTestId("meeting-layout")).toBeVisible();
		await expect(guest.page.getByTestId("toolbar-end-call")).toBeVisible();
	});
});
