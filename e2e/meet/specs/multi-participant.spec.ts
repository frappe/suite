import { test, expect, joinFromPreview, appUrl } from "../fixtures/test";
import { meetHostName } from "../helpers/auth";
import { expectRemoteVideoReceiving } from "../helpers/media";

declare global {
	interface Window {
		__meetCaptureGate?: { waiting: boolean; release: (allow: boolean) => void };
	}
}

test.describe("Multi participant", () => {
	for (const allowCapture of [true, false]) {
		test(`waits for initial capture before guest join (${allowCapture ? "allowed" : "denied"})`, async ({
			hostPage, createMeeting, createParticipant,
		}) => {
			const meetingId = await createMeeting();
			const control = await createParticipant();
			await Promise.all([
				(async () => {
					await hostPage.goto(appUrl(`/meet/${meetingId}`));
					await joinFromPreview(hostPage);
				})(),
				control.joinAsGuest(meetingId, "Capture Control"),
			]);
			const delayed = await createParticipant();
			await delayed.context.addInitScript(() => {
				const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
				let release!: (allow: boolean) => void;
				const gate = new Promise<boolean>((resolve) => { release = resolve; });
				window.__meetCaptureGate = { waiting: false, release };
				navigator.mediaDevices.getUserMedia = async (constraints) => {
					window.__meetCaptureGate!.waiting = true;
					if (!(await gate)) throw new DOMException("Test capture denied", "NotAllowedError");
					return original(constraints);
				};
			});
			await delayed.page.goto(appUrl(`/meet/${meetingId}`));
			await delayed.page.getByPlaceholder("John Doe").fill("Delayed Capture");
			await delayed.page.waitForFunction(() => window.__meetCaptureGate?.waiting === true);
			try {
				await expect(delayed.page.getByRole("button", { name: /Join Meeting$/ })).toBeDisabled();
			} finally {
				await delayed.page.evaluate((allow) => window.__meetCaptureGate!.release(allow), allowCapture);
			}
			await joinFromPreview(delayed.page);
			await expect(delayed.page.getByTestId("meeting-layout")).toBeVisible();
			await expect(hostPage.locator("[data-participant-id]")).toHaveCount(3);
			await expectRemoteVideoReceiving(delayed.page, meetHostName);
			await expectRemoteVideoReceiving(delayed.page, "Capture Control");
			if (allowCapture) {
				await expectRemoteVideoReceiving(hostPage, "Delayed Capture");
			} else {
				const tile = hostPage.locator("[data-testid^='participant-tile-']", { hasText: "Delayed Capture" });
				await expect(tile).toHaveAttribute("data-video-enabled", "false");
				await expect(tile).toHaveAttribute("data-audio-enabled", "false");
			}
		});
	}

	test("host and two guests see the same meeting", async ({
		hostPage,
		createMeeting,
		createParticipant,
	}) => {
		const meetingId = await createMeeting();
		const guestOne = await createParticipant();
		const guestTwo = await createParticipant();
		const guestOneName = `Guest One ${test.info().parallelIndex}`;
		const guestTwoName = `Guest Two ${test.info().parallelIndex}`;

		await Promise.all([
			(async () => {
				await hostPage.goto(appUrl(`/meet/${meetingId}`));
				await joinFromPreview(hostPage);
			})(),
			guestOne.joinAsGuest(meetingId, guestOneName),
			guestTwo.joinAsGuest(meetingId, guestTwoName),
		]);

		await expect(hostPage.locator("[data-participant-id]")).toHaveCount(3);
		await Promise.all([
			expectRemoteVideoReceiving(hostPage, "Guest One"),
			expectRemoteVideoReceiving(hostPage, "Guest Two"),
			expectRemoteVideoReceiving(guestOne.page, meetHostName),
			expectRemoteVideoReceiving(guestTwo.page, meetHostName),
		]);
		await hostPage.getByRole("button", { name: "Show Participants" }).click();

		const peoplePanel = hostPage.getByTestId("people-panel");
		await expect(peoplePanel).toContainText("People");
		await expect(peoplePanel).toContainText(meetHostName);
		await expect(peoplePanel).toContainText("Guest One");
		await expect(peoplePanel).toContainText("Guest Two");
	});
});
