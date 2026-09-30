import { mkdir, open, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Version 1: one second of moving luma/checker texture, 720p30 I420, looping in Chromium.
export function cameraFrame(frame) {
	const bytes = Buffer.alloc((1280 * 720 * 3) / 2, 128);
	for (let y = 0; y < 720; y++)
		for (let x = 0; x < 1280; x++) {
			bytes[y * 1280 + x] =
				16 + ((x + frame * 13 + y * 3 + ((((x + frame * 8) >> 5) ^ (y >> 5)) & 1) * 80) % 220);
		}
	return bytes;
}

export function microphoneFixture() {
	const rate = 48000;
	const wav = Buffer.alloc(44 + rate * 2);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(rate, 24);
	wav.writeUInt32LE(rate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(rate * 2, 40);
	// Integer triangle harmonics and a syllable-like envelope avoid platform-dependent sin rounding.
	for (let i = 0; i < rate; i++) {
		const triangle = (period) => Math.abs((i % period) * 4 - period * 2) - period;
		const envelope = Math.min(i % 12000, 12000 - (i % 12000), 2400);
		wav.writeInt16LE(
			Math.trunc(((triangle(400) * 20 + triangle(160) * 8) * envelope) / 2400),
			44 + i * 2,
		);
	}
	return wav;
}

export async function generateFixtures(directory) {
	await mkdir(directory, { recursive: true });
	const video = await open(resolve(directory, "camera-720p30-v1.y4m"), "w");
	const hash = createHash("sha256");
	try {
		for (const chunk of [Buffer.from("YUV4MPEG2 W1280 H720 F30:1 Ip A1:1 C420jpeg\n")]) {
			await video.writeFile(chunk);
			hash.update(chunk);
		}
		for (let i = 0; i < 30; i++)
			for (const chunk of [Buffer.from("FRAME\n"), cameraFrame(i)]) {
				await video.writeFile(chunk);
				hash.update(chunk);
			}
	} finally {
		await video.close();
	}
	const audio = microphoneFixture();
	await writeFile(resolve(directory, "microphone-v1.wav"), audio);
	const manifest = {
		version: 1,
		video: {
			file: "camera-720p30-v1.y4m",
			sha256: hash.digest("hex"),
			width: 1280,
			height: 720,
			fps: 30,
			frames: 30,
		},
		audio: {
			file: "microphone-v1.wav",
			sha256: createHash("sha256").update(audio).digest("hex"),
			sampleRate: 48000,
			channels: 1,
		},
	};
	await writeFile(resolve(directory, "fixtures.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (!process.argv[2]) throw new Error("Usage: node fixtures.mjs OUTPUT_DIRECTORY");
	console.log(JSON.stringify(await generateFixtures(resolve(process.argv[2])), null, 2));
}
