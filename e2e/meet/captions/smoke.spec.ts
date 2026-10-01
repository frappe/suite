import { test, expect } from "@playwright/test";
// @ts-expect-error publication.mjs has a runtime browser-statistics interface.
import { verifyAudioPublication } from "./publication.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAudioCapture, observeCaptions, CaptionCaseError, type CaptionObservation } from "./browser";

// A known tone is sufficient to test browser capture; this is not an STT fixture.
function toneWav(): Buffer {
  const sampleRate = 48_000;
  const samples = sampleRate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) {
    bytes.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 16_000), 44 + index * 2);
  }
  return bytes;
}

test("fixture microphone carries audio only during playback", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "meet-caption-smoke-"));
  try {
    const audioPath = join(directory, "tone.wav");
    await writeFile(audioPath, toneWav());
    await installAudioCapture(page, audioPath, true);
    await page.route("http://localhost/caption-smoke", route => route.fulfill({ contentType: "text/html", body: "<body>capture smoke</body>" }));
    await page.goto("http://localhost/caption-smoke");
    const track = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      audio.createMediaStreamSource(stream).connect(analyser);
      await audio.resume();
      Object.assign(window, { __smokeAnalyser: analyser });
      const track = stream.getAudioTracks()[0];
      const peer = new RTCPeerConnection();
      peer.addTrack(track, stream);
      return { kind: track.kind, state: track.readyState, videos: stream.getVideoTracks().length };
    });
    expect(track).toEqual({ kind: "audio", state: "live", videos: 0 });
    const amplitude = () => page.evaluate(() => {
      const analyser = (window as unknown as { __smokeAnalyser: AnalyserNode }).__smokeAnalyser;
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      return Math.max(...data.map(Math.abs));
    });
    expect(await amplitude()).toBeLessThan(0.001);
    const playback = await page.evaluate(() => (window as unknown as {
      __captionAudio: { play(): Promise<{ startedAt: number; durationSeconds: number }> };
    }).__captionAudio.play());
    expect(playback.durationSeconds).toBeCloseTo(1, 2);
    expect(playback.startedAt).toBeGreaterThan(Date.now() - 5000);
    await expect.poll(amplitude, { intervals: [20], timeout: 800 }).toBeGreaterThan(0.1);
    await page.waitForTimeout(1100);
    await expect.poll(amplitude).toBeLessThan(0.001);
    const diagnostic = await page.evaluate(() => (window as unknown as {
      __captionAudio: { diagnostics(): Promise<{peakSourceAmplitude:number;audioContextState:string;issuedTracks:{readyState:string}[];connections:{senders:unknown[]}[]}> };
    }).__captionAudio.diagnostics());
    expect(diagnostic.peakSourceAmplitude).toBeGreaterThan(.1);
    expect(diagnostic.audioContextState).toBe("running");
    expect(diagnostic.issuedTracks[0].readyState).toBe("live");
    expect(diagnostic.connections).toHaveLength(1);
    expect(diagnostic.connections[0].senders).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("render observer captures partial revisions and final state once", async ({ page }) => {
  await page.setContent('<body><div data-testid="caption-line" data-caption-id="line-1" data-participant-id="speaker-1" data-participant-name="Ada" data-is-final="false"><span data-testid="caption-text">Hello</span></div></body>');
  await observeCaptions(page);
  const observations = () => page.evaluate(() => (window as unknown as { __captionObservations: CaptionObservation[] }).__captionObservations);
  await expect.poll(async () => (await observations()).length).toBe(1);
  await page.locator('[data-testid="caption-text"]').evaluate(node => node.textContent = "Hello world");
  await expect.poll(async () => (await observations()).length).toBe(2);
  await page.locator('[data-testid="caption-line"]').evaluate(node => node.setAttribute("data-is-final", "true"));
  await expect.poll(async () => (await observations()).length).toBe(3);
  await page.locator('[data-testid="caption-line"]').evaluate(node => node.setAttribute("class", "unrelated"));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const rendered = await observations();
  expect(rendered.map(({ text, isFinal }) => ({ text, isFinal }))).toEqual([
    { text: "Hello", isFinal: false },
    { text: "Hello world", isFinal: false },
    { text: "Hello world", isFinal: true },
  ]);
  expect(rendered.every(line => line.captionId === "line-1" && line.participantId === "speaker-1" && line.participantName === "Ada")).toBe(true);
  expect(rendered.every(line => Number.isFinite(line.observedAt))).toBe(true);
  await page.locator('[data-testid="caption-line"]').evaluate(node => node.setAttribute("data-participant-name", "Grace"));
  await expect.poll(async () => (await observations()).at(-1)?.participantName).toBe("Grace");
  expect((await observations()).length).toBe(4);
});

test("render observer ignores hidden captions until displayed", async ({ page }) => {
  await page.setContent('<body><div style="display:none"><div data-testid="caption-line" data-caption-id="hidden-1" data-is-final="true"><span data-testid="caption-text">Invisible words</span></div></div></body>');
  await observeCaptions(page);
  const observations = () => page.evaluate(() => (window as unknown as { __captionObservations: CaptionObservation[] }).__captionObservations);
  expect(await observations()).toEqual([]);
  await page.locator('[data-testid="caption-text"]').evaluate(node => node.textContent = "Still invisible");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await observations()).toEqual([]);
  await page.locator("body > div").evaluate(node => (node as HTMLElement).style.display = "block");
  await expect.poll(async () => (await observations()).map(line => line.text)).toEqual(["Still invisible"]);
});

test("concurrent capture requests both reject invalid audio", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "meet-caption-invalid-"));
  try {
    const audioPath = join(directory, "invalid.wav");
    await writeFile(audioPath, "this is not audio");
    await installAudioCapture(page, audioPath);
    await page.route("http://localhost/caption-smoke", route => route.fulfill({ contentType: "text/html", body: "<body>invalid audio smoke</body>" }));
    await page.goto("http://localhost/caption-smoke");
    const statuses = await page.evaluate(async () => {
      return Promise.race([
        Promise.allSettled([
          navigator.mediaDevices.getUserMedia({ audio: true }),
          navigator.mediaDevices.getUserMedia({ audio: true }),
        ]).then(results => results.map(result => result.status)),
        new Promise<string[]>(resolve => setTimeout(() => resolve(["timed out"]), 2000)),
      ]);
    });
    expect(statuses).toEqual(["rejected", "rejected"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("failure metadata exposes phase and category without private error text", () => {
  const privateError = new Error("secret-token /private/audio.wav browser details");
  const failure = new CaptionCaseError("speaker-join", privateError);
  expect(failure.phase).toBe("speaker-join");
  expect(failure.category).toBe("browser-or-service");
  expect(failure.message).toBe("Caption case failed during speaker-join");
  expect(JSON.stringify(failure)).not.toContain("secret-token");
  expect(failure.cause).toBe(privateError);
  expect(new CaptionCaseError("audio-input", new Error("Audio is shorter than annotated speech end")).category).toBe("invalid-speech-bounds");
});

test("actual connected silence publishes packets while disabled tracks fail the guard", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "meet-caption-silence-"));
  try {
    const path = join(directory,"silence.wav");
    const silence = toneWav(); silence.fill(0,44); await writeFile(path,silence);
    await installAudioCapture(page,path,true);
    await page.route("http://localhost/caption-silence", route => route.fulfill({contentType:"text/html",body:"<body>silence publication</body>"}));
    await page.goto("http://localhost/caption-silence");
    await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection();
      sender.addTrack(stream.getAudioTracks()[0],stream);
      const gathered = (peer:RTCPeerConnection) => new Promise<void>(resolve => {
        if (peer.iceGatheringState === "complete") { resolve(); return; }
        peer.addEventListener("icegatheringstatechange",()=>{if(peer.iceGatheringState === "complete") resolve();});
      });
      await sender.setLocalDescription(await sender.createOffer()); await gathered(sender);
      await receiver.setRemoteDescription(sender.localDescription!);
      await receiver.setLocalDescription(await receiver.createAnswer()); await gathered(receiver);
      await sender.setRemoteDescription(receiver.localDescription!);
      Object.assign(window,{__silenceTrack:stream.getAudioTracks()[0]});
      await (window as unknown as {__captionAudio:{play():Promise<unknown>}}).__captionAudio.play();
    });
    const snapshot = () => page.evaluate(() => window.__captionAudio.diagnostics());
    const before = await snapshot();
    await expect.poll(async()=>verifyAudioPublication(before,await snapshot()),{timeout:8000}).toBe(true);
    const connected = await snapshot();
    expect(connected?.peakSourceAmplitude).toBe(0);
    await page.evaluate(() => (window as unknown as {__silenceTrack:MediaStreamTrack}).__silenceTrack.enabled=false);
    const disabled = await snapshot();
    expect(verifyAudioPublication(before,disabled)).toBe(false);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
