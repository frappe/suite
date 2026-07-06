import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Reactions and raise hand", () => {
	test("guest reaction and raised hand are visible to the host", async ({ hostPage, meetingId, createParticipant }) => {
		const guest = await createParticipant();

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, `Guest Engage ${test.info().parallelIndex}`);

		await guest.page.getByTestId("toolbar-reactions").click();
		await guest.page.getByLabel("Send 👍 reaction").click();

		await expect(hostPage.locator("[aria-label^='Reaction 👍']")).toBeVisible();

		await guest.page.getByTestId("toolbar-reactions").click();
		await guest.page.getByTestId("toolbar-raise-hand").click();

		await expect(hostPage.locator("[aria-label*='has raised their hand']")).toBeVisible();
		await hostPage.getByTestId("toolbar-people").click();
		await expect(hostPage.getByTestId("people-panel").locator("[title*='has raised their hand']")).toBeVisible();
	});
});
