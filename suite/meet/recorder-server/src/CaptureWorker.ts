import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	CaptureEpoch,
	CaptureInterruption,
	CaptureRecovery,
	CaptureSegment,
	CaptureState,
	MediaTools,
} from './captureTypes.js';
import { FfmpegMediaTools, Finalizer } from './Finalizer.js';
import { ManifestStore } from './ManifestStore.js';
import { type ManagedProcess, ProcessSupervisor } from './ProcessSupervisor.js';
import { SegmentWatcher } from './SegmentWatcher.js';
import type { RecordingLimits } from './types.js';

type Outcome = Extract<CaptureState, 'complete' | 'partial' | 'failed'>;
type Watcher = Pick<SegmentWatcher, 'start' | 'stopAndAdoptFinal'>;

export interface CaptureWorkerOptions {
	dataRoot: string;
	display: number;
	segmentSeconds: number;
	ffmpeg: string;
	xvfb: string;
	pulseaudio: string;
	pactl: string;
	gracefulTimeoutMs: number;
	recoveryTimeoutMs: number;
	limits?: RecordingLimits;
	onStopRequested?: (partial: boolean, reason: string) => void;
	onInterrupted?: (interruption: CaptureInterruption) => void;
	onRecovered?: (recovery: CaptureRecovery) => void;
	onProgress?: (capturedBytes: number) => Promise<number>;
	onCapturePreparing?: (epoch: number) => Promise<void>;
	onCaptureCommitted?: (launch: CaptureEpoch) => Promise<void>;
	onCaptureLaunched?: (launch: CaptureEpoch) => Promise<void>;
	onCaptureAborted?: (epoch: number) => Promise<void>;
}

export interface CaptureWorkerDependencies {
	supervisor?: ProcessSupervisor;
	tools?: MediaTools & { concat(list: string, output: string): Promise<void> };
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	watcher?: (
		manifest: ManifestStore,
		tools: MediaTools,
		epoch: number,
		onAdopt: (segment: CaptureSegment) => void | Promise<void>,
		onCandidateError: (file: string, error: unknown) => void | Promise<void>,
	) => Watcher;
	finalizer?: (manifest: ManifestStore) => Pick<Finalizer, 'finalize'>;
}

export class CaptureWorker {
	readonly manifest: ManifestStore;
	readonly env: NodeJS.ProcessEnv;
	private readonly supervisor: ProcessSupervisor;
	private readonly tools: MediaTools & {
		concat(list: string, output: string): Promise<void>;
	};
	private readonly now: () => number;
	private readonly sleep: (ms: number) => Promise<void>;
	private services: ManagedProcess[] = [];
	private ffmpeg: ManagedProcess | undefined;
	private watcher: Watcher | undefined;
	private epoch = 0;
	private partial = false;
	private stopPromise?: Promise<Outcome>;
	private recoveryPromise: Promise<void> | undefined;
	private interruption: CaptureInterruption | undefined;
	private rendererUnavailable = false;
	private captureFailed = false;
	private captureLaunchedAt?: string;
	private limitTimer?: NodeJS.Timeout;
	private interruptionTimer?: NodeJS.Timeout;
	private healthyEpoch?: {
		epoch: number;
		resolve: (adoptedAt: string) => void;
		reject: (error: Error) => void;
		promise: Promise<string>;
	};
	private launchPromise: Promise<CaptureEpoch | undefined> | undefined;
	private initializePromise: Promise<void> | undefined;
	private initialStartupPublication: Promise<void> | undefined;
	private stopping = false;

	constructor(
		readonly job: string,
		private readonly options: CaptureWorkerOptions,
		dependencies: CaptureWorkerDependencies | ProcessSupervisor = {},
	) {
		const injected =
			dependencies instanceof ProcessSupervisor
				? { supervisor: dependencies }
				: dependencies;
		this.supervisor = injected.supervisor ?? new ProcessSupervisor();
		this.tools =
			injected.tools ??
			new FfmpegMediaTools(
				options.ffmpeg,
				'ffprobe',
				options.segmentSeconds * 1000,
			);
		this.now = injected.now ?? Date.now;
		this.sleep =
			injected.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.manifest = new ManifestStore(options.dataRoot, job);
		this.makeWatcher =
			injected.watcher ??
			((manifest, tools, epoch, onAdopt, onCandidateError) =>
				new SegmentWatcher(
					manifest,
					tools,
					epoch,
					250,
					onAdopt,
					onCandidateError,
				));
		this.makeFinalizer =
			injected.finalizer ?? ((manifest) => new Finalizer(manifest, this.tools));
		const runtime = join(this.manifest.directory, 'pulse');
		const display = `:${options.display}`;
		this.env = {
			...process.env,
			DISPLAY: display,
			PULSE_SERVER: `unix:${runtime}/native`,
			PULSE_RUNTIME_PATH: runtime,
			XDG_RUNTIME_DIR: runtime,
		};
	}

	private readonly makeWatcher: NonNullable<
		CaptureWorkerDependencies['watcher']
	>;
	private readonly makeFinalizer: NonNullable<
		CaptureWorkerDependencies['finalizer']
	>;

	initialize(): Promise<void> {
		this.initializePromise ??= this.initializeWorker();
		return this.initializePromise;
	}

	private async initializeWorker(): Promise<void> {
		const manifest = await this.manifest.initialize();
		this.epoch = manifest.epochs;
		await mkdir(join(this.manifest.directory, 'pulse'), {
			recursive: true,
			mode: 0o700,
		});
		try {
			this.services.push(
				await this.startService(
					this.options.xvfb,
					[
						String(this.env.DISPLAY),
						'-screen',
						'0',
						'1920x1080x24',
						'-nolisten',
						'tcp',
						'-ac',
					],
					'xvfb',
					'xvfb_exited',
				),
			);
			this.services.push(
				await this.startService(
					this.options.pulseaudio,
					['--daemonize=no', '--exit-idle-time=-1', '--log-target=stderr'],
					'pulse',
					'pulseaudio_exited',
				),
			);
			await this.assertServicesReady();
			await this.waitForPulse();
			const setup = await this.supervisor.start(
				this.options.pactl,
				[
					'load-module',
					'module-null-sink',
					'sink_name=recorder',
					'rate=48000',
					'channels=2',
				],
				{
					env: this.env,
					logPath: join(this.manifest.directory, 'logs/pactl.log'),
				},
			);
			const result = await setup.exited;
			if (result.code !== 0)
				throw new Error(`pactl setup exited ${result.code}`);
		} catch (error) {
			await Promise.allSettled(
				this.services.map((process) =>
					process.stop(this.options.gracefulTimeoutMs),
				),
			);
			this.services = [];
			throw error;
		}
	}

	startCapture(): Promise<CaptureEpoch | undefined> {
		if (this.launchPromise) return this.launchPromise;
		const launch = this.launchCapture().finally(() => {
			if (this.launchPromise === launch) this.launchPromise = undefined;
		});
		this.launchPromise = launch;
		return launch;
	}

	private async launchCapture(): Promise<CaptureEpoch | undefined> {
		if (this.ffmpeg || this.stopping) return;
		if (this.limitReached()) {
			this.requestStop(false, 'capture_limit_reached');
			return;
		}
		const epoch = this.epoch;
		let prepareAttempted = false;
		let process: ManagedProcess | undefined;
		try {
			prepareAttempted = true;
			await this.options.onCapturePreparing?.(epoch);
			if (this.stopping) throw new Error('capture launch stopped');
			await this.manifest.update((m) => {
				m.epochs = epoch + 1;
			});
			this.epoch = epoch + 1;
		} catch (error) {
			if (prepareAttempted)
				await this.options.onCaptureAborted?.(epoch).catch(() => undefined);
			throw error;
		}
		this.captureFailed = false;
		let resolveHealth!: (adoptedAt: string) => void;
		let rejectHealth!: (error: Error) => void;
		const health = new Promise<string>((resolve, reject) => {
			resolveHealth = resolve;
			rejectHealth = reject;
		});
		this.healthyEpoch = {
			epoch,
			resolve: resolveHealth,
			reject: rejectHealth,
			promise: health,
		};
		const watcher = this.makeWatcher(
			this.manifest,
			this.tools,
			epoch,
			(segment) => this.segmentAdopted(epoch, segment),
			(file, error) => this.segmentCandidateFailed(file, error),
		);
		const pattern = join(
			this.manifest.directory,
			`epoch-${String(epoch).padStart(3, '0')}-segment-%06d.ts`,
		);
		let committed = false;
		let exitError: Error | undefined;
		try {
			process = await this.supervisor.start(
				this.options.ffmpeg,
				[
					'-hide_banner',
					'-y',
					'-use_wallclock_as_timestamps',
					'1',
					'-f',
					'x11grab',
					'-draw_mouse',
					'0',
					'-video_size',
					'1920x1080',
					'-framerate',
					'30',
					'-i',
					`${this.env.DISPLAY}.0`,
					'-use_wallclock_as_timestamps',
					'1',
					'-f',
					'pulse',
					'-sample_rate',
					'48000',
					'-channels',
					'2',
					'-i',
					'recorder.monitor',
					'-c:v',
					'libx264',
					'-preset',
					'veryfast',
					'-pix_fmt',
					'yuv420p',
					'-g',
					String(this.options.segmentSeconds * 30),
					'-keyint_min',
					String(this.options.segmentSeconds * 30),
					'-sc_threshold',
					'0',
					'-maxrate',
					'5M',
					'-bufsize',
					'10M',
					'-c:a',
					'aac',
					'-af',
					'aresample=async=1000:first_pts=0',
					'-b:a',
					'128k',
					'-ar',
					'48000',
					'-ac',
					'2',
					'-f',
					'segment',
					'-segment_time',
					String(this.options.segmentSeconds),
					'-reset_timestamps',
					'1',
					pattern,
				],
				{
					env: this.env,
					logPath: join(this.manifest.directory, `logs/ffmpeg-${epoch}.log`),
					onUnexpectedExit: () => {
						if (committed) this.queueRecovery();
						else exitError = new Error('ffmpeg exited during capture launch');
					},
				},
			);
			if (exitError) throw exitError;
			const launch: CaptureEpoch = {
				epoch,
				capture_started_at: this.nextLaunchTimestamp(),
			};
			if (this.stopping || exitError)
				throw exitError ?? new Error('capture launch stopped');
			await this.manifest.update((manifest) => {
				manifest.capture_epochs ??= [];
				const existing = manifest.capture_epochs.find(
					(record) => record.epoch === epoch,
				);
				if (existing) {
					if (existing.capture_started_at !== launch.capture_started_at)
						throw new Error('conflicting capture epoch launch');
					return;
				}
				manifest.capture_epochs.push(launch);
			});
			this.ffmpeg = process;
			this.watcher = watcher;
			this.captureLaunchedAt = launch.capture_started_at;
			committed = true;
			watcher.start();
			this.armEndLimit();
			const initial = this.manifest.get().capture_epochs?.[0]?.epoch === epoch;
			const publication = initial
				? (this.options.onCaptureCommitted?.(launch) ?? Promise.resolve())
				: Promise.resolve();
			if (initial) this.initialStartupPublication = publication;
			if (exitError) this.queueRecovery();
			await publication;
			if (this.stopping) throw new Error('capture launch stopped');
			await (this.options.onCaptureLaunched?.(launch) ?? Promise.resolve());
			if (this.stopping) throw new Error('capture launch stopped');
			return launch;
		} catch (error) {
			if (committed) await this.stopCaptureProcess().catch(() => undefined);
			else
				await process
					?.stop(this.options.gracefulTimeoutMs)
					.catch(() => undefined);
			await this.options.onCaptureAborted?.(epoch).catch(() => undefined);
			if (this.healthyEpoch?.epoch === epoch) delete this.healthyEpoch;
			throw error;
		}
	}

	async rendererFailed(reason: string): Promise<void> {
		if (this.stopPromise) return;
		this.partial = true;
		this.rendererUnavailable = true;
		if (this.recoveryPromise)
			this.healthyEpoch?.reject(new Error('renderer unavailable'));
		await this.beginInterruption(
			reason === 'projection_invalid' ? reason : `renderer:${reason}`,
		);
		await this.stopCaptureProcess();
	}

	recoverRenderer(): void {
		if (this.stopPromise || !this.interruption) return;
		this.rendererUnavailable = false;
		if (this.recoveryPromise) {
			void this.recoveryPromise.then(
				() => this.recoverRenderer(),
				() => this.recoverRenderer(),
			);
			return;
		}
		this.recoveryPromise = this.recover().finally(() => {
			this.recoveryPromise = undefined;
		});
	}

	stop(forcePartial = false, reason?: string): Promise<Outcome> {
		this.partial ||= forcePartial;
		if (!this.stopPromise) {
			this.stopping = true;
			const captureStop = this.stopCaptureProcess();
			this.stopPromise = this.performStop(reason, captureStop);
		}
		return this.stopPromise;
	}

	async recoverStopped(): Promise<Outcome> {
		let manifest = await this.manifest.initialize();
		if (['complete', 'partial', 'failed'].includes(manifest.state))
			return manifest.state as Outcome;
		const allocatedEpoch = manifest.epochs - 1;
		if (
			manifest.state === 'capturing' &&
			allocatedEpoch >= 0 &&
			!manifest.capture_epochs?.some(
				(record) => record.epoch === allocatedEpoch,
			)
		) {
			const prefix = `epoch-${String(allocatedEpoch).padStart(3, '0')}-segment-`;
			const candidate = (await readdir(this.manifest.directory))
				.filter(
					(file) =>
						file.startsWith(prefix) &&
						/^epoch-\d{3}-segment-\d{6}\.ts$/.test(file),
				)
				.sort()[0];
			if (candidate) {
				const info = await stat(join(this.manifest.directory, candidate));
				const previousStartedAt =
					manifest.capture_epochs?.at(-1)?.capture_started_at;
				const startedAt = Math.max(
					info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs,
					previousStartedAt ? Date.parse(previousStartedAt) : 0,
				);
				await this.manifest.update((current) => {
					current.capture_epochs ??= [];
					current.capture_epochs.push({
						epoch: allocatedEpoch,
						capture_started_at: new Date(startedAt).toISOString(),
					});
				});
				manifest = this.manifest.get();
			}
		}
		const committedEpoch = manifest.capture_epochs?.at(-1)?.epoch;
		if (manifest.state === 'capturing' && committedEpoch !== undefined) {
			await this.makeWatcher(
				this.manifest,
				this.tools,
				committedEpoch,
				() => undefined,
				() => undefined,
			).stopAndAdoptFinal();
			manifest = this.manifest.get();
		}
		return (await this.makeFinalizer(this.manifest).finalize(
			manifest.gaps.length > 0,
			manifest.reason,
		)) as Outcome;
	}

	captureResult() {
		const manifest = this.manifest.get();
		return {
			artifact: manifest.artifact,
			gaps: manifest.gaps,
			captureStartedAt: manifest.capture_epochs?.[0]?.capture_started_at,
			capturedBytes: manifest.segments.reduce(
				(total, segment) => total + segment.bytes,
				0,
			),
		};
	}

	private async performStop(
		reason: string | undefined,
		captureStop: Promise<void>,
	): Promise<Outcome> {
		if (this.limitTimer) clearTimeout(this.limitTimer);
		if (this.interruptionTimer) clearTimeout(this.interruptionTimer);
		let outcome: Outcome = 'failed';
		try {
			await captureStop;
			await this.initializePromise?.catch(() => undefined);
			await this.launchPromise?.catch(() => undefined);
			if (reason === 'service_shutdown' && !this.interruption)
				await this.openGap(reason);
			await this.stopCaptureProcess();
			outcome = (await this.makeFinalizer(this.manifest).finalize(
				this.partial,
				reason,
			)) as Outcome;
		} finally {
			await Promise.allSettled(
				this.services.map((process) =>
					process.stop(this.options.gracefulTimeoutMs),
				),
			);
			this.services = [];
		}
		return outcome;
	}

	private async stopCaptureProcess(): Promise<void> {
		const process = this.ffmpeg;
		const watcher = this.watcher;
		this.ffmpeg = undefined;
		this.watcher = undefined;
		await process?.stop(this.options.gracefulTimeoutMs).catch(() => undefined);
		await watcher?.stopAndAdoptFinal();
	}

	private queueRecovery(): void {
		if (this.stopPromise) return;
		this.captureFailed = true;
		if (this.recoveryPromise) {
			this.healthyEpoch?.reject(
				new Error('ffmpeg exited before capture progressed'),
			);
			return;
		}
		this.recoveryPromise = (this.initialStartupPublication ?? Promise.resolve())
			.catch(() => undefined)
			.then(() => {
				if (!this.stopPromise) return this.recover();
			})
			.finally(() => {
				this.recoveryPromise = undefined;
			});
	}

	private async recover(): Promise<void> {
		this.partial = true;
		this.ffmpeg = undefined;
		await this.watcher?.stopAndAdoptFinal().catch(() => undefined);
		this.watcher = undefined;
		const interruption = await this.beginInterruption('ffmpeg_exited');
		const deadline = Date.parse(interruption.deadline);
		let backoff = 250;
		while (
			!this.stopPromise &&
			!this.rendererUnavailable &&
			this.now() < deadline
		) {
			try {
				await this.startCapture();
				const health = this.healthyEpoch?.promise;
				if (!health) throw new Error('capture health unavailable');
				const remaining = deadline - this.now();
				const recoveredAt = await Promise.race([
					health,
					this.sleep(remaining).then(() => {
						throw new Error('recovery timeout');
					}),
				]);
				if (this.stopPromise || this.rendererUnavailable || this.captureFailed)
					throw new Error('capture unavailable');
				if (this.now() >= deadline || Date.parse(recoveredAt) >= deadline)
					throw new Error('recovery timeout');
				const captureStartedAt = this.captureLaunchedAt;
				if (!captureStartedAt)
					throw new Error('capture launch time unavailable');
				await this.closeGap(captureStartedAt);
				if (
					this.stopPromise ||
					this.rendererUnavailable ||
					this.captureFailed ||
					this.now() >= deadline
				)
					throw new Error('capture unavailable after gap close');
				this.options.onRecovered?.({
					id: interruption.id,
					capture_started_at: captureStartedAt,
					recovered_at: recoveredAt,
				});
				if (this.interruptionTimer) clearTimeout(this.interruptionTimer);
				delete this.interruptionTimer;
				this.interruption = undefined;
				return;
			} catch (error) {
				if (
					this.captureFailed ||
					(error instanceof Error && error.message.includes('after gap close'))
				)
					await this.reopenGap();
				await this.stopCaptureProcess().catch(() => undefined);
				const remaining = deadline - this.now();
				if (remaining > 0) await this.sleep(Math.min(backoff, remaining));
				backoff = Math.min(backoff * 2, 5_000);
			}
		}
		if (!this.stopPromise && !this.rendererUnavailable)
			this.requestStop(true, 'capture_recovery_timeout');
	}

	private async beginInterruption(
		reason: string,
	): Promise<CaptureInterruption> {
		if (this.interruption) return this.interruption;
		const detectedAt = this.now();
		const interruption: CaptureInterruption = {
			id: crypto.randomUUID(),
			detected_at: new Date(detectedAt).toISOString(),
			deadline: new Date(
				detectedAt + this.options.recoveryTimeoutMs,
			).toISOString(),
			omission_started_at: new Date(detectedAt).toISOString(),
			reason,
		};
		this.interruption = interruption;
		interruption.omission_started_at = await this.openGap(reason);
		this.interruptionTimer = setTimeout(
			() => this.requestStop(true, 'capture_recovery_timeout'),
			Math.max(0, Date.parse(interruption.deadline) - this.now()),
		);
		this.options.onInterrupted?.(interruption);
		return interruption;
	}

	private async segmentAdopted(
		epoch: number,
		_segment: CaptureSegment,
	): Promise<void> {
		const stopping = Boolean(this.stopPromise);
		const capturedBytes = this.manifest
			.get()
			.segments.reduce((sum, segment) => sum + segment.bytes, 0);
		if (this.options.limits) {
			try {
				if (!this.options.onProgress)
					throw new Error('recording budget callback is unavailable');
				this.options.limits.budget_bytes =
					await this.options.onProgress(capturedBytes);
			} catch {
				if (!stopping) this.requestStop(false, 'capture_budget_unavailable');
				return;
			}
		}
		if (stopping) return;
		if (this.healthyEpoch?.epoch === epoch)
			this.healthyEpoch.resolve(new Date(this.now()).toISOString());
		if (this.limitReached()) {
			this.requestStop(false, 'capture_budget_reached');
			return;
		}
	}

	private segmentCandidateFailed(_file: string, error: unknown): void {
		if (this.stopPromise) return;
		const detail = error instanceof Error ? error.message : 'validation_failed';
		this.requestStop(true, `capture_segment_failed:${detail}`.slice(0, 256));
	}

	private limitReached(): boolean {
		const limits = this.options.limits;
		if (!limits) return false;
		if (this.now() >= Date.parse(limits.max_ends_at)) return true;
		const bytes = this.manifest
			.get()
			.segments.reduce((sum, segment) => sum + segment.bytes, 0);
		return bytes + this.segmentSafetyBytes() * 3 > limits.budget_bytes;
	}

	private segmentSafetyBytes(): number {
		return Math.ceil(
			((5_000_000 + 128_000) / 8) * 1.1 * this.options.segmentSeconds,
		);
	}

	private armEndLimit(): void {
		const end =
			this.options.limits && Date.parse(this.options.limits.max_ends_at);
		if (!end || this.limitTimer) return;
		this.limitTimer = setTimeout(
			() => this.requestStop(false, 'capture_time_limit_reached'),
			Math.max(0, end - this.now()),
		);
	}

	private requestStop(partial: boolean, reason: string): void {
		if (this.options.onStopRequested) {
			this.options.onStopRequested(partial, reason);
			return;
		}
		void this.stop(partial, reason);
	}

	private async openGap(reason: string): Promise<string> {
		let startedAt = new Date(this.now()).toISOString();
		await this.manifest.update((m) => {
			const gap = m.gaps.at(-1);
			if (!gap || gap.ended_at) {
				const segment = m.segments.at(-1);
				startedAt = segment
					? new Date(
							Date.parse(segment.started_at) + segment.duration_ms,
						).toISOString()
					: startedAt;
				m.gaps.push({ started_at: startedAt, reason });
			} else startedAt = gap.started_at;
		});
		return startedAt;
	}

	private async closeGap(captureStartedAt: string): Promise<void> {
		await this.manifest.update((m) => {
			const gap = m.gaps.at(-1);
			if (gap && !gap.ended_at) gap.ended_at = captureStartedAt;
		});
	}

	private async reopenGap(): Promise<void> {
		await this.manifest.update((m) => {
			const gap = m.gaps.at(-1);
			if (gap) delete gap.ended_at;
		});
	}

	private nextLaunchTimestamp(): string {
		const manifest = this.manifest.get();
		const previousLaunch = manifest.capture_epochs?.at(-1)?.capture_started_at;
		const gapStart = manifest.gaps.at(-1)?.started_at;
		const floor = Math.max(
			previousLaunch ? Date.parse(previousLaunch) : 0,
			gapStart ? Date.parse(gapStart) : 0,
		);
		return new Date(Math.max(this.now(), floor)).toISOString();
	}

	private async startService(
		command: string,
		args: string[],
		log: string,
		reason: string,
	): Promise<ManagedProcess> {
		return this.supervisor.start(command, args, {
			env: this.env,
			logPath: join(this.manifest.directory, `logs/${log}.log`),
			onUnexpectedExit: () => this.requestStop(true, reason),
		});
	}

	private async assertServicesReady(): Promise<void> {
		const result = await Promise.race([
			this.sleep(200).then(() => undefined),
			...this.services.map((service) => service.exited),
		]);
		if (result) throw new Error(`capture service exited ${result.code}`);
	}

	private async waitForPulse(): Promise<void> {
		for (let attempt = 0; attempt < 40; attempt += 1) {
			const probe = await this.supervisor.start(this.options.pactl, ['info'], {
				env: this.env,
				logPath: join(this.manifest.directory, 'logs/pactl-ready.log'),
			});
			const result = await probe.exited;
			if (result.code === 0) return;
			await this.sleep(250);
		}
		throw new Error('PulseAudio did not become ready');
	}
}
