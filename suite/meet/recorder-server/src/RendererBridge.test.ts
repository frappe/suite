import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'puppeteer-core';
import { describe, expect, it, vi } from 'vitest';
import {
	type BrowserAdapter,
	ChromiumRendererBridge,
	parseCapturePrepared,
	parseCaptureStartedAccepted,
	TEST_PUBLIC_JWK,
} from './RendererBridge.js';
import { COMMAND_AUDIENCE, type CommandClaims } from './types.js';

const command: CommandClaims = {
	iss: 'frappe-site:site.test',
	aud: COMMAND_AUDIENCE,
	site: 'site.test',
	origin: 'https://site.test',
	room: 'room-1',
	recording: 'recording-1',
	job: 'job-1',
	operation: 'reserve',
	policy: { recording_allowed: true },
	limits: {
		budget_bytes: 1_000_000,
		max_ends_at: '2026-07-31T12:00:00Z',
		output: {
			width: 1920,
			height: 1080,
			fps: 30,
			video: 'h264',
			audio: 'aac',
		},
	},
	jti: 'nonce',
	iat: 1,
	exp: 2,
};

describe('ChromiumRendererBridge', () => {
	it('strictly parses capture acknowledgements', () => {
		expect(
			parseCapturePrepared({
				type: 'suite-recorder:capture-prepared',
				protocol_version: 1,
				occurred_at: '2026-08-30T12:00:00.000Z',
				job: 'job-1',
				epoch: 0,
			}),
		).toEqual({
			job: 'job-1',
			epoch: 0,
			occurredAt: '2026-08-30T12:00:00.000Z',
		});
		expect(
			parseCaptureStartedAccepted({
				type: 'suite-recorder:capture-started-accepted',
				protocol_version: 1,
				occurred_at: '2026-08-30T12:00:01.000Z',
				job: 'job-1',
				epoch: 0,
				capture_started_at: '2026-08-30T12:00:00.000Z',
			})?.captureStartedAt,
		).toBe('2026-08-30T12:00:00.000Z');
		for (const invalid of [
			{ epoch: -1 },
			{ epoch: 0, extra: true },
			{ epoch: 0, occurred_at: '2026-08-30T12:00:00Z' },
		])
			expect(
				parseCapturePrepared({
					type: 'suite-recorder:capture-prepared',
					protocol_version: 1,
					occurred_at: '2026-08-30T12:00:00.000Z',
					job: 'job-1',
					...invalid,
				}),
			).toBeUndefined();
	});

	it.each([
		{
			type: 'suite-recorder:public-key-ready',
			publicKey: TEST_PUBLIC_JWK,
		},
		{
			type: 'suite-recorder:public-key-ready',
			protocol_version: 2,
			occurred_at: '2026-08-30T12:00:00.000Z',
			publicKey: TEST_PUBLIC_JWK,
		},
		{
			type: 'suite-recorder:public-key-ready',
			protocol_version: 1,
			occurred_at: '2026-08-30T12:00:00.000Z',
			publicKey: TEST_PUBLIC_JWK,
			extra: true,
		},
		{
			type: 'suite-recorder:public-key-ready',
			protocol_version: 1,
			occurred_at: '2026-08-30T12:00:00.000Z',
			publicKey: { ...TEST_PUBLIC_JWK, ext: true },
		},
	])('rejects malformed public-key message %#', (message) => {
		const bridge = new ChromiumRendererBridge({} as never);
		const resolveReady = vi.fn();
		const rejectReady = vi.fn();
		const receive = Reflect.get(bridge, 'receive') as (
			job: string,
			generation: number,
			value: unknown,
			resolve: typeof resolveReady,
			reject: typeof rejectReady,
		) => void;

		receive.call(bridge, 'job-1', 0, message, resolveReady, rejectReady);

		expect(resolveReady).not.toHaveBeenCalled();
		expect(rejectReady).toHaveBeenCalledOnce();
	});

	it('cancels and awaits a Chromium launch during shutdown', async () => {
		const assets = await mkdtemp(join(tmpdir(), 'renderer-assets-'));
		await writeFile(join(assets, 'recorder.html'), '<!doctype html>');
		let resolveLaunch!: (browser: Browser) => void;
		const launch = vi.fn(
			() =>
				new Promise<Browser>((resolve) => {
					resolveLaunch = resolve;
				}),
		);
		const close = vi.fn(async () => undefined);
		const browser = {
			newPage: vi.fn(),
			close,
			on: vi.fn(),
		} as unknown as Browser;
		const bridge = new ChromiumRendererBridge(
			{
				executablePath: process.execPath,
				assetDirectory: assets,
				sfuOrigin: 'https://sfu.test',
				sfuSocketPath: '/socket.io',
				trustedCommandOrigin: 'https://site.test',
				listenerPort: 0,
				noSandbox: false,
				reserveTimeoutMs: 1_000,
				configureTimeoutMs: 1_000,
			},
			{ launch },
		);
		await bridge.initialize();
		const reservation = bridge.reserve(command);
		const rejectedReservation =
			expect(reservation).rejects.toThrow('cancelled');
		await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
		const shutdown = bridge.close();

		await shutdown;
		await rejectedReservation;
		resolveLaunch(browser);
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		expect(close).toHaveBeenCalledOnce();
		expect(bridge.hasWorker(command.job)).toBe(false);
	});

	it('bounds the Chromium adapter launch with the reservation timeout', async () => {
		const assets = await mkdtemp(join(tmpdir(), 'renderer-assets-'));
		await writeFile(join(assets, 'recorder.html'), '<!doctype html>');
		const bridge = new ChromiumRendererBridge(
			{
				executablePath: process.execPath,
				assetDirectory: assets,
				sfuOrigin: 'https://sfu.test',
				sfuSocketPath: '/socket.io',
				trustedCommandOrigin: 'https://site.test',
				listenerPort: 0,
				noSandbox: false,
				reserveTimeoutMs: 10,
				configureTimeoutMs: 1_000,
			},
			{ launch: vi.fn(() => new Promise<Browser>(() => undefined)) },
		);
		await bridge.initialize();

		await expect(bridge.reserve(command)).rejects.toThrow('launch timed out');
		await bridge.close();
	});

	it('times out and rejects pending capture handshakes on stop', async () => {
		const close = vi.fn(async () => undefined);
		const bridge = new ChromiumRendererBridge({
			configureTimeoutMs: 10,
		} as never);
		const jobs = Reflect.get(bridge, 'jobs') as Map<string, unknown>;
		jobs.set('job-1', {
			browser: { close },
			page: { evaluate: vi.fn(async () => undefined) },
			command,
			generation: 0,
		});
		await expect(bridge.prepareCapture('job-1', 0, 0)).rejects.toThrow(
			'timed out',
		);

		jobs.set('job-1', {
			browser: { close },
			page: { evaluate: vi.fn(async () => undefined) },
			command,
			generation: 0,
		});
		const pending = bridge.prepareCapture('job-1', 0, 0);
		await bridge.stop('job-1', 0);
		await expect(pending).rejects.toThrow('renderer stopped');
	});

	it('ignores valid stale acknowledgements without rejecting the current epoch', () => {
		const bridge = new ChromiumRendererBridge({} as never);
		const rejectPrepared = vi.fn();
		const rejectStarted = vi.fn();
		const jobs = Reflect.get(bridge, 'jobs') as Map<string, unknown>;
		jobs.set('job-1', {
			generation: 0,
			capture: {
				epoch: 2,
				prepared: Promise.resolve(),
				preparedAccepted: true,
				resolvePrepared: vi.fn(),
				rejectPrepared,
				started: {
					timestamp: '2026-08-30T12:00:02.000Z',
					accepted: Promise.resolve(),
					acceptedByRenderer: false,
					resolve: vi.fn(),
					reject: rejectStarted,
				},
			},
		});
		const receive = Reflect.get(bridge, 'receiveCaptureAcknowledgement').bind(
			bridge,
		) as (job: string, generation: number, value: object) => void;
		receive('job-1', 0, {
			type: 'suite-recorder:capture-prepared',
			protocol_version: 1,
			occurred_at: '2026-08-30T12:00:00.000Z',
			job: 'job-1',
			epoch: 1,
		});
		receive('job-1', 0, {
			type: 'suite-recorder:capture-started-accepted',
			protocol_version: 1,
			occurred_at: '2026-08-30T12:00:00.000Z',
			job: 'job-1',
			epoch: 1,
			capture_started_at: '2026-08-30T12:00:01.000Z',
		});
		expect(rejectPrepared).not.toHaveBeenCalled();
		expect(rejectStarted).not.toHaveBeenCalled();

		receive('job-1', 0, {
			type: 'suite-recorder:capture-started-accepted',
			protocol_version: 1,
			occurred_at: '2026-08-30T12:00:02.001Z',
			job: 'job-1',
			epoch: 2,
			capture_started_at: '2026-08-30T12:00:02.001Z',
		});
		expect(rejectStarted).toHaveBeenCalledOnce();
	});

	it('allows the next epoch after a capture-start acknowledgement timeout', async () => {
		const bridge = new ChromiumRendererBridge({
			configureTimeoutMs: 5,
		} as never);
		const jobs = Reflect.get(bridge, 'jobs') as Map<string, unknown>;
		const receive = Reflect.get(bridge, 'receiveCaptureAcknowledgement').bind(
			bridge,
		) as (job: string, generation: number, value: object) => void;
		const page = {
			evaluate: vi.fn(
				async (_callback, value: { type: string; epoch: number }) => {
					if (value.type === 'suite-recorder:prepare-capture')
						receive('job-1', 0, {
							type: 'suite-recorder:capture-prepared',
							protocol_version: 1,
							occurred_at: '2026-08-30T12:00:00.000Z',
							job: 'job-1',
							epoch: value.epoch,
						});
				},
			),
		};
		jobs.set('job-1', {
			browser: { close: vi.fn() },
			page,
			command,
			generation: 0,
		});
		await bridge.prepareCapture('job-1', 0, 0);
		await expect(
			bridge.captureStarted('job-1', 0, 0, '2026-08-30T12:00:00.000Z'),
		).rejects.toThrow('timed out');

		await expect(bridge.prepareCapture('job-1', 0, 1)).resolves.toBeUndefined();
	});

	it('allows a newer epoch to supersede an acknowledged prepare with no start', async () => {
		const bridge = new ChromiumRendererBridge({
			configureTimeoutMs: 100,
		} as never);
		const jobs = Reflect.get(bridge, 'jobs') as Map<string, unknown>;
		const receive = Reflect.get(bridge, 'receiveCaptureAcknowledgement').bind(
			bridge,
		) as (job: string, generation: number, value: object) => void;
		const page = {
			evaluate: vi.fn(async (_callback, value: { epoch: number }) => {
				receive('job-1', 0, {
					type: 'suite-recorder:capture-prepared',
					protocol_version: 1,
					occurred_at: '2026-08-30T12:00:00.000Z',
					job: 'job-1',
					epoch: value.epoch,
				});
			}),
		};
		jobs.set('job-1', {
			browser: { close: vi.fn() },
			page,
			command,
			generation: 0,
		});

		await bridge.prepareCapture('job-1', 0, 0);
		await expect(bridge.prepareCapture('job-1', 0, 1)).resolves.toBeUndefined();
		expect(page.evaluate).toHaveBeenCalledTimes(2);
	});

	it('reserves one isolated page, delivers trusted config, and stops idempotently', async () => {
		const assets = await mkdtemp(join(tmpdir(), 'renderer-assets-'));
		await writeFile(join(assets, 'recorder.html'), '<!doctype html>');
		let exposed: ((value: unknown) => void) | undefined;
		const evaluate = vi.fn(
			async (
				_callback,
				value: { type: string; epoch?: number; capture_started_at?: string },
			) => {
				if (value.type === 'suite-recorder:configure')
					exposed?.({
						type: 'suite-recorder:configuration-accepted',
						protocol_version: 1,
						occurred_at: '2026-08-30T12:00:01.000Z',
						job: 'job-1',
					});
				if (value.type === 'suite-recorder:prepare-capture')
					exposed?.({
						type: 'suite-recorder:capture-prepared',
						protocol_version: 1,
						occurred_at: '2026-08-30T12:00:02.000Z',
						job: 'job-1',
						epoch: value.epoch,
					});
				if (value.type === 'suite-recorder:capture-started')
					exposed?.({
						type: 'suite-recorder:capture-started-accepted',
						protocol_version: 1,
						occurred_at: '2026-08-30T12:00:03.000Z',
						job: 'job-1',
						epoch: value.epoch,
						capture_started_at: value.capture_started_at,
					});
			},
		);
		const page = {
			setViewport: vi.fn(),
			setRequestInterception: vi.fn(),
			on: vi.fn(),
			exposeFunction: vi.fn(async (_name, callback) => {
				exposed = callback as (value: unknown) => void;
			}),
			evaluateOnNewDocument: vi.fn(),
			goto: vi.fn(async () => {
				exposed?.({
					type: 'suite-recorder:public-key-ready',
					protocol_version: 1,
					occurred_at: '2026-08-30T12:00:00.000Z',
					publicKey: TEST_PUBLIC_JWK,
				});
				return null;
			}),
			evaluate,
		} as unknown as Page;
		const close = vi.fn(async () => undefined);
		const browser = {
			newPage: vi.fn(async () => page),
			close,
			on: vi.fn(),
		} as unknown as Browser;
		const adapter: BrowserAdapter = {
			launch: vi.fn(async () => browser),
		};
		const bridge = new ChromiumRendererBridge(
			{
				executablePath: process.execPath,
				assetDirectory: assets,
				sfuOrigin: 'https://sfu.test',
				sfuSocketPath: '/socket.io',
				trustedCommandOrigin: 'https://site.test',
				listenerPort: 0,
				noSandbox: false,
				reserveTimeoutMs: 1_000,
				configureTimeoutMs: 1_000,
			},
			adapter,
		);
		const lifecycle = vi.fn(async () => undefined);
		bridge.onLifecycle(lifecycle);

		await bridge.initialize();
		expect(bridge.productionReady).toBe(true);
		expect(await bridge.reserve(command)).toEqual(TEST_PUBLIC_JWK);
		expect(page.setViewport).toHaveBeenCalledWith({
			width: 1920,
			height: 1080,
		});
		expect(page.evaluateOnNewDocument).toHaveBeenCalledBefore(
			page.goto as never,
		);

		await bridge.deliverGrant(
			'job-1',
			'private-grant',
			'2026-07-31T12:00:00.000Z',
		);
		expect(evaluate.mock.calls[0]?.[1]).toEqual({
			type: 'suite-recorder:configure',
			protocol_version: 1,
			config: {
				job: 'job-1',
				grant: 'private-grant',
				frappeOrigin: 'https://site.test',
				meetingId: 'room-1',
				sfuOrigin: 'https://sfu.test',
				socketPath: '/socket.io',
				acceptedAt: '2026-07-31T12:00:00.000Z',
			},
		});
		expect(lifecycle).toHaveBeenCalledTimes(1);
		await bridge.prepareCapture('job-1', 0, 0);
		await bridge.prepareCapture('job-1', 0, 0);
		await bridge.captureStarted('job-1', 0, 0, '2026-08-30T12:00:02.500Z');
		await expect(
			bridge.captureStarted('job-1', 0, 0, '2026-08-30T12:00:02.501Z'),
		).rejects.toThrow('conflicting');
		await bridge.captureStarted('job-1', 0, 0, '2026-08-30T12:00:02.500Z');
		expect(evaluate.mock.calls.slice(1).map((call) => call[1])).toEqual([
			{
				type: 'suite-recorder:prepare-capture',
				protocol_version: 1,
				job: 'job-1',
				epoch: 0,
			},
			{
				type: 'suite-recorder:capture-started',
				protocol_version: 1,
				job: 'job-1',
				epoch: 0,
				capture_started_at: '2026-08-30T12:00:02.500Z',
			},
		]);
		await expect(bridge.prepareCapture('job-1', 0, 1)).resolves.toBeUndefined();
		await expect(bridge.prepareCapture('job-1', 0, 0)).rejects.toThrow('stale');
		for (const message of [
			{ type: 'suite-recorder:capture-ready', job: 'job-1' },
			{
				type: 'suite-recorder:capture-ready',
				protocol_version: 2,
				occurred_at: '2026-08-30T12:00:02.000Z',
				job: 'job-1',
			},
			{
				type: 'suite-recorder:capture-ready',
				protocol_version: 1,
				occurred_at: '2026-08-30T12:00:02.000Z',
				job: 'job-1',
				extra: true,
			},
			{
				type: 'suite-recorder:interruption',
				protocol_version: 1,
				occurred_at: '2026-08-30T12:00:02.000Z',
				job: 'job-1',
				reason_code: 'arbitrary_reason',
			},
			{
				type: 'suite-recorder:interruption',
				protocol_version: 1,
				occurred_at: '2026-08-30T12:00:02.000Z',
				job: 'job-1',
				reason_code: 'sfu_disconnected',
				diagnostic: 'x'.repeat(257),
			},
		])
			exposed?.(message);
		expect(lifecycle).toHaveBeenCalledTimes(1);
		exposed?.({
			type: 'suite-recorder:interruption',
			protocol_version: 1,
			occurred_at: '2026-08-30T12:00:02.000Z',
			job: 'job-1',
			reason_code: 'sfu_disconnected',
			diagnostic: 'connection lost',
		});
		expect(lifecycle).toHaveBeenLastCalledWith({
			job: 'job-1',
			generation: 0,
			type: 'interrupted',
			reason: 'sfu_disconnected',
			occurredAt: '2026-08-30T12:00:02.000Z',
		});
		await bridge.deliverGrant(
			'job-1',
			'private-grant',
			'2026-07-31T12:00:00.000Z',
		);
		expect(evaluate).toHaveBeenCalledTimes(4);
		await expect(
			bridge.deliverGrant(
				'job-1',
				'different-grant',
				'2026-07-31T12:00:00.000Z',
			),
		).rejects.toThrow('conflicting');

		await bridge.stop('job-1');
		await bridge.stop('job-1');
		expect(close).toHaveBeenCalledOnce();
		await bridge.close();
		expect(bridge.productionReady).toBe(false);
	});

	it.each([
		['error', 'page_crashed'],
		['disconnected', 'browser_disconnected'],
	])('reports %s as failed and closes the worker', async (event, reason) => {
		const assets = await mkdtemp(join(tmpdir(), 'renderer-assets-'));
		await writeFile(join(assets, 'recorder.html'), '<!doctype html>');
		let exposed: ((value: unknown) => void) | undefined;
		const pageHandlers = new Map<string, () => void>();
		const browserHandlers = new Map<string, () => void>();
		const page = {
			setViewport: vi.fn(),
			setRequestInterception: vi.fn(),
			on: vi.fn((name: string, handler: () => void) =>
				pageHandlers.set(name, handler),
			),
			exposeFunction: vi.fn(async (_name, callback) => {
				exposed = callback as (value: unknown) => void;
			}),
			evaluateOnNewDocument: vi.fn(),
			goto: vi.fn(async () => {
				exposed?.({
					type: 'suite-recorder:public-key-ready',
					protocol_version: 1,
					occurred_at: '2026-08-30T12:00:00.000Z',
					publicKey: TEST_PUBLIC_JWK,
				});
				return null;
			}),
		} as unknown as Page;
		const close = vi.fn(async () => undefined);
		const browser = {
			newPage: vi.fn(async () => page),
			close,
			on: vi.fn((name: string, handler: () => void) =>
				browserHandlers.set(name, handler),
			),
		} as unknown as Browser;
		const bridge = new ChromiumRendererBridge(
			{
				executablePath: process.execPath,
				assetDirectory: assets,
				sfuOrigin: 'https://sfu.test',
				sfuSocketPath: '/socket.io',
				trustedCommandOrigin: 'https://site.test',
				listenerPort: 0,
				noSandbox: false,
				reserveTimeoutMs: 1_000,
				configureTimeoutMs: 1_000,
			},
			{ launch: vi.fn(async () => browser) },
		);
		const lifecycle = vi.fn(async ({ job }: { job: string }) =>
			bridge.stop(job),
		);
		bridge.onLifecycle(lifecycle);
		await bridge.initialize();
		await bridge.reserve(command);

		const handler =
			event === 'error' ? pageHandlers.get(event) : browserHandlers.get(event);
		handler?.();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());

		expect(lifecycle).toHaveBeenCalledWith({
			job: 'job-1',
			generation: 0,
			type: 'failed',
			reason,
		});
		expect(bridge.hasWorker('job-1')).toBe(false);
		await bridge.close();
	});
});
