import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
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
	private limitTimer?: NodeJS.Timeout;
	private healthyEpoch?: {
		epoch: number;
		resolve: () => void;
		reject: (error: Error) => void;
		promise: Promise<void>;
	};

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
		this.tools = injected.tools ?? new FfmpegMediaTools(options.ffmpeg);
		this.now = injected.now ?? Date.now;
		this.sleep =
			injected.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
		this.manifest = new ManifestStore(options.dataRoot, job);
		this.makeWatcher =
			injected.watcher ??
			((manifest, tools, epoch, onAdopt) =>
				new SegmentWatcher(manifest, tools, epoch, 250, onAdopt));
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

	async initialize(): Promise<void> {
		await this.manifest.initialize();
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

	async startCapture(): Promise<void> {
		if (this.ffmpeg || this.stopPromise) return;
		if (this.limitReached()) {
			this.requestStop(false, 'capture_limit_reached');
			return;
		}
		const epoch = this.epoch++;
		await this.manifest.update((m) => {
			m.epochs = this.epoch;
		});
		let resolveHealth!: () => void;
		let rejectHealth!: (error: Error) => void;
		const health = new Promise<void>((resolve, reject) => {
			resolveHealth = resolve;
			rejectHealth = reject;
		});
		this.healthyEpoch = {
			epoch,
			resolve: resolveHealth,
			reject: rejectHealth,
			promise: health,
		};
		this.watcher = this.makeWatcher(
			this.manifest,
			this.tools,
			epoch,
			(segment) => this.segmentAdopted(epoch, segment),
		);
		const pattern = join(
			this.manifest.directory,
			`epoch-${String(epoch).padStart(3, '0')}-segment-%06d.ts`,
		);
		this.ffmpeg = await this.supervisor.start(
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
				onUnexpectedExit: () => this.queueRecovery(),
			},
		);
		this.watcher.start();
		this.armEndLimit();
	}

	async rendererFailed(reason: string): Promise<Outcome> {
		if (this.stopPromise) return this.stopPromise;
		this.partial = true;
		await this.openGap(`renderer:${reason}`);
		await this.stopCaptureProcess();
		await this.sleep(this.options.recoveryTimeoutMs);
		return this.stop(true, 'renderer_recovery_timeout');
	}

	stop(forcePartial = false, reason?: string): Promise<Outcome> {
		this.partial ||= forcePartial;
		if (!this.stopPromise) this.stopPromise = this.performStop(reason);
		return this.stopPromise;
	}

	async recoverStopped(): Promise<Outcome> {
		let manifest = await this.manifest.initialize();
		if (['complete', 'partial', 'failed'].includes(manifest.state))
			return manifest.state as Outcome;
		if (manifest.state === 'capturing' && manifest.epochs > 0) {
			await this.makeWatcher(
				this.manifest,
				this.tools,
				manifest.epochs - 1,
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
		return { artifact: manifest.artifact, gaps: manifest.gaps };
	}

	private async performStop(reason?: string): Promise<Outcome> {
		if (this.limitTimer) clearTimeout(this.limitTimer);
		let outcome: Outcome = 'failed';
		try {
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
		if (this.recoveryPromise) {
			this.healthyEpoch?.reject(
				new Error('ffmpeg exited before capture progressed'),
			);
			return;
		}
		this.recoveryPromise = this.recover().finally(() => {
			this.recoveryPromise = undefined;
		});
	}

	private async recover(): Promise<void> {
		this.partial = true;
		this.ffmpeg = undefined;
		await this.watcher?.stopAndAdoptFinal().catch(() => undefined);
		this.watcher = undefined;
		await this.openGap('ffmpeg_exited');
		const deadline = this.now() + this.options.recoveryTimeoutMs;
		let backoff = 250;
		while (!this.stopPromise && this.now() < deadline) {
			try {
				await this.startCapture();
				const health = this.healthyEpoch?.promise;
				if (!health) throw new Error('capture health unavailable');
				const remaining = deadline - this.now();
				await Promise.race([
					health,
					this.sleep(remaining).then(() => {
						throw new Error('recovery timeout');
					}),
				]);
				await this.closeGap();
				return;
			} catch {
				await this.stopCaptureProcess().catch(() => undefined);
				const remaining = deadline - this.now();
				if (remaining > 0) await this.sleep(Math.min(backoff, remaining));
				backoff = Math.min(backoff * 2, 5_000);
			}
		}
		if (!this.stopPromise) this.requestStop(true, 'capture_recovery_timeout');
	}

	private async segmentAdopted(
		epoch: number,
		_segment: CaptureSegment,
	): Promise<void> {
		if (this.healthyEpoch?.epoch === epoch) this.healthyEpoch.resolve();
		if (this.limitReached()) this.requestStop(false, 'capture_budget_reached');
	}

	private limitReached(): boolean {
		const limits = this.options.limits;
		if (!limits) return false;
		if (this.now() >= Date.parse(limits.max_ends_at)) return true;
		const bytes = this.manifest
			.get()
			.segments.reduce((sum, segment) => sum + segment.bytes, 0);
		return bytes + this.segmentSafetyBytes() > limits.budget_bytes;
	}

	private segmentSafetyBytes(): number {
		return Math.ceil(((5_000_000 + 128_000) / 8) * this.options.segmentSeconds);
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

	private async openGap(reason: string): Promise<void> {
		await this.manifest.update((m) => {
			const gap = m.gaps.at(-1);
			if (!gap || gap.ended_at)
				m.gaps.push({ started_at: new Date(this.now()).toISOString(), reason });
		});
	}

	private async closeGap(): Promise<void> {
		await this.manifest.update((m) => {
			const gap = m.gaps.at(-1);
			if (gap && !gap.ended_at)
				gap.ended_at = new Date(this.now()).toISOString();
		});
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
