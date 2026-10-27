import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { loginViaApi } from "../../shared/auth";
import { meetHost } from "../helpers/auth";
import {
	createMeetingViaApi,
	clearMeetingRateLimits,
} from "../helpers/meeting";
import { joinFromPreview } from "../fixtures/test";
import { installAudioCapture } from "../captions/browser";
// @ts-expect-error Runtime validator is shared with the caption pilot.
import { verifyAudioPublication } from "../captions/publication.mjs";

interface Clip {
	id: string;
	path: string;
	reference: string;
	sha256: string;
	corpus: string;
	license: string;
}
interface Scenario {
	id: string;
	video: boolean;
	transcript: boolean;
	index: number;
	overlap: boolean;
	mixed?: boolean;
}
interface CaptureState {
	name: string;
	status: string;
	video_capture_state?: string;
	transcription_capture_state?: string;
}
async function state(
	api: APIRequestContext,
	room: string,
): Promise<CaptureState | null> {
	const response = await api.get(
		"/api/v2/method/suite.meet.api.recording.get_state",
		{ params: { meeting_id: room } },
	);
	expect(response.ok()).toBe(true);
	return (await response.json()).data;
}

test("licensed speech crosses Meet capture and persistent recorder storage", async ({
	browser,
}) => {
	const manifestPath = process.env.MEET_TRANSCRIPTION_MANIFEST;
	const output = process.env.MEET_TRANSCRIPTION_CAPTURE_REPORT;
	if (!manifestPath || !output)
		throw new Error("Configure private pilot manifest and output paths");
	const manifest: { cases: Clip[] } = JSON.parse(
		await readFile(manifestPath, "utf8"),
	);
	for (const corpus of ["ami", "indian-english"]) {
		if (manifest.cases.filter((clip) => clip.corpus === corpus).length < 4)
			throw new Error(`The frozen manifest needs four ${corpus} clips`);
	}
	const cases: Scenario[] = [
		{
			id: "transcription-only",
			video: false,
			transcript: true,
			index: 0,
			overlap: false,
		},
		{ id: "both", video: true, transcript: true, index: 1, overlap: false },
		{
			id: "transcription-backlog",
			video: false,
			transcript: true,
			index: 2,
			overlap: false,
		},
		{
			id: "both-overlap",
			video: true,
			transcript: true,
			index: 3,
			overlap: true,
		},
		{
			id: "video-only",
			video: true,
			transcript: false,
			index: 0,
			overlap: false,
		},
		{
			id: "silence",
			video: false,
			transcript: true,
			index: -1,
			overlap: false,
		},
	];
	if (manifest.cases.filter((clip) => clip.corpus === "hinglish").length >= 2)
		cases.push({
			id: "mixed-with-silent-late-join",
			video: false,
			transcript: true,
			index: 0,
			overlap: false,
			mixed: true,
		});
	const startIndex = Number(process.env.MEET_PILOT_START ?? 0);
	const endIndex = Number(process.env.MEET_PILOT_CASES ?? cases.length);
	if (
		!Number.isInteger(startIndex) ||
		!Number.isInteger(endIndex) ||
		startIndex < 0 ||
		endIndex > cases.length ||
		startIndex >= endIndex
	)
		throw new Error("Invalid pilot scenario range");
	const results: object[] = startIndex
		? JSON.parse(await readFile(output, "utf8")).cases
		: [];
	for (const scenario of cases.slice(startIndex, endIndex)) {
		console.log(`Pilot phase: ${scenario.id}`);
		const host = await browser.newContext({
			baseURL: process.env.BASE_URL ?? "http://localhost:8098",
			permissions: ["camera", "microphone"],
		});
		const guest = await browser.newContext({
			baseURL: process.env.BASE_URL ?? "http://localhost:8098",
			permissions: ["camera", "microphone"],
		});
		const observer = scenario.mixed
			? await browser.newContext({
					baseURL: process.env.BASE_URL ?? "http://localhost:8098",
					permissions: ["camera", "microphone"],
				})
			: undefined;
		try {
			await loginViaApi(host.request, meetHost);
			await clearMeetingRateLimits(host.request);
			const room = scenario.mixed
				? await (async () => {
						const response = await host.request.post(
							"/api/v2/method/suite.meet.api.meeting.create",
							{ data: { title: "Frappe Hinglish review" } },
						);
						expect(response.ok()).toBe(true);
						return (await response.json()).data as string;
					})()
				: await createMeetingViaApi(host.request);
			const owner = await host.newPage(),
				speaker = await guest.newPage();
			const clips =
				scenario.index < 0
					? []
					: scenario.mixed
						? manifest.cases.filter((c) => c.corpus === "hinglish").slice(0, 2)
						: [
								manifest.cases.filter((c) => c.corpus === "ami")[
									scenario.index
								],
								manifest.cases.filter((c) => c.corpus === "indian-english")[
									scenario.index
								],
							];
			const paths = clips.length
				? clips.map((c) => resolve(dirname(manifestPath), c.path))
				: [
						resolve(dirname(manifestPath), "silence.wav"),
						resolve(dirname(manifestPath), "silence.wav"),
					];
			const hashes = [
				await installAudioCapture(owner, paths[0], true),
				await installAudioCapture(speaker, paths[1], true),
			];
			if (clips.length) expect(hashes).toEqual(clips.map((c) => c.sha256));
			await owner.goto(`/meet/${room}`);
			await joinFromPreview(owner);
			await speaker.goto(`/meet/${room}`);
			await speaker.getByPlaceholder("John Doe").fill("Pilot Guest");
			await joinFromPreview(speaker);
			await expect
				.poll(
					async () => {
						const response = await host.request.get(
							"/api/v2/method/suite.meet.api.recording.get_preflight",
							{
								params: {
									meeting_id: room,
									video_enabled: scenario.video,
									transcription_enabled: scenario.transcript,
									language: "en",
								},
							},
						);
						return response.ok() && (await response.json()).data.eligible;
					},
					{ timeout: 90_000 },
				)
				.toBe(true);
			await owner.getByRole("button", { name: "More options" }).click();
			await owner
				.getByText("Recording and transcription", { exact: true })
				.click();
			const dialog = owner.getByRole("dialog");
			await expect(
				dialog.getByRole("switch", { name: "Record video" }),
			).toHaveAttribute("aria-checked", "true");
			if (!scenario.video)
				await dialog.getByRole("switch", { name: "Record video" }).click();
			if (scenario.transcript)
				await dialog.getByRole("switch", { name: "Transcribe speech" }).click();
			const start = dialog.getByRole("button", { name: /^Start / });
			await expect(start).toBeEnabled({ timeout: 30_000 });
			await start.click();
			await expect
				.poll(
					async () => {
						const current = await state(host.request, room);
						if (scenario.video && current?.video_capture_state === "failed")
							throw new Error("Recorder startup failed");
						return (
							current?.status === "Recording" &&
							(!scenario.video || current.video_capture_state === "capturing")
						);
					},
					{ timeout: 90_000 },
				)
				.toBe(true);
			const capture = await state(host.request, room);
			expect(capture?.name).toBeTruthy();
			console.log(`Pilot capture ready: ${scenario.id}`);
			if (observer) {
				const quiet = await observer.newPage();
				await installAudioCapture(
					quiet,
					resolve(dirname(manifestPath), "silence.wav"),
					true,
				);
				await quiet.goto(`/meet/${room}`);
				await quiet.getByPlaceholder("John Doe").fill("Hint Only Observer");
				await joinFromPreview(quiet);
			}

			await owner.waitForTimeout(2500);
			const before = [
				await owner.evaluate(() => window.__captionAudio.diagnostics()),
				await speaker.evaluate(() => window.__captionAudio.diagnostics()),
			];
			const first = await owner.evaluate(() => window.__captionAudio.play());
			console.log(`Pilot audio started: ${scenario.id}`);
			await owner.waitForTimeout(
				scenario.overlap ? 500 : first.durationSeconds * 1000 + 500,
			);
			const second = await speaker.evaluate(() => window.__captionAudio.play());
			await owner.waitForTimeout(
				Math.max(
					second.durationSeconds,
					scenario.overlap ? first.durationSeconds : 0,
				) *
					1000 +
					2500,
			);
			const after = [
				await owner.evaluate(() => window.__captionAudio.diagnostics()),
				await speaker.evaluate(() => window.__captionAudio.diagnostics()),
			];
			expect(verifyAudioPublication(before[0], after[0])).toBe(true);
			expect(verifyAudioPublication(before[1], after[1])).toBe(true);
			await owner.getByRole("button", { name: "More options" }).click();
			await owner.getByText("Stop capture", { exact: true }).click();
			const stopped = owner.waitForResponse(
				(response) =>
					response.url().includes("suite.meet.api.recording.stop") &&
					response.request().method() === "POST",
			);
			await owner
				.getByRole("dialog")
				.getByRole("button", { name: /^Stop / })
				.click();
			expect((await stopped).ok()).toBe(true);
			results.push({
				...scenario,
				room,
				capture: capture!.name,
				clips,
				playback: [first, second],
				before,
				after,
				stoppedAt: Date.now(),
			});
			await writeFile(output, JSON.stringify({ cases: results }, null, 2), {
				mode: 0o600,
			});
			await owner.waitForTimeout(3000);
		} catch (error) {
			console.log(`Pilot scenario failed: ${scenario.id}`);
			throw error;
		} finally {
			await Promise.all([host.close(), guest.close(), observer?.close()]);
		}
	}
});
