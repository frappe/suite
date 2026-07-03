import { test, expect, joinFromPreview } from "../fixtures/test";

test.describe("Chat", () => {
	test("messages are delivered between host and guest", async ({ hostPage, meetingId, createParticipant }) => {
		const guest = await createParticipant();
		const message = `hello-${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, `Guest Chat ${test.info().parallelIndex}`);

		await hostPage.getByTestId("toolbar-chat").click();
		await hostPage.getByTestId("chat-input-wrapper").click();
		const hostChatInput = hostPage.getByTestId("chat-input");
		await expect(hostChatInput).toBeFocused();
		await hostChatInput.fill(message);
		await hostPage.getByTestId("chat-send").click();

		await guest.page.getByTestId("toolbar-chat").click();
		await expect(guest.page.getByTestId("chat-messages")).toContainText(message);
	});

	test("unread badge appears when chat is closed and clears when opened", async ({
		hostPage,
		meetingId,
		createParticipant,
	}) => {
		const guest = await createParticipant();
		const message = `unread-${test.info().parallelIndex}`;

		await hostPage.goto(`/meet/${meetingId}`);
		await joinFromPreview(hostPage);
		await guest.joinAsGuest(meetingId, `Guest Unread ${test.info().parallelIndex}`);

		const chatButton = hostPage.getByTestId("toolbar-chat");
		const unreadBadge = hostPage.getByTestId("toolbar-chat-unread");

		await expect(unreadBadge).toHaveCount(0);

		await guest.page.getByTestId("toolbar-chat").click();
		await guest.page.getByTestId("chat-input").fill(message);
		await guest.page.getByTestId("chat-send").click();

		await expect(unreadBadge).toHaveCount(1);

		await chatButton.click();
		await expect(hostPage.getByTestId("chat-messages")).toContainText(message);
		await expect(unreadBadge).toHaveCount(0);
	});
});
