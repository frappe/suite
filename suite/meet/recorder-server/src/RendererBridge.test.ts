import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'puppeteer-core';
import { describe, expect, it, vi } from 'vitest';
import {
	type BrowserAdapter,
	ChromiumRendererBridge,
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
		await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
		const shutdown = bridge.close();

		resolveLaunch(browser);
		await expect(reservation).rejects.toThrow('cancelled');
		await shutdown;
		expect(close).toHaveBeenCalledOnce();
		expect(bridge.hasWorker(command.job)).toBe(false);
	});

	it('reserves one isolated page, delivers trusted config, and stops idempotently', async () => {
		const assets = await mkdtemp(join(tmpdir(), 'renderer-assets-'));
		await writeFile(join(assets, 'recorder.html'), '<!doctype html>');
		let exposed: ((value: unknown) => void) | undefined;
		const evaluate = vi.fn(async () => {
			exposed?.({
				type: 'suite-recorder:configuration-accepted',
				protocol_version: 1,
				occurred_at: '2026-08-30T12:00:01.000Z',
				job: 'job-1',
			});
		});
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
		expect(evaluate).toHaveBeenCalledOnce();
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
