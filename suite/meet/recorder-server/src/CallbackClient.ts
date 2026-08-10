import { createHash, randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
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

interface InterruptedRequest {
	recording_id: string;
	job: string;
	event_sequence: number;
	reason: string;
}

interface RecoveredRequest {
	recording_id: string;
	job: string;
	event_sequence: number;
}

interface FailedRequest {
	recording_id: string;
	job: string;
	event_sequence: number;
	failure_code: 'capture_failed';
}

interface StoppedRequest {
	recording_id: string;
	job: string;
	event_sequence: number;
	size: number;
	sha256: string;
	duration_ms: number;
	ended_at: string;
	end_reason: string;
	gaps: Array<{ started_at: string; ended_at: string; reason: string }>;
}

interface CompleteUploadRequest {
	recording_id: string;
	job: string;
	event_sequence: number;
}

type CallbackRequest =
	| InterruptedRequest
	| RecoveredRequest
	| FailedRequest
	| StoppedRequest
	| CompleteUploadRequest;

type CallbackMethod =
	| 'recorder_interrupted'
	| 'recorder_recovered'
	| 'recorder_failed'
	| 'recorder_stopped'
	| 'recorder_complete_upload';

type CallbackOperation =
	| 'interrupted'
	| 'recovered'
	| 'failed'
	| 'stopped'
	| 'upload_chunk'
	| 'complete_upload';

interface StatusResponse {
	status: string;
}

interface UploadStartResponse {
	offset: number;
	complete: boolean;
}

interface UploadChunkResponse {
	offset: number;
}

export class CallbackClient {
	private readonly timeoutMs: number;
	constructor(private readonly options: CallbackClientOptions) {
		this.timeoutMs = options.timeoutMs ?? 30_000;
	}

	async interrupted(job: JobRecord): Promise<void> {
		const sequence = job.event_sequence ?? 2;
		await this.retryHealthCallback(() =>
			this.json(
				'recorder_interrupted',
				job,
				'interrupted',
				String(sequence),
				{
					recording_id: job.recording,
					job: job.job,
					event_sequence: sequence,
					reason: job.health_reason ?? 'capture_interrupted',
				},
				parseStatusResponse,
			),
		);
	}

	async recovered(job: JobRecord): Promise<void> {
		const sequence = job.event_sequence ?? 2;
		await this.retryHealthCallback(() =>
			this.json(
				'recorder_recovered',
				job,
				'recovered',
				String(sequence),
				{
					recording_id: job.recording,
					job: job.job,
					event_sequence: sequence,
				},
				parseStatusResponse,
			),
		);
	}

	async upload(job: JobRecord): Promise<void> {
		let delay = 1_000;
		for (let attempt = 0; ; attempt += 1) {
			try {
				await this.performUpload(job);
				await rm(safeJobDirectory(this.options.dataRoot, job.job), {
					recursive: true,
					force: true,
				});
				return;
			} catch (error) {
				if (attempt === 4) throw error;
				await new Promise((resolve) => setTimeout(resolve, delay));
				delay *= 2;
			}
		}
	}

	private async performUpload(job: JobRecord): Promise<void> {
		const terminalSequence = (job.event_sequence ?? 2) + 1;
		if (job.state === 'failed') {
			await this.json(
				'recorder_failed',
				job,
				'failed',
				String(terminalSequence),
				{
					recording_id: job.recording,
					job: job.job,
					event_sequence: terminalSequence,
					failure_code: 'capture_failed',
				},
				parseStatusResponse,
			);
			return;
		}
		const artifact = job.artifact;
		if (
			!artifact?.bytes ||
			!artifact.sha256 ||
			!artifact.duration_ms ||
			!['complete', 'partial'].includes(artifact.state)
		)
			throw new Error('terminal recording artifact is incomplete');
		const stoppedSequence = terminalSequence;
		const begun = await this.json(
			'recorder_stopped',
			job,
			'stopped',
			String(stoppedSequence),
			{
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
			},
			parseUploadStartResponse,
		);
		if (begun.complete === true) return;
		let offset = begun.offset;
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
				const next = result.offset;
				if (next !== offset + length)
					throw new Error('invalid Frappe upload acknowledgement');
				offset = next;
			}
		} finally {
			await file.close();
		}
		await this.json(
			'recorder_complete_upload',
			job,
			'complete_upload',
			String(stoppedSequence + 1),
			{
				recording_id: job.recording,
				job: job.job,
				event_sequence: stoppedSequence + 1,
			},
			parseStatusResponse,
		);
	}

	private async retryHealthCallback(
		callback: () => Promise<unknown>,
	): Promise<void> {
		let delay = 250;
		for (let attempt = 0; ; attempt += 1) {
			try {
				await callback();
				return;
			} catch (error) {
				if (attempt === 4) throw error;
				await new Promise((resolve) => setTimeout(resolve, delay));
				delay *= 2;
			}
		}
	}

	private async binary(
		job: JobRecord,
		offset: number,
		hash: string,
		chunk: Buffer,
	): Promise<UploadChunkResponse> {
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
		return this.request(
			url,
			job,
			'upload_chunk',
			operationId,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body,
			},
			parseUploadChunkResponse,
		);
	}

	private json<T>(
		method: CallbackMethod,
		job: JobRecord,
		operation: Exclude<CallbackOperation, 'upload_chunk'>,
		operationId: string,
		body: CallbackRequest,
		parseResponse: (value: unknown) => T,
	): Promise<T> {
		const url = new URL(
			`/api/method/suite.meet.api.recording.${method}`,
			this.options.origin,
		);
		return this.request(
			url,
			job,
			operation,
			operationId,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			},
			parseResponse,
		);
	}

	private async request<T>(
		url: URL,
		job: JobRecord,
		operation: CallbackOperation,
		operationId: string,
		init: RequestInit,
		parseResponse: (value: unknown) => T,
	): Promise<T> {
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
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error('invalid Frappe callback response');
		}
		if (!('message' in parsed)) {
			throw new Error('invalid Frappe callback response');
		}
		return parseResponse(parsed.message);
	}

	private token(
		job: JobRecord,
		operation: CallbackOperation,
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

function parseStatusResponse(value: unknown): StatusResponse {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('status' in value) ||
		typeof value.status !== 'string'
	) {
		throw new Error('invalid Frappe callback response');
	}
	return { status: value.status };
}

function parseUploadStartResponse(value: unknown): UploadStartResponse {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('complete' in value) ||
		typeof value.complete !== 'boolean' ||
		!('offset' in value) ||
		typeof value.offset !== 'number' ||
		!Number.isSafeInteger(value.offset)
	) {
		throw new Error('invalid Frappe callback response');
	}
	return { complete: value.complete, offset: value.offset };
}

function parseUploadChunkResponse(value: unknown): UploadChunkResponse {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('offset' in value) ||
		typeof value.offset !== 'number' ||
		!Number.isSafeInteger(value.offset)
	) {
		throw new Error('invalid Frappe callback response');
	}
	return { offset: value.offset };
}
