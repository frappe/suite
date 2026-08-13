import { test, expect, joinHostAndGuest } from "../fixtures/test";

test.describe("Reactions and raise hand", { tag: "@meet-group-2" }, () => {
	test("guest reaction and raised hand are visible to the host", async ({
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
			`Guest Engage ${test.info().parallelIndex}`,
		);

		await guest.page.getByRole("button", { name: "Reactions" }).click();
		await guest.page.getByLabel("Send 👍 reaction").click();

		await expect(hostPage.locator("[aria-label^='Reaction 👍']")).toBeVisible();

		await guest.page.getByRole("button", { name: "Reactions" }).click();
		await guest.page.getByRole("button", { name: "Raise Hand" }).click();

		await expect(hostPage.locator("[aria-label*='has raised their hand']")).toBeVisible();
		await hostPage.getByRole("button", { name: "Show Participants" }).click();
		await expect(
			hostPage.getByTestId("people-panel").locator("[title*='has raised their hand']"),
		).toBeVisible();
	});
});
