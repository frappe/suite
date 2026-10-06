import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { loginViaApi } from "../../shared/auth";
import { meetHost } from "../helpers/auth";
import { createMeetingViaApi, clearMeetingRateLimits } from "../helpers/meeting";
import { runCaptionCase, CaptionCaseError, type CaptionPhase } from "./browser";
// @ts-expect-error report.mjs has a runtime-validated JSON interface.
import { validateManifest, validateRooms, scoreRun, assertThresholds } from "./report.mjs";

// @ts-expect-error observations.mjs uses the harness runtime interface.
import { predictionFromObservations } from "./observations.mjs";

interface Clip {
  id: string; audio: string; reference: string; speaker: string; expectSpeech?: boolean;
  speechStartSeconds?: number | null; speechEndSeconds?: number | null;
}
interface Prediction {
  id: string; transcript: string; speaker?: string;
  firstTextSeconds?: number; finalAfterSpeechSeconds?: number; finalAfterAudioSeconds?: number; failed?: boolean;
}

const manifestPath = process.env.MEET_CAPTION_MANIFEST;
test("audio reaches rendered captions and meets corpus thresholds", async ({ browser, request, baseURL }) => {
  if (!manifestPath) throw new Error("Set MEET_CAPTION_MANIFEST to a consented audio corpus manifest");
  const absoluteManifest = resolve(manifestPath);
  const manifestBytes = await readFile(absoluteManifest, "utf8");
  const manifest = validateManifest(JSON.parse(manifestBytes));
  const existingRoom = process.env.MEET_CAPTION_ROOM_ID;
  const roomMapFile = process.env.MEET_CAPTION_ROOMS_JSON_FILE;
  if (existingRoom && roomMapFile) throw new Error("Room map and MEET_CAPTION_ROOM_ID are mutually exclusive");
  const roomMap: Map<string, string> | undefined = roomMapFile
    ? validateRooms(manifest, JSON.parse(await readFile(resolve(roomMapFile), "utf8"))) : undefined;
  if (existingRoom && manifest.clips.length !== 1) throw new Error("MEET_CAPTION_ROOM_ID requires exactly one clip");
  const privateClips: unknown[] = [];
  const audioInputs: unknown[] = [];
  const failureCategories: { id: string; category: string; phase?: CaptionPhase }[] = [];
  const predictions: Prediction[] = [];
  await loginViaApi(request, meetHost);
  test.setTimeout(Math.max(180_000, manifest.clips.length * 75_000));
  for (const clip of manifest.clips as Clip[]) {
    console.log(JSON.stringify({ captionClip: clip.id, status: "starting" }));
    await clearMeetingRateLimits(request);
    const meetingId = existingRoom ?? roomMap?.get(clip.id) ?? await createMeetingViaApi(request);
    try {
      const result = await runCaptionCase({
        browser, baseURL: baseURL!, meetingId,
        diagnostics: !!process.env.MEET_CAPTION_RAW_REPORT, requirePublication: clip.expectSpeech === false,
        audioPath: resolve(dirname(absoluteManifest), clip.audio),
        onPhase: phase => console.log(JSON.stringify({ captionClip: clip.id, phase })),
        speakerName: clip.speaker, speechStartSeconds: clip.speechStartSeconds ?? undefined, speechEndSeconds: clip.speechEndSeconds ?? undefined, maxDurationSeconds: 15,
      });
      const prediction = predictionFromObservations(clip, result);
      predictions.push(prediction);
      audioInputs.push({ id: clip.id, sourceAudioSha256: result.sourceAudioSha256,
        durationSeconds: result.durationSeconds, publicationVerified: result.publicationVerified, captureSettings: result.captureSettings });
      if (process.env.MEET_CAPTION_RAW_REPORT) privateClips.push({ id: clip.id, meetingId, ...result, prediction });
      const category = clip.expectSpeech === false ? "false-caption" : result.unfinishedCaptionIds.length ? "unfinished-caption" : "missing-final-caption";
      if (prediction.failed) failureCategories.push({ id: clip.id, category, phase: "collection" });
      console.log(JSON.stringify({ captionClip: clip.id, status: prediction.failed ? "failed" : "captured",
        ...(prediction.failed ? { category, phase: "collection" } : {}) }));
    } catch (error) {
      // No raw caption text or private paths are written to the report.
      const category = error instanceof CaptionCaseError ? error.category : "browser-or-service";
      const phase = error instanceof CaptionCaseError ? error.phase : undefined;
      failureCategories.push({ id: clip.id, category, phase });
      console.log(JSON.stringify({ captionClip: clip.id, status: "failed", category, phase }));
      predictions.push({ id: clip.id, transcript: "", failed: true });
    }
  }
  const thresholds = process.env.MEET_CAPTION_THRESHOLDS ? JSON.parse(process.env.MEET_CAPTION_THRESHOLDS) : { maxFailed: 0, maxFalseCaptionClips: 0, ...(manifest.clips.some((clip: Clip) => clip.expectSpeech !== false) ? { maxWer: 0.3, minAttributionAccuracy: 1 } : {}) };
  const report = scoreRun(manifest, predictions, { thresholds });
  const destination = resolve(process.env.MEET_CAPTION_REPORT ?? "meet/test-results/captions/report.json");
  const run = { thresholds, audioInputs, browserVersion: browser.version(),
    operatorSettings: process.env.MEET_CAPTION_RUN_SETTINGS ? JSON.parse(process.env.MEET_CAPTION_RUN_SETTINGS) : null,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    collectionTailMs: 15000, startupSettleMs: 3000, failureCategories,
    modelLabel: process.env.MEET_CAPTION_MODEL_LABEL ?? "operator-unspecified",
    backendIdentityVerified: false,
    capture: "WebAudio file substituted for microphone; app WebRTC/SFU/STT/UI",
    clock: "Date.now across local browser contexts", createdAt: new Date().toISOString() };
  await mkdir(dirname(destination), { recursive: true });
  if (process.env.MEET_CAPTION_RAW_REPORT) {
    const rawDestination = resolve(process.env.MEET_CAPTION_RAW_REPORT);
    if (rawDestination === destination) throw new Error("Raw and summary report paths must differ");
    await mkdir(dirname(rawDestination), { recursive: true });
    await writeFile(rawDestination, JSON.stringify({ version: 1, run, clips: privateClips, predictions }, null, 2), { mode: 0o600 });
    await chmod(rawDestination, 0o600);
  }
  await writeFile(destination, JSON.stringify({
    ...report,
    run,
  }, null, 2), { mode: 0o600 });
  await chmod(destination, 0o600);
  expect(assertThresholds(report, thresholds)).toMatchObject({ passed: true });
});
