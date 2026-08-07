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
			...(job.terminal_at === undefined ? [] : ['terminal_at']),
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
			validUtcTimestamp(job.accepted_at) &&
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
				if (!validLedger(parsed)) throw new Error('invalid ledger schema');
				this.ledger = { ...parsed, consumed_jtis: parsed.consumed_jtis ?? {} };
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
		let failure: unknown;
		this.updates = this.updates.then(async () => {
			if (!this.writable) throw new Error('job ledger is unavailable');
			const next = structuredClone(this.ledger);
			mutator(next.jobs, next.consumed_jtis);
			try {
				await this.persist(next);
				this.ledger = next;
			} catch (error) {
				this.writable = false;
				failure = error;
				throw error;
			}
		});
		try {
			await this.updates;
		} catch (error) {
			throw failure ?? error;
		}
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
