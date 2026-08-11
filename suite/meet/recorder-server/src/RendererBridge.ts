import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import express from 'express';
import puppeteer, {
	type Browser,
	type HTTPRequest,
	type Page,
} from 'puppeteer-core';
import type { CaptureArtifact, CaptureGap } from './captureTypes.js';
import type { CommandClaims, PublicJwk } from './types.js';

declare global {
	interface Window {
		__suiteRecorderLifecycle(value: unknown): void;
	}
}

export interface RendererBridge {
	readonly productionReady: boolean;
	reserve(command: CommandClaims): Promise<PublicJwk>;
	deliverGrant(job: string, grant: string, acceptedAt: string): Promise<void>;
	stop(job: string): Promise<void>;
	recoverStopping?(job: string): Promise<{
		type: 'complete' | 'partial' | 'failed';
		artifact?: CaptureArtifact;
		gaps?: CaptureGap[];
	}>;
	close?(): Promise<void>;
	hasWorker(job: string): boolean;
	onLifecycle(handler: (event: RendererLifecycleEvent) => Promise<void>): void;
}

export type RendererLifecycleEvent = {
	job: string;
	type:
		| 'configured'
		| 'proof_complete'
		| 'joined'
		| 'capture_ready'
		| 'interrupted'
		| 'room_empty'
		| 'failed'
		| 'complete'
		| 'partial';
	reason?: string;
	artifact?: CaptureArtifact;
	gaps?: CaptureGap[];
};

export interface BrowserAdapter {
	launch(options: Parameters<typeof puppeteer.launch>[0]): Promise<Browser>;
}

export interface ChromiumBridgeOptions {
	executablePath: string;
	assetDirectory: string;
	sfuOrigin: string;
	sfuSocketPath: string;
	trustedCommandOrigin: string;
	listenerPort: number;
	noSandbox: boolean;
	reserveTimeoutMs: number;
	configureTimeoutMs: number;
	workerEnvironment?: (job: string) => NodeJS.ProcessEnv | undefined;
}

interface RendererJob {
	browser: Browser;
	page: Page;
	command: CommandClaims;
	grantHash?: string;
	configurationAccepted?: Promise<void>;
	resolveConfiguration?: () => void;
	rejectConfiguration?: (error: Error) => void;
}

const browserAdapter: BrowserAdapter = {
	launch: (options) => puppeteer.launch(options),
};

function isPublicJwk(value: unknown): value is PublicJwk {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return (
		'kty' in value &&
		value.kty === 'EC' &&
		'crv' in value &&
		value.crv === 'P-256' &&
		'x' in value &&
		typeof value.x === 'string' &&
		'y' in value &&
		typeof value.y === 'string' &&
		/^[A-Za-z0-9_-]{43}$/.test(value.x) &&
		/^[A-Za-z0-9_-]{43}$/.test(value.y)
	);
}

export class ChromiumRendererBridge implements RendererBridge {
	private readonly jobs = new Map<string, RendererJob>();
	private server: Server | undefined;
	private rendererOrigin?: string;
	private available = false;
	private lifecycleHandler: (event: RendererLifecycleEvent) => Promise<void> =
		async () => undefined;

	constructor(
		private readonly options: ChromiumBridgeOptions,
		private readonly adapter: BrowserAdapter = browserAdapter,
	) {}

	get productionReady(): boolean {
		return this.available;
	}

	hasWorker(job: string): boolean {
		return this.jobs.has(job);
	}

	onLifecycle(handler: (event: RendererLifecycleEvent) => Promise<void>): void {
		this.lifecycleHandler = handler;
	}

	async initialize(): Promise<void> {
		await access(this.options.executablePath, constants.X_OK);
		const entrypoint = join(this.options.assetDirectory, 'recorder.html');
		if (!(await stat(entrypoint)).isFile())
			throw new Error('renderer entrypoint is unavailable');

		const app = express();
		app.disable('x-powered-by');
		app.use((_req, res, next) => {
			res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
			res.setHeader('X-Content-Type-Options', 'nosniff');
			const socketOrigin = this.socketOrigin();
			res.setHeader(
				'Content-Security-Policy',
				[
					"default-src 'none'",
					"script-src 'self'",
					"style-src 'self'",
					`img-src 'self' data: blob: ${this.options.trustedCommandOrigin}`,
					'media-src blob: data:',
					`connect-src ${this.options.sfuOrigin} ${socketOrigin}`,
					"font-src 'self'",
					"base-uri 'none'",
					"form-action 'none'",
					"frame-ancestors 'none'",
				].join('; '),
			);
			next();
		});
		app.use(express.static(this.options.assetDirectory, { index: false }));
		this.server = app.listen(this.options.listenerPort, '127.0.0.1');
		await new Promise<void>((resolve, reject) => {
			this.server?.once('listening', resolve);
			this.server?.once('error', reject);
		});
		const address = this.server.address() as AddressInfo;
		this.rendererOrigin = `http://127.0.0.1:${address.port}`;
		this.available = true;
	}

	async reserve(command: CommandClaims): Promise<PublicJwk> {
		if (!this.available || !this.rendererOrigin)
			throw new Error('renderer bridge is unavailable');
		if (this.jobs.has(command.job))
			throw new Error('renderer job already exists');

		const args = [
			'--autoplay-policy=no-user-gesture-required',
			'--disable-dev-shm-usage',
			'--disable-infobars',
		];
		if (this.options.noSandbox)
			args.push('--no-sandbox', '--disable-setuid-sandbox');
		const workerEnvironment = this.options.workerEnvironment?.(command.job);
		const browser = await this.adapter.launch({
			executablePath: this.options.executablePath,
			headless: false,
			...(workerEnvironment ? { env: workerEnvironment } : {}),
			defaultViewport: null,
			ignoreDefaultArgs: ['--enable-automation'],
			args: [
				...args,
				'--kiosk',
				'--window-position=0,0',
				'--window-size=1920,1080',
				'--force-device-scale-factor=1',
			],
		});
		try {
			const page = await browser.newPage();
			await page.setViewport({ width: 1920, height: 1080 });
			await page.setRequestInterception(true);
			page.on('request', (request) => void this.intercept(request));
			page.on('requestfailed', (request) => {
				const url = new URL(request.url());
				console.error(
					JSON.stringify({
						event: 'renderer_request_failed',
						job: command.job,
						url: `${url.origin}${url.pathname}`,
						reason: request.failure()?.errorText.slice(0, 256),
					}),
				);
			});
			page.on('console', (message) => {
				if (message.type() !== 'error') return;
				console.error(
					JSON.stringify({
						event: 'renderer_console_error',
						job: command.job,
						message: message.text().slice(0, 256),
					}),
				);
			});

			let resolveReady!: (jwk: PublicJwk) => void;
			let rejectReady!: (error: Error) => void;
			const ready = new Promise<PublicJwk>((resolve, reject) => {
				resolveReady = resolve;
				rejectReady = reject;
			});
			await page.exposeFunction(
				'__suiteRecorderLifecycle',
				(value: unknown) => {
					this.receive(command.job, value, resolveReady, rejectReady);
				},
			);
			await page.evaluateOnNewDocument(() => {
				window.addEventListener('message', (event) => {
					if (
						event.source === window &&
						event.origin === window.location.origin
					) {
						window.__suiteRecorderLifecycle(event.data);
					}
				});
			});
			let timeout: NodeJS.Timeout | undefined;
			const readyWithinDeadline = Promise.race([
				ready,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error('renderer readiness timed out')),
						this.options.reserveTimeoutMs,
					);
				}),
			]);
			await page.goto(`${this.rendererOrigin}/recorder.html`, {
				waitUntil: 'domcontentloaded',
				timeout: this.options.reserveTimeoutMs,
			});
			const publicJwk = await readyWithinDeadline.finally(() =>
				clearTimeout(timeout),
			);
			this.jobs.set(command.job, { browser, page, command });
			browser.on(
				'disconnected',
				() => void this.workerFailed(command.job, 'browser_disconnected'),
			);
			page.on(
				'error',
				() => void this.workerFailed(command.job, 'page_crashed'),
			);
			return publicJwk;
		} catch (error) {
			await browser.close();
			throw error;
		}
	}

	async deliverGrant(
		job: string,
		grant: string,
		acceptedAt: string,
	): Promise<void> {
		const renderer = this.jobs.get(job);
		if (!renderer) throw new Error('renderer job is unavailable');
		const hash = createHash('sha256').update(grant).digest('base64url');
		if (renderer.grantHash) {
			if (renderer.grantHash !== hash)
				throw new Error('conflicting renderer grant');
			await renderer.configurationAccepted;
			return;
		}
		renderer.grantHash = hash;
		renderer.configurationAccepted = new Promise<void>((resolve, reject) => {
			renderer.resolveConfiguration = resolve;
			renderer.rejectConfiguration = reject;
		});
		const config = {
			job,
			grant,
			meetingId: renderer.command.room,
			sfuOrigin: this.options.sfuOrigin,
			frappeOrigin: renderer.command.origin,
			socketPath: this.options.sfuSocketPath,
			startedAt: Date.parse(acceptedAt),
		};
		await renderer.page.evaluate((value) => {
			window.postMessage(
				{ type: 'suite-recorder:configure', config: value },
				window.location.origin,
			);
		}, config);
		let timeout: NodeJS.Timeout | undefined;
		try {
			await Promise.race([
				renderer.configurationAccepted,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error('renderer configuration timed out')),
						this.options.configureTimeoutMs,
					);
				}),
			]).finally(() => clearTimeout(timeout));
		} catch (error) {
			await this.stop(job);
			await this.lifecycleHandler({
				job,
				type: 'failed',
				reason: 'configuration_failed',
			});
			throw error;
		}
	}

	async stop(job: string): Promise<void> {
		const renderer = this.jobs.get(job);
		if (!renderer) return;
		this.jobs.delete(job);
		renderer.rejectConfiguration?.(new Error('renderer stopped'));
		await renderer.browser.close().catch(() => undefined);
	}

	async close(): Promise<void> {
		this.available = false;
		await Promise.all([...this.jobs.keys()].map((job) => this.stop(job)));
		if (!this.server) return;
		await new Promise<void>((resolve, reject) =>
			this.server?.close((error) => (error ? reject(error) : resolve())),
		);
		this.server = undefined;
	}

	private async intercept(request: HTTPRequest): Promise<void> {
		try {
			const url = new URL(request.url());
			const frame = request.frame();
			const rendererAsset =
				url.origin === this.rendererOrigin &&
				(url.pathname === '/recorder.html' ||
					/^\/assets\/[A-Za-z0-9._-]+\.(?:css|js|woff2?)$/.test(url.pathname));
			const commandAsset =
				url.origin === this.options.trustedCommandOrigin &&
				request.resourceType() === 'image' &&
				(url.pathname.startsWith('/files/') ||
					url.pathname.startsWith('/private/files/'));
			const sfuRequest =
				(url.origin === this.options.sfuOrigin ||
					url.origin === this.socketOrigin()) &&
				(url.pathname === this.options.sfuSocketPath ||
					url.pathname.startsWith(`${this.options.sfuSocketPath}/`));
			const localData =
				(url.protocol === 'data:' || url.protocol === 'blob:') &&
				['image', 'media'].includes(request.resourceType());
			const initialNavigation =
				request.isNavigationRequest() &&
				frame !== null &&
				frame === frame.page()?.mainFrame() &&
				rendererAsset &&
				url.pathname === '/recorder.html';
			if (
				request.method() !== 'GET' ||
				request.redirectChain().length > 0 ||
				(request.isNavigationRequest() && !initialNavigation) ||
				(!rendererAsset && !commandAsset && !sfuRequest && !localData)
			) {
				await request.abort('blockedbyclient');
			} else {
				await request.continue();
			}
		} catch {
			await request.abort('blockedbyclient');
		}
	}

	private socketOrigin(): string {
		const url = new URL(this.options.sfuOrigin);
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		return url.origin;
	}

	private receive(
		job: string,
		value: unknown,
		resolveReady: (jwk: PublicJwk) => void,
		rejectReady: (error: Error) => void,
	): void {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return;
		if ('type' in value && value.type === 'suite-recorder:public-key-ready') {
			if ('publicKey' in value && isPublicJwk(value.publicKey)) {
				const { kty, crv, x, y } = value.publicKey;
				resolveReady({ kty, crv, x, y });
			} else rejectReady(new Error('renderer returned an invalid public JWK'));
			return;
		}
		if (!('job' in value) || value.job !== job || !('type' in value)) return;
		const renderer = this.jobs.get(job);
		const type = rendererLifecycleType(value.type);
		if (!type) return;
		if (type === 'configured') renderer?.resolveConfiguration?.();
		const reason =
			'reason' in value && typeof value.reason === 'string'
				? value.reason.slice(0, 256)
				: undefined;
		void this.lifecycleHandler({ job, type, ...(reason ? { reason } : {}) });
	}

	private async workerFailed(job: string, reason: string): Promise<void> {
		const renderer = this.jobs.get(job);
		if (!renderer) return;
		renderer.rejectConfiguration?.(new Error(reason));
		await this.lifecycleHandler({ job, type: 'failed', reason });
	}
}

function rendererLifecycleType(
	value: unknown,
): RendererLifecycleEvent['type'] | undefined {
	switch (value) {
		case 'suite-recorder:configuration-accepted':
			return 'configured';
		case 'suite-recorder:proof-complete':
			return 'proof_complete';
		case 'suite-recorder:join-complete':
			return 'joined';
		case 'suite-recorder:capture-ready':
			return 'capture_ready';
		case 'suite-recorder:interruption':
			return 'interrupted';
		case 'suite-recorder:room-empty':
			return 'room_empty';
		case 'suite-recorder:failure':
			return 'failed';
		default:
			return undefined;
	}
}

export const TEST_PUBLIC_JWK: PublicJwk = {
	kty: 'EC',
	crv: 'P-256',
	x: 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY',
	y: 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
};

export class FakeRendererBridge implements RendererBridge {
	readonly productionReady = false;
	readonly grants: Array<{ job: string; grant: string; acceptedAt: string }> =
		[];
	readonly stopped = new Set<string>();
	private readonly workers = new Set<string>();
	private handler: (event: RendererLifecycleEvent) => Promise<void> =
		async () => undefined;
	hasWorker(job: string): boolean {
		return this.workers.has(job);
	}
	onLifecycle(handler: (event: RendererLifecycleEvent) => Promise<void>): void {
		this.handler = handler;
	}
	async emit(event: RendererLifecycleEvent): Promise<void> {
		await this.handler(event);
	}

	async reserve(command: CommandClaims): Promise<PublicJwk> {
		this.workers.add(command.job);
		return TEST_PUBLIC_JWK;
	}
	async deliverGrant(
		job: string,
		grant: string,
		acceptedAt: string,
	): Promise<void> {
		this.grants.push({ job, grant, acceptedAt });
		void this.handler({ job, type: 'configured' });
	}
	async stop(job: string): Promise<void> {
		this.stopped.add(job);
		this.workers.delete(job);
	}
}
