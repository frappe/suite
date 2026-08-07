import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallbackClient } from './CallbackClient.js';
import { safeJobDirectory } from './ManifestStore.js';
import type { JobRecord } from './types.js';

const roots: string[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe('CallbackClient', () => {
	it('publishes recorder interruption with the next lifecycle sequence', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ message: { status: 'Interrupted' } }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
		);
		vi.stubGlobal('fetch', fetch);
		const job = {
			job: 'job',
			site: 'site.test',
			origin: 'https://site.test',
			room: 'room',
			recording: 'recording',
			state: 'interrupted',
			health_reason: 'connection_lost',
		} as JobRecord;

		await new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret: 's'.repeat(32),
			dataRoot: '/tmp',
		}).interrupted(job);

		expect(String(fetch.mock.calls[0]?.[0])).toContain('recorder_interrupted');
		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
			recording_id: 'recording',
			job: 'job',
			event_sequence: 2,
			reason: 'connection_lost',
		});
	});

	it('uploads a finalized artifact with scoped chunk tokens', async () => {
		const root = join(tmpdir(), `callback-client-${crypto.randomUUID()}`);
		roots.push(root);
		const content = Buffer.from('recording artifact');
		const directory = safeJobDirectory(root, 'job');
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, 'recording.mp4'), content);
		const job: JobRecord = {
			job: 'job',
			site: 'site.test',
			origin: 'https://site.test',
			room: 'room',
			recording: 'recording',
			limits: {
				budget_bytes: 1000,
				max_ends_at: '2030-01-01T00:00:00Z',
				output: {
					width: 1920,
					height: 1080,
					fps: 30,
					video: 'h264',
					audio: 'aac',
				},
			},
			accepted_at: '2026-01-01T00:00:00.000Z',
			public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
			state: 'partial',
			terminal_at: '2026-01-01T00:01:00.000Z',
			artifact: {
				state: 'partial',
				path: 'recording.mp4',
				bytes: content.length,
				sha256: 'a'.repeat(64),
				duration_ms: 1000,
				gaps: [
					{
						started_at: '2026-01-01T00:00:59.000Z',
						reason: 'invalid_final_segment',
					},
				],
			},
			stop_operation_ids: [],
		};
		const requests: Array<{ url: string; init: RequestInit }> = [];
		const fetch = vi.fn(async (url: URL, init: RequestInit) => {
			requests.push({ url: String(url), init });
			const message =
				requests.length === 1
					? { offset: 0, complete: false }
					: requests.length === 2
						? { offset: content.length }
						: { artifact: 'file', status: 'Ready' };
			return new Response(JSON.stringify({ message }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		});
		vi.stubGlobal('fetch', fetch);
		const secret = 's'.repeat(32);

		await new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret,
			dataRoot: root,
		}).upload(job);

		expect(requests).toHaveLength(3);
		expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
			gaps: [
				{
					started_at: '2026-01-01T00:00:59.000Z',
					ended_at: '2026-01-01T00:01:00.000Z',
					reason: 'ffmpeg_exited',
				},
			],
		});
		expect(Buffer.from(requests[1]?.init.body as Uint8Array)).toEqual(content);
		const authorization = new Headers(requests[1]?.init.headers).get(
			'X-Meet-Recorder-Authorization',
		);
		const token = authorization?.slice('Bearer '.length) ?? '';
		expect(jwt.verify(token, secret, { algorithms: ['HS256'] })).toMatchObject({
			aud: 'meet-recording-callback',
			site: 'site.test',
			recording: 'recording',
			job: 'job',
			operation: 'upload_chunk',
		});
		expect(jwt.decode(token, { complete: true })?.header.typ).toBe(
			'meet-recording-callback+jwt',
		);
		await expect(stat(directory)).rejects.toThrow();
	});
});
