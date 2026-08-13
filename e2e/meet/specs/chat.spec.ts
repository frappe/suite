import { test, expect, joinHostAndGuest } from "../fixtures/test";

test.describe("Chat", { tag: "@meet-group-1" }, () => {
	test("messages are delivered between host and guest", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guest = await createParticipant();
		const message = `hello-${test.info().parallelIndex}`;

		await joinHostAndGuest(
			hostPage,
			guest,
			meetingId,
			`Guest Chat ${test.info().parallelIndex}`,
		);

		await hostPage.getByRole("button", { name: "Show Chat" }).click();
		const hostChatInput = hostPage.getByPlaceholder("Type a message");
		await hostChatInput.click();
		await expect(hostChatInput).toBeFocused();
		await hostChatInput.fill(message);
		await hostPage.getByRole("button", { name: "Send message" }).click();

		await guest.page.getByRole("button", { name: "Show Chat" }).click();
		await expect(
			guest.page.getByTestId("chat-panel").getByText(message, { exact: true }),
		).toBeVisible();
	});

	test("unread badge appears when chat is closed and clears when opened", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guest = await createParticipant();
		const message = `unread-${test.info().parallelIndex}`;

		await joinHostAndGuest(
			hostPage,
			guest,
			meetingId,
			`Guest Unread ${test.info().parallelIndex}`,
		);

		const chatButton = hostPage.getByRole("button", { name: "Show Chat" });
		const unreadBadge = hostPage.getByTestId("toolbar-chat-unread");

		await expect(unreadBadge).toHaveCount(0);

		await guest.page.getByRole("button", { name: "Show Chat" }).click();
		await guest.page.getByPlaceholder("Type a message").fill(message);
		await guest.page.getByRole("button", { name: "Send message" }).click();

		await expect(unreadBadge).toHaveCount(1);

		await chatButton.click();
		await expect(
			hostPage.getByTestId("chat-panel").getByText(message, { exact: true }),
		).toBeVisible();
		await expect(unreadBadge).toHaveCount(0);
	});
});
