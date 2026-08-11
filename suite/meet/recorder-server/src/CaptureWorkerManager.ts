import { CaptureWorker, type CaptureWorkerOptions } from './CaptureWorker.js';
import type { CaptureArtifact, CaptureGap } from './captureTypes.js';
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
	| 'stop'
	| 'recoverStopped'
	| 'captureResult'
>;

export interface CaptureWorkerManagerOptions
	extends Omit<CaptureWorkerOptions, 'display' | 'limits' | 'onStopRequested'> {
	maxConcurrent: number;
}

export class CaptureWorkerManager implements RendererBridge {
	private readonly workers = new Map<string, Worker>();
	private readonly operations = new Map<string, Promise<void>>();
	private readonly stopping = new Map<string, Promise<void>>();
	private handler: (event: RendererLifecycleEvent) => Promise<void> =
		async () => undefined;
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
		return this.workers.has(job) && this.renderer.hasWorker(job);
	}
	onLifecycle(handler: (event: RendererLifecycleEvent) => Promise<void>): void {
		this.handler = handler;
	}
	workerEnvironment(job: string): NodeJS.ProcessEnv | undefined {
		return this.workers.get(job)?.env;
	}
	async reserve(command: CommandClaims): Promise<PublicJwk> {
		if (this.workers.has(command.job))
			throw new Error('capture worker already exists');
		if (this.workers.size >= this.options.maxConcurrent)
			throw new Error('recording capacity unavailable');
		const worker = this.createWorker(command.job, {
			...this.options,
			display: this.nextDisplay++,
			limits: command.limits,
			onStopRequested: (partial, reason) => {
				void this.enqueue(command.job, () =>
					this.stopWorker(command.job, partial, reason),
				);
			},
		});
		// Claim capacity before asynchronous initialization so concurrent reserves cannot overbook.
		this.workers.set(command.job, worker);
		try {
			await worker.initialize();
			return await this.renderer.reserve(command);
		} catch (error) {
			this.workers.delete(command.job);
			await Promise.allSettled([
				this.renderer.stop(command.job),
				worker.stop(true, 'reserve_failed'),
			]);
			throw error;
		}
	}
	deliverGrant(job: string, grant: string, acceptedAt: string): Promise<void> {
		return this.renderer.deliverGrant(job, grant, acceptedAt);
	}
	stop(job: string): Promise<void> {
		const existing = this.stopping.get(job);
		if (existing) return existing;
		const promise = this.enqueue(job, () => this.stopWorker(job, false));
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
		};
	}
	async close(): Promise<void> {
		await Promise.all([...this.workers.keys()].map((job) => this.stop(job)));
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
		const worker = this.workers.get(job);
		if (!worker) return;
		let outcome: 'complete' | 'partial' | 'failed' = 'failed';
		let rendererError: unknown;
		try {
			await this.renderer.stop(job).catch((error: unknown) => {
				rendererError = error;
			});
			outcome = await worker.stop(partial, reason);
		} finally {
			this.workers.delete(job);
			await this.renderer.stop(job).catch(() => undefined);
		}
		if (rendererError) throw rendererError;
		const result = worker.captureResult();
		await this.handler({
			job,
			type: outcome,
			...(reason ? { reason } : {}),
			...(result.artifact ? { artifact: result.artifact } : {}),
			gaps: result.gaps,
			...(outcome === 'partial' && !reason
				? { reason: reason ?? 'capture_interrupted' }
				: {}),
		});
	}
	private async lifecycle(event: RendererLifecycleEvent): Promise<void> {
		const worker = this.workers.get(event.job);
		if (event.type === 'capture_ready') await worker?.startCapture();
		if (event.type === 'room_empty') {
			await this.stopWorker(event.job, false, 'room_empty');
			return;
		}
		if ((event.type === 'failed' || event.type === 'interrupted') && worker) {
			if (event.type === 'interrupted') await this.handler(event);
			let outcome: 'complete' | 'partial' | 'failed' = 'failed';
			try {
				const recovery = worker.rendererFailed(event.reason ?? event.type);
				await this.renderer.stop(event.job).catch(() => undefined);
				outcome = await recovery;
			} finally {
				this.workers.delete(event.job);
				await this.renderer.stop(event.job).catch(() => undefined);
			}
			const result = worker.captureResult();
			await this.handler({
				job: event.job,
				type: outcome,
				reason: 'operator_recovery_required',
				...(result.artifact ? { artifact: result.artifact } : {}),
				gaps: result.gaps,
			});
			return;
		}
		await this.handler(event);
	}
}
