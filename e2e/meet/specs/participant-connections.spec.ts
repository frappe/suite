import { appUrl, expect, joinFromPreview, test } from "../fixtures/test";
import { meetHostName } from "../helpers/auth";
import {
	expectRemoteTrackReplaced,
	readRemoteVideoProgress,
} from "../helpers/faults";
import { expectRemoteVideoReceiving } from "../helpers/media";

test.describe("Participant Connection switching", () => {
	test(
		"keeps the incumbent active until a device switch is confirmed",
		{ tag: "@meet-group-3" },
		async ({ hostPage, createMeeting, createParticipant }) => {
			const meetingId = await createMeeting();
			const secondHostEndpoint = await createParticipant();
			const guest = await createParticipant();
			await Promise.all([
				(async () => {
					await hostPage.goto(appUrl(`/meet/${meetingId}`));
					await joinFromPreview(hostPage);
				})(),
				guest.joinAsGuest(meetingId, "Endpoint Observer"),
			]);

			await Promise.all([
				expect(hostPage.locator("[data-participant-id]")).toHaveCount(2),
				expect(guest.page.locator("[data-participant-id]")).toHaveCount(2),
				expectRemoteVideoReceiving(hostPage, "Endpoint Observer"),
				expectRemoteVideoReceiving(guest.page, meetHostName),
			]);
			const firstHostTrack = await readRemoteVideoProgress(
				guest.page,
				meetHostName,
			);

			const secondHostJoin = secondHostEndpoint.joinAsHost(meetingId);
			await expect(
				secondHostEndpoint.page.getByText("Switch to this device?", {
					exact: true,
				}).last(),
			).toBeVisible();
			await Promise.all([
				expect(hostPage.getByTestId("meeting-layout")).toBeVisible(),
				expectRemoteVideoReceiving(guest.page, meetHostName),
			]);

			await secondHostEndpoint.page
				.locator("button")
				.filter({ hasText: "Switch to this device" })
				.last()
				.click();
			await secondHostJoin;
			await expectRemoteTrackReplaced(
				guest.page,
				meetHostName,
				firstHostTrack.trackId,
			);
			await expect(
				hostPage.getByRole("heading", {
					name: "Meeting moved to another device",
				}),
			).toBeVisible();
			await expectRemoteVideoReceiving(
				secondHostEndpoint.page,
				"Endpoint Observer",
			);

			await Promise.all([
				expect(guest.page.locator("[data-participant-id]")).toHaveCount(2),
				expectRemoteVideoReceiving(guest.page, meetHostName),
			]);
		},
	);
});
