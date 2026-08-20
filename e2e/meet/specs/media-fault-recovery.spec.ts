import { appUrl, expect, joinFromPreview, test } from "../fixtures/test";
import {
	armNextRemoteVideoFault,
	expectLocalTrackReplaced,
	expectRemoteTrackReplaced,
	injectRemoteVideoFault,
	monitorRemoteVideoContinuity,
	readRemoteVideoProgress,
	setBrowserLifecycle,
	stopLatestLocalTrack,
} from "../helpers/faults";
import { expectRemoteVideoReceiving } from "../helpers/media";

test.describe("Media fault recovery", () => {
	test(
		"recovers an ended camera while healthy media keeps advancing",
		{ tag: "@meet-group-3" },
		async ({ hostPage, createMeeting, createParticipant }) => {
			const meetingId = await createMeeting();
			const target = await createParticipant();
			const control = await createParticipant();
			await Promise.all([
				(async () => {
					await hostPage.goto(appUrl(`/meet/${meetingId}`));
					await joinFromPreview(hostPage);
				})(),
				target.joinAsGuest(meetingId, "Fault Target"),
				control.joinAsGuest(meetingId, "Healthy Control"),
			]);
			await Promise.all([
				expectRemoteVideoReceiving(hostPage, "Fault Target"),
				expectRemoteVideoReceiving(hostPage, "Healthy Control"),
			]);
			const controlMonitor = monitorRemoteVideoContinuity(
				hostPage,
				"Healthy Control",
			);
			const stoppedTrackId = await stopLatestLocalTrack(target.page, "video");
			try {
				await expectLocalTrackReplaced(target.page, "video", stoppedTrackId);
				await expectRemoteVideoReceiving(hostPage, "Fault Target");
			} finally {
				await controlMonitor.stop();
			}
		},
	);

	test(
		"recreates only a zero-byte consumer while healthy media keeps advancing",
		{ tag: "@meet-group-2" },
		async ({ hostPage, createMeeting, createParticipant }) => {
			test.setTimeout(120_000);
			const meetingId = await createMeeting();
			const target = await createParticipant();
			const control = await createParticipant();
			await Promise.all([
				(async () => {
					await hostPage.goto(appUrl(`/meet/${meetingId}`));
					await joinFromPreview(hostPage);
				})(),
				control.joinAsGuest(meetingId, "Healthy Control"),
			]);
			await expectRemoteVideoReceiving(hostPage, "Healthy Control");
			const controlMonitor = monitorRemoteVideoContinuity(
				hostPage,
				"Healthy Control",
			);
			try {
				await armNextRemoteVideoFault(hostPage, "zero-bytes");
				await target.joinAsGuest(meetingId, "Fault Target");
				await expectRemoteVideoReceiving(hostPage, "Fault Target");
				const targetBaseline = await readRemoteVideoProgress(
					hostPage,
					"Fault Target",
				);
				await expectRemoteTrackReplaced(
					hostPage,
					"Fault Target",
					targetBaseline.trackId,
				);
				await expectRemoteVideoReceiving(hostPage, "Fault Target");
			} finally {
				await controlMonitor.stop();
			}
		},
	);

	test(
		"recreates only a decode-stalled consumer",
		{ tag: "@meet-group-1" },
		async ({ hostPage, createMeeting, createParticipant }) => {
			test.setTimeout(120_000);
			const meetingId = await createMeeting();
			const target = await createParticipant();
			const control = await createParticipant();
			await Promise.all([
				(async () => {
					await hostPage.goto(appUrl(`/meet/${meetingId}`));
					await joinFromPreview(hostPage);
				})(),
				target.joinAsGuest(meetingId, "Fault Target"),
				control.joinAsGuest(meetingId, "Healthy Control"),
			]);
			await Promise.all([
				expectRemoteVideoReceiving(hostPage, "Fault Target"),
				expectRemoteVideoReceiving(hostPage, "Healthy Control"),
			]);
			await hostPage.waitForTimeout(3500);
			const controlMonitor = monitorRemoteVideoContinuity(
				hostPage,
				"Healthy Control",
			);
			try {
				const targetBaseline = await injectRemoteVideoFault(
					hostPage,
					"Fault Target",
					"decode-stall",
				);
				await expectRemoteTrackReplaced(
					hostPage,
					"Fault Target",
					targetBaseline.trackId,
				);
				await expectRemoteVideoReceiving(hostPage, "Fault Target");
			} finally {
				await controlMonitor.stop();
			}
		},
	);

	test(
		"defers media repair while hidden and offline, then recovers on resume",
		{ tag: "@meet-group-2" },
		async ({ hostPage, createMeeting, createParticipant }) => {
			test.setTimeout(120_000);
			const meetingId = await createMeeting();
			const target = await createParticipant();
			const control = await createParticipant();
			await Promise.all([
				(async () => {
					await hostPage.goto(appUrl(`/meet/${meetingId}`));
					await joinFromPreview(hostPage);
				})(),
				target.joinAsGuest(meetingId, "Fault Target"),
				control.joinAsGuest(meetingId, "Healthy Control"),
			]);
			await Promise.all([
				expectRemoteVideoReceiving(hostPage, "Fault Target"),
				expectRemoteVideoReceiving(hostPage, "Healthy Control"),
			]);
			await hostPage.waitForTimeout(3500);
			const targetBaseline = await readRemoteVideoProgress(
				hostPage,
				"Fault Target",
			);
			const controlBaseline = await readRemoteVideoProgress(
				hostPage,
				"Healthy Control",
			);

			await setBrowserLifecycle(hostPage, { hidden: true, online: false });
			await injectRemoteVideoFault(hostPage, "Fault Target", "decode-stall");
			await hostPage.waitForTimeout(7000);
			expect(
				(await readRemoteVideoProgress(hostPage, "Fault Target")).trackId,
			).toBe(targetBaseline.trackId);

			await setBrowserLifecycle(hostPage, { hidden: false, online: true });
			await expectRemoteTrackReplaced(
				hostPage,
				"Fault Target",
				targetBaseline.trackId,
			);
			await Promise.all([
				expectRemoteVideoReceiving(hostPage, "Fault Target"),
				expectRemoteVideoReceiving(hostPage, "Healthy Control"),
			]);
			expect(
				(await readRemoteVideoProgress(hostPage, "Healthy Control")).trackId,
			).toBe(controlBaseline.trackId);
		},
	);
});
