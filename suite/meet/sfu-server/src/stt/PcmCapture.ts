import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface PcmCaptureMetadata {
	sessionId: string;
	roomId: string;
	participantId: string;
	producerId: string;
	sampleRate: number;
	channels: number;
	durationMs: number;
	capturedAt: string;
	wavFile: string;
	transcript?: string;
}

export function encodePcm16Wav(
	pcm: Buffer,
	sampleRate: number,
	channels = 1,
): Buffer {
	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * channels * 2, 28);
	header.writeUInt16LE(channels * 2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

export function writePcmCapture(
	directory: string,
	pcm: Buffer,
	metadata: Omit<PcmCaptureMetadata, 'capturedAt' | 'wavFile'>,
): string {
	fs.mkdirSync(directory, { recursive: true });
	const captureId = `${Date.now()}-${metadata.sessionId}-${randomUUID()}`;
	const wavFile = `${captureId}.wav`;
	const metadataPath = path.join(directory, `${captureId}.json`);
	fs.writeFileSync(
		path.join(directory, wavFile),
		encodePcm16Wav(pcm, metadata.sampleRate, metadata.channels),
	);
	fs.writeFileSync(
		metadataPath,
		`${JSON.stringify({ ...metadata, capturedAt: new Date().toISOString(), wavFile }, null, 2)}\n`,
	);
	return metadataPath;
}

export function updatePcmCaptureTranscript(
	metadataPath: string,
	transcript: string,
): void {
	const metadata = JSON.parse(
		fs.readFileSync(metadataPath, 'utf8'),
	) as PcmCaptureMetadata;
	fs.writeFileSync(
		metadataPath,
		`${JSON.stringify({ ...metadata, transcript }, null, 2)}\n`,
	);
}
