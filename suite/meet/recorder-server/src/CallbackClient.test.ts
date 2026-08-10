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
	vi.useRealTimers();
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

	it('publishes recovery for the active interruption sequence', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ message: { status: 'Recording' } }), {
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
			state: 'capture_ready',
		} as JobRecord;

		await new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret: 's'.repeat(32),
			dataRoot: '/tmp',
		}).recovered(job);

		expect(String(fetch.mock.calls[0]?.[0])).toContain('recorder_recovered');
		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
			recording_id: 'recording',
			job: 'job',
			event_sequence: 2,
		});
	});

	it('publishes later interruption cycles with their persisted sequence', async () => {
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
			event_sequence: 4,
		} as JobRecord;

		await new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret: 's'.repeat(32),
			dataRoot: '/tmp',
		}).interrupted(job);

		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual(
			expect.objectContaining({ event_sequence: 4 }),
		);
	});

	it('rejects string offsets while uploading with scoped chunk tokens', async () => {
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
		let retainedWhileProcessing = false;
		const fetch = vi.fn(async (url: URL, init: RequestInit) => {
			requests.push({ url: String(url), init });
			if (requests.length === 5)
				retainedWhileProcessing = await stat(directory).then(
					() => true,
					() => false,
				);
			const message =
				requests.length === 1
					? { offset: '0', complete: false }
					: requests.length === 2
						? { offset: 0, complete: false }
						: requests.length === 3
							? { offset: content.length }
							: requests.length === 4
								? { status: 'Processing' }
								: { offset: content.length, complete: true };
			return new Response(JSON.stringify({ message }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		});
		vi.stubGlobal('fetch', fetch);
		const secret = 's'.repeat(32);

		const upload = new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret,
			dataRoot: root,
			sleep: async () => undefined,
		}).upload(job);
		await upload;

		expect(requests).toHaveLength(5);
		expect(requests[0]?.url).toContain('recorder_stopped');
		expect(requests[1]?.url).toContain('recorder_stopped');
		expect(JSON.parse(String(requests[1]?.init.body))).toMatchObject({
			gaps: [
				{
					started_at: '2026-01-01T00:00:59.000Z',
					ended_at: '2026-01-01T00:01:00.000Z',
					reason: 'ffmpeg_exited',
				},
			],
		});
		expect(Buffer.from(requests[2]?.init.body as Uint8Array)).toEqual(content);
		expect(requests[3]?.url).toContain('recorder_complete_upload');
		expect(requests[4]?.url).toContain('recorder_stopped');
		expect(retainedWhileProcessing).toBe(true);
		const authorization = new Headers(requests[2]?.init.headers).get(
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
