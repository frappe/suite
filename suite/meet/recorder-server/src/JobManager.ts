import type { JobStore } from './JobStore.js';
import type { RendererBridge } from './RendererBridge.js';
import type { CommandClaims, JobRecord } from './types.js';

const TERMINAL_STATES = ['complete', 'partial', 'failed'] as const;
const MAX_ACKNOWLEDGED_TERMINAL_JOBS = 1_000;
const ACTIVE_TRANSITIONS: Record<JobRecord['state'], JobRecord['state'][]> = {
	reserved: ['configured', 'complete', 'partial', 'failed', 'stopping'],
	configured: ['proof_complete', 'complete', 'partial', 'failed', 'stopping'],
	proof_complete: ['joined', 'complete', 'partial', 'failed', 'stopping'],
	joined: ['capture_ready', 'complete', 'partial', 'failed', 'stopping'],
	capture_ready: ['interrupted', 'complete', 'partial', 'failed', 'stopping'],
	interrupted: ['capture_ready', 'complete', 'partial', 'failed', 'stopping'],
	stopping: ['complete', 'partial', 'failed'],
	recovery_required: [],
	complete: [],
	partial: [],
	failed: [],
};

function terminal(job: JobRecord): boolean {
	return TERMINAL_STATES.includes(
		job.state as (typeof TERMINAL_STATES)[number],
	);
}

export type ReserveResult =
	| { status: 'accepted'; job: JobRecord }
	| { status: 'rejected'; reason: 'capacity' | 'policy' | 'invalid_job' };

function sameCommand(job: JobRecord, command: CommandClaims): boolean {
	return (
		job.job === command.job &&
		job.site === command.site &&
		job.origin === command.origin &&
		job.room === command.room &&
		job.recording === command.recording &&
		JSON.stringify(job.limits) === JSON.stringify(command.limits)
	);
}

export class JobManager {
	private operations: Promise<void> = Promise.resolve();
	private recoveryRequired = false;
	private readonly terminalDeliveries = new Map<string, Promise<void>>();

	constructor(
		private readonly store: JobStore,
		private readonly bridge: RendererBridge,
		private readonly capacity: number,
		private readonly onTerminal?: (job: JobRecord) => Promise<void>,
		private readonly onInterrupted?: (job: JobRecord) => Promise<void>,
		private readonly sleep: (ms: number) => Promise<void> = (ms) =>
			new Promise((resolve) => setTimeout(resolve, ms)),
	) {
		this.bridge.onLifecycle(async (event) => {
			if (event.type === 'room_empty') return;
			await this.recordLifecycle(
				event.job,
				event.type,
				event.reason,
				event.artifact,
				event.gaps,
			);
		});
	}

	async initialize(): Promise<void> {
		const terminalAtStartup = this.store.all().filter((job) => terminal(job));
		for (const job of this.store
			.all()
			.filter(
				(record) => !terminal(record) && !this.bridge.hasWorker(record.job),
			)) {
			try {
				const outcome = await this.bridge.recoverStopping?.(job.job);
				const type =
					job.state !== 'stopping' && outcome?.type === 'complete'
						? 'partial'
						: (outcome?.type ?? 'failed');
				await this.recordLifecycle(
					job.job,
					type,
					'worker_missing_after_restart',
					outcome?.artifact,
					outcome?.gaps,
				);
			} catch {
				// The persisted job is marked recovery-required below.
			}
		}
		const orphaned = this.store
			.all()
			.filter((job) => !terminal(job) && !this.bridge.hasWorker(job.job));
		if (orphaned.length) {
			this.recoveryRequired = true;
			await this.store.update((jobs) => {
				for (const job of orphaned) {
					const current = jobs[job.job];
					if (!current) throw new Error('job disappeared');
					current.state = 'recovery_required';
					current.health_reason = 'worker_missing_after_restart';
				}
			});
		}
		for (const job of terminalAtStartup) this.scheduleTerminal(job);
	}

	get ready(): boolean {
		return (
			this.store.ready && this.bridge.productionReady && !this.recoveryRequired
		);
	}
	get activeCount(): number {
		return this.store
			.all()
			.filter((job) => !terminal(job) && job.state !== 'stopping').length;
	}

	async reserve(command: CommandClaims): Promise<ReserveResult> {
		let result: ReserveResult | undefined;
		await this.serial(async () => {
			const existing = this.store.get(command.job);
			if (existing) {
				result =
					sameCommand(existing, command) &&
					existing.state !== 'recovery_required' &&
					(terminal(existing) || this.bridge.hasWorker(existing.job))
						? { status: 'accepted', job: existing }
						: { status: 'rejected', reason: 'invalid_job' };
				return;
			}
			if (this.activeCount >= this.capacity) {
				result = { status: 'rejected', reason: 'capacity' };
				return;
			}
			const publicJwk = await this.bridge.reserve(command);
			const job: JobRecord = {
				job: command.job,
				site: command.site,
				origin: command.origin,
				room: command.room,
				recording: command.recording,
				limits: command.limits,
				accepted_at: new Date().toISOString(),
				public_jwk: publicJwk,
				state: 'reserved',
				stop_operation_ids: [],
			};
			try {
				await this.store.update((jobs) => {
					jobs[job.job] = job;
				});
			} catch (error) {
				await this.bridge.stop(job.job);
				throw error;
			}
			result = { status: 'accepted', job };
		});
		if (!result) throw new Error('reservation did not complete');
		return result;
	}

	query(command: CommandClaims): JobRecord | undefined {
		const job = this.store.get(command.job);
		return job &&
			job.state !== 'recovery_required' &&
			(terminal(job) ||
				job.state === 'stopping' ||
				this.bridge.hasWorker(job.job)) &&
			sameCommand(job, command)
			? job
			: undefined;
	}

	async grant(command: CommandClaims, grant: string): Promise<boolean> {
		let acceptedAt: string | undefined;
		await this.serial(async () => {
			const job = this.query(command);
			if (!job || !['reserved', 'configured'].includes(job.state)) return;
			acceptedAt = job.accepted_at;
		});
		if (!acceptedAt) return false;
		await this.bridge.deliverGrant(command.job, grant, acceptedAt);
		return true;
	}

	async stop(command: CommandClaims, operationId: string): Promise<boolean> {
		let found = false;
		let invoke = false;
		await this.serial(async () => {
			const job = this.query(command);
			if (!job) return;
			found = true;
			if (terminal(job)) return;
			if (job.stop_operation_ids.includes(operationId)) return;
			await this.store.update((jobs) => {
				const current = jobs[job.job];
				if (!current) throw new Error('job disappeared');
				current.state = 'stopping';
				current.stop_operation_ids.push(operationId);
			});
			invoke = true;
		});
		if (invoke) await this.bridge.stop(command.job);
		return found;
	}

	private async serial(operation: () => Promise<void>): Promise<void> {
		const current = this.operations.then(operation);
		this.operations = current.catch(() => undefined);
		await current;
	}

	private scheduleTerminal(job: JobRecord): void {
		if (
			!this.onTerminal ||
			job.callback_completed_at ||
			this.terminalDeliveries.has(job.job)
		)
			return;
		const delivery = this.deliverTerminal(job.job).finally(() => {
			this.terminalDeliveries.delete(job.job);
		});
		this.terminalDeliveries.set(job.job, delivery);
	}

	private async deliverTerminal(jobId: string): Promise<void> {
		let delay = 1_000;
		while (this.onTerminal) {
			const job = this.store.get(jobId);
			if (!job || !terminal(job) || job.callback_completed_at) return;
			try {
				await this.onTerminal(job);
				await this.store.update((jobs) => {
					const current = jobs[jobId];
					if (!current || !terminal(current)) return;
					current.callback_completed_at ??= new Date().toISOString();
					const acknowledged = Object.values(jobs)
						.filter((record) => record.callback_completed_at)
						.sort((a, b) =>
							(b.callback_completed_at ?? '').localeCompare(
								a.callback_completed_at ?? '',
							),
						);
					for (const expired of acknowledged.slice(
						MAX_ACKNOWLEDGED_TERMINAL_JOBS,
					))
						delete jobs[expired.job];
				});
				return;
			} catch {
				await this.sleep(delay);
				delay = Math.min(delay * 2, 60_000);
			}
		}
	}

	private async recordLifecycle(
		job: string,
		type:
			| 'configured'
			| 'proof_complete'
			| 'joined'
			| 'capture_ready'
			| 'interrupted'
			| 'failed'
			| 'complete'
			| 'partial',
		reason?: string,
		artifact?: {
			file: string;
			bytes: number;
			sha256: string;
			duration_ms: number;
		},
		gaps?: Array<{ started_at: string; ended_at?: string; reason: string }>,
	): Promise<void> {
		let cleanup = false;
		await this.serial(async () => {
			const current = this.store.get(job);
			if (!current || !ACTIVE_TRANSITIONS[current.state].includes(type)) return;
			await this.store.update((jobs) => {
				const record = jobs[job];
				if (!record) return;
				record.state = type;
				if (type === 'complete' || type === 'partial')
					record.artifact = {
						state: type,
						path: artifact?.file ?? 'recording.mp4',
						...(artifact
							? {
									bytes: artifact.bytes,
									sha256: artifact.sha256,
									duration_ms: artifact.duration_ms,
									gaps: gaps ?? [],
								}
							: {}),
					};
				if (reason) record.health_reason = reason.slice(0, 256);
				else delete record.health_reason;
				if (TERMINAL_STATES.includes(type as (typeof TERMINAL_STATES)[number]))
					record.terminal_at ??= new Date().toISOString();
			});
			cleanup = type === 'failed';
		});
		if (cleanup) await this.bridge.stop(job);
		const terminal = this.store.get(job);
		if (terminal?.state === 'interrupted') await this.onInterrupted?.(terminal);
		if (
			terminal &&
			TERMINAL_STATES.includes(
				terminal.state as (typeof TERMINAL_STATES)[number],
			)
		)
			this.scheduleTerminal(terminal);
	}
}
