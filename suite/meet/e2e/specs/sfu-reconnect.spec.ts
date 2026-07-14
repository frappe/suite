import { expect, joinHostAndGuest, test } from "../fixtures/test";
import { expectRemoteVideoReceiving } from "../helpers/media";

const disconnectTestEnabled =
	process.env.SFU_E2E_DISCONNECT_TEST === "true";
const disconnectWaitMs = Number.parseInt(
	process.env.SFU_E2E_DISCONNECT_WAIT_MS || "7000",
	10,
);

test.describe("SFU reconnect", () => {
	test.skip(
		!disconnectTestEnabled,
		"Requires the SFU E2E socket timeout configuration",
	);

	test("rejoins after the SFU removes an offline participant", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestName = "Guest Server Disconnect";
		const guest = await createParticipant();

		await joinHostAndGuest(hostPage, guest, meetingId, guestName);
		await expectRemoteVideoReceiving(hostPage, guestName);
		await expectRemoteVideoReceiving(guest.page, "Administrator");

		await guest.context.setOffline(true);
		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(1, {
			timeout: disconnectWaitMs + 10_000,
		});
		await guest.context.setOffline(false);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 45_000,
		});
		await expect(guest.page.locator("[data-participant-id]")).toHaveCount(2, {
			timeout: 45_000,
		});
		await expectRemoteVideoReceiving(hostPage, guestName);
		await expectRemoteVideoReceiving(guest.page, "Administrator");
	});
});
