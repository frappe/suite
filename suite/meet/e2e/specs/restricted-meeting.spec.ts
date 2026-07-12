import { test, expect, joinFromPreview, appUrl } from "../fixtures/test";

const lobbyTransitionTimeout = process.env.CI ? 60_000 : 30_000;

test.describe("Restricted meeting", () => {
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
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByTestId("join-meeting-preview-button")).toBeEnabled();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });

		const joinRequest = hostPage
			.locator("[data-testid^='join-request-']")
			.filter({ hasText: guestName });
		await expect(joinRequest).toBeVisible({ timeout: lobbyTransitionTimeout });
		await joinRequest.getByRole("button", { name: "Admit" }).click();

		await expect(guest.page.getByTestId("meeting-layout")).toBeVisible();
		await expect(guest.page.getByTestId("toolbar-end-call")).toBeVisible();
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
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		const guestNameInput = guest.page.getByPlaceholder("John Doe");
		await guestNameInput.fill(guestName);
		await expect(guestNameInput).toHaveValue(guestName);
		await expect(guest.page.getByTestId("join-meeting-preview-button")).toBeEnabled();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });

		const joinRequest = hostPage
			.locator("[data-testid^='join-request-']")
			.filter({ hasText: guestName });
		await expect(joinRequest).toBeVisible({ timeout: lobbyTransitionTimeout });
		await joinRequest.getByRole("button", { name: "Deny" }).click();
		await expect(joinRequest).toHaveCount(0, {
			timeout: lobbyTransitionTimeout,
		});

		await guest.page.goto(appUrl(`/meet/${meetingId}`));
		await expect(guest.page.getByTestId("meeting-preview")).toBeVisible();
		await guest.page.getByTestId("join-meeting-preview-button").click();

		await expect(
			guest.page.getByRole("heading", { name: "Waiting to be admitted" }),
		).toBeVisible({ timeout: lobbyTransitionTimeout });
	});
});
