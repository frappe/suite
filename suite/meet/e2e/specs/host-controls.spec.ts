import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Host controls", () => {
	test("host can mute a guest participant", async ({ hostPage, meetingId, createParticipant }) => {
		const guest = await createParticipant();
		const guestName = `Guest Mute ${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, guestName);
		const guestSelfTile = guest.page
			.locator("[data-testid^='participant-tile-guest_']")
			.first();
		if ((await guestSelfTile.getAttribute("data-audio-enabled")) === "false") {
			await guest.page.getByTestId("toolbar-microphone").click();
			await expect(guestSelfTile).toHaveAttribute("data-audio-enabled", "true");
		}

		await hostPage.getByTestId("toolbar-people").click();
		await expect(hostPage.getByTestId("people-panel")).toBeVisible();

		const guestRow = hostPage
			.getByTestId("people-panel")
			.locator("[data-testid^='people-participant-']")
			.filter({ hasText: guestName })
			.first();
		const guestTileOnHost = hostPage
			.locator("[data-testid^='participant-tile-']")
			.filter({ hasText: guestName })
			.first();

		await expect(guestRow).toBeVisible();
		await expect(guestRow).toHaveAttribute("data-audio-enabled", "true");
		await expect(guestTileOnHost).toBeVisible();
		await guestRow.getByRole("button", { name: /Actions for/ }).click();
		await hostPage.getByRole("menuitem", { name: "Mute" }).click();

		await expect(guestTileOnHost).toHaveAttribute("data-audio-enabled", "false");
		await expect(
			guest.page.locator("[data-testid^='participant-tile-guest_'][data-audio-enabled='false']"),
		).toHaveCount(1);
	});

	test("host can remove a guest participant", async ({ hostPage, meetingId, createParticipant }) => {
		const guest = await createParticipant();
		const guestName = `Guest Remove ${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, guestName);

		await hostPage.getByTestId("toolbar-people").click();
		await expect(hostPage.getByTestId("people-panel")).toBeVisible();

		const guestRow = hostPage
			.getByTestId("people-panel")
			.locator("[data-testid^='people-participant-']")
			.filter({ hasText: guestName })
			.first();
		const guestTileOnHost = hostPage
			.locator("[data-testid^='participant-tile-']")
			.filter({ hasText: guestName })
			.first();

		await expect(guestRow).toBeVisible();
		await expect(guestTileOnHost).toBeVisible();
		await guestRow.getByRole("button", { name: /Actions for/ }).click();
		await hostPage.getByRole("menuitem", { name: "Remove" }).click();

		await expect(hostPage.getByText("Remove Participant")).toBeVisible();
		await hostPage.getByRole("button", { name: "Remove", exact: true }).click();

		await expect(guestTileOnHost).toHaveCount(0);
		await expect(guest.page.getByTestId("meeting-layout")).toHaveCount(0);
		await expect
			.poll(async () => {
				const url = guest.page.url();
				if (url.includes("/login")) {
					return "login";
				}
				if (url.endsWith("/meet/")) {
					return "home";
				}
				return "other";
			})
			.toMatch(/login|home/);
	});
});
