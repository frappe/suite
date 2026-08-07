import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { safeJobDirectory } from './ManifestStore.js';
import type { JobRecord } from './types.js';

const AUDIENCE = 'meet-recording-callback';
const TYPE = 'meet-recording-callback+jwt';
const CHUNK_SIZE = 8 * 1024 * 1024;

interface CallbackClientOptions {
	origin: string;
	site: string;
	secret: string;
	dataRoot: string;
	timeoutMs?: number;
}

export class CallbackClient {
	private readonly timeoutMs: number;
	constructor(private readonly options: CallbackClientOptions) {
		this.timeoutMs = options.timeoutMs ?? 30_000;
	}

	async interrupted(job: JobRecord): Promise<void> {
		await this.json('recorder_interrupted', job, 'interrupted', '2', {
			recording_id: job.recording,
			job: job.job,
			event_sequence: 2,
			reason: job.health_reason ?? 'capture_interrupted',
		});
	}

	async upload(job: JobRecord): Promise<void> {
		let delay = 1_000;
		for (let attempt = 0; ; attempt += 1) {
			try {
				await this.performUpload(job);
				return;
			} catch (error) {
				if (attempt === 4) throw error;
				await new Promise((resolve) => setTimeout(resolve, delay));
				delay *= 2;
			}
		}
	}

	private async performUpload(job: JobRecord): Promise<void> {
		if (job.state === 'failed') {
			await this.json('recorder_failed', job, 'failed', '3', {
				recording_id: job.recording,
				job: job.job,
				event_sequence: 3,
				failure_code: 'capture_failed',
			});
			return;
		}
		const artifact = job.artifact;
		if (
			!artifact?.bytes ||
			!artifact.sha256 ||
			!artifact.duration_ms ||
			!['complete', 'partial'].includes(artifact.state)
		)
			return;
		const stoppedSequence = 3;
		const begun = await this.json('recorder_stopped', job, 'stopped', '3', {
			recording_id: job.recording,
			job: job.job,
			event_sequence: stoppedSequence,
			size: artifact.bytes,
			sha256: artifact.sha256,
			duration_ms: artifact.duration_ms,
			ended_at: job.terminal_at ?? new Date().toISOString(),
			end_reason: this.endReason(job),
			gaps: (artifact.gaps ?? []).map((gap) => ({
				started_at: gap.started_at,
				ended_at: gap.ended_at ?? job.terminal_at ?? new Date().toISOString(),
				reason: this.gapReason(gap.reason),
			})),
		});
		if (begun.complete === true) return;
		let offset = Number(begun.offset);
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > artifact.bytes)
			throw new Error('invalid Frappe upload offset');

		const path = join(
			safeJobDirectory(this.options.dataRoot, job.job),
			artifact.path,
		);
		const file = await open(path, 'r');
		try {
			while (offset < artifact.bytes) {
				const length = Math.min(CHUNK_SIZE, artifact.bytes - offset);
				const chunk = Buffer.allocUnsafe(length);
				const { bytesRead } = await file.read(chunk, 0, length, offset);
				if (bytesRead !== length)
					throw new Error('recording artifact ended early');
				const hash = createHash('sha256').update(chunk).digest('hex');
				const result = await this.binary(job, offset, hash, chunk);
				const next = Number(result.offset);
				if (next !== offset + length)
					throw new Error('invalid Frappe upload acknowledgement');
				offset = next;
			}
		} finally {
			await file.close();
		}
		await this.json('recorder_complete_upload', job, 'complete_upload', '4', {
			recording_id: job.recording,
			job: job.job,
			event_sequence: 4,
		});
	}

	private async binary(
		job: JobRecord,
		offset: number,
		hash: string,
		chunk: Buffer,
	): Promise<Record<string, unknown>> {
		const operationId = `${offset}:${hash}`;
		const url = new URL(
			'/api/method/suite.meet.api.recording.recorder_upload_chunk',
			this.options.origin,
		);
		url.searchParams.set('recording_id', job.recording);
		url.searchParams.set('job', job.job);
		url.searchParams.set('offset', String(offset));
		url.searchParams.set('chunk_sha256', hash);
		const body = new Uint8Array(chunk.length);
		body.set(chunk);
		return this.request(url, job, 'upload_chunk', operationId, {
			method: 'POST',
			headers: { 'Content-Type': 'application/octet-stream' },
			body,
		});
	}

	private json(
		method: string,
		job: JobRecord,
		operation: string,
		operationId: string,
		body: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const url = new URL(
			`/api/method/suite.meet.api.recording.${method}`,
			this.options.origin,
		);
		return this.request(url, job, operation, operationId, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	}

	private async request(
		url: URL,
		job: JobRecord,
		operation: string,
		operationId: string,
		init: RequestInit,
	): Promise<Record<string, unknown>> {
		const response = await fetch(url, {
			...init,
			headers: {
				...init.headers,
				'X-Meet-Recorder-Authorization': `Bearer ${this.token(job, operation, operationId)}`,
			},
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		const text = await response.text();
		if (!response.ok || text.length > 64 * 1024)
			throw new Error(`Frappe callback failed with HTTP ${response.status}`);
		const parsed: unknown = JSON.parse(text);
		if (
			!parsed ||
			typeof parsed !== 'object' ||
			Array.isArray(parsed) ||
			!('message' in parsed) ||
			!(parsed as { message?: unknown }).message ||
			typeof (parsed as { message: unknown }).message !== 'object' ||
			Array.isArray((parsed as { message: unknown }).message)
		)
			throw new Error('invalid Frappe callback response');
		return (parsed as { message: Record<string, unknown> }).message;
	}

	private token(
		job: JobRecord,
		operation: string,
		operationId: string,
	): string {
		const now = Math.floor(Date.now() / 1000);
		return jwt.sign(
			{
				iss: `meet-recorder:${this.options.site}`,
				aud: AUDIENCE,
				site: this.options.site,
				recording: job.recording,
				job: job.job,
				operation,
				operation_id: operationId,
				jti: randomUUID(),
				iat: now,
				exp: now + 30,
			},
			this.options.secret,
			{ algorithm: 'HS256', header: { alg: 'HS256', typ: TYPE } },
		);
	}

	private endReason(job: JobRecord): string {
		const reason = job.health_reason ?? '';
		if (reason.includes('budget') || reason.includes('quota'))
			return 'quota_limit';
		if (reason.includes('time_limit') || reason.includes('duration'))
			return 'duration_limit';
		if (reason.includes('recovery_timeout') || reason.includes('interruption'))
			return 'interruption_timeout';
		if (reason.includes('shutdown')) return 'service_shutdown';
		if (reason.includes('room_empty')) return 'room_empty';
		return 'host_stop';
	}

	private gapReason(reason: string): string {
		if (reason.includes('ffmpeg') || reason.includes('segment'))
			return 'ffmpeg_exited';
		if (reason.includes('renderer')) return 'renderer_interrupted';
		return 'capture_interrupted';
	}
}
