import type { StorageGuard } from './DiskGuard.js';
import type { JobStore } from './JobStore.js';
import type { RendererBridge } from './RendererBridge.js';
import type { CommandClaims, JobRecord } from './types.js';

const TERMINAL_STATES = ['complete', 'partial', 'failed'] as const;
const MAX_ACKNOWLEDGED_TERMINAL_JOBS = 1_000;
const PROGRESS_QUEUE_TIMEOUT_MS = 5_000;
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
	| {
			status: 'rejected';
			reason: 'capacity' | 'storage' | 'policy' | 'invalid_job';
	  };

const unrestrictedStorage: StorageGuard = {
	ready: () => true,
	canReserve: () => true,
};

function sameCommand(job: JobRecord, command: CommandClaims): boolean {
	return (
		job.job === command.job &&
		job.site === command.site &&
		job.origin === command.origin &&
		job.room === command.room &&
		job.recording === command.recording &&
		job.limits.max_ends_at === command.limits.max_ends_at &&
		JSON.stringify(job.limits.output) ===
			JSON.stringify(command.limits.output) &&
		command.limits.budget_bytes <= job.limits.budget_bytes
	);
}

export class JobManager {
	private operations: Promise<void> = Promise.resolve();
	private recoveryRequired = false;
	private readonly terminalDeliveries = new Map<string, Promise<void>>();
	private readonly healthDeliveries = new Map<string, Promise<unknown>>();

	constructor(
		private readonly store: JobStore,
		private readonly bridge: RendererBridge,
		private readonly capacity: number,
		private readonly onTerminal?: (job: JobRecord) => Promise<void>,
		private readonly onInterrupted?: (job: JobRecord) => Promise<void>,
		private readonly sleep: (ms: number) => Promise<void> = (ms) =>
			new Promise((resolve) => setTimeout(resolve, ms)),
		private readonly onRecovered?: (job: JobRecord) => Promise<void>,
		private readonly storage: StorageGuard = unrestrictedStorage,
		private readonly onStartup?: (job: JobRecord) => Promise<void>,
		private readonly onReplacementReady?: (job: JobRecord) => Promise<void>,
		private readonly onProgress?: (
			job: JobRecord,
			capturedBytes: number,
		) => Promise<number>,
	) {
		this.bridge.onLifecycle(async (event) => {
			if (event.type === 'room_empty') return;
			if (event.type === 'replacement_ready') {
				await this.recordReplacementReady(event);
				return;
			}
			if (event.capturedBytes !== undefined)
				await this.recordTerminalProgress(event.job, event.capturedBytes);
			await this.recordLifecycle(
				event.job,
				event.generation,
				event.type,
				event.reason,
				event.artifact,
				event.gaps,
				event.occurredAt,
				event.interruption,
				event.recovery,
			);
		});
		this.bridge.onProgress?.((job, capturedBytes) =>
			this.recordProgress(job, capturedBytes),
		);
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
				if (outcome?.capturedBytes !== undefined)
					await this.recordTerminalProgress(job.job, outcome.capturedBytes);
				const type =
					job.state !== 'stopping' && outcome?.type === 'complete'
						? 'partial'
						: (outcome?.type ?? 'failed');
				await this.recordLifecycle(
					job.job,
					job.endpoint_generation,
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
			this.store.ready &&
			this.bridge.productionReady &&
			!this.recoveryRequired &&
			this.storage.ready()
		);
	}
	get activeCount(): number {
		return this.store.all().filter((job) => !terminal(job)).length;
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
			let requiredBytes = command.limits.budget_bytes * 2;
			for (const job of this.store.all().filter((job) => !terminal(job))) {
				const capturedBytes = job.captured_bytes ?? 0;
				const remaining = job.limits.budget_bytes * 2 - capturedBytes;
				if (!Number.isSafeInteger(remaining) || remaining < 0) {
					requiredBytes = Number.NaN;
					break;
				}
				requiredBytes += remaining;
			}
			if (
				!Number.isSafeInteger(requiredBytes) ||
				!this.storage.canReserve(requiredBytes)
			) {
				result = { status: 'rejected', reason: 'storage' };
				return;
			}
			const publicJwk = await this.bridge.reserve(command, 0);
			const job: JobRecord = {
				job: command.job,
				site: command.site,
				origin: command.origin,
				room: command.room,
				recording: command.recording,
				limits: command.limits,
				accepted_at: new Date().toISOString(),
				public_jwk: publicJwk,
				endpoint_generation: 0,
				state: 'reserved',
				event_sequence: 1,
				stop_operation_ids: [],
				captured_bytes: 0,
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

	async grant(
		command: CommandClaims,
		grant: string,
		generation: number,
	): Promise<boolean> {
		let acceptedAt: string | undefined;
		await this.serial(async () => {
			const job = this.query(command);
			if (
				!job ||
				job.endpoint_generation !== generation ||
				!['reserved', 'configured', 'interrupted'].includes(job.state)
			)
				return;
			acceptedAt = job.accepted_at;
		});
		if (!acceptedAt) return false;
		await this.bridge.deliverGrant(command.job, grant, acceptedAt, generation);
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
		if (invoke) {
			const job = this.store.get(command.job);
			await this.bridge.stop(
				command.job,
				job?.endpoint_generation,
				'host_stop',
			);
		}
		return found;
	}

	private async serial(operation: () => Promise<void>): Promise<void> {
		const current = this.operations.then(operation);
		this.operations = current.catch(() => undefined);
		await current;
	}

	private async recordProgress(
		jobId: string,
		capturedBytes: number,
	): Promise<number> {
		if (!Number.isSafeInteger(capturedBytes) || capturedBytes < 0)
			throw new Error('invalid captured byte count');
		return this.scheduleDelivery(
			jobId,
			async () => {
				let snapshot: JobRecord | undefined;
				let budget: number | undefined;
				await this.serial(async () => {
					const current = this.store.get(jobId);
					if (!current || terminal(current))
						throw new Error('recording job is not capturing');
					const previousCaptured = current.captured_bytes ?? 0;
					if (capturedBytes < previousCaptured)
						throw new Error('captured byte count decreased');
					if (capturedBytes === previousCaptured) {
						budget = current.limits.budget_bytes;
						return;
					}
					snapshot = structuredClone(current);
				});
				if (budget !== undefined) return budget;
				if (!snapshot || !this.onProgress)
					throw new Error('recording budget callback is unavailable');

				const returnedBudget = await this.onProgress(snapshot, capturedBytes);
				if (
					!Number.isSafeInteger(returnedBudget) ||
					returnedBudget < capturedBytes
				)
					throw new Error('invalid recording budget');

				await this.serial(async () => {
					const current = this.store.get(jobId);
					if (!current || terminal(current))
						throw new Error('recording job is not capturing');
					if ((current.captured_bytes ?? 0) !== (snapshot?.captured_bytes ?? 0))
						throw new Error('captured byte count changed');
					if (current.limits.budget_bytes !== snapshot?.limits.budget_bytes)
						throw new Error('recording budget changed');
					if (returnedBudget < current.limits.budget_bytes)
						throw new Error('invalid recording budget');
					let requiredBytes = 0;
					for (const job of this.store.all().filter((job) => !terminal(job))) {
						const budget =
							job.job === jobId ? returnedBudget : job.limits.budget_bytes;
						const captured =
							job.job === jobId ? capturedBytes : (job.captured_bytes ?? 0);
						const remaining = budget * 2 - captured;
						if (!Number.isSafeInteger(remaining) || remaining < 0) {
							requiredBytes = Number.NaN;
							break;
						}
						requiredBytes += remaining;
					}
					if (
						!Number.isSafeInteger(requiredBytes) ||
						!this.storage.canReserve(requiredBytes)
					)
						throw new Error('recording storage unavailable');
					await this.store.update((jobs) => {
						const record = jobs[jobId];
						if (!record) throw new Error('job disappeared');
						record.captured_bytes = capturedBytes;
						record.limits.budget_bytes = returnedBudget;
					});
					budget = returnedBudget;
				});
				if (budget === undefined)
					throw new Error('recording budget did not update');
				return budget;
			},
			PROGRESS_QUEUE_TIMEOUT_MS,
		);
	}

	private async recordTerminalProgress(
		jobId: string,
		capturedBytes: number,
	): Promise<void> {
		if (!Number.isSafeInteger(capturedBytes) || capturedBytes < 0)
			throw new Error('invalid captured byte count');
		await this.serial(async () => {
			const current = this.store.get(jobId);
			if (!current || terminal(current)) return;
			if (
				capturedBytes < (current.captured_bytes ?? 0) ||
				capturedBytes > current.limits.budget_bytes
			)
				throw new Error('invalid terminal captured byte count');
			await this.store.update((jobs) => {
				const record = jobs[jobId];
				if (!record) throw new Error('job disappeared');
				record.captured_bytes = capturedBytes;
			});
		});
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

	private scheduleHealth(
		job: JobRecord,
		callback: (job: JobRecord) => Promise<void>,
	): Promise<void> {
		return this.scheduleDelivery(job.job, () => callback(job));
	}

	private scheduleDelivery<T>(
		job: string,
		callback: () => Promise<T>,
		queueTimeoutMs?: number,
	): Promise<T> {
		const previous = this.healthDeliveries.get(job) ?? Promise.resolve();
		let cancelled = false;
		let started = false;
		let timer: NodeJS.Timeout | undefined;
		const delivery = previous
			.catch(() => undefined)
			.then(async () => {
				if (cancelled) return undefined;
				started = true;
				if (timer) clearTimeout(timer);
				return callback();
			})
			.finally(() => {
				if (this.healthDeliveries.get(job) === delivery)
					this.healthDeliveries.delete(job);
			});
		this.healthDeliveries.set(job, delivery);
		if (queueTimeoutMs === undefined) return delivery as Promise<T>;
		return new Promise<T>((resolve, reject) => {
			timer = setTimeout(() => {
				if (started) return;
				cancelled = true;
				reject(new Error('callback delivery queue timed out'));
			}, queueTimeoutMs);
			delivery.then(
				(value) => {
					if (!cancelled) resolve(value as T);
				},
				(error: unknown) => {
					if (!cancelled) reject(error);
				},
			);
		});
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
		generation: number,
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
		occurredAt = new Date().toISOString(),
		interruption?: {
			id: string;
			detected_at: string;
			deadline: string;
			omission_started_at: string;
			reason: string;
		},
		recovery?: {
			id: string;
			capture_started_at: string;
			recovered_at: string;
		},
	): Promise<void> {
		let cleanup = false;
		let healthDelivery: Promise<void> | undefined;
		await this.serial(async () => {
			const current = this.store.get(job);
			if (current?.endpoint_generation !== generation) return;
			if (!current || !ACTIVE_TRANSITIONS[current.state].includes(type)) return;
			const recovered =
				current.state === 'interrupted' && type === 'capture_ready';
			const startupMilestone =
				['configured', 'proof_complete', 'joined', 'capture_ready'].includes(
					type,
				) && !recovered;
			await this.store.update((jobs) => {
				const record = jobs[job];
				if (!record) return;
				if (type === 'interrupted' || recovered || startupMilestone)
					record.event_sequence = (record.event_sequence ?? 1) + 1;
				record.state = type;
				if (type === 'configured') record.configured_at = occurredAt;
				if (type === 'proof_complete') record.proof_completed_at = occurredAt;
				if (type === 'joined') record.joined_at = occurredAt;
				if (type === 'capture_ready' && !recovered)
					record.capture_started_at = occurredAt;
				if (type === 'interrupted' && interruption) {
					record.interruption_id = interruption.id;
					record.interrupted_at = interruption.detected_at;
					record.interruption_deadline = interruption.deadline;
					record.omission_started_at = interruption.omission_started_at;
					delete record.resumed_capture_started_at;
					delete record.recovered_at;
					delete record.replacement_ready_at;
				}
				if (recovered && recovery) {
					record.resumed_capture_started_at = recovery.capture_started_at;
					record.recovered_at = recovery.recovered_at;
				}
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
			const updated = this.store.get(job);
			if (updated?.state === 'interrupted' && this.onInterrupted)
				healthDelivery = this.scheduleHealth(
					{ ...updated },
					this.onInterrupted,
				);
			if (recovered && updated?.state === 'capture_ready' && this.onRecovered)
				healthDelivery = this.scheduleHealth({ ...updated }, this.onRecovered);
			if (startupMilestone && updated && this.onStartup)
				healthDelivery = this.scheduleHealth({ ...updated }, this.onStartup);
		});
		await healthDelivery;
		if (cleanup) await this.bridge.stop(job, generation);
		const terminal = this.store.get(job);
		if (
			terminal &&
			TERMINAL_STATES.includes(
				terminal.state as (typeof TERMINAL_STATES)[number],
			)
		)
			this.scheduleTerminal(terminal);
	}

	private async recordReplacementReady(
		event: import('./RendererBridge.js').RendererLifecycleEvent,
	): Promise<void> {
		if (
			!event.publicJwk ||
			!event.readyAt ||
			!event.interruptionId ||
			event.generation <= 0
		)
			throw new Error('replacement readiness metadata is unavailable');
		const publicJwk = event.publicJwk;
		const readyAt = event.readyAt;
		let delivery: Promise<void> | undefined;
		await this.serial(async () => {
			const current = this.store.get(event.job);
			if (
				current?.state !== 'interrupted' ||
				current.interruption_id !== event.interruptionId ||
				event.generation <= current.endpoint_generation
			)
				throw new Error('stale renderer replacement');
			await this.store.update((jobs) => {
				const record = jobs[event.job];
				if (!record) throw new Error('job disappeared');
				record.endpoint_generation = event.generation;
				record.public_jwk = publicJwk;
				record.replacement_ready_at = readyAt;
				record.event_sequence = (record.event_sequence ?? 1) + 1;
			});
			const updated = this.store.get(event.job);
			if (updated && this.onReplacementReady)
				delivery = this.scheduleHealth({ ...updated }, this.onReplacementReady);
		});
		await delivery;
	}
}
