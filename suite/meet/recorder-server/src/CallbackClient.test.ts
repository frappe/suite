import { createHash } from 'node:crypto';
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
	it('reports segment progress with the captured byte operation ID', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ message: { budget_bytes: 2_000_000 } }), {
					status: 200,
				}),
		);
		vi.stubGlobal('fetch', fetch);
		const secret = 's'.repeat(32);
		const job = {
			job: 'job',
			site: 'site.test',
			origin: 'https://site.test',
			room: 'room',
			recording: 'recording',
		} as JobRecord;

		await expect(
			new CallbackClient({
				origin: 'https://site.test',
				site: 'site.test',
				secret,
				dataRoot: '/tmp',
			}).segmentProgress(job, 1_234_567),
		).resolves.toBe(2_000_000);

		expect(String(fetch.mock.calls[0]?.[0])).toContain(
			'recorder_segment_progress',
		);
		const body = String(fetch.mock.calls[0]?.[1]?.body);
		expect(JSON.parse(body)).toEqual({
			recording_id: 'recording',
			job: 'job',
			captured_bytes: 1_234_567,
		});
		const authorization = new Headers(fetch.mock.calls[0]?.[1]?.headers).get(
			'X-Meet-Recorder-Authorization',
		);
		expect(
			jwt.verify(String(authorization).replace('Bearer ', ''), secret),
		).toMatchObject({
			operation: 'segment_progress',
			operation_id: '1234567',
			body_sha256: createHash('sha256').update(body).digest('hex'),
		});
	});

	it.each([
		{ budget_bytes: -1 },
		{ budget_bytes: 1.5 },
		{ budget_bytes: '2000000' },
		{ budget_bytes: 2_000_000, extra: true },
	])('rejects an invalid segment progress response %#', async (message) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ message }), {
						status: 200,
					}),
			),
		);
		await expect(
			new CallbackClient({
				origin: 'https://site.test',
				site: 'site.test',
				secret: 's'.repeat(32),
				dataRoot: '/tmp',
			}).segmentProgress(
				{
					job: 'job',
					recording: 'recording',
				} as JobRecord,
				1,
			),
		).rejects.toThrow('invalid Frappe callback response');
	});

	it('publishes an ordered startup milestone with its durable timestamp', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ message: { status: 'Starting' } }), {
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
			state: 'proof_complete',
			event_sequence: 3,
			configured_at: '2026-08-30T11:59:59.000Z',
			proof_completed_at: '2026-08-30T12:00:00.000Z',
		} as JobRecord;

		await new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret: 's'.repeat(32),
			dataRoot: '/tmp',
		}).startup(job);

		expect(String(fetch.mock.calls[0]?.[0])).toContain(
			'recorder_startup_progress',
		);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
			recording_id: 'recording',
			job: 'job',
			event_sequence: 2,
			milestone: 'configured',
			occurred_at: '2026-08-30T11:59:59.000Z',
		});
		expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
			recording_id: 'recording',
			job: 'job',
			event_sequence: 3,
			milestone: 'proof_complete',
			occurred_at: '2026-08-30T12:00:00.000Z',
		});
	});

	it('keeps retrying the final startup milestone until acknowledged', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
			.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
			.mockResolvedValue(
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
			state: 'configured',
			event_sequence: 2,
			configured_at: '2026-08-30T12:00:00.000Z',
		} as JobRecord;

		await new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret: 's'.repeat(32),
			dataRoot: '/tmp',
			sleep: async () => undefined,
		}).startup(job);

		expect(fetch).toHaveBeenCalledTimes(3);
	});

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
			interruption_id: '11111111-1111-4111-8111-111111111111',
			interrupted_at: '2026-08-30T12:00:00.000Z',
			interruption_deadline: '2026-08-30T12:01:00.000Z',
			omission_started_at: '2026-08-30T11:59:30.000Z',
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
			interruption_id: '11111111-1111-4111-8111-111111111111',
			interrupted_at: '2026-08-30T12:00:00.000Z',
			interruption_deadline: '2026-08-30T12:01:00.000Z',
			omission_started_at: '2026-08-30T11:59:30.000Z',
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
			interruption_id: '11111111-1111-4111-8111-111111111111',
			resumed_capture_started_at: '2026-08-30T12:00:10.000Z',
			recovered_at: '2026-08-30T12:00:40.000Z',
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
			interruption_id: '11111111-1111-4111-8111-111111111111',
			resumed_capture_started_at: '2026-08-30T12:00:10.000Z',
			recovered_at: '2026-08-30T12:00:40.000Z',
		});
	});

	it('publishes replacement readiness with the exact authenticated body and bounded retries', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
			.mockResolvedValue(
				new Response(JSON.stringify({ message: { status: 'Interrupted' } }), {
					status: 200,
				}),
			);
		vi.stubGlobal('fetch', fetch);
		const publicJwk = {
			kty: 'EC' as const,
			crv: 'P-256' as const,
			x: 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY',
			y: 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
		};
		const job = {
			job: 'job',
			site: 'site.test',
			origin: 'https://site.test',
			room: 'room',
			recording: 'recording',
			state: 'interrupted',
			event_sequence: 7,
			interruption_id: '11111111-1111-4111-8111-111111111111',
			endpoint_generation: 2,
			public_jwk: publicJwk,
			replacement_ready_at: '2026-08-30T12:00:10.000Z',
		} as JobRecord;

		await new CallbackClient({
			origin: 'https://site.test',
			site: 'site.test',
			secret: 's'.repeat(32),
			dataRoot: '/tmp',
			sleep: async () => undefined,
		}).replacementReady(job);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(String(fetch.mock.calls[1]?.[0])).toContain(
			'recorder_replacement_ready',
		);
		const body = String(fetch.mock.calls[1]?.[1]?.body);
		expect(JSON.parse(body)).toEqual({
			recording_id: 'recording',
			job: 'job',
			event_sequence: 7,
			interruption_id: '11111111-1111-4111-8111-111111111111',
			endpoint_generation: 2,
			public_jwk: publicJwk,
			ready_at: '2026-08-30T12:00:10.000Z',
		});
		const authorization = new Headers(fetch.mock.calls[1]?.[1]?.headers).get(
			'X-Meet-Recorder-Authorization',
		);
		const claims = jwt.verify(
			String(authorization).replace('Bearer ', ''),
			's'.repeat(32),
		) as jwt.JwtPayload;
		expect(claims).toMatchObject({
			operation: 'replacement_ready',
			operation_id: '7',
			body_sha256: createHash('sha256').update(body).digest('hex'),
		});
	});

	it('propagates final replacement callback failure', async () => {
		const fetch = vi.fn(
			async () => new Response('unavailable', { status: 503 }),
		);
		vi.stubGlobal('fetch', fetch);
		await expect(
			new CallbackClient({
				origin: 'https://site.test',
				site: 'site.test',
				secret: 's'.repeat(32),
				dataRoot: '/tmp',
				sleep: async () => undefined,
			}).replacementReady({
				job: 'job',
				site: 'site.test',
				origin: 'https://site.test',
				room: 'room',
				recording: 'recording',
				state: 'interrupted',
				event_sequence: 7,
				interruption_id: '11111111-1111-4111-8111-111111111111',
				endpoint_generation: 2,
				public_jwk: {
					kty: 'EC',
					crv: 'P-256',
					x: 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY',
					y: 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
				},
				replacement_ready_at: '2026-08-30T12:00:10.000Z',
			} as JobRecord),
		).rejects.toThrow('HTTP 503');
		expect(fetch).toHaveBeenCalledTimes(5);
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
			interruption_id: '22222222-2222-4222-8222-222222222222',
			interrupted_at: '2026-08-30T12:02:00.000Z',
			interruption_deadline: '2026-08-30T12:03:00.000Z',
			omission_started_at: '2026-08-30T12:01:30.000Z',
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
			captured_bytes: 17,
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
			captured_bytes: 17,
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
			body_sha256: createHash('sha256').update(content).digest('hex'),
		});
		expect(jwt.decode(token, { complete: true })?.header.typ).toBe(
			'meet-recording-callback+jwt',
		);
		await expect(stat(directory)).rejects.toThrow();
	});
});
