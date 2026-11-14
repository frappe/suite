import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Producer, Router } from 'mediasoup/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../../recorder-server/src/config';
import { transcriptionRoutes } from '../../../recorder-server/src/TranscriptionRoutes';
import { TranscriptionStore } from '../../../recorder-server/src/TranscriptionStore';
import { SourceCapture } from './SourceCapture';

const decoder = vi.hoisted(() => ({
	tap: undefined as undefined | ((pcm: Buffer) => void),
}));
// Decoder transport and Silero behavior each have dedicated tests; this exercises
// their speech-source integration against the actual authenticated durable store.
vi.mock('../stt/AudioIngester', () => ({
	AudioIngester: class {
		constructor(options: { onPcm: (pcm: Buffer) => void }) {
			decoder.tap = options.onPcm;
		}
		async start() {}
		async stop() {}
	},
}));
vi.mock('../stt/SpeechDetector', () => ({
	createSpeechDetector: async () => ({
		mode: 'fixture',
		reset() {},
		async detect(audio: Buffer) {
			return { speech: audio.readInt16LE(0) === 1000 };
		},
	}),
}));
const secret = 'capture-private-test-secret-at-least-32-bytes';
let root: string | undefined;
let server: Server | undefined;
afterEach(async () => {
	if (server) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = undefined;
	}
	if (root) {
		await rm(root, { recursive: true, force: true });
		root = undefined;
	}
});
function pcm(value: number): Buffer {
	const frame = Buffer.alloc(4800);
	for (let i = 0; i < frame.length; i += 2) frame.writeInt16LE(value, i);
	return frame;
}
async function setup(failUploads = false) {
	root = await mkdtemp(join(tmpdir(), 'meet-capture-chain-'));
	const store = new TranscriptionStore(root, 0);
	await store.initialize();
	await store.reserve('site.test', 'room', 'capture', 960000, 10000);
	await store.begin('site.test', 'capture', new Date().toISOString());
	const config = loadConfig({
		RECORDER_SECRET: secret,
		RECORDER_METRICS_TOKEN: 'independent-metrics-test-secret-at-least32',
		RECORDER_SITE: 'site.test',
		RECORDER_SITE_ORIGIN: 'https://site.test',
		RECORDER_LEDGER_PATH: join(root, 'ledger'),
		CHROMIUM_EXECUTABLE: '/unused/chromium',
		RECORDER_RENDERER_ASSET_DIR: root,
		SFU_ORIGIN: 'https://sfu.test',
		SFU_SOCKET_PATH: '/socket.io',
	});
	const app = express();
	let attempts = 0;
	app.use((req, res, next) => {
		if (req.method === 'PUT') {
			attempts++;
			if (failUploads) return res.status(503).json({ error: 'unavailable' });
		}
		next();
	});
	transcriptionRoutes(app, config, store);
	server = app.listen(0, '127.0.0.1');
	await new Promise<void>((resolve) => server!.once('listening', resolve));
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('missing_address');
	const now = Math.floor(Date.now() / 1000);
	const token = jwt.sign(
		{
			iss: 'https://site.test',
			aud: 'meet-transcription-source',
			site: 'site.test',
			origin: 'https://site.test',
			room: 'room',
			capture: 'capture',
			operation: 'capture',
			iat: now,
			exp: now + 120,
		},
		secret,
		{
			algorithm: 'HS256',
			header: { alg: 'HS256', typ: 'meet-transcription-source+jwt' },
		},
	);
	const onFailure = vi.fn();
	const source = new SourceCapture({
		capture: 'capture',
		speakerId: 'person',
		speakerName: 'A Speaker',
		producer: { id: 'producer' } as Producer,
		router: {} as Router,
		epoch: performance.now() - 1000,
		maxDurationMs: 10000,
		recorderOrigin: `http://127.0.0.1:${address.port}`,
		token,
		onFailure,
	});
	await source.start();
	return { source, store, onFailure, attempts: () => attempts };
}
describe('durable per-speaker source integration', () => {
	it('stores and acknowledges exact speech samples, attribution and source-relative time through authenticated HTTP', async () => {
		const { source, store, onFailure } = await setup();
		const audio = Buffer.concat(Array.from({ length: 8 }, () => pcm(1000)));
		decoder.tap!(audio.subarray(0, 101));
		decoder.tap!(audio.subarray(101));
		await source.stop();
		const manifest = await store.manifest('site.test', 'capture');
		expect(manifest.segments).toHaveLength(1);
		const segment = manifest.segments[0]!;
		expect(segment).toMatchObject({
			speaker_id: 'person',
			speaker_name: 'A Speaker',
			sample_rate: 24000,
			size: 38400,
			sha256: createHash('sha256').update(audio).digest('hex'),
		});
		expect(segment.end_ms - segment.start_ms).toBe(800);
		expect(segment.start_ms).toBeGreaterThanOrEqual(190);
		expect(segment.start_ms).toBeLessThan(1100);
		expect(
			await readFile(
				await store.audio('site.test', 'capture', segment.source_id),
			),
		).toEqual(audio);
		expect(onFailure).not.toHaveBeenCalled();
	});
	it('persists no silent source and bounds failed uploads at three attempts with a positive known gap', async () => {
		const silent = await setup();
		decoder.tap!(pcm(0));
		await silent.source.stop();
		expect(
			(await silent.store.manifest('site.test', 'capture')).segments,
		).toEqual([]);
		server!.closeAllConnections();
		await new Promise<void>((resolve) => server!.close(() => resolve()));
		server = undefined;
		await rm(root!, { recursive: true, force: true });
		root = undefined;
		const failed = await setup(true);
		decoder.tap!(pcm(1000));
		await failed.source.stop();
		expect(failed.attempts()).toBe(3);
		expect(failed.onFailure).toHaveBeenCalledOnce();
		const gap = failed.onFailure.mock.calls[0]![0];
		expect(gap.end_ms).toBeGreaterThan(gap.start_ms);
		expect(gap.reason).toBe('upload_failed');
	});
});
