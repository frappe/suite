import type { Browser, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loginViaApi } from "../../shared/auth";
import { meetHost } from "../helpers/auth";
import { joinFromPreview } from "../fixtures/test";

// @ts-expect-error publication.mjs validates numeric browser statistics at runtime.
import { verifyAudioPublication } from "./publication.mjs";

// @ts-expect-error report.mjs checks decoded duration and optional timing annotations.
import { validateAudioTiming } from "./report.mjs";

export interface CaptionObservation {
  captionId: string;
  participantId: string;
  participantName: string;
  text: string;
  isFinal: boolean;
  observedAt: number;
}

interface AudioTrackState {
  enabled: boolean; muted: boolean; readyState: MediaStreamTrackState;
}
interface AudioRtpCounters {
  type: string; timestamp?: number; bytesSent?: number; packetsSent?: number;
  totalAudioEnergy?: number; totalSamplesDuration?: number; audioLevel?: number;
  packetsLost?: number; roundTripTime?: number;
}
export interface AudioCaptureDiagnostics {
  observedAt: number; audioContextState: AudioContextState; peakSourceAmplitude: number;
  destinationTrack: AudioTrackState; issuedTracks: AudioTrackState[];
  connections: {
    connectionState: RTCPeerConnectionState; iceConnectionState: RTCIceConnectionState;
    senders: AudioTrackState[]; reports: AudioRtpCounters[];
  }[];
}
interface AudioCaptureSettings {
  decodedSampleRate: number; decodedChannels: number; audioContextSampleRate: number;
  trackSettings: MediaTrackSettings;
}
interface AudioPlayback {
  startedAt: number; durationSeconds: number; captureSettings: AudioCaptureSettings;
}
declare global {
  interface Window {
    __captionAudio: {
      duration(): Promise<number>;
      diagnostics(): Promise<AudioCaptureDiagnostics | undefined>;
      play(): Promise<AudioPlayback>;
    };
    __captionObservations: CaptionObservation[];
  }
}

export type CaptionPhase = "observer-login" | "audio-input" | "observer-join" | "speaker-join" | "captions-enable" | "audio-play" | "collection";
export class CaptionCaseError extends Error {
  readonly category: "invalid-speech-bounds" | "audio-input" | "audio-publication" | "browser-or-service";
  constructor(readonly phase: CaptionPhase, cause: unknown) {
    super(`Caption case failed during ${phase}`, { cause });
    this.name = "CaptionCaseError";
    const message = cause instanceof Error ? cause.message : "";
    this.category = /Audio publication was not observed/.test(message) ? "audio-publication" : /Audio is shorter|Audio exceeds duration limit/.test(message)
      ? "invalid-speech-bounds" : phase === "audio-input" || /ENOENT|decode|EncodingError/.test(message)
        ? "audio-input" : "browser-or-service";
  }
}

// Only the capture source is simulated. The app still acquires a microphone
// track and publishes it through its normal WebRTC/Opus/SFU/STT path.
export async function installAudioCapture(page: Page, audioPath: string, diagnostics = false): Promise<string> {
  const bytes = await readFile(audioPath);
  await page.addInitScript(({ base64, diagnostics }) => {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    let audio: AudioContext | undefined;
    let destination: MediaStreamAudioDestinationNode | undefined;
    let decoded: AudioBuffer | undefined;
    let preparing: Promise<void> | undefined;
    let analyser: AnalyserNode | undefined;
    let peakAmplitude = 0;
    const issuedTracks: MediaStreamTrack[] = [];
    const peers: RTCPeerConnection[] = [];
    if (diagnostics) {
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(configuration?: RTCConfiguration) { super(configuration); peers.push(this); }
      };
    }
    const prepare = async () => {
      if (!preparing) {
        preparing = (async () => {
        audio = new AudioContext();
        destination = audio.createMediaStreamDestination();
        if (diagnostics) analyser = audio.createAnalyser();
        const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        decoded = await audio.decodeAudioData(data.buffer);
        })();
      }
      await preparing;
      return { audio: audio!, destination: destination!, decoded: decoded! };
    };
    media.getUserMedia = async (constraints) => {
      if (!constraints?.audio) return original(constraints);
      const prepared = await prepare();
      const stream = constraints.video ? await original({ video: constraints.video }) : new MediaStream();
      const track = prepared.destination.stream.getAudioTracks()[0].clone();
      issuedTracks.push(track);
      stream.addTrack(track);
      return stream;
    };
    Object.assign(window, { __captionAudio: {
      async duration() { return (await prepare()).decoded.duration; },
      async diagnostics() {
        if (!diagnostics) return undefined;
        const prepared = await prepare();
        const trackState = (track: MediaStreamTrack) => ({ enabled: track.enabled, muted: track.muted, readyState: track.readyState });
        const connections = await Promise.all(peers.map(async peer => {
          const reports: AudioRtpCounters[] = [];
          try {
            (await peer.getStats()).forEach(report => {
              if (!['outbound-rtp', 'media-source', 'remote-inbound-rtp'].includes(report.type) || (report.kind !== 'audio' && report.mediaType !== 'audio')) return;
              const safe: AudioRtpCounters = { type: report.type };
              for (const field of ['timestamp','bytesSent','packetsSent','totalAudioEnergy','totalSamplesDuration','audioLevel','packetsLost','roundTripTime'] as const) {
                if (typeof report[field] === 'number') safe[field] = report[field];
              }
              reports.push(safe);
            });
          } catch { /* Closed peers do not expose raw exceptions. */ }
          return { connectionState: peer.connectionState, iceConnectionState: peer.iceConnectionState,
            senders: peer.getSenders().filter(sender => sender.track?.kind === 'audio').map(sender => trackState(sender.track!)), reports };
        }));
        return { observedAt: Date.now(), audioContextState: prepared.audio.state,
          peakSourceAmplitude: peakAmplitude, destinationTrack: trackState(prepared.destination.stream.getAudioTracks()[0]),
          issuedTracks: issuedTracks.map(trackState), connections };
      },
      async play() {
        const prepared = await prepare();
        await prepared.audio.resume();
        const source = prepared.audio.createBufferSource();
        source.buffer = prepared.decoded;
        source.connect(prepared.destination);
        if (analyser) {
          source.connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          const timer = setInterval(() => {
            analyser!.getFloatTimeDomainData(samples);
            for (const sample of samples) peakAmplitude = Math.max(peakAmplitude, Math.abs(sample));
          }, 100);
          source.addEventListener('ended', () => clearInterval(timer));
        }
        const startedAt = Date.now();
        source.start();
        return { startedAt, durationSeconds: prepared.decoded.duration,
          captureSettings: { decodedSampleRate: prepared.decoded.sampleRate,
            decodedChannels: prepared.decoded.numberOfChannels,
            audioContextSampleRate: prepared.audio.sampleRate,
            trackSettings: prepared.destination.stream.getAudioTracks()[0].getSettings() } };
      },
    } });
    localStorage.setItem("mediaPref.autoHideToolbar", "0");
  }, { base64: bytes.toString("base64"), diagnostics });
  return createHash("sha256").update(bytes).digest("hex");
}

export async function observeCaptions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const observations: CaptionObservation[] = [];
    const previous = new Map<string, string>();
    const scan = () => {
      document.querySelectorAll<HTMLElement>('[data-testid="caption-line"]').forEach((line) => {
        if (!line.checkVisibility()) return;
        const observation = {
          captionId: line.dataset.captionId ?? "",
          participantId: line.dataset.participantId ?? "",
          participantName: line.dataset.participantName ?? "",
          text: line.querySelector('[data-testid="caption-text"]')?.textContent?.trim() ?? "",
          isFinal: line.dataset.isFinal === "true",
          observedAt: Date.now(),
        };
        const signature = `${observation.text}:${observation.isFinal}:${observation.participantName}`;
        if (previous.get(observation.captionId) === signature) return;
        previous.set(observation.captionId, signature);
        if (observation.text) observations.push(observation);
      });
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    Object.assign(window, { __captionObservations: observations });
  });
}

export async function runCaptionCase(options: {
  browser: Browser; baseURL: string; meetingId: string; audioPath: string;
  speakerName: string; diagnostics?: boolean; requirePublication?: boolean; onPhase?: (phase: CaptionPhase) => void; timeoutMs?: number; speechStartSeconds?: number; speechEndSeconds?: number; maxDurationSeconds?: number;
}): Promise<{ playbackStartedAt: number; observations: CaptionObservation[];
  unfinishedCaptionIds: string[]; sourceAudioSha256: string; durationSeconds: number;
  captureSettings: AudioCaptureSettings; browserDiagnostics?: { beforePlayback?: AudioCaptureDiagnostics; afterPlayback?: AudioCaptureDiagnostics }; publicationVerified?: boolean }> {
  const { browser, baseURL, meetingId, audioPath, speakerName } = options;
  const observerContext = await browser.newContext({ baseURL, permissions: ["microphone", "camera"] });
  const speakerContext = await browser.newContext({ baseURL, permissions: ["microphone", "camera"] });
  let phase: CaptionPhase = "observer-login";
  const setPhase = (next: CaptionPhase) => { phase = next; options.onPhase?.(next); };
  try {
    setPhase("observer-login");
    await loginViaApi(observerContext.request, meetHost);
    const observer = await observerContext.newPage();
    const speaker = await speakerContext.newPage();
    await observer.addInitScript(() => localStorage.setItem("mediaPref.autoHideToolbar", "0"));
    setPhase("audio-input");
    const sourceAudioSha256 = await installAudioCapture(speaker, audioPath, options.diagnostics || options.requirePublication);
    setPhase("observer-join");
    await observer.goto(`/meet/${meetingId}`);
    await joinFromPreview(observer);
    await observer.getByRole("button", { name: /^Toggle Audio/ }).click();
    setPhase("speaker-join");
    await speaker.goto(`/meet/${meetingId}`);
    await speaker.getByPlaceholder("John Doe").fill(speakerName);
    await joinFromPreview(speaker);
    setPhase("audio-input");
    const duration = await speaker.evaluate(() => window.__captionAudio.duration());
    if (options.maxDurationSeconds !== undefined && duration > options.maxDurationSeconds) throw new Error("Audio exceeds duration limit");
    validateAudioTiming(duration, options);
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error("Caption tail timeout must be between 1000 and 120000 ms");
    setPhase("captions-enable");
    await observeCaptions(observer);
    await observer.getByRole("button", { name: "More options" }).click();
    await observer.getByText("Enable captions", { exact: true }).click();
    await observer.getByRole("button", { name: "More options" }).click();
    await expect(observer.getByText("Disable captions", { exact: true })).toBeVisible();
    await observer.keyboard.press("Escape");
    // Subscription acknowledgement precedes async FFmpeg/stream setup. This
    // settling period keeps the fixture's first words out of startup races.
    await speaker.waitForTimeout(3000);
    const snapshot = () => speaker.evaluate(() => window.__captionAudio.diagnostics());
    const beforePlayback = await snapshot();
    setPhase("audio-play");
    const playback = await speaker.evaluate(async () => {
      const controller = window.__captionAudio;
      return controller.play();
    });
    // Observe the complete bounded tail to include every utterance's final.
    setPhase("collection");
    await observer.waitForTimeout(playback.durationSeconds * 1000 + timeoutMs);
    const afterPlayback = await snapshot();
    const publicationVerified = options.requirePublication ? verifyAudioPublication(beforePlayback, afterPlayback) : undefined;
    if (publicationVerified === false) throw new Error("Audio publication was not observed");
    const observations = await observer.evaluate(() => window.__captionObservations);
    const unfinishedCaptionIds = await observer.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="caption-line"]')]
      .filter(line => line.checkVisibility() && line.dataset.isFinal !== "true")
      .map(line => line.dataset.captionId ?? ""));
    return { playbackStartedAt: playback.startedAt,
      observations: observations.filter((line) => line.observedAt >= playback.startedAt),
      unfinishedCaptionIds, sourceAudioSha256, durationSeconds: playback.durationSeconds,
      captureSettings: playback.captureSettings, publicationVerified,
      browserDiagnostics: options.diagnostics ? { beforePlayback, afterPlayback } : undefined };
  } catch (error) {
    throw new CaptionCaseError(phase, error);
  } finally {
    await Promise.all([speakerContext.close(), observerContext.close()]);
  }
}
