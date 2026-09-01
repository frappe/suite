import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureWorker, type CaptureWorkerOptions } from './CaptureWorker.js';
import { CaptureWorkerManager } from './CaptureWorkerManager.js';
import type { ManagedProcess, ProcessSupervisor } from './ProcessSupervisor.js';
import { FakeRendererBridge, TEST_PUBLIC_JWK } from './RendererBridge.js';
import { COMMAND_AUDIENCE, type CommandClaims } from './types.js';

const roots: string[] = [];
const options = (root: string): CaptureWorkerOptions => ({
	dataRoot: root,
	display: 100,
	segmentSeconds: 30,
	ffmpeg: 'ffmpeg',
	xvfb: 'xvfb',
	pulseaudio: 'pulse',
	pactl: 'pactl',
	gracefulTimeoutMs: 10,
	recoveryTimeoutMs: 60_000,
});
const command = (job: string): CommandClaims => ({
	iss: 'site',
	aud: COMMAND_AUDIENCE,
	site: 'site',
	origin: 'https://site.test',
	room: 'room',
	recording: 'recording',
	job,
	operation: 'reserve',
	limits: {
		budget_bytes: 100_000_000,
		max_ends_at: '2030-01-01T00:00:00Z',
		output: { width: 1920, height: 1080, fps: 30, video: 'h264', audio: 'aac' },
	},
	jti: job,
	iat: 1,
	exp: 2,
});
const process = (code?: number): ManagedProcess => ({
	pid: 1,
	exited:
		code === undefined
			? new Promise(() => undefined)
			: Promise.resolve({ code, signal: null }),
	stop: vi.fn(async () => undefined),
});

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe('capture lifecycle', () => {
	it('orders prepare, spawn, durable commit, startup publication, then browser command', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const order: string[] = [];
		const now = Date.parse('2026-08-30T12:00:00.123Z');
		const supervisor = {
			start: vi.fn(async (name: string) => {
				if (name === 'ffmpeg') order.push('spawn');
				return name === 'pactl' ? process(0) : process();
			}),
		};
		let worker!: CaptureWorker;
		worker = new CaptureWorker(
			'ordered-launch',
			{
				...options(root),
				onCapturePreparing: async (epoch) => order.push(`prepare:${epoch}`),
				onCaptureCommitted: async (launch) => {
					order.push(
						worker.manifest.get().capture_epochs?.[launch.epoch]
							?.capture_started_at === launch.capture_started_at
							? 'published-after-durable'
							: 'published-before-durable',
					);
				},
				onCaptureLaunched: async () => order.push('capture-started'),
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				now: () => now,
				sleep: async () => undefined,
				watcher: () => ({
					start: () => order.push('watch'),
					stopAndAdoptFinal: async () => 'none' as const,
				}),
			},
		);
		await worker.initialize();

		await expect(worker.startCapture()).resolves.toEqual({
			epoch: 0,
			capture_started_at: '2026-08-30T12:00:00.123Z',
		});
		expect(order.filter((event) => event !== 'watch')).toEqual([
			'prepare:0',
			'spawn',
			'published-after-durable',
			'capture-started',
		]);
		expect(worker.manifest.get().capture_epochs).toEqual([
			{
				epoch: 0,
				capture_started_at: '2026-08-30T12:00:00.123Z',
			},
		]);
		await worker.stop();
	});

	it('does not spawn when capture preparation fails', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const supervisor = {
			start: vi.fn(async (name: string) =>
				name === 'pactl' ? process(0) : process(),
			),
		};
		const worker = new CaptureWorker(
			'prepare-failure',
			{
				...options(root),
				onCapturePreparing: async () => {
					throw new Error('prepare failed');
				},
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
			},
		);
		await worker.initialize();
		await expect(worker.startCapture()).rejects.toThrow('prepare failed');
		expect(
			supervisor.start.mock.calls.some(([name]) => name === 'ffmpeg'),
		).toBe(false);
		await worker.stop();
	});

	it.each(['durable write', 'browser acknowledgement'] as const)(
		'stops a spawned epoch when %s fails',
		async (failure) => {
			const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
			roots.push(root);
			const ffmpeg = process();
			const supervisor = {
				start: vi.fn(async (name: string) => {
					if (name === 'ffmpeg') return ffmpeg;
					return name === 'pactl' ? process(0) : process();
				}),
			};
			const aborted = vi.fn(async () => undefined);
			const launched = vi.fn(async () => {
				if (
					failure === 'browser acknowledgement' &&
					launched.mock.calls.length === 1
				)
					throw new Error('start acknowledgement failed');
			});
			const watcherStart = vi.fn();
			const worker = new CaptureWorker(
				`launch-failure-${failure}`,
				{
					...options(root),
					onCaptureLaunched: launched,
					onCaptureAborted: aborted,
				},
				{
					supervisor: supervisor as unknown as ProcessSupervisor,
					sleep: async () => undefined,
					watcher: () => ({
						start: watcherStart,
						stopAndAdoptFinal: async () => 'none' as const,
					}),
				},
			);
			await worker.initialize();
			if (failure === 'durable write') {
				const update = worker.manifest.update.bind(worker.manifest);
				vi.spyOn(worker.manifest, 'update')
					.mockImplementationOnce(update)
					.mockRejectedValueOnce(new Error('durable write failed'));
			}

			await expect(worker.startCapture()).rejects.toThrow(
				failure === 'durable write' ? 'durable' : 'acknowledgement',
			);
			expect(ffmpeg.stop).toHaveBeenCalledOnce();
			expect(aborted).toHaveBeenCalledWith(0);
			expect(watcherStart).toHaveBeenCalledTimes(
				failure === 'durable write' ? 0 : 1,
			);
			if (failure === 'durable write') expect(launched).not.toHaveBeenCalled();

			if (failure === 'durable write')
				await expect(worker.startCapture()).resolves.toMatchObject({
					epoch: 1,
				});
			expect(watcherStart).toHaveBeenCalledOnce();
			await worker.stop();
		},
	);

	it('cancels renderer preparation and permits retry when FFmpeg spawn fails', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const supervisor = {
			start: vi.fn(async (name: string) => {
				if (
					name === 'ffmpeg' &&
					supervisor.start.mock.calls.filter(([value]) => value === 'ffmpeg')
						.length === 1
				)
					throw new Error('spawn failed');
				return name === 'pactl' ? process(0) : process();
			}),
		};
		const aborted = vi.fn(async () => undefined);
		const worker = new CaptureWorker(
			'spawn-failure',
			{ ...options(root), onCaptureAborted: aborted },
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: () => ({
					start: () => undefined,
					stopAndAdoptFinal: async () => 'none' as const,
				}),
			},
		);
		await worker.initialize();

		await expect(worker.startCapture()).rejects.toThrow('spawn failed');
		expect(aborted).toHaveBeenCalledWith(0);
		await expect(worker.startCapture()).resolves.toMatchObject({ epoch: 1 });
		await worker.stop();
	});

	it('keeps a durable commit when renderer acknowledgement fails', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const ffmpeg = process();
		const supervisor = {
			start: vi.fn(async (name: string) =>
				name === 'pactl' ? process(0) : name === 'ffmpeg' ? ffmpeg : process(),
			),
		};
		const aborted = vi.fn(async () => undefined);
		const worker = new CaptureWorker(
			'acceptance-write-failure',
			{
				...options(root),
				onCaptureAborted: aborted,
				onCaptureLaunched: async () => {
					throw new Error('acknowledgement failed');
				},
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: () => ({
					start: () => undefined,
					stopAndAdoptFinal: async () => 'none' as const,
				}),
			},
		);
		await worker.initialize();

		await expect(worker.startCapture()).rejects.toThrow(
			'acknowledgement failed',
		);
		expect(worker.manifest.get().capture_epochs).toEqual([
			expect.objectContaining({ epoch: 0 }),
		]);
		expect(aborted).toHaveBeenCalledWith(0);
		await worker.stop();
	});

	it('keeps the durable commit when stop races startup publication', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const ffmpeg = process();
		const supervisor = {
			start: vi.fn(async (name: string) =>
				name === 'pactl' ? process(0) : name === 'ffmpeg' ? ffmpeg : process(),
			),
		};
		const adoptFinal = vi.fn(async () => 'none' as const);
		const aborted = vi.fn(async () => undefined);
		const finalize = vi.fn(async () => 'failed' as const);
		const worker = new CaptureWorker(
			'accepted-stop-race',
			{ ...options(root), onCaptureAborted: aborted },
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: () => ({
					start: () => undefined,
					stopAndAdoptFinal: adoptFinal,
				}),
				finalizer: () => ({ finalize }),
			},
		);
		await worker.initialize();
		let releaseAcceptance!: () => void;
		const acceptanceBlocked = new Promise<void>((resolve) => {
			releaseAcceptance = resolve;
		});
		let commitReached!: () => void;
		const reachedCommit = new Promise<void>((resolve) => {
			commitReached = resolve;
		});
		Reflect.get(worker, 'options').onCaptureCommitted = async () => {
			commitReached();
			await acceptanceBlocked;
		};

		const launching = worker.startCapture();
		await reachedCommit;
		expect(worker.manifest.get().capture_epochs).toHaveLength(1);
		const stopping = worker.stop(false, 'host_stop');
		await vi.waitFor(() => expect(ffmpeg.stop).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(adoptFinal).toHaveBeenCalledOnce());
		expect(finalize).not.toHaveBeenCalled();
		releaseAcceptance();

		await expect(launching).rejects.toThrow('stopped');
		await expect(stopping).resolves.toBe('failed');
		expect(finalize).toHaveBeenCalledOnce();
		expect(adoptFinal).toHaveBeenCalledOnce();
		expect(aborted).toHaveBeenCalledWith(0);
	});

	it('does not commit FFmpeg after an asynchronous launch error', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const supervisor = {
			start: vi.fn(async (name: string, _args, processOptions) => {
				if (name === 'ffmpeg') {
					queueMicrotask(() =>
						processOptions.onUnexpectedExit?.({ code: null, signal: null }),
					);
					return process();
				}
				return name === 'pactl' ? process(0) : process();
			}),
		};
		const worker = new CaptureWorker('dead-launch', options(root), {
			supervisor: supervisor as unknown as ProcessSupervisor,
			sleep: async () => undefined,
		});
		await worker.initialize();

		await expect(worker.startCapture()).rejects.toThrow('ffmpeg exited');
		expect(worker.manifest.get().capture_epochs).toEqual([]);
		await worker.stop();
	});

	it.each(['allocated', 'committed'] as const)(
		'adopts only a committed %s crash window after restart',
		async (phase) => {
			const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
			roots.push(root);
			const makeWatcher = vi.fn(() => ({
				start: () => undefined,
				stopAndAdoptFinal: async () => 'adopted' as const,
			}));
			const worker = new CaptureWorker(`crash-${phase}`, options(root), {
				watcher: makeWatcher,
				finalizer: () => ({ finalize: async () => 'failed' as const }),
			});
			await worker.manifest.initialize();
			await worker.manifest.update((manifest) => {
				manifest.epochs = 1;
				if (phase === 'committed')
					manifest.capture_epochs?.push({
						epoch: 0,
						capture_started_at: '2026-08-30T12:00:00.000Z',
					});
			});
			await expect(worker.recoverStopped()).resolves.toBe('failed');
			expect(makeWatcher).toHaveBeenCalledTimes(phase === 'committed' ? 1 : 0);
			expect(worker.captureResult()).toMatchObject({
				artifact: undefined,
				captureStartedAt:
					phase === 'committed' ? '2026-08-30T12:00:00.000Z' : undefined,
			});
		},
	);

	it('serializes FFmpeg exit recovery behind initial startup publication', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		let unexpectedExit!: () => void;
		const ffmpeg = process();
		const supervisor = {
			start: vi.fn(async (name: string, _args, processOptions) => {
				if (name === 'ffmpeg') {
					unexpectedExit = processOptions.onUnexpectedExit;
					return ffmpeg;
				}
				return name === 'pactl' ? process(0) : process();
			}),
		};
		let releasePublication!: () => void;
		const publicationBlocked = new Promise<void>((resolve) => {
			releasePublication = resolve;
		});
		const watcherStart = vi.fn();
		const onInterrupted = vi.fn();
		const worker = new CaptureWorker(
			'exit-during-startup-publication',
			{
				...options(root),
				onInterrupted,
				onCaptureCommitted: async () => publicationBlocked,
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: () => ({
					start: watcherStart,
					stopAndAdoptFinal: async () => 'none' as const,
				}),
			},
		);
		await worker.initialize();

		const launching = worker.startCapture();
		await vi.waitFor(() => expect(unexpectedExit).toBeTypeOf('function'));
		await vi.waitFor(() =>
			expect(worker.manifest.get().capture_epochs).toHaveLength(1),
		);
		unexpectedExit();
		expect(onInterrupted).not.toHaveBeenCalled();
		releasePublication();

		await expect(launching).resolves.toMatchObject({ epoch: 0 });
		await vi.waitFor(() => expect(onInterrupted).toHaveBeenCalledOnce());
		expect(watcherStart).toHaveBeenCalled();
		await worker.stop();
	});

	it('applies refreshed budget before deciding whether the next segment fits', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const adopted: Array<(segment: never) => void | Promise<void>> = [];
		const safetyBytes = Math.ceil(((5_000_000 + 128_000) / 8) * 1.1 * 30);
		const onProgress = vi.fn(async () => safetyBytes * 3 + 1);
		const onStopRequested = vi.fn();
		const supervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process()),
		};
		const worker = new CaptureWorker(
			'budget-refresh',
			{
				...options(root),
				limits: {
					...command('budget-refresh').limits,
					budget_bytes: safetyBytes * 3,
					max_ends_at: new Date(Date.now() + 60_000).toISOString(),
				},
				onProgress,
				onStopRequested,
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: (_manifest, _tools, _epoch, onAdopt) => {
					adopted.push(onAdopt as (segment: never) => void | Promise<void>);
					return {
						start: () => undefined,
						stopAndAdoptFinal: async () => 'none' as const,
					};
				},
			},
		);
		await worker.initialize();
		await worker.startCapture();
		await worker.manifest.update((manifest) => {
			manifest.segments.push({
				epoch: 0,
				index: 0,
				file: 'epoch-000-segment-000000.ts',
				bytes: 1,
				sha256: 'a'.repeat(64),
				duration_ms: 30_000,
				started_at: '2026-08-30T12:00:00.000Z',
			});
		});

		await adopted[0]?.({} as never);

		expect(onProgress).toHaveBeenCalledWith(1);
		expect(onStopRequested).not.toHaveBeenCalled();
		await worker.manifest.update((manifest) => {
			manifest.segments.push({
				epoch: 0,
				index: 1,
				file: 'epoch-000-segment-000001.ts',
				bytes: 1,
				sha256: 'b'.repeat(64),
				duration_ms: 30_000,
				started_at: '2026-08-30T12:00:30.000Z',
			});
		});
		await adopted[0]?.({} as never);
		expect(onStopRequested).toHaveBeenCalledWith(
			false,
			'capture_budget_reached',
		);
		await worker.stop();
	});

	it('stops when progress is unavailable and includes the 10% segment margin', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const adopted: Array<(segment: never) => void | Promise<void>> = [];
		const onStopRequested = vi.fn();
		const withoutMargin = Math.ceil(((5_000_000 + 128_000) / 8) * 30);
		const supervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process(0)),
		};
		const worker = new CaptureWorker(
			'budget-unavailable',
			{
				...options(root),
				limits: {
					...command('budget-unavailable').limits,
					budget_bytes: withoutMargin * 3,
					max_ends_at: new Date(Date.now() + 60_000).toISOString(),
				},
				onStopRequested,
				onProgress: async () => {
					throw new Error('callback failed');
				},
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: (_manifest, _tools, _epoch, onAdopt) => {
					adopted.push(onAdopt as (segment: never) => void | Promise<void>);
					return {
						start: () => undefined,
						stopAndAdoptFinal: async () => 'none' as const,
					};
				},
			},
		);
		await worker.initialize();

		await worker.startCapture();
		expect(onStopRequested).toHaveBeenCalledWith(
			false,
			'capture_limit_reached',
		);

		const enoughSupervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process()),
		};
		const enoughWorker = new CaptureWorker(
			'callback-unavailable',
			{
				...options(root),
				limits: {
					...command('callback-unavailable').limits,
					max_ends_at: new Date(Date.now() + 60_000).toISOString(),
				},
				onStopRequested,
				onProgress: async () => {
					throw new Error('callback failed');
				},
			},
			{
				supervisor: enoughSupervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: (_manifest, _tools, _epoch, onAdopt) => {
					adopted.push(onAdopt as (segment: never) => void | Promise<void>);
					return {
						start: () => undefined,
						stopAndAdoptFinal: async () => 'none' as const,
					};
				},
			},
		);
		await enoughWorker.initialize();
		await enoughWorker.startCapture();
		await enoughWorker.manifest.update((manifest) => {
			manifest.segments.push({
				epoch: 0,
				index: 0,
				file: 'epoch-000-segment-000000.ts',
				bytes: 1,
				sha256: 'a'.repeat(64),
				duration_ms: 30_000,
				started_at: '2026-08-30T12:00:00.000Z',
			});
		});
		await expect(adopted.at(-1)?.({} as never)).resolves.toBeUndefined();
		expect(onStopRequested).toHaveBeenCalledWith(
			false,
			'capture_budget_unavailable',
		);
		expect(enoughWorker.manifest.get().gaps).toEqual([]);
	});

	it('reports cumulative progress after adopting the final host-stop segment', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const onProgress = vi.fn(async () => 100_000_000);
		const onStopRequested = vi.fn();
		const supervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process()),
		};
		const worker = new CaptureWorker(
			'host-stop-final',
			{
				...options(root),
				limits: {
					...command('host-stop-final').limits,
					max_ends_at: new Date(Date.now() + 60_000).toISOString(),
				},
				onProgress,
				onStopRequested,
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: (manifest, _tools, _epoch, onAdopt) => ({
					start: () => undefined,
					stopAndAdoptFinal: async () => {
						const segment = {
							epoch: 0,
							index: 0,
							file: 'epoch-000-segment-000000.ts',
							bytes: 42,
							sha256: 'a'.repeat(64),
							duration_ms: 1_000,
							started_at: '2026-08-30T12:00:00.000Z',
						};
						await manifest.update((value) => value.segments.push(segment));
						await onAdopt(segment);
						return 'adopted' as const;
					},
				}),
				finalizer: () => ({ finalize: async () => 'complete' as const }),
			},
		);
		await worker.initialize();
		await worker.startCapture();

		await expect(worker.stop(false, 'host_stop')).resolves.toBe('complete');

		expect(worker.manifest.get().segments).toHaveLength(1);
		expect(onProgress).toHaveBeenCalledOnce();
		expect(onProgress).toHaveBeenCalledWith(42);
		expect(onStopRequested).not.toHaveBeenCalled();
	});

	it('requests a partial stop without throwing when a closed segment fails', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const candidateErrors: Array<(file: string, error: unknown) => void> = [];
		const onStopRequested = vi.fn();
		const supervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process()),
		};
		const worker = new CaptureWorker(
			'validation-error',
			{ ...options(root), onStopRequested },
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				sleep: async () => undefined,
				watcher: (_manifest, _tools, _epoch, _onAdopt, onCandidateError) => {
					candidateErrors.push(onCandidateError);
					return {
						start: () => undefined,
						stopAndAdoptFinal: async () => 'none' as const,
					};
				},
			},
		);
		await worker.initialize();
		await worker.startCapture();

		expect(() =>
			candidateErrors[0]?.(
				'epoch-000-segment-000000.ts',
				new Error('invalid media'),
			),
		).not.toThrow();

		expect(onStopRequested).toHaveBeenCalledWith(
			true,
			'capture_segment_failed:invalid media',
		);
		await worker.stop();
	});

	it('recovers FFmpeg capture with a durable bounded interruption', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const exits: Array<() => void> = [];
		const adopted: Array<(segment: never) => void | Promise<void>> = [];
		let now = Date.parse('2026-08-30T12:00:30.000Z');
		const supervisor = {
			start: vi.fn(
				async (
					command: string,
					_args: string[],
					processOptions: Parameters<ProcessSupervisor['start']>[2],
				) => {
					if (command === 'ffmpeg' && processOptions.onUnexpectedExit) {
						if (exits.length > 0) now += 1_000;
						exits.push(processOptions.onUnexpectedExit);
					}
					return command === 'pactl' ? process(0) : process();
				},
			),
		};
		const onInterrupted = vi.fn();
		const onRecovered = vi.fn();
		const onCapturePreparing = vi.fn(async () => undefined);
		const onCaptureLaunched = vi.fn(async () => undefined);
		const worker = new CaptureWorker(
			'ffmpeg-recovery',
			{
				...options(root),
				onInterrupted,
				onRecovered,
				onCapturePreparing,
				onCaptureLaunched,
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				now: () => now,
				sleep: async (delay) => {
					if (delay > 5_000) await new Promise(() => undefined);
				},
				watcher: (_manifest, _tools, _epoch, onAdopt) => {
					adopted.push(onAdopt as (segment: never) => void | Promise<void>);
					return {
						start: () => undefined,
						stopAndAdoptFinal: async () => 'none' as const,
					};
				},
			},
		);

		await worker.initialize();
		await worker.startCapture();
		await worker.manifest.update((manifest) => {
			manifest.segments.push({
				epoch: 0,
				index: 0,
				file: 'epoch-000-segment-000000.ts',
				bytes: 1,
				sha256: 'a'.repeat(64),
				duration_ms: 30_000,
				started_at: '2026-08-30T12:00:00.000Z',
			});
		});

		exits[0]?.();
		await vi.waitFor(() => expect(onInterrupted).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(adopted).toHaveLength(2));
		const adoption = adopted[1]?.({} as never);
		exits[1]?.();
		await adoption;
		await vi.waitFor(() => expect(adopted).toHaveLength(3));
		expect(onRecovered).not.toHaveBeenCalled();
		await adopted[2]?.({} as never);
		await vi.waitFor(() => expect(onRecovered).toHaveBeenCalledOnce());

		expect(onInterrupted).toHaveBeenCalledWith(
			expect.objectContaining({
				omission_started_at: '2026-08-30T12:00:30.000Z',
				deadline: '2026-08-30T12:01:30.000Z',
			}),
		);
		expect(onRecovered).toHaveBeenCalledWith(
			expect.objectContaining({
				capture_started_at: '2026-08-30T12:00:32.000Z',
				recovered_at: '2026-08-30T12:00:32.000Z',
			}),
		);
		expect(onCapturePreparing.mock.calls.map(([epoch]) => epoch)).toEqual([
			0, 1, 2,
		]);
		expect([
			[0, 2],
			[0, 1, 2],
		]).toContainEqual(
			onCaptureLaunched.mock.calls.map(([launch]) => launch.epoch),
		);
		expect(worker.manifest.get().gaps).toEqual([
			{
				started_at: '2026-08-30T12:00:30.000Z',
				ended_at: '2026-08-30T12:00:32.000Z',
				reason: 'ffmpeg_exited',
			},
		]);
		await worker.stop();
	});

	it('keeps recovery launch timestamps nondecreasing when the clock regresses', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		let now = Date.parse('2026-08-30T12:00:30.000Z');
		const exits: Array<() => void> = [];
		const launches: string[] = [];
		const supervisor = {
			start: vi.fn(async (name: string, _args, processOptions) => {
				if (name === 'ffmpeg') exits.push(processOptions.onUnexpectedExit);
				return name === 'pactl' ? process(0) : process();
			}),
		};
		const worker = new CaptureWorker(
			'clock-regression',
			{
				...options(root),
				onCaptureLaunched: async (launch) =>
					launches.push(launch.capture_started_at),
			},
			{
				supervisor: supervisor as unknown as ProcessSupervisor,
				now: () => now,
				sleep: async (delay) => {
					if (delay > 5_000) await new Promise(() => undefined);
				},
				watcher: () => ({
					start: () => undefined,
					stopAndAdoptFinal: async () => 'none' as const,
				}),
			},
		);
		await worker.initialize();
		await worker.startCapture();
		now -= 60_000;
		exits[0]?.();
		await vi.waitFor(() => expect(launches).toHaveLength(2));

		expect(launches).toEqual([
			'2026-08-30T12:00:30.000Z',
			'2026-08-30T12:00:30.000Z',
		]);
		await worker.stop();
	});

	it.each(['deadline', 'host stop'] as const)(
		'does not publish recovery when %s wins after health resolution',
		async (boundary) => {
			const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
			roots.push(root);
			const startedAt = Date.parse('2026-08-30T12:00:30.000Z');
			let now = startedAt;
			const exits: Array<() => void> = [];
			const adopted: Array<(segment: never) => void | Promise<void>> = [];
			const onRecovered = vi.fn();
			const onStopRequested = vi.fn();
			const supervisor = {
				start: vi.fn(async (name: string, _args, processOptions) => {
					if (name === 'ffmpeg') exits.push(processOptions.onUnexpectedExit);
					return name === 'pactl' ? process(0) : process();
				}),
			};
			const worker = new CaptureWorker(
				`recovery-${boundary}`,
				{ ...options(root), onRecovered, onStopRequested },
				{
					supervisor: supervisor as unknown as ProcessSupervisor,
					now: () => now,
					sleep: async (delay) => {
						if (delay > 5_000) await new Promise(() => undefined);
					},
					watcher: (_manifest, _tools, _epoch, onAdopt) => {
						adopted.push(onAdopt as (segment: never) => void | Promise<void>);
						return {
							start: () => undefined,
							stopAndAdoptFinal: async () => 'none' as const,
						};
					},
					finalizer: () => ({ finalize: async () => 'partial' as const }),
				},
			);
			await worker.initialize();
			await worker.startCapture();
			await worker.manifest.update((manifest) => {
				manifest.segments.push({
					epoch: 0,
					index: 0,
					file: 'epoch-000-segment-000000.ts',
					bytes: 1,
					sha256: 'a'.repeat(64),
					duration_ms: 30_000,
					started_at: '2026-08-30T12:00:00.000Z',
				});
			});
			exits[0]?.();
			await vi.waitFor(() => expect(adopted).toHaveLength(2));
			if (boundary === 'deadline') now = startedAt + 60_000;
			const health = adopted[1]?.({} as never);
			const stopping =
				boundary === 'host stop'
					? worker.stop(true, 'host_stop')
					: Promise.resolve(undefined);
			await health;
			if (boundary === 'deadline')
				await vi.waitFor(() =>
					expect(onStopRequested).toHaveBeenCalledWith(
						true,
						'capture_recovery_timeout',
					),
				);
			else await stopping;

			expect(onRecovered).not.toHaveBeenCalled();
			expect(worker.manifest.get().gaps.at(-1)?.ended_at).toBeUndefined();
			await worker.stop(true, 'test_cleanup');
		},
	);

	it('synchronizes audio and video capture to the wall clock', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const supervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process())
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process()),
		};
		const worker = new CaptureWorker('synchronized', options(root), {
			supervisor: supervisor as unknown as ProcessSupervisor,
			sleep: async () => undefined,
		});

		await worker.initialize();
		await worker.startCapture();

		const args = supervisor.start.mock.calls.at(-1)?.[1] as string[];
		expect(
			args.filter((arg) => arg === '-use_wallclock_as_timestamps'),
		).toHaveLength(2);
		expect(args).toContain('aresample=async=1000:first_pts=0');
		await worker.stop();
	});

	it('rolls back every started service when setup exits non-zero', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const xvfb = process();
		const pulse = process();
		const setup = process(1);
		const supervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(xvfb)
				.mockResolvedValueOnce(pulse)
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(setup),
		};
		const worker = new CaptureWorker('rollback', options(root), {
			supervisor: supervisor as unknown as ProcessSupervisor,
			sleep: async () => undefined,
		});
		await expect(worker.initialize()).rejects.toThrow('pactl setup exited 1');
		expect(xvfb.stop).toHaveBeenCalledOnce();
		expect(pulse.stop).toHaveBeenCalledOnce();
	});

	it('shares concurrent stop and cleans services when finalization throws', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const xvfb = process();
		const pulse = process();
		const supervisor = {
			start: vi
				.fn()
				.mockResolvedValueOnce(xvfb)
				.mockResolvedValueOnce(pulse)
				.mockResolvedValueOnce(process(0))
				.mockResolvedValueOnce(process(0)),
		};
		const finalize = vi.fn(async () => {
			throw new Error('finalizer failed');
		});
		const worker = new CaptureWorker('stop', options(root), {
			supervisor: supervisor as unknown as ProcessSupervisor,
			sleep: async () => undefined,
			finalizer: () => ({ finalize }),
		});
		await worker.initialize();
		const first = worker.stop();
		const second = worker.stop();
		expect(first).toBe(second);
		await expect(first).rejects.toThrow('finalizer failed');
		expect(finalize).toHaveBeenCalledOnce();
		expect(xvfb.stop).toHaveBeenCalledOnce();
		expect(pulse.stop).toHaveBeenCalledOnce();
	});

	it('recovers sealing directly from the durable manifest without starting services', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const finalize = vi.fn(async () => 'partial' as const);
		const worker = new CaptureWorker('recover', options(root), {
			finalizer: () => ({ finalize }),
		});
		await worker.manifest.initialize();
		await worker.manifest.update((manifest) => {
			manifest.state = 'sealing';
			manifest.reason = 'service_shutdown';
			manifest.gaps.push({
				started_at: '2026-01-01T00:00:00.000Z',
				ended_at: '2026-01-01T00:00:01.000Z',
				reason: 'capture_interrupted',
			});
		});

		await expect(worker.recoverStopped()).resolves.toBe('partial');
		expect(finalize).toHaveBeenCalledWith(true, 'service_shutdown');
	});

	it('claims capacity during initialization and serializes concurrent stop', async () => {
		const renderer = new FakeRendererBridge();
		let release!: () => void;
		const initialized = new Promise<void>((resolve) => {
			release = resolve;
		});
		const stop = vi.fn(async () => 'complete' as const);
		const worker = {
			env: {},
			initialize: () => initialized,
			startCapture: vi.fn(async () => undefined),
			rendererFailed: vi.fn(async () => 'partial' as const),
			stop,
			recoverStopped: vi.fn(async () => 'complete' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{
				...options('/tmp'),
				maxConcurrent: 1,
			},
			() => worker,
		);
		const reserving = manager.reserve(command('one'));
		await expect(manager.reserve(command('two'))).rejects.toThrow(
			'capacity unavailable',
		);
		release();
		await expect(reserving).resolves.toEqual(TEST_PUBLIC_JWK);
		await Promise.all([manager.stop('one'), manager.stop('one')]);
		expect(stop).toHaveBeenCalledOnce();
		await expect(manager.recoverStopping('one')).resolves.toEqual({
			type: 'complete',
			gaps: [],
		});
		expect(worker.recoverStopped).toHaveBeenCalledOnce();
	});

	it('closes an initializing reservation without leaking capture services', async () => {
		const root = join(tmpdir(), `capture-lifecycle-${crypto.randomUUID()}`);
		roots.push(root);
		const renderer = new FakeRendererBridge();
		const xvfb = process();
		const pulse = process();
		let releaseXvfb!: () => void;
		const xvfbStarted = new Promise<void>((resolve) => {
			releaseXvfb = resolve;
		});
		let xvfbPending = true;
		const supervisor = {
			start: vi.fn(async (name: string) => {
				if (name === 'xvfb' && xvfbPending) {
					xvfbPending = false;
					await xvfbStarted;
					return xvfb;
				}
				if (name === 'pulse') return pulse;
				return process(0);
			}),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options(root), maxConcurrent: 1 },
			(job, createdOptions) =>
				new CaptureWorker(job, createdOptions, {
					supervisor: supervisor as unknown as ProcessSupervisor,
					sleep: async () => undefined,
				}),
		);

		const reserving = manager.reserve(command('initializing'));
		await vi.waitFor(() =>
			expect(supervisor.start).toHaveBeenCalledWith(
				'xvfb',
				expect.any(Array),
				expect.any(Object),
			),
		);
		const closing = manager.close();
		await expect(manager.reserve(command('late'))).rejects.toThrow('closing');
		releaseXvfb();

		await expect(reserving).rejects.toThrow('closing');
		await expect(closing).resolves.toBeUndefined();
		expect(xvfb.stop).toHaveBeenCalledOnce();
		expect(pulse.stop).toHaveBeenCalledOnce();
		expect(renderer.hasWorker('initializing')).toBe(false);
		expect(manager.hasWorker('initializing')).toBe(false);
	});

	it('stops workers and renderers before waiting for a blocked job queue', async () => {
		const renderer = new FakeRendererBridge();
		let releaseStart!: () => void;
		const startBlocked = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const stop = vi.fn(async () => 'partial' as const);
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => startBlocked),
			rendererFailed: vi.fn(async () => undefined),
			recoverRenderer: vi.fn(),
			stop,
			recoverStopped: vi.fn(async () => 'partial' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			() => worker,
		);
		manager.onLifecycle(async () => undefined);
		await manager.reserve(command('blocked-close'));
		const starting = renderer.emit({
			job: 'blocked-close',
			generation: 0,
			type: 'capture_ready',
		});
		await vi.waitFor(() => expect(worker.startCapture).toHaveBeenCalledOnce());

		const closing = manager.close();
		await vi.waitFor(() =>
			expect(stop).toHaveBeenCalledWith(true, 'service_shutdown'),
		);
		expect(renderer.hasWorker('blocked-close')).toBe(false);
		releaseStart();

		await expect(Promise.all([starting, closing])).resolves.toBeDefined();
	});

	it('publishes the exact persisted launch timestamp after both handshakes', async () => {
		const renderer = new FakeRendererBridge();
		let workerOptions: CaptureWorkerOptions | undefined;
		const timestamp = '2026-08-30T12:00:00.321Z';
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => {
				await workerOptions?.onCapturePreparing?.(0);
				await workerOptions?.onCaptureCommitted?.({
					epoch: 0,
					capture_started_at: timestamp,
				});
				await workerOptions?.onCaptureLaunched?.({
					epoch: 0,
					capture_started_at: timestamp,
				});
				return { epoch: 0, capture_started_at: timestamp };
			}),
			rendererFailed: vi.fn(async () => undefined),
			recoverRenderer: vi.fn(),
			stop: vi.fn(async () => 'complete' as const),
			recoverStopped: vi.fn(async () => 'complete' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			(_job, createdOptions) => {
				workerOptions = createdOptions;
				return worker;
			},
		);
		const lifecycle = vi.fn(async () => undefined);
		manager.onLifecycle(lifecycle);
		await manager.reserve(command('one'));

		await renderer.emit({
			job: 'one',
			generation: 0,
			type: 'capture_ready',
			occurredAt: '2026-08-30T11:59:00.000Z',
		});
		await workerOptions?.onCaptureCommitted?.({
			epoch: 1,
			capture_started_at: '2026-08-30T12:00:30.000Z',
		});

		expect(renderer.prepared).toEqual([
			{ job: 'one', generation: 0, epoch: 0 },
		]);
		expect(renderer.captureStarts).toEqual([
			{ job: 'one', generation: 0, epoch: 0, timestamp },
		]);
		expect(lifecycle).toHaveBeenCalledWith({
			job: 'one',
			generation: 0,
			type: 'capture_ready',
			occurredAt: timestamp,
		});
		expect(lifecycle).toHaveBeenCalledTimes(1);
		await manager.stop('one');
	});

	it('turns an initial capture handshake failure into terminal cleanup', async () => {
		const renderer = new FakeRendererBridge();
		const stop = vi.fn(async () => 'failed' as const);
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => {
				throw new Error('capture prepare failed');
			}),
			rendererFailed: vi.fn(async () => undefined),
			recoverRenderer: vi.fn(),
			stop,
			recoverStopped: vi.fn(async () => 'failed' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			() => worker,
		);
		const lifecycle = vi.fn(async () => undefined);
		manager.onLifecycle(lifecycle);
		await manager.reserve(command('one'));

		await renderer.emit({ job: 'one', generation: 0, type: 'capture_ready' });

		expect(stop).toHaveBeenCalledWith(false, 'capture prepare failed');
		expect(manager.hasWorker('one')).toBe(false);
		expect(lifecycle).toHaveBeenCalledWith(
			expect.objectContaining({
				job: 'one',
				type: 'failed',
				reason: 'capture prepare failed',
			}),
		);
	});

	it('cancels a blocked initial prepare before worker launch on host stop', async () => {
		const renderer = new FakeRendererBridge();
		let rejectPrepare!: (error: Error) => void;
		vi.spyOn(renderer, 'prepareCapture').mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectPrepare = reject;
				}),
		);
		vi.spyOn(renderer, 'stop').mockImplementation(async (job, generation) => {
			rejectPrepare?.(new Error('renderer stopped'));
			await FakeRendererBridge.prototype.stop.call(renderer, job, generation);
		});
		let workerOptions: CaptureWorkerOptions | undefined;
		const launched = vi.fn();
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => {
				await workerOptions?.onCapturePreparing?.(0);
				launched();
			}),
			rendererFailed: vi.fn(async () => undefined),
			recoverRenderer: vi.fn(),
			stop: vi.fn(async () => 'failed' as const),
			recoverStopped: vi.fn(async () => 'failed' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			(_job, createdOptions) => {
				workerOptions = createdOptions;
				return worker;
			},
		);
		manager.onLifecycle(async () => undefined);
		await manager.reserve(command('one'));
		const starting = renderer.emit({ job: 'one', type: 'capture_ready' });
		await vi.waitFor(() =>
			expect(renderer.prepareCapture).toHaveBeenCalledOnce(),
		);

		await expect(manager.stop('one', 0, 'host_stop')).resolves.toBeUndefined();
		await starting;
		expect(launched).not.toHaveBeenCalled();
		expect(worker.stop).toHaveBeenCalledWith(false, 'host_stop');
	});

	it('marks service shutdown as a partial non-host stop', async () => {
		const renderer = new FakeRendererBridge();
		const stop = vi.fn(async () => 'partial' as const);
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => undefined),
			rendererFailed: vi.fn(async () => undefined),
			recoverRenderer: vi.fn(),
			stop,
			recoverStopped: vi.fn(async () => 'partial' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			() => worker,
		);
		const lifecycle = vi.fn(async () => undefined);
		manager.onLifecycle(lifecycle);
		await manager.reserve(command('one'));

		await manager.close();

		expect(stop).toHaveBeenCalledWith(true, 'service_shutdown');
		expect(lifecycle).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'partial',
				reason: 'service_shutdown',
			}),
		);
	});

	it('stops capture when the renderer reports a human-empty room', async () => {
		const renderer = new FakeRendererBridge();
		const stop = vi.fn(async () => 'complete' as const);
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => undefined),
			rendererFailed: vi.fn(async () => 'partial' as const),
			stop,
			recoverStopped: vi.fn(async () => 'complete' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			() => worker,
		);
		const lifecycle = vi.fn(async () => undefined);
		manager.onLifecycle(lifecycle);
		await manager.reserve(command('one'));

		await renderer.emit({ job: 'one', type: 'room_empty' });

		expect(stop).toHaveBeenCalledWith(false, 'room_empty');
		expect(lifecycle).toHaveBeenCalledWith(
			expect.objectContaining({
				job: 'one',
				type: 'complete',
				reason: 'room_empty',
			}),
		);
	});

	it('starts segment-failure stopping immediately and completes as partial', async () => {
		const renderer = new FakeRendererBridge();
		const stop = vi.fn(async () => 'partial' as const);
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => undefined),
			rendererFailed: vi.fn(async () => 'partial' as const),
			stop,
			recoverStopped: vi.fn(async () => 'complete' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		let workerOptions: CaptureWorkerOptions | undefined;
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			(_job, createdOptions) => {
				workerOptions = createdOptions;
				return worker;
			},
		);
		const lifecycle = vi.fn(async () => undefined);
		manager.onLifecycle(lifecycle);
		await manager.reserve(command('one'));

		workerOptions?.onStopRequested?.(
			true,
			'capture_segment_failed:invalid media',
		);
		expect(stop).toHaveBeenCalledWith(
			true,
			'capture_segment_failed:invalid media',
		);

		await vi.waitFor(() =>
			expect(lifecycle).toHaveBeenCalledWith(
				expect.objectContaining({
					job: 'one',
					type: 'partial',
					reason: 'capture_segment_failed:invalid media',
				}),
			),
		);
		expect(stop).toHaveBeenCalledOnce();
		expect(manager.hasWorker('one')).toBe(false);
	});

	it.each([
		['capture_time_limit_reached', false, 'complete'],
		['capture_recovery_timeout', true, 'partial'],
	] as const)(
		'starts %s capture stop immediately',
		async (reason, partial, outcome) => {
			const renderer = new FakeRendererBridge();
			const stop = vi.fn(async () => outcome);
			const worker = {
				env: {},
				initialize: vi.fn(async () => undefined),
				startCapture: vi.fn(async () => undefined),
				rendererFailed: vi.fn(async () => 'partial' as const),
				stop,
				recoverStopped: vi.fn(async () => outcome),
				captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
			};
			let workerOptions: CaptureWorkerOptions | undefined;
			const manager = new CaptureWorkerManager(
				renderer,
				{ ...options('/tmp'), maxConcurrent: 1 },
				(_job, createdOptions) => {
					workerOptions = createdOptions;
					return worker;
				},
			);
			manager.onLifecycle(async () => undefined);
			await manager.reserve(command('one'));

			workerOptions?.onStopRequested?.(partial, reason);

			expect(stop).toHaveBeenCalledWith(partial, reason);
			await vi.waitFor(() => expect(manager.hasWorker('one')).toBe(false));
			expect(stop).toHaveBeenCalledOnce();
		},
	);

	it('retries fresh replacement generations under one interruption and recovers only through the worker', async () => {
		const renderer = new FakeRendererBridge();
		const originalReserve = renderer.reserve.bind(renderer);
		const reserve = vi
			.spyOn(renderer, 'reserve')
			.mockImplementation(async (claimedCommand, generation = 0) => {
				await originalReserve(claimedCommand, generation);
				return {
					...TEST_PUBLIC_JWK,
					x: `${String.fromCharCode(97 + generation)}${TEST_PUBLIC_JWK.x.slice(1)}`,
				};
			});
		let workerOptions: CaptureWorkerOptions | undefined;
		let interrupted = false;
		const recoverRenderer = vi.fn();
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => {
				await workerOptions?.onCaptureCommitted?.({
					epoch: 0,
					capture_started_at: '2026-08-30T12:00:00.000Z',
				});
			}),
			rendererFailed: vi.fn(async () => {
				if (interrupted) return;
				interrupted = true;
				workerOptions?.onInterrupted?.({
					id: '11111111-1111-4111-8111-111111111111',
					detected_at: new Date().toISOString(),
					deadline: new Date(Date.now() + 60_000).toISOString(),
					omission_started_at: new Date().toISOString(),
					reason: 'renderer:disconnected',
				});
			}),
			recoverRenderer,
			stop: vi.fn(async () => 'partial' as const),
			recoverStopped: vi.fn(async () => 'partial' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			(_job, createdOptions) => {
				workerOptions = createdOptions;
				return worker;
			},
		);
		const replacementEvents: Array<{
			generation: number;
			interruptionId?: string;
			publicJwk?: typeof TEST_PUBLIC_JWK;
		}> = [];
		manager.onLifecycle(async (event) => {
			if (event.type !== 'replacement_ready') return;
			replacementEvents.push(event);
			if (event.generation === 1) throw new Error('callback unavailable');
		});
		await manager.reserve(command('one'));
		await renderer.emit({ job: 'one', generation: 0, type: 'capture_ready' });
		await renderer.emit({
			job: 'one',
			generation: 0,
			type: 'failed',
			reason: 'disconnected',
		});

		await vi.waitFor(() => expect(replacementEvents).toHaveLength(2));
		expect(replacementEvents).toEqual([
			expect.objectContaining({
				generation: 1,
				interruptionId: '11111111-1111-4111-8111-111111111111',
				publicJwk: expect.objectContaining({
					x: `b${TEST_PUBLIC_JWK.x.slice(1)}`,
				}),
			}),
			expect.objectContaining({
				generation: 2,
				interruptionId: '11111111-1111-4111-8111-111111111111',
				publicJwk: expect.objectContaining({
					x: `c${TEST_PUBLIC_JWK.x.slice(1)}`,
				}),
			}),
		]);
		expect(reserve.mock.calls.map((call) => call[1])).toEqual([0, 1, 2]);
		await renderer.emit({ job: 'one', generation: 1, type: 'capture_ready' });
		expect(recoverRenderer).not.toHaveBeenCalled();
		await renderer.emit({ job: 'one', generation: 2, type: 'configured' });
		await renderer.emit({ job: 'one', generation: 2, type: 'capture_ready' });
		expect(recoverRenderer).toHaveBeenCalledOnce();
		await workerOptions?.onCapturePreparing?.(1);
		await workerOptions?.onCaptureLaunched?.({
			epoch: 1,
			capture_started_at: '2026-08-30T12:00:10.000Z',
		});
		expect(renderer.prepared.at(-1)).toEqual({
			job: 'one',
			generation: 2,
			epoch: 1,
		});
		expect(renderer.captureStarts.at(-1)).toEqual({
			job: 'one',
			generation: 2,
			epoch: 1,
			timestamp: '2026-08-30T12:00:10.000Z',
		});
		await manager.stop('one');
	});

	it('does not make host stop wait for a replacement callback or deadline', async () => {
		const renderer = new FakeRendererBridge();
		let workerOptions: CaptureWorkerOptions | undefined;
		const stop = vi.fn(async () => 'partial' as const);
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => {
				await workerOptions?.onCaptureCommitted?.({
					epoch: 0,
					capture_started_at: '2026-08-30T12:00:00.000Z',
				});
			}),
			rendererFailed: vi.fn(async () => {
				workerOptions?.onInterrupted?.({
					id: '11111111-1111-4111-8111-111111111111',
					detected_at: new Date().toISOString(),
					deadline: new Date(Date.now() + 60_000).toISOString(),
					omission_started_at: new Date().toISOString(),
					reason: 'renderer:disconnected',
				});
			}),
			recoverRenderer: vi.fn(),
			stop,
			recoverStopped: vi.fn(async () => 'partial' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			(_job, createdOptions) => {
				workerOptions = createdOptions;
				return worker;
			},
		);
		manager.onLifecycle(async (event) => {
			if (event.type === 'replacement_ready')
				await new Promise(() => undefined);
		});
		await manager.reserve(command('one'));
		await renderer.emit({ job: 'one', generation: 0, type: 'capture_ready' });
		await renderer.emit({ job: 'one', generation: 0, type: 'failed' });
		await vi.waitFor(() => expect(renderer.hasWorker('one')).toBe(true));

		await expect(manager.stop('one', 0, 'host_stop')).resolves.toBeUndefined();
		expect(stop).toHaveBeenCalledWith(false, 'host_stop');
		expect(manager.hasWorker('one')).toBe(false);
	});

	it('publishes interruption before waiting for terminal recovery timeout', async () => {
		const renderer = new FakeRendererBridge();
		let workerOptions: CaptureWorkerOptions | undefined;
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => {
				await workerOptions?.onCaptureCommitted?.({
					epoch: 0,
					capture_started_at: '2026-08-30T12:00:00.000Z',
				});
			}),
			rendererFailed: vi.fn(async (reason: string) => {
				workerOptions?.onInterrupted?.({
					id: '4cad3218-a956-4dec-a522-18f0dd3b75a2',
					detected_at: '2026-08-30T12:00:30.000Z',
					deadline: '2026-08-30T12:01:30.000Z',
					omission_started_at: '2026-08-30T12:00:00.000Z',
					reason: `renderer:${reason}`,
				});
			}),
			recoverRenderer: vi.fn(),
			stop: vi.fn(async () => 'complete' as const),
			recoverStopped: vi.fn(async () => 'complete' as const),
			captureResult: vi.fn(() => ({ artifact: undefined, gaps: [] })),
		};
		const manager = new CaptureWorkerManager(
			renderer,
			{ ...options('/tmp'), maxConcurrent: 1 },
			(_job, createdOptions) => {
				workerOptions = createdOptions;
				return worker;
			},
		);
		const lifecycle = vi.fn(async () => undefined);
		manager.onLifecycle(lifecycle);
		await manager.reserve(command('one'));
		await renderer.emit({ job: 'one', generation: 0, type: 'capture_ready' });

		const interrupted = renderer.emit({
			job: 'one',
			type: 'interrupted',
			reason: 'connection_lost',
		});
		await vi.waitFor(() =>
			expect(lifecycle).toHaveBeenCalledWith({
				job: 'one',
				generation: 0,
				type: 'interrupted',
				reason: 'renderer:connection_lost',
				interruption: {
					id: '4cad3218-a956-4dec-a522-18f0dd3b75a2',
					detected_at: '2026-08-30T12:00:30.000Z',
					deadline: '2026-08-30T12:01:30.000Z',
					omission_started_at: '2026-08-30T12:00:00.000Z',
					reason: 'renderer:connection_lost',
				},
			}),
		);
		expect(worker.rendererFailed).toHaveBeenCalledWith('connection_lost');

		await interrupted;
	});
});
