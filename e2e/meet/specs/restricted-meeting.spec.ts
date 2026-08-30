import { test, expect, joinFromPreview, appUrl } from "../fixtures/test";

const lobbyTransitionTimeout = process.env.CI ? 60_000 : 30_000;

test.describe("Restricted meeting", { tag: "@meet-group-1" }, () => {
	test("guest waits for approval and host can admit from people panel", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting("restricted");
		const guest = await createParticipant();
		const guestName = `Guest Restricted ${test.info().parallelIndex}`;

		// Host must be in the meeting before admit controls appear.
		await hostPage.goto(appUrl(`/meet/${meetingId}`));
		await joinFromPreview(hostPage);

		await guest.page.goto(appUrl(`/meet/${meetingId}`));
		await expect(guest.page.getByRole("heading", { name: "Ready to join?" })).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByRole("button", { name: "Join Meeting" })).toBeEnabled();
		await guest.page.getByRole("button", { name: "Join Meeting" }).click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });

		const joinRequest = hostPage
			.locator("[data-testid^='join-request-']")
			.filter({ hasText: guestName });
		await expect(joinRequest).toBeVisible({ timeout: lobbyTransitionTimeout });
		await joinRequest.getByRole("button", { name: "Admit" }).click();

		await expect(guest.page.getByTestId("meeting-layout")).toBeVisible();
		await expect(guest.page.getByRole("button", { name: "End Call" })).toBeVisible();
	});

	test("guest in restricted lobby can't join meeting when rejected", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting("restricted");
		const guest = await createParticipant();
		const guestName = `Guest Rejected ${test.info().parallelIndex}-${test.info().retry}`;

		await hostPage.goto(appUrl(`/meet/${meetingId}`));
		await joinFromPreview(hostPage);

		await guest.page.goto(appUrl(`/meet/${meetingId}`));
		await expect(guest.page.getByRole("heading", { name: "Ready to join?" })).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByRole("button", { name: "Join Meeting" })).toBeEnabled();
		await guest.page.getByRole("button", { name: "Join Meeting" }).click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });

		const joinRequest = hostPage
			.locator("[data-testid^='join-request-']")
			.filter({ hasText: guestName });
		await expect(joinRequest).toBeVisible({ timeout: lobbyTransitionTimeout });
		await expect(async () => {
			await joinRequest.getByRole("button", { name: "Deny" }).click();
		}).toPass({ timeout: lobbyTransitionTimeout });
		await expect(joinRequest).toHaveCount(0, {
			timeout: lobbyTransitionTimeout,
		});
		await expect(
			guest.page.getByText("Your join request was denied by the meeting host"),
		).toBeVisible({ timeout: lobbyTransitionTimeout });

		await guest.page.goto(appUrl(`/meet/${meetingId}`));
		await expect(guest.page.getByRole("heading", { name: "Ready to join?" })).toBeVisible();
		await guest.page.getByPlaceholder("John Doe").fill(guestName);
		await guest.page.getByRole("button", { name: "Join Meeting" }).click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });
	});
});
