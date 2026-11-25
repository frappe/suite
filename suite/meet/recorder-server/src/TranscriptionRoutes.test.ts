import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { transcriptionRoutes } from './TranscriptionRoutes.js';
import { TranscriptionStore } from './TranscriptionStore.js';

const secret = 'transcription-source-test-secret-at-least32';
let root: string, server: Server, base: string;
function token(
	operation: string,
	overrides: {
		site?: string;
		capture?: string;
		source_id?: string;
		room?: string;
		exp?: number;
		max_bytes?: number;
		max_duration_ms?: number;
	} = {},
) {
	const now = Math.floor(Date.now() / 1000);
	return jwt.sign(
		{
			iss: 'https://site.test',
			aud: 'meet-transcription-source',
			site: 'site.test',
			origin: 'https://site.test',
			room: 'room',
			capture: 'capture',
			operation,
			iat: now,
			exp: now + 60,
			...overrides,
		},
		secret,
		{
			algorithm: 'HS256',
			header: { alg: 'HS256', typ: 'meet-transcription-source+jwt' },
		},
	);
}
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'meet-source-routes-'));
	const store = new TranscriptionStore(root, 0);
	await store.initialize();
	const config = loadConfig({
		RECORDER_SECRET: secret,
		RECORDER_METRICS_TOKEN: 'independent-metrics-secret-at-least-32-bytes',
		RECORDER_SITE: 'site.test',
		RECORDER_SITE_ORIGIN: 'https://site.test',
		RECORDER_LEDGER_PATH: join(root, 'ledger'),
		CHROMIUM_EXECUTABLE: '/unused/chromium',
		RECORDER_RENDERER_ASSET_DIR: root,
		SFU_ORIGIN: 'https://sfu.test',
		SFU_SOCKET_PATH: '/socket.io',
	});
	const app = express();
	transcriptionRoutes(app, config, store);
	server = app.listen(0, '127.0.0.1');
	await new Promise<void>((resolve) => server.once('listening', resolve));
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('missing_address');
	base = `http://127.0.0.1:${address.port}/v1/transcriptions/capture`;
});
afterEach(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	await rm(root, { recursive: true, force: true });
});
async function reserve() {
	return fetch(base, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token('reserve', { max_bytes: 96000, max_duration_ms: 10000 })}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ max_bytes: 96000, max_duration_ms: 10000 }),
	});
}
describe('private recorder transcription protocol', () => {
	it('requires site, capture, room, operation and segment-bound authorization to retrieve audio', async () => {
		expect((await reserve()).status).toBe(200);
		expect(
			(
				await fetch(`${base}/begin`, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${token('capture')}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({ started_at: new Date().toISOString() }),
				})
			).status,
		).toBe(200);
		const pcm = Buffer.alloc(4800, 1);
		const uploaded = await fetch(`${base}/segments/one`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${token('capture')}`,
				'content-type': 'application/octet-stream',
				'x-speaker-id': 'speaker',
				'x-speaker-name': 'A%20Speaker',
				'x-start-ms': '2000',
				'x-end-ms': '2100',
				'x-sha256': createHash('sha256').update(pcm).digest('hex'),
			},
			body: pcm,
		});
		expect(uploaded.status).toBe(200);
		for (const bad of [
			token('manifest'),
			token('source', { site: 'other' }),
			token('source', { capture: 'other' }),
			token('source', { source_id: 'two' }),
			token('source', { source_id: 'one', room: 'other' }),
		])
			expect(
				(
					await fetch(`${base}/segments/one`, {
						headers: { authorization: `Bearer ${bad}` },
					})
				).status,
			).toBeGreaterThanOrEqual(400);
		const source = await fetch(`${base}/segments/one`, {
			headers: {
				authorization: `Bearer ${token('source', { source_id: 'one' })}`,
			},
		});
		expect(source.status).toBe(200);
		expect(Buffer.from(await source.arrayBuffer())).toEqual(pcm);
		const manifest = await (
			await fetch(`${base}/manifest`, {
				headers: { authorization: `Bearer ${token('manifest')}` },
			})
		).json();
		expect(manifest.segments[0]).toMatchObject({
			source_id: 'one',
			speaker_id: 'speaker',
			speaker_name: 'A Speaker',
			start_ms: 2000,
			end_ms: 2100,
			size: 4800,
			sample_rate: 24000,
		});
		expect(
			(
				await fetch(base, {
					method: 'DELETE',
					headers: { authorization: `Bearer ${token('capture')}` },
				})
			).status,
		).toBe(401);
		expect(
			(
				await fetch(base, {
					method: 'DELETE',
					headers: { authorization: `Bearer ${token('delete')}` },
				})
			).status,
		).toBe(200);
		expect(
			(
				await fetch(`${base}/manifest`, {
					headers: { authorization: `Bearer ${token('manifest')}` },
				})
			).status,
		).toBe(404);
	});
	it('rejects oversized credential validity and unsigned admission limits', async () => {
		const now = Math.floor(Date.now() / 1000);
		expect(
			(
				await fetch(base, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${token('reserve', { exp: now + 121 })}`,
						'content-type': 'application/json',
					},
					body: '{}',
				})
			).status,
		).toBe(401);
		expect(
			(
				await fetch(base, {
					method: 'POST',
					headers: {
						authorization: `Bearer ${token('reserve')}`,
						'content-type': 'application/json',
					},
					body: JSON.stringify({ max_bytes: 96000, max_duration_ms: 10000 }),
				})
			).status,
		).toBe(422);
	});
	it('reports a damaged private manifest as failed and still authorizes bounded source cleanup', async () => {
		expect((await reserve()).status).toBe(200);
		await writeFile(
			join(
				root,
				createHash('sha256').update('site.test').digest('hex'),
				'capture',
				'manifest.json',
			),
			'{interrupted',
		);
		const response = await fetch(`${base}/manifest`, {
			headers: { authorization: `Bearer ${token('manifest')}` },
		});
		expect(response.status).toBe(200);
		const manifest = await response.json();
		expect(manifest.state).toBe('failed');
		expect(manifest.segments).toEqual([]);
		expect(
			(
				await fetch(base, {
					method: 'DELETE',
					headers: { authorization: `Bearer ${token('delete')}` },
				})
			).status,
		).toBe(200);
	});
});
