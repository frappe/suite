import { constants } from 'node:fs';
import {
	access,
	chmod,
	type FileHandle,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { validLimits, validUtcTimestamp } from './AuthManager.js';
import type { JobRecord } from './types.js';

interface Ledger {
	version: 1;
	jobs: Record<string, JobRecord>;
	consumed_jtis: Record<string, number>;
}

const MAX_NONCES = 10_000;
const NONCE_SKEW_SECONDS = 5;

function nonempty(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function migrateLegacyLedger(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const ledger = value as { version?: unknown; jobs?: unknown };
	if (
		ledger.version !== 1 ||
		!ledger.jobs ||
		typeof ledger.jobs !== 'object' ||
		Array.isArray(ledger.jobs)
	)
		return false;
	let migrated = false;
	for (const job of Object.values(ledger.jobs)) {
		if (
			job &&
			typeof job === 'object' &&
			!Array.isArray(job) &&
			!('endpoint_generation' in job)
		) {
			Object.assign(job, { endpoint_generation: 0 });
			migrated = true;
		}
	}
	return migrated;
}

function validLedger(value: unknown): value is Ledger {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const ledger = value as Partial<Ledger>;
	const ledgerKeys = Object.keys(ledger).sort();
	if (
		JSON.stringify(ledgerKeys) !==
		JSON.stringify(
			(ledger.consumed_jtis === undefined
				? ['jobs', 'version']
				: ['consumed_jtis', 'jobs', 'version']) as string[],
		)
	)
		return false;
	if (
		ledger.version !== 1 ||
		!ledger.jobs ||
		typeof ledger.jobs !== 'object' ||
		Array.isArray(ledger.jobs)
	)
		return false;
	if (
		ledger.consumed_jtis !== undefined &&
		(typeof ledger.consumed_jtis !== 'object' ||
			Array.isArray(ledger.consumed_jtis) ||
			Object.keys(ledger.consumed_jtis).length > MAX_NONCES ||
			!Object.entries(ledger.consumed_jtis).every(
				([jti, expiry]) =>
					nonempty(jti) && Number.isSafeInteger(expiry) && expiry > 0,
			))
	)
		return false;
	return Object.entries(ledger.jobs).every(([id, job]) => {
		if (!job || typeof job !== 'object' || job.job !== id) return false;
		const keys = [
			'accepted_at',
			'endpoint_generation',
			'job',
			'limits',
			'origin',
			'public_jwk',
			'recording',
			'room',
			'site',
			'state',
			'stop_operation_ids',
			...(job.health_reason === undefined ? [] : ['health_reason']),
			...(job.configured_at === undefined ? [] : ['configured_at']),
			...(job.proof_completed_at === undefined ? [] : ['proof_completed_at']),
			...(job.joined_at === undefined ? [] : ['joined_at']),
			...(job.capture_started_at === undefined ? [] : ['capture_started_at']),
			...(job.interruption_id === undefined ? [] : ['interruption_id']),
			...(job.interrupted_at === undefined ? [] : ['interrupted_at']),
			...(job.interruption_deadline === undefined
				? []
				: ['interruption_deadline']),
			...(job.omission_started_at === undefined ? [] : ['omission_started_at']),
			...(job.resumed_capture_started_at === undefined
				? []
				: ['resumed_capture_started_at']),
			...(job.recovered_at === undefined ? [] : ['recovered_at']),
			...(job.replacement_ready_at === undefined
				? []
				: ['replacement_ready_at']),
			...(job.event_sequence === undefined ? [] : ['event_sequence']),
			...(job.terminal_at === undefined ? [] : ['terminal_at']),
			...(job.callback_completed_at === undefined
				? []
				: ['callback_completed_at']),
			...(job.captured_bytes === undefined ? [] : ['captured_bytes']),
			...(job.artifact === undefined ? [] : ['artifact']),
		].sort();
		if (JSON.stringify(Object.keys(job).sort()) !== JSON.stringify(keys))
			return false;
		if (
			JSON.stringify(Object.keys(job.public_jwk ?? {}).sort()) !==
			JSON.stringify(['crv', 'kty', 'x', 'y'])
		)
			return false;
		return (
			nonempty(job.site) &&
			nonempty(job.origin) &&
			nonempty(job.room) &&
			nonempty(job.recording) &&
			(job.event_sequence === undefined ||
				(Number.isSafeInteger(job.event_sequence) &&
					job.event_sequence >= 1)) &&
			Number.isSafeInteger(job.endpoint_generation) &&
			job.endpoint_generation >= 0 &&
			validUtcTimestamp(job.accepted_at) &&
			(job.configured_at === undefined ||
				validUtcTimestamp(job.configured_at)) &&
			(job.proof_completed_at === undefined ||
				validUtcTimestamp(job.proof_completed_at)) &&
			(job.joined_at === undefined || validUtcTimestamp(job.joined_at)) &&
			(job.capture_started_at === undefined ||
				validUtcTimestamp(job.capture_started_at)) &&
			(job.interruption_id === undefined || nonempty(job.interruption_id)) &&
			(job.interrupted_at === undefined ||
				validUtcTimestamp(job.interrupted_at)) &&
			(job.interruption_deadline === undefined ||
				validUtcTimestamp(job.interruption_deadline)) &&
			(job.omission_started_at === undefined ||
				validUtcTimestamp(job.omission_started_at)) &&
			(job.resumed_capture_started_at === undefined ||
				validUtcTimestamp(job.resumed_capture_started_at)) &&
			(job.recovered_at === undefined || validUtcTimestamp(job.recovered_at)) &&
			(job.replacement_ready_at === undefined ||
				validUtcTimestamp(job.replacement_ready_at)) &&
			[
				'reserved',
				'configured',
				'proof_complete',
				'joined',
				'capture_ready',
				'interrupted',
				'failed',
				'recovery_required',
				'stopping',
				'complete',
				'partial',
			].includes(job.state) &&
			(job.artifact === undefined ||
				(['complete', 'partial'].includes(job.artifact.state) &&
					job.artifact.path === 'recording.mp4' &&
					job.state === job.artifact.state)) &&
			(job.health_reason === undefined ||
				(typeof job.health_reason === 'string' &&
					job.health_reason.length <= 256)) &&
			(job.terminal_at === undefined || validUtcTimestamp(job.terminal_at)) &&
			(job.callback_completed_at === undefined ||
				validUtcTimestamp(job.callback_completed_at)) &&
			(job.captured_bytes === undefined ||
				(Number.isSafeInteger(job.captured_bytes) &&
					job.captured_bytes >= 0)) &&
			Array.isArray(job.stop_operation_ids) &&
			job.stop_operation_ids.length <= 10_000 &&
			job.stop_operation_ids.every(nonempty) &&
			new Set(job.stop_operation_ids).size === job.stop_operation_ids.length &&
			job.public_jwk?.kty === 'EC' &&
			job.public_jwk.crv === 'P-256' &&
			/^[A-Za-z0-9_-]{43}$/.test(job.public_jwk.x) &&
			/^[A-Za-z0-9_-]{43}$/.test(job.public_jwk.y) &&
			validLimits(job.limits)
		);
	});
}

export class JobStore {
	private ledger: Ledger = { version: 1, jobs: {}, consumed_jtis: {} };
	private writable = false;
	private updates: Promise<void> = Promise.resolve();

	constructor(private readonly path: string) {}

	get ready(): boolean {
		return this.writable;
	}

	async initialize(): Promise<void> {
		try {
			await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
			try {
				const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
				const migrated = migrateLegacyLedger(parsed);
				if (!validLedger(parsed)) throw new Error('invalid ledger schema');
				this.ledger = { ...parsed, consumed_jtis: parsed.consumed_jtis ?? {} };
				if (migrated) await this.persist(this.ledger);
				await chmod(this.path, 0o600);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				try {
					await access(`${this.path}.initialized`, constants.F_OK);
					throw new Error('initialized ledger is missing');
				} catch (markerError) {
					if ((markerError as NodeJS.ErrnoException).code !== 'ENOENT')
						throw markerError;
				}
				await this.persist(this.ledger);
				const marker = await open(`${this.path}.initialized`, 'wx', 0o600);
				try {
					await marker.writeFile('1\n');
					await marker.sync();
				} finally {
					await marker.close();
				}
				const parent = await open(dirname(this.path), 'r');
				try {
					await parent.sync();
				} finally {
					await parent.close();
				}
			}
			await access(this.path, constants.R_OK | constants.W_OK);
			this.writable = true;
		} catch (error) {
			this.writable = false;
			throw new Error('job ledger is unavailable', { cause: error });
		}
	}

	get(job: string): JobRecord | undefined {
		if (!this.writable) throw new Error('job ledger is unavailable');
		return this.ledger.jobs[job];
	}

	all(): JobRecord[] {
		if (!this.writable) throw new Error('job ledger is unavailable');
		return Object.values(this.ledger.jobs);
	}

	async update(
		mutator: (
			jobs: Record<string, JobRecord>,
			consumedJtis: Record<string, number>,
		) => void,
	): Promise<void> {
		const update = this.updates.then(async () => {
			if (!this.writable) throw new Error('job ledger is unavailable');
			const next = structuredClone(this.ledger);
			mutator(next.jobs, next.consumed_jtis);
			try {
				await this.persist(next);
				this.ledger = next;
			} catch (error) {
				this.writable = false;
				throw error;
			}
		});
		this.updates = update.catch(() => undefined);
		await update;
	}

	async consumeJti(
		jti: string,
		exp: number,
		now = Math.floor(Date.now() / 1000),
	): Promise<boolean> {
		let consumed = false;
		await this.update((_jobs, nonces) => {
			for (const [key, expiry] of Object.entries(nonces))
				if (expiry < now) delete nonces[key];
			if (nonces[jti] !== undefined) return;
			if (Object.keys(nonces).length >= MAX_NONCES)
				throw new Error('nonce ledger is full');
			nonces[jti] = exp + NONCE_SKEW_SECONDS;
			consumed = true;
		});
		return consumed;
	}

	private async persist(ledger: Ledger): Promise<void> {
		const temp = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
		let file: FileHandle | undefined;
		try {
			file = await open(temp, 'wx', 0o600);
			await file.writeFile(`${JSON.stringify(ledger)}\n`, 'utf8');
			await file.sync();
			await file.close();
			file = undefined;
			await rename(temp, this.path);
			const parent = await open(dirname(this.path), 'r');
			try {
				await parent.sync();
			} finally {
				await parent.close();
			}
		} finally {
			if (file) await file.close().catch(() => undefined);
			await unlink(temp).catch(() => undefined);
		}
	}
}
