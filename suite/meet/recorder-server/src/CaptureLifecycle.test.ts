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

	it('routes worker-requested stops through lifecycle completion', async () => {
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

		workerOptions?.onStopRequested?.(false, 'capture_budget_reached');

		await vi.waitFor(() =>
			expect(lifecycle).toHaveBeenCalledWith(
				expect.objectContaining({
					job: 'one',
					type: 'complete',
					reason: 'capture_budget_reached',
				}),
			),
		);
		expect(stop).toHaveBeenCalledWith(false, 'capture_budget_reached');
		expect(manager.hasWorker('one')).toBe(false);
	});

	it('publishes interruption before waiting for terminal recovery timeout', async () => {
		const renderer = new FakeRendererBridge();
		let finishRecovery!: (outcome: 'partial') => void;
		const recovery = new Promise<'partial'>((resolve) => {
			finishRecovery = resolve;
		});
		const worker = {
			env: {},
			initialize: vi.fn(async () => undefined),
			startCapture: vi.fn(async () => undefined),
			rendererFailed: vi.fn(() => recovery),
			stop: vi.fn(async () => 'complete' as const),
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

		const interrupted = renderer.emit({
			job: 'one',
			type: 'interrupted',
			reason: 'connection_lost',
		});
		await vi.waitFor(() =>
			expect(lifecycle).toHaveBeenCalledWith({
				job: 'one',
				type: 'interrupted',
				reason: 'connection_lost',
			}),
		);
		expect(worker.rendererFailed).toHaveBeenCalledWith('connection_lost');

		finishRecovery('partial');
		await interrupted;
	});
});
