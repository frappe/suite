import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { generateFixtures } from "./fixtures.mjs";
import { clientServerOptions } from "./baseline.mjs";

test(
	"offline Chromium loads the harness and sends/decodes pinned 720p30 VP9 and Opus fixtures",
	{
		skip: process.env.MEET_LOAD_BROWSER_SMOKE !== "1",
		timeout: 30000,
	},
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "meet-fixtures-"));
		const root = dirname(fileURLToPath(import.meta.url));
		let browser;
		let vite;
		try {
			const fixture = await generateFixtures(directory);
			vite = await createServer(clientServerOptions(root));
			await vite.listen();
			browser = await chromium.launch({
				headless: true,
				channel: process.env.CHROME_CHANNEL,
				args: [
					"--use-fake-device-for-media-stream",
					"--use-fake-ui-for-media-stream",
					"--autoplay-policy=no-user-gesture-required",
					"--mute-audio",
					`--use-file-for-fake-video-capture=${join(directory, fixture.video.file)}`,
					`--use-file-for-fake-audio-capture=${join(directory, fixture.audio.file)}`,
				],
			});
			const page = await browser.newPage();
			await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
			await page.waitForFunction(() => Boolean(window.meetLoad));
			assert.equal(
				(await page.evaluate(() => window.meetLoad.status())).participantMediaProtocolVersion,
				1,
			);
			const observations = await page.evaluate(async () => {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
					video: { width: { exact: 1280 }, height: { exact: 720 }, frameRate: { exact: 30 } },
				});
				const sender = new RTCPeerConnection({ iceServers: [] });
				const receiver = new RTCPeerConnection({ iceServers: [] });
				const audioElement = document.createElement("audio");
				try {
					document.body.append(audioElement);
					receiver.ontrack = ({ track }) => {
						if (track.kind === "audio") {
							audioElement.srcObject = new MediaStream([track]);
							void audioElement.play();
						}
					};
					const settings = stream.getVideoTracks()[0].getSettings();
					for (const track of stream.getTracks()) {
						const codecs = RTCRtpSender.getCapabilities(track.kind).codecs.filter(
							(c) =>
								c.mimeType.toLowerCase() === (track.kind === "video" ? "video/vp9" : "audio/opus"),
						);
						const transceiver = sender.addTransceiver(track, {
							direction: "sendonly",
							sendEncodings:
								track.kind === "video"
									? [{ maxBitrate: 1800000, scalabilityMode: "L3T1_KEY" }]
									: [{}],
						});
						transceiver.setCodecPreferences(codecs);
					}
					const gathered = async (pc) => {
						if (pc.iceGatheringState === "complete") return;
						await new Promise((resolve) =>
							pc.addEventListener("icegatheringstatechange", () => {
								if (pc.iceGatheringState === "complete") resolve();
							}),
						);
					};
					await sender.setLocalDescription(await sender.createOffer());
					await gathered(sender);
					await receiver.setRemoteDescription(sender.localDescription);
					await receiver.setLocalDescription(await receiver.createAnswer());
					await gathered(receiver);
					await sender.setRemoteDescription(receiver.localDescription);
					const deadline = Date.now() + 10000;
					while (Date.now() < deadline) {
						const reports = [...(await receiver.getStats()).values()];
						const audio = reports.find((r) => r.type === "inbound-rtp" && r.kind === "audio");
						const video = reports.find((r) => r.type === "inbound-rtp" && r.kind === "video");
						if (
							audio?.packetsReceived > 0 &&
							audio?.totalAudioEnergy > 0 &&
							video?.framesDecoded > 0
						)
							return {
								settings,
								audio,
								video,
								codecs: reports.filter((r) => r.type === "codec").map((r) => r.mimeType),
							};
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
					throw new Error("Loopback media was not decoded");
				} finally {
					sender.close();
					receiver.close();
					audioElement.srcObject = null;
					audioElement.remove();
					stream.getTracks().forEach((t) => t.stop());
				}
			});
			assert.equal(observations.settings.width, 1280);
			assert.equal(observations.settings.height, 720);
			assert.equal(observations.settings.frameRate, 30);
			assert.ok(observations.codecs.includes("video/VP9"));
			assert.ok(observations.codecs.includes("audio/opus"));
			assert.ok(observations.audio.bytesReceived > 0);
			assert.ok(observations.audio.totalAudioEnergy > 0);
			assert.ok(observations.video.framesDecoded > 0);
			console.log(`Offline fixture probe: Chromium ${browser.version()}`);
		} finally {
			await browser?.close();
			await vite?.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
