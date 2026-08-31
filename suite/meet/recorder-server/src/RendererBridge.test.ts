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
					publicKey: { ...TEST_PUBLIC_JWK, ext: true, key_ops: ['verify'] },
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

		await bridge.deliverGrant('job-1', 'private-grant', '2026-07-31T12:00:00Z');
		expect(evaluate.mock.calls[0]?.[1]).toEqual({
			job: 'job-1',
			grant: 'private-grant',
			frappeOrigin: 'https://site.test',
			meetingId: 'room-1',
			sfuOrigin: 'https://sfu.test',
			socketPath: '/socket.io',
			startedAt: Date.parse('2026-07-31T12:00:00Z'),
		});
		await bridge.deliverGrant('job-1', 'private-grant', '2026-07-31T12:00:00Z');
		expect(evaluate).toHaveBeenCalledOnce();
		await expect(
			bridge.deliverGrant('job-1', 'different-grant', '2026-07-31T12:00:00Z'),
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
