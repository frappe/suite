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
		const worker = new CaptureWorker(
			'ffmpeg-recovery',
			{ ...options(root), onInterrupted, onRecovered },
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
		expect(worker.manifest.get().gaps).toEqual([
			{
				started_at: '2026-08-30T12:00:30.000Z',
				ended_at: '2026-08-30T12:00:32.000Z',
				reason: 'ffmpeg_exited',
			},
		]);
		await worker.stop();
	});

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
			startCapture: vi.fn(async () => undefined),
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
		await manager.stop('one');
	});

	it('does not make host stop wait for a replacement callback or deadline', async () => {
		const renderer = new FakeRendererBridge();
		let workerOptions: CaptureWorkerOptions | undefined;
		const stop = vi.fn(async () => 'partial' as const);
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => undefined),
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
			startCapture: vi.fn(async () => undefined),
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
