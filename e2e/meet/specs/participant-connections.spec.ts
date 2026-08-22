import { appUrl, expect, joinFromPreview, test } from "../fixtures/test";
import { meetHostName } from "../helpers/auth";
import {
	expectRemoteTrackReplaced,
	readRemoteVideoProgress,
} from "../helpers/faults";
import { expectRemoteVideoReceiving } from "../helpers/media";

test.describe("Independent Participant Connections", () => {
	test(
		"closing one endpoint preserves the participant's other endpoint",
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

			await secondHostEndpoint.joinAsHost(meetingId);
			await expectRemoteTrackReplaced(
				guest.page,
				meetHostName,
				firstHostTrack.trackId,
			);
			await expectRemoteVideoReceiving(
				secondHostEndpoint.page,
				"Endpoint Observer",
			);
			const secondHostTrack = await readRemoteVideoProgress(
				guest.page,
				meetHostName,
			);

			await secondHostEndpoint.context.close();
			await expectRemoteTrackReplaced(
				guest.page,
				meetHostName,
				secondHostTrack.trackId,
			);

			await Promise.all([
				expect(hostPage.locator("[data-participant-id]")).toHaveCount(2),
				expect(guest.page.locator("[data-participant-id]")).toHaveCount(2),
				expectRemoteVideoReceiving(hostPage, "Endpoint Observer"),
				expectRemoteVideoReceiving(guest.page, meetHostName),
			]);
		},
	);
});
