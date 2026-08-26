import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	encodePcm16Wav,
	type PcmCaptureMetadata,
	updatePcmCaptureTranscript,
	writePcmCapture,
} from './PcmCapture';

describe('PCM capture', () => {
	let directory: string | undefined;

	afterEach(() => {
		if (directory) fs.rmSync(directory, { recursive: true, force: true });
	});

	it('encodes exact PCM bytes in a 24 kHz mono WAV', () => {
		const pcm = Buffer.from([0, 0, 1, 0, 255, 255]);
		const wav = encodePcm16Wav(pcm, 24000);

		expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
		expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
		expect(wav.readUInt16LE(22)).toBe(1);
		expect(wav.readUInt32LE(24)).toBe(24000);
		expect(wav.readUInt16LE(34)).toBe(16);
		expect(wav.subarray(44)).toEqual(pcm);
	});

	it('writes metadata and records the final transcript', () => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-capture-'));
		const metadataPath = writePcmCapture(directory, Buffer.alloc(4800), {
			sessionId: 'session-1',
			roomId: 'room-1',
			participantId: 'participant-1',
			producerId: 'producer-1',
			sampleRate: 24000,
			channels: 1,
			durationMs: 100,
		});
		updatePcmCaptureTranscript(metadataPath, 'hello world');

		const metadata = JSON.parse(
			fs.readFileSync(metadataPath, 'utf8'),
		) as PcmCaptureMetadata;
		expect(metadata).toMatchObject({
			sessionId: 'session-1',
			sampleRate: 24000,
			durationMs: 100,
			transcript: 'hello world',
		});
		expect(fs.readFileSync(path.join(directory, metadata.wavFile)).length).toBe(
			4844,
		);
	});
});
