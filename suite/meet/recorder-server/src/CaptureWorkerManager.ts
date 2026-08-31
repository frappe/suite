import { CaptureWorker, type CaptureWorkerOptions } from './CaptureWorker.js';
import type {
	CaptureArtifact,
	CaptureGap,
	CaptureInterruption,
} from './captureTypes.js';
import type {
	RendererBridge,
	RendererLifecycleEvent,
} from './RendererBridge.js';
import type { CommandClaims, PublicJwk } from './types.js';

type Worker = Pick<
	CaptureWorker,
	| 'env'
	| 'initialize'
	| 'startCapture'
	| 'rendererFailed'
	| 'recoverRenderer'
	| 'stop'
	| 'recoverStopped'
	| 'captureResult'
>;

interface ManagedWorker {
	worker: Worker;
	command: CommandClaims;
	generation: number;
	active: boolean;
	interruption?: CaptureInterruption;
	replacement?: Promise<void>;
	captureStop?: Promise<'complete' | 'partial' | 'failed'>;
	deadlineTimer?: NodeJS.Timeout;
}

export interface CaptureWorkerManagerOptions
	extends Omit<CaptureWorkerOptions, 'display' | 'limits' | 'onStopRequested'> {
	maxConcurrent: number;
}

export class CaptureWorkerManager implements RendererBridge {
	private readonly workers = new Map<string, ManagedWorker>();
	private readonly operations = new Map<string, Promise<void>>();
	private readonly stopping = new Map<string, Promise<void>>();
	private handler: (event: RendererLifecycleEvent) => Promise<void> =
		async () => undefined;
	private progressHandler?: (
		job: string,
		capturedBytes: number,
	) => Promise<number>;
	private nextDisplay = 100;
	constructor(
		private readonly renderer: RendererBridge,
		private readonly options: CaptureWorkerManagerOptions,
		private readonly createWorker: (
			job: string,
			options: CaptureWorkerOptions,
		) => Worker = (job, options) => new CaptureWorker(job, options),
	) {
		renderer.onLifecycle((event) =>
			this.enqueue(event.job, () => this.lifecycle(event)),
		);
	}
	get productionReady(): boolean {
		return this.renderer.productionReady;
	}
	hasWorker(job: string): boolean {
		return this.workers.has(job);
	}
	onLifecycle(handler: (event: RendererLifecycleEvent) => Promise<void>): void {
		this.handler = handler;
	}
	onProgress(
		handler: (job: string, capturedBytes: number) => Promise<number>,
	): void {
		this.progressHandler = handler;
	}
	workerEnvironment(job: string): NodeJS.ProcessEnv | undefined {
		return this.workers.get(job)?.worker.env;
	}
	async reserve(command: CommandClaims, generation = 0): Promise<PublicJwk> {
		if (this.workers.has(command.job))
			throw new Error('capture worker already exists');
		if (this.workers.size >= this.options.maxConcurrent)
			throw new Error('recording capacity unavailable');
		let managed!: ManagedWorker;
		const worker = this.createWorker(command.job, {
			...this.options,
			display: this.nextDisplay++,
			limits: command.limits,
			onProgress: async (capturedBytes) => {
				if (!this.progressHandler)
					throw new Error('recording budget callback is unavailable');
				return this.progressHandler(command.job, capturedBytes);
			},
			onInterrupted: (interruption) => {
				managed.interruption ??= interruption;
				this.armDeadline(managed);
				void this.handler({
					job: command.job,
					generation: managed.generation,
					type: 'interrupted',
					reason: interruption.reason,
					interruption,
				}).catch(() => undefined);
			},
			onRecovered: (recovery) => {
				if (managed.deadlineTimer) clearTimeout(managed.deadlineTimer);
				delete managed.deadlineTimer;
				delete managed.interruption;
				void this.handler({
					job: command.job,
					generation: managed.generation,
					type: 'capture_ready',
					recovery,
				});
			},
			onStopRequested: (partial, reason) => {
				managed.captureStop ??= worker.stop(partial, reason);
				void this.enqueue(command.job, async () => {
					await this.stopWorker(command.job, partial, reason);
				});
			},
		});
		// Claim capacity before asynchronous initialization so concurrent reserves cannot overbook.
		managed = { worker, command, generation, active: false };
		this.workers.set(command.job, managed);
		try {
			await worker.initialize();
			return await this.renderer.reserve(command, generation);
		} catch (error) {
			this.workers.delete(command.job);
			await Promise.allSettled([
				this.renderer.stop(command.job, generation),
				worker.stop(true, 'reserve_failed'),
			]);
			throw error;
		}
	}
	deliverGrant(
		job: string,
		grant: string,
		acceptedAt: string,
		generation: number,
	): Promise<void> {
		const managed = this.workers.get(job);
		if (!managed || managed.generation !== generation)
			return Promise.reject(new Error('capture generation is unavailable'));
		return this.renderer.deliverGrant(job, grant, acceptedAt, generation);
	}
	stop(job: string, _generation?: number, reason?: string): Promise<void> {
		const existing = this.stopping.get(job);
		if (existing) return existing;
		const promise = this.enqueue(job, () =>
			this.stopWorker(job, false, reason),
		);
		this.stopping.set(job, promise);
		void promise.then(
			() => this.stopping.delete(job),
			() => this.stopping.delete(job),
		);
		return promise;
	}
	async recoverStopping(job: string): Promise<{
		type: 'complete' | 'partial' | 'failed';
		artifact?: CaptureArtifact;
		gaps: CaptureGap[];
		capturedBytes: number;
	}> {
		const worker = this.createWorker(job, {
			...this.options,
			display: this.nextDisplay++,
		});
		const type = await worker.recoverStopped();
		const result = worker.captureResult();
		return {
			type,
			...(result.artifact ? { artifact: result.artifact } : {}),
			gaps: result.gaps,
			capturedBytes: result.capturedBytes,
		};
	}
	async close(): Promise<void> {
		await Promise.all(
			[...this.workers.keys()].map((job) =>
				this.enqueue(job, () => this.stopWorker(job, true, 'service_shutdown')),
			),
		);
		await this.renderer.close?.();
	}
	private enqueue(job: string, operation: () => Promise<void>): Promise<void> {
		const previous = this.operations.get(job) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(operation);
		this.operations.set(job, next);
		const cleanup = () => {
			if (this.operations.get(job) === next) this.operations.delete(job);
		};
		void next.then(cleanup, cleanup);
		return next;
	}
	private async stopWorker(
		job: string,
		partial: boolean,
		reason?: string,
	): Promise<void> {
		const managed = this.workers.get(job);
		if (!managed) return;
		const { worker } = managed;
		if (managed.deadlineTimer) clearTimeout(managed.deadlineTimer);
		let outcome: 'complete' | 'partial' | 'failed' = 'failed';
		let rendererError: unknown;
		try {
			await this.renderer
				.stop(job, managed.generation)
				.catch((error: unknown) => {
					rendererError = error;
				});
			outcome = await (managed.captureStop ?? worker.stop(partial, reason));
		} finally {
			this.workers.delete(job);
			await this.renderer.stop(job, managed.generation).catch(() => undefined);
		}
		if (rendererError) throw rendererError;
		const result = worker.captureResult();
		await this.handler({
			job,
			generation: managed.generation,
			type: outcome,
			...(reason ? { reason } : {}),
			...(result.artifact ? { artifact: result.artifact } : {}),
			gaps: result.gaps,
			capturedBytes: result.capturedBytes,
			...(outcome === 'partial' && !reason
				? { reason: reason ?? 'capture_interrupted' }
				: {}),
		});
	}
	private async lifecycle(event: RendererLifecycleEvent): Promise<void> {
		const managed = this.workers.get(event.job);
		if (!managed || event.generation !== managed.generation) return;
		const { worker } = managed;
		if (event.type === 'capture_ready') {
			if (managed.active) {
				worker.recoverRenderer();
				return;
			}
			await worker.startCapture();
			managed.active = true;
			event = { ...event, occurredAt: new Date().toISOString() };
		}
		if (event.type === 'room_empty') {
			await this.stopWorker(event.job, false, 'room_empty');
			return;
		}
		if (event.type === 'failed' || event.type === 'interrupted') {
			if (!managed.active) {
				await this.stopWorker(event.job, false, event.reason ?? event.type);
				return;
			}
			await worker.rendererFailed(event.reason ?? event.type);
			await this.renderer
				.stop(event.job, event.generation)
				.catch(() => undefined);
			this.startReplacement(managed);
			return;
		}
		if (
			managed.active &&
			['configured', 'proof_complete', 'joined'].includes(event.type)
		)
			return;
		await this.handler(event);
	}

	private armDeadline(managed: ManagedWorker): void {
		if (managed.deadlineTimer || !managed.interruption) return;
		const interruption = managed.interruption;
		managed.deadlineTimer = setTimeout(
			() => {
				void this.enqueue(managed.command.job, async () => {
					if (
						this.workers.get(managed.command.job) !== managed ||
						managed.interruption !== interruption
					)
						return;
					await this.stopWorker(
						managed.command.job,
						true,
						'renderer_recovery_timeout',
					);
				});
			},
			Math.max(0, Date.parse(interruption.deadline) - Date.now()),
		);
	}

	private startReplacement(managed: ManagedWorker): void {
		if (managed.replacement || !managed.interruption) return;
		managed.replacement = this.replaceRenderer(managed).finally(() => {
			delete managed.replacement;
			if (
				this.workers.get(managed.command.job) === managed &&
				managed.interruption &&
				Date.now() < Date.parse(managed.interruption.deadline) &&
				!this.renderer.hasWorker(managed.command.job)
			)
				this.startReplacement(managed);
		});
	}

	private async replaceRenderer(managed: ManagedWorker): Promise<void> {
		let backoff = 250;
		while (
			this.workers.get(managed.command.job) === managed &&
			managed.interruption &&
			Date.now() < Date.parse(managed.interruption.deadline)
		) {
			const interruption = managed.interruption;
			const generation = managed.generation + 1;
			try {
				const publicJwk = await this.renderer.reserve(
					managed.command,
					generation,
				);
				if (
					this.workers.get(managed.command.job) !== managed ||
					managed.interruption !== interruption ||
					Date.now() >= Date.parse(interruption.deadline)
				) {
					await this.renderer
						.stop(managed.command.job, generation)
						.catch(() => undefined);
					return;
				}
				managed.generation = generation;
				await this.handler({
					job: managed.command.job,
					generation,
					type: 'replacement_ready',
					publicJwk,
					readyAt: new Date().toISOString(),
					interruptionId: interruption.id,
				});
				if (
					this.workers.get(managed.command.job) !== managed ||
					managed.interruption !== interruption ||
					!this.renderer.hasWorker(managed.command.job)
				)
					continue;
				return;
			} catch {
				await this.renderer
					.stop(managed.command.job, generation)
					.catch(() => undefined);
				const remaining = managed.interruption
					? Date.parse(managed.interruption.deadline) - Date.now()
					: 0;
				if (remaining > 0)
					await new Promise((resolve) =>
						setTimeout(resolve, Math.min(backoff, remaining)),
					);
				backoff = Math.min(backoff * 2, 5_000);
			}
		}
	}
}
