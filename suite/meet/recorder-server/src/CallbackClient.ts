import { createHash, randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { safeJobDirectory } from './ManifestStore.js';
import type { JobRecord } from './types.js';

const AUDIENCE = 'meet-recording-callback';
const TYPE = 'meet-recording-callback+jwt';
const PROTOCOL_VERSION = 1;
const FINALIZATION_AUDIENCE = 'meet-recording-finalization';
const FINALIZATION_TYPE = 'meet-recording-finalization+jwt';
const FINALIZATION_PROTOCOL_VERSION = 1;
const CHUNK_SIZE = 8 * 1024 * 1024;
const FRAPPE_RECORDING_STATES = new Set([
	'Pending',
	'Starting',
	'Recording',
	'Interrupted',
	'Stopping',
	'Processing',
	'Ready',
	'Partial',
	'Failed',
	'Cancelled',
]);

interface CallbackClientOptions {
	origin: string;
	site: string;
	secret: string;
	dataRoot: string;
	timeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
}

interface InterruptedRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	event_sequence: number;
	reason_code: string;
	interruption_id: string;
	interrupted_at: string;
	interruption_deadline: string;
	omission_started_at: string;
}

interface RecoveredRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	event_sequence: number;
	interruption_id: string;
	resumed_capture_started_at: string;
	recovered_at: string;
}

interface ReplacementReadyRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	event_sequence: number;
	interruption_id: string;
	endpoint_generation: number;
	public_jwk: JobRecord['public_jwk'];
	ready_at: string;
}

interface StartupProgressRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	event_sequence: number;
	milestone: 'configured' | 'proof_complete' | 'joined' | 'capture_started';
	occurred_at: string;
}

interface FailedRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	event_sequence: number;
	reason_code: 'capture_failed';
}

interface StoppedRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	event_sequence: number;
	captured_bytes: number;
	size: number;
	sha256: string;
	duration_ms: number;
	ended_at: string;
	end_reason_code: string;
	gaps: Array<{ started_at: string; ended_at: string; reason_code: string }>;
}

interface CompleteUploadRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	event_sequence: number;
}

interface SegmentProgressRequest {
	protocol_version: typeof PROTOCOL_VERSION;
	recording_id: string;
	job: string;
	captured_bytes: number;
}

type CallbackRequest =
	| StartupProgressRequest
	| InterruptedRequest
	| RecoveredRequest
	| ReplacementReadyRequest
	| FailedRequest
	| StoppedRequest
	| CompleteUploadRequest
	| SegmentProgressRequest;

type CallbackMethod =
	| 'recorder_startup_progress'
	| 'recorder_interrupted'
	| 'recorder_recovered'
	| 'recorder_replacement_ready'
	| 'recorder_failed'
	| 'recorder_stopped'
	| 'recorder_segment_progress'
	| 'recorder_complete_upload';

type CallbackOperation =
	| 'startup_progress'
	| 'interrupted'
	| 'recovered'
	| 'replacement_ready'
	| 'failed'
	| 'stopped'
	| 'segment_progress'
	| 'upload_chunk'
	| 'complete_upload'
	| 'status';

interface StatusResponse {
	protocol_version: typeof PROTOCOL_VERSION;
	status: string;
}

interface UploadStartResponse {
	protocol_version: typeof PROTOCOL_VERSION;
	offset: number;
	complete: boolean;
}

interface UploadChunkResponse {
	protocol_version: typeof PROTOCOL_VERSION;
	offset: number;
}

interface SegmentProgressResponse {
	protocol_version: typeof PROTOCOL_VERSION;
	budget_bytes: number;
}

type FinalizationAction =
	| { protocol_version: 1; action: 'wait' }
	| { protocol_version: 1; action: 'resume_upload'; offset: number }
	| {
			protocol_version: 1;
			action: 'delete_local';
			terminal_result: 'Ready' | 'Partial' | 'Failed';
	  };

export type FinalizationProgress = (
	phase: 'started' | 'cleanup_authorized' | 'local_deleted',
	terminalResult?: 'Ready' | 'Partial' | 'Failed',
) => Promise<void>;

export class CallbackClient {
	private readonly timeoutMs: number;
	private readonly sleep: (ms: number) => Promise<void>;
	constructor(private readonly options: CallbackClientOptions) {
		this.timeoutMs = options.timeoutMs ?? 30_000;
		this.sleep =
			options.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

	async startup(job: JobRecord): Promise<void> {
		const milestones = [
			['configured', 'configured', job.configured_at],
			['proof_complete', 'proof_complete', job.proof_completed_at],
			['joined', 'joined', job.joined_at],
			['capture_ready', 'capture_started', job.capture_started_at],
		] as const;
		const current = milestones.findIndex(([state]) => state === job.state);
		if (current < 0) throw new Error('invalid startup milestone');
		for (const [index, [, milestone, occurredAt]] of milestones
			.slice(0, current + 1)
			.entries()) {
			if (!occurredAt)
				throw new Error('startup milestone timestamp is unavailable');
			const sequence = index + 2;
			await this.retryHealthCallback(
				() =>
					this.json(
						'recorder_startup_progress',
						job,
						'startup_progress',
						String(sequence),
						{
							protocol_version: PROTOCOL_VERSION,
							recording_id: job.recording,
							job: job.job,
							event_sequence: sequence,
							milestone,
							occurred_at: occurredAt,
						},
						parseStatusResponse,
					),
				Number.POSITIVE_INFINITY,
			);
		}
	}

	async interrupted(job: JobRecord): Promise<void> {
		const sequence = job.event_sequence ?? 2;
		if (
			!job.interruption_id ||
			!job.interrupted_at ||
			!job.interruption_deadline ||
			!job.omission_started_at
		)
			throw new Error('interruption metadata is unavailable');
		await this.retryHealthCallback(() =>
			this.json(
				'recorder_interrupted',
				job,
				'interrupted',
				String(sequence),
				{
					protocol_version: PROTOCOL_VERSION,
					recording_id: job.recording,
					job: job.job,
					event_sequence: sequence,
					reason_code: this.healthReason(job.health_reason),
					interruption_id: job.interruption_id,
					interrupted_at: job.interrupted_at,
					interruption_deadline: job.interruption_deadline,
					omission_started_at: job.omission_started_at,
				},
				parseStatusResponse,
			),
		);
	}

	async recovered(job: JobRecord): Promise<void> {
		const sequence = job.event_sequence ?? 2;
		if (
			!job.interruption_id ||
			!job.resumed_capture_started_at ||
			!job.recovered_at
		)
			throw new Error('recovery metadata is unavailable');
		await this.retryHealthCallback(() =>
			this.json(
				'recorder_recovered',
				job,
				'recovered',
				String(sequence),
				{
					protocol_version: PROTOCOL_VERSION,
					recording_id: job.recording,
					job: job.job,
					event_sequence: sequence,
					interruption_id: job.interruption_id,
					resumed_capture_started_at: job.resumed_capture_started_at,
					recovered_at: job.recovered_at,
				},
				parseStatusResponse,
			),
		);
	}

	async replacementReady(job: JobRecord): Promise<void> {
		const sequence = job.event_sequence ?? 2;
		if (!job.interruption_id || !job.replacement_ready_at)
			throw new Error('replacement metadata is unavailable');
		await this.retryHealthCallback(() =>
			this.json(
				'recorder_replacement_ready',
				job,
				'replacement_ready',
				String(sequence),
				{
					protocol_version: PROTOCOL_VERSION,
					recording_id: job.recording,
					job: job.job,
					event_sequence: sequence,
					interruption_id: job.interruption_id,
					endpoint_generation: job.endpoint_generation,
					public_jwk: job.public_jwk,
					ready_at: job.replacement_ready_at,
				},
				parseStatusResponse,
			),
		);
	}

	async segmentProgress(
		job: JobRecord,
		capturedBytes: number,
	): Promise<number> {
		if (!Number.isSafeInteger(capturedBytes) || capturedBytes < 0)
			throw new Error('invalid captured byte count');
		const response = await this.json(
			'recorder_segment_progress',
			job,
			'segment_progress',
			String(capturedBytes),
			{
				protocol_version: PROTOCOL_VERSION,
				recording_id: job.recording,
				job: job.job,
				captured_bytes: capturedBytes,
			},
			parseSegmentProgressResponse,
		);
		return response.budget_bytes;
	}

	async upload(
		job: JobRecord,
		onProgress: FinalizationProgress = async () => undefined,
	): Promise<void> {
		if (job.cleanup_authorized_at) {
			await this.deleteLocal(job);
			await onProgress('local_deleted', job.cleanup_result);
			return;
		}
		let started = Boolean(job.finalization_started_at);
		let delay = 1_000;
		let attempt = 0;
		for (;;) {
			try {
				if (!started) {
					await this.beginFinalization(job, async () => {
						await onProgress('started');
						started = true;
					});
				}
				const action = await this.finalizationStatus(job);
				if (action.action === 'wait') {
					attempt = 0;
					delay = 1_000;
					await this.sleep(5_000);
					continue;
				}
				if (action.action === 'resume_upload') {
					await this.uploadArtifact(job, action.offset);
					attempt = 0;
					delay = 1_000;
					continue;
				}
				await onProgress('cleanup_authorized', action.terminal_result);
				await this.deleteLocal(job);
				await onProgress('local_deleted', action.terminal_result);
				return;
			} catch (error) {
				attempt += 1;
				if (attempt >= 5) throw error;
				await this.sleep(delay);
				delay *= 2;
			}
		}
	}

	private async beginFinalization(
		job: JobRecord,
		onAccepted: () => Promise<void>,
	): Promise<void> {
		const terminalSequence = (job.event_sequence ?? 2) + 1;
		if (job.state === 'failed') {
			await this.json(
				'recorder_failed',
				job,
				'failed',
				String(terminalSequence),
				{
					protocol_version: PROTOCOL_VERSION,
					recording_id: job.recording,
					job: job.job,
					event_sequence: terminalSequence,
					reason_code: 'capture_failed',
				},
				parseStatusResponse,
			);
			await onAccepted();
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
				protocol_version: PROTOCOL_VERSION,
				recording_id: job.recording,
				job: job.job,
				event_sequence: stoppedSequence,
				captured_bytes: job.captured_bytes ?? 0,
				size: artifact.bytes,
				sha256: artifact.sha256,
				duration_ms: artifact.duration_ms,
				ended_at: job.terminal_at ?? new Date().toISOString(),
				end_reason_code: this.endReason(job),
				gaps: (artifact.gaps ?? []).map((gap) => ({
					started_at: gap.started_at,
					ended_at: gap.ended_at ?? job.terminal_at ?? new Date().toISOString(),
					reason_code: this.gapReason(gap.reason),
				})),
			},
			parseUploadStartResponse,
		);
		await onAccepted();
		if (!begun.complete) await this.uploadArtifact(job, begun.offset);
	}

	private async uploadArtifact(
		job: JobRecord,
		requestedOffset: number,
	): Promise<void> {
		const artifact = job.artifact;
		if (
			!artifact?.bytes ||
			!artifact.sha256 ||
			!artifact.duration_ms ||
			!['complete', 'partial'].includes(artifact.state)
		)
			throw new Error('terminal recording artifact is incomplete');
		let offset = requestedOffset;
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
		const completed = await this.json(
			'recorder_complete_upload',
			job,
			'complete_upload',
			String((job.event_sequence ?? 2) + 2),
			{
				protocol_version: PROTOCOL_VERSION,
				recording_id: job.recording,
				job: job.job,
				event_sequence: (job.event_sequence ?? 2) + 2,
			},
			parseStatusResponse,
		);
		if (!['Processing', 'Ready', 'Partial'].includes(completed.status))
			throw new Error('invalid Frappe upload completion state');
	}

	private async finalizationStatus(
		job: JobRecord,
	): Promise<FinalizationAction> {
		const body = JSON.stringify({
			protocol_version: FINALIZATION_PROTOCOL_VERSION,
			recording_id: job.recording,
			job: job.job,
		});
		const url = new URL(
			'/api/method/suite.meet.api.recording.recorder_finalization_status',
			this.options.origin,
		);
		return this.request(
			url,
			job,
			'status',
			'status',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
			},
			parseFinalizationResponse,
			true,
		);
	}

	private async deleteLocal(job: JobRecord): Promise<void> {
		await rm(safeJobDirectory(this.options.dataRoot, job.job), {
			recursive: true,
			force: true,
		});
	}

	private async retryHealthCallback(
		callback: () => Promise<unknown>,
		maxAttempts = 5,
	): Promise<void> {
		let delay = 250;
		for (let attempt = 0; ; attempt += 1) {
			try {
				await callback();
				return;
			} catch (error) {
				if (attempt + 1 >= maxAttempts) throw error;
				await this.sleep(delay);
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
		url.searchParams.set('protocol_version', String(PROTOCOL_VERSION));
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
		finalization = false,
	): Promise<T> {
		const response = await fetch(url, {
			...init,
			headers: {
				...init.headers,
				'X-Meet-Recorder-Authorization': `Bearer ${this.token(
					job,
					operation,
					operationId,
					init.body,
					finalization,
				)}`,
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
		if (!exactKeys(parsed, ['message']) || !('message' in parsed)) {
			throw new Error('invalid Frappe callback response');
		}
		return parseResponse(parsed.message);
	}

	private token(
		job: JobRecord,
		operation: CallbackOperation,
		operationId: string,
		body: BodyInit | null | undefined,
		finalization = false,
	): string {
		const now = Math.floor(Date.now() / 1000);
		const bytes =
			typeof body === 'string'
				? Buffer.from(body)
				: body instanceof Uint8Array
					? Buffer.from(body)
					: undefined;
		if (!bytes) throw new Error('unsupported callback request body');
		return jwt.sign(
			{
				protocol_version: finalization
					? FINALIZATION_PROTOCOL_VERSION
					: PROTOCOL_VERSION,
				iss: `meet-recorder:${this.options.site}`,
				aud: finalization ? FINALIZATION_AUDIENCE : AUDIENCE,
				site: this.options.site,
				recording: job.recording,
				job: job.job,
				operation,
				operation_id: operationId,
				body_sha256: createHash('sha256').update(bytes).digest('hex'),
				jti: randomUUID(),
				iat: now,
				exp: now + 30,
			},
			this.options.secret,
			{
				algorithm: 'HS256',
				header: { alg: 'HS256', typ: finalization ? FINALIZATION_TYPE : TYPE },
			},
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

	private healthReason(reason?: string): string {
		const finite = new Set([
			'browser_disconnected',
			'capture_interrupted',
			'configuration_failed',
			'ffmpeg_exited',
			'media_attachment_failed',
			'media_subscription_failed',
			'page_crashed',
			'receive_transport_failed',
			'sfu_disconnected',
		]);
		return reason && finite.has(reason) ? reason : 'capture_interrupted';
	}

	private gapReason(reason: string): string {
		if (reason.includes('ffmpeg') || reason.includes('segment'))
			return 'ffmpeg_exited';
		if (reason.includes('renderer')) return 'renderer_interrupted';
		return 'capture_interrupted';
	}
}

export function parseStatusResponse(value: unknown): StatusResponse {
	if (
		!exactKeys(value, ['protocol_version', 'status']) ||
		!('protocol_version' in value) ||
		value.protocol_version !== PROTOCOL_VERSION ||
		!('status' in value) ||
		typeof value.status !== 'string' ||
		!FRAPPE_RECORDING_STATES.has(value.status)
	) {
		throw new Error('invalid Frappe callback response');
	}
	return { protocol_version: PROTOCOL_VERSION, status: value.status };
}

export function parseFinalizationResponse(value: unknown): FinalizationAction {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('protocol_version' in value) ||
		value.protocol_version !== FINALIZATION_PROTOCOL_VERSION ||
		!('action' in value) ||
		typeof value.action !== 'string'
	)
		throw new Error('invalid Frappe finalization response');
	if (
		value.action === 'wait' &&
		exactKeys(value, ['action', 'protocol_version'])
	)
		return { protocol_version: 1, action: 'wait' };
	if (
		value.action === 'resume_upload' &&
		exactKeys(value, ['action', 'offset', 'protocol_version']) &&
		'offset' in value &&
		typeof value.offset === 'number' &&
		Number.isSafeInteger(value.offset) &&
		value.offset >= 0
	)
		return {
			protocol_version: 1,
			action: 'resume_upload',
			offset: value.offset,
		};
	if (
		value.action === 'delete_local' &&
		exactKeys(value, ['action', 'protocol_version', 'terminal_result']) &&
		'terminal_result' in value &&
		['Ready', 'Partial', 'Failed'].includes(String(value.terminal_result))
	)
		return {
			protocol_version: 1,
			action: 'delete_local',
			terminal_result: value.terminal_result as 'Ready' | 'Partial' | 'Failed',
		};
	throw new Error('invalid Frappe finalization response');
}

function parseUploadStartResponse(value: unknown): UploadStartResponse {
	if (
		!exactKeys(value, ['complete', 'offset', 'protocol_version']) ||
		!('protocol_version' in value) ||
		value.protocol_version !== PROTOCOL_VERSION ||
		!('complete' in value) ||
		typeof value.complete !== 'boolean' ||
		!('offset' in value) ||
		typeof value.offset !== 'number' ||
		!Number.isSafeInteger(value.offset)
	) {
		throw new Error('invalid Frappe callback response');
	}
	return {
		protocol_version: PROTOCOL_VERSION,
		complete: value.complete,
		offset: value.offset,
	};
}

function parseUploadChunkResponse(value: unknown): UploadChunkResponse {
	if (
		!exactKeys(value, ['offset', 'protocol_version']) ||
		!('protocol_version' in value) ||
		value.protocol_version !== PROTOCOL_VERSION ||
		!('offset' in value) ||
		typeof value.offset !== 'number' ||
		!Number.isSafeInteger(value.offset)
	) {
		throw new Error('invalid Frappe callback response');
	}
	return { protocol_version: PROTOCOL_VERSION, offset: value.offset };
}

function parseSegmentProgressResponse(value: unknown): SegmentProgressResponse {
	if (
		!exactKeys(value, ['budget_bytes', 'protocol_version']) ||
		!('protocol_version' in value) ||
		value.protocol_version !== PROTOCOL_VERSION ||
		!('budget_bytes' in value) ||
		typeof value.budget_bytes !== 'number' ||
		!Number.isSafeInteger(value.budget_bytes) ||
		value.budget_bytes < 0
	) {
		throw new Error('invalid Frappe callback response');
	}
	return {
		protocol_version: PROTOCOL_VERSION,
		budget_bytes: value.budget_bytes,
	};
}

function exactKeys(value: unknown, keys: string[]): value is object {
	return (
		!!value &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys)
	);
}
