import { mkdtemp, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, AuthManager } from './AuthManager.js';
import { createApp } from './app.js';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import { JobManager } from './JobManager.js';
import { JobStore } from './JobStore.js';
import type { LogEntry, Logger } from './logger.js';
import { FakeRendererBridge, TEST_PUBLIC_JWK } from './RendererBridge.js';
import { COMMAND_AUDIENCE, COMMAND_TYPE, type CommandClaims } from './types.js';

const secret = 'a-long-enough-test-secret-for-hs256';
const now = Math.floor(Date.now() / 1000);
const baseClaims = {
	iss: 'frappe-site:site.test',
	aud: COMMAND_AUDIENCE,
	site: 'site.test',
	origin: 'https://site.test',
	room: 'room',
	recording: 'recording',
	job: 'job',
	operation: 'reserve',
	jti: 'nonce',
	iat: now,
	exp: now + 30,
	limits: {
		budget_bytes: 1_000_000,
		max_ends_at: '2026-07-31T12:00:00Z',
		output: { width: 1920, height: 1080, fps: 30, video: 'h264', audio: 'aac' },
	},
} satisfies CommandClaims;

function token(
	overrides: Partial<Omit<CommandClaims, 'aud' | 'limits'>> & {
		aud?: string;
		limits?: CommandClaims['limits'];
		extra?: boolean;
	} = {},
	header: { typ?: string; kid?: string } = {},
): string {
	return jwt.sign(
		{ ...baseClaims, jti: crypto.randomUUID(), ...overrides },
		secret,
		{
			algorithm: 'HS256',
			header: { alg: 'HS256', typ: COMMAND_TYPE, ...header },
		},
	);
}

async function call(
	app: Express,
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	const server = app.listen(0);
	try {
		await new Promise<void>((resolve) => server.once('listening', resolve));
		const address = server.address();
		if (!address || typeof address === 'string')
			throw new Error('test server has no TCP address');
		return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
	} finally {
		server.close();
	}
}

function authenticated(
	method = 'GET',
	body?: object,
	signed = token(),
): RequestInit {
	return {
		method,
		headers: {
			Authorization: `Bearer ${signed}`,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	};
}

describe('configuration', () => {
	it('loads a strict production configuration', () => {
		const config = loadConfig({
			RECORDER_SECRET: secret,
			RECORDER_METRICS_TOKEN: 'm'.repeat(32),
			RECORDER_SITE: 'site.test',
			RECORDER_SITE_ORIGIN: 'https://site.test',
			RECORDER_LEDGER_PATH: '/data/jobs.json',
			CHROMIUM_EXECUTABLE: '/usr/bin/chromium',
			RECORDER_RENDERER_ASSET_DIR: '/app/renderer',
			SFU_ORIGIN: 'https://sfu.test',
			SFU_SOCKET_PATH: '/socket.io',
		});
		expect(config.port).toBe(3010);
		expect(config.maxConcurrent).toBe(1);
	});

	it.each([
		['RECORDER_SECRET', 'short'],
		['RECORDER_METRICS_TOKEN', 'short'],
		['RECORDER_SITE_ORIGIN', 'http://site.test'],
		['RECORDER_SITE_ORIGIN', 'https://site.test/'],
		['RECORDER_MAX_CONCURRENT', '0'],
		['PORT', 'x'],
	])('rejects invalid %s', (name, value) => {
		const env: NodeJS.ProcessEnv = {
			RECORDER_SECRET: secret,
			RECORDER_METRICS_TOKEN: 'm'.repeat(32),
			RECORDER_SITE: 'site.test',
			RECORDER_SITE_ORIGIN: 'https://site.test',
			RECORDER_LEDGER_PATH: '/data/jobs.json',
			CHROMIUM_EXECUTABLE: '/usr/bin/chromium',
			RECORDER_RENDERER_ASSET_DIR: '/app/renderer',
			SFU_ORIGIN: 'https://sfu.test',
			SFU_SOCKET_PATH: '/socket.io',
			[name]: value,
		};
		expect(() => loadConfig(env)).toThrow();
	});

	it('allows exact HTTP origins only when explicitly enabled', () => {
		const config = loadConfig({
			RECORDER_SECRET: secret,
			RECORDER_METRICS_TOKEN: 'm'.repeat(32),
			RECORDER_SITE: 'site.test',
			RECORDER_SITE_ORIGIN: 'http://site.test',
			RECORDER_ALLOW_HTTP: 'true',
			RECORDER_LEDGER_PATH: '/data/jobs.json',
			CHROMIUM_EXECUTABLE: '/usr/bin/chromium',
			RECORDER_RENDERER_ASSET_DIR: '/app/renderer',
			SFU_ORIGIN: 'http://sfu.test',
			SFU_SOCKET_PATH: '/socket.io',
		});
		expect(config.origin).toBe('http://site.test');
		expect(config.sfuOrigin).toBe('http://sfu.test');
	});
});

describe('AuthManager', () => {
	const auth = new AuthManager(
		secret,
		'site.test',
		'https://site.test',
		new JobStore(join(tmpdir(), `auth-${crypto.randomUUID()}.json`)),
	);

	it('accepts the exact Python RecorderClient command', () => {
		expect(auth.authenticate(`Bearer ${token()}`, 'reserve').job).toBe('job');
	});

	it('atomically rejects replay', () => {
		expect(auth.authenticate(`Bearer ${token()}`, 'reserve').job).toBe('job');
	});

	it.each([
		[{ extra: true }, {}],
		[{ aud: 'other' }, {}],
		[{ site: 'other' }, {}],
		[{ origin: 'https://other.test' }, {}],
		[{ exp: now + 31 }, {}],
		[{ limits: { ...baseClaims.limits, budget_bytes: 0 } }, {}],
		[{}, { typ: 'JWT' }],
		[{}, { kid: 'unexpected' }],
	])('rejects altered headers and claims', (claims, header) => {
		expect(() =>
			auth.authenticate(`Bearer ${token(claims, header)}`, 'reserve'),
		).toThrow(AuthError);
	});

	it('uses constant-time metrics token comparison semantics', () => {
		expect(auth.authenticateMetrics('Bearer metrics', 'metrics')).toBe(true);
		expect(auth.authenticateMetrics('Bearer wrong', 'metrics')).toBe(false);
	});
});

describe('JobStore and JobManager', () => {
	let directory: string;
	let path: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), 'recorder-store-'));
		path = join(directory, 'ledger.json');
	});

	it('creates a 0600 ledger and reloads durable jobs', async () => {
		const store = new JobStore(path);
		await store.initialize();
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		const manager = new JobManager(store, new FakeRendererBridge(), 1);
		const result = await manager.reserve(baseClaims);
		expect(result.status).toBe('accepted');
		const reloaded = new JobStore(path);
		await reloaded.initialize();
		expect(reloaded.get('job')?.accepted_at).toBe(
			result.status === 'accepted' ? result.job.accepted_at : '',
		);
		expect(
			JSON.parse(await readFile(path, 'utf8')).jobs.job.public_jwk,
		).toEqual(TEST_PUBLIC_JWK);
	});

	it('persists consumed command nonces across restart through expiry skew', async () => {
		const first = new JobStore(path);
		await first.initialize();
		expect(await first.consumeJti('durable-nonce', now + 30, now)).toBe(true);
		const restarted = new JobStore(path);
		await restarted.initialize();
		expect(
			await restarted.consumeJti('durable-nonce', now + 30, now + 34),
		).toBe(false);
		expect(
			await restarted.consumeJti('durable-nonce', now + 30, now + 36),
		).toBe(true);
	});

	it('continues ledger updates after the nonce limit rejects a command', async () => {
		const store = new JobStore(path);
		await store.initialize();
		await store.update((_jobs, nonces) => {
			for (let index = 0; index < 10_000; index += 1)
				nonces[`nonce-${index}`] = now + 60;
		});

		await expect(store.consumeJti('overflow', now + 30, now)).rejects.toThrow(
			'nonce ledger is full',
		);
		await store.update((_jobs, nonces) => {
			delete nonces['nonce-0'];
		});
		expect(await store.consumeJti('after-rejection', now + 30, now)).toBe(true);
	});

	it('fails closed on corrupt ledger data', async () => {
		await writeFile(path, '{broken', { mode: 0o600 });
		const store = new JobStore(path);
		await expect(store.initialize()).rejects.toThrow(
			'job ledger is unavailable',
		);
		expect(store.ready).toBe(false);
	});

	it('fails closed when an initialized ledger disappears', async () => {
		const first = new JobStore(path);
		await first.initialize();
		await unlink(path);
		const restarted = new JobStore(path);
		await expect(restarted.initialize()).rejects.toThrow(
			'job ledger is unavailable',
		);
		expect(restarted.ready).toBe(false);
	});

	it('enforces capacity under concurrent reservations and preserves idempotency', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		const [first, second] = await Promise.all([
			manager.reserve(baseClaims),
			manager.reserve({ ...baseClaims, job: 'job-2' }),
		]);
		expect([first.status, second.status].sort()).toEqual([
			'accepted',
			'rejected',
		]);
		const again = await manager.reserve(baseClaims);
		expect(again.status).toBe('accepted');
	});

	it('ends a persisted active job instead of resuming it after restart', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const first = new JobManager(store, new FakeRendererBridge(), 1);
		await first.reserve(baseClaims);
		const reloaded = new JobStore(path);
		await reloaded.initialize();
		const terminal = vi.fn(async () => undefined);
		const restartedBridge = Object.assign(new FakeRendererBridge(), {
			recoverStopping: vi.fn(async () => ({
				type: 'complete' as const,
				artifact: {
					file: 'recording.mp4',
					bytes: 42,
					sha256: 'a'.repeat(64),
					duration_ms: 1000,
				},
				gaps: [],
			})),
		});
		const restarted = new JobManager(reloaded, restartedBridge, 1, terminal);
		await restarted.initialize();
		expect(restartedBridge.recoverStopping).toHaveBeenCalledWith('job');
		expect(restarted.activeCount).toBe(0);
		expect(reloaded.get('job')).toMatchObject({
			state: 'partial',
			health_reason: 'worker_missing_after_restart',
			artifact: { state: 'partial', path: 'recording.mp4' },
		});
		expect(restarted.query(baseClaims)?.state).toBe('partial');
		expect(terminal).toHaveBeenCalledWith(
			expect.objectContaining({ state: 'partial' }),
		);
	});

	it('requires operator recovery when restart finalization fails', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const first = new JobManager(store, new FakeRendererBridge(), 1);
		await first.reserve(baseClaims);
		const reloaded = new JobStore(path);
		await reloaded.initialize();
		const restartedBridge = Object.assign(new FakeRendererBridge(), {
			recoverStopping: vi.fn(async () => {
				throw new Error('finalization failed');
			}),
		});
		const restarted = new JobManager(reloaded, restartedBridge, 1);
		await restarted.initialize();
		expect(restarted.ready).toBe(false);
		expect(reloaded.get('job')?.state).toBe('recovery_required');
		expect(restarted.query(baseClaims)).toBeUndefined();
	});

	it('durably tracks capture readiness and interruption', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		await manager.reserve(baseClaims);
		await bridge.emit({ job: 'job', type: 'configured' });
		await bridge.emit({ job: 'job', type: 'proof_complete' });
		await bridge.emit({ job: 'job', type: 'joined' });
		await bridge.emit({ job: 'job', type: 'capture_ready' });
		expect(store.get('job')?.state).toBe('capture_ready');
		await bridge.emit({
			job: 'job',
			type: 'interrupted',
			reason: 'connection_lost',
		});
		expect(store.get('job')).toMatchObject({
			state: 'interrupted',
			health_reason: 'connection_lost',
		});
		expect(bridge.hasWorker('job')).toBe(true);
	});

	it('notifies the control plane when capture becomes interrupted', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const interrupted = vi.fn(async () => undefined);
		const manager = new JobManager(store, bridge, 1, undefined, interrupted);
		await manager.reserve(baseClaims);
		await bridge.emit({ job: 'job', type: 'configured' });
		await bridge.emit({ job: 'job', type: 'proof_complete' });
		await bridge.emit({ job: 'job', type: 'joined' });
		await bridge.emit({ job: 'job', type: 'capture_ready' });

		await bridge.emit({
			job: 'job',
			type: 'interrupted',
			reason: 'connection_lost',
		});

		expect(interrupted).toHaveBeenCalledWith(
			expect.objectContaining({
				job: 'job',
				state: 'interrupted',
				health_reason: 'connection_lost',
			}),
		);
	});

	it('does not block unrelated jobs while a health callback is pending', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const interrupted = vi.fn(async () => pending);
		const manager = new JobManager(store, bridge, 2, undefined, interrupted);
		await manager.reserve(baseClaims);
		await bridge.emit({ job: 'job', type: 'configured' });
		await bridge.emit({ job: 'job', type: 'proof_complete' });
		await bridge.emit({ job: 'job', type: 'joined' });
		await bridge.emit({ job: 'job', type: 'capture_ready' });

		const delivery = bridge.emit({ job: 'job', type: 'interrupted' });
		await vi.waitFor(() => expect(interrupted).toHaveBeenCalledOnce());
		await expect(
			manager.reserve({
				...baseClaims,
				job: 'job-2',
				recording: 'recording-2',
			}),
		).resolves.toMatchObject({ status: 'accepted' });

		release();
		await delivery;
	});

	it('notifies the control plane when interrupted capture recovers', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const recovered = vi.fn(async () => undefined);
		const manager = new JobManager(
			store,
			bridge,
			1,
			undefined,
			undefined,
			async () => undefined,
			recovered,
		);
		await manager.reserve(baseClaims);
		await bridge.emit({ job: 'job', type: 'configured' });
		await bridge.emit({ job: 'job', type: 'proof_complete' });
		await bridge.emit({ job: 'job', type: 'joined' });
		await bridge.emit({ job: 'job', type: 'capture_ready' });
		await bridge.emit({ job: 'job', type: 'interrupted' });

		await bridge.emit({ job: 'job', type: 'capture_ready' });

		expect(recovered).toHaveBeenCalledWith(
			expect.objectContaining({ job: 'job', state: 'capture_ready' }),
		);
		await bridge.emit({ job: 'job', type: 'interrupted' });
		await bridge.emit({ job: 'job', type: 'capture_ready' });
		expect(store.get('job')?.event_sequence).toBe(3);
		expect(recovered).toHaveBeenCalledTimes(2);
	});

	it.each(['complete', 'partial', 'failed'] as const)(
		'keeps %s terminal despite delayed lifecycle callbacks',
		async (outcome) => {
			const store = new JobStore(path);
			await store.initialize();
			const bridge = new FakeRendererBridge();
			const manager = new JobManager(store, bridge, 1);
			await manager.reserve(baseClaims);
			await bridge.emit({ job: 'job', type: outcome, reason: 'final' });
			await bridge.emit({ job: 'job', type: 'configured', reason: 'delayed' });
			await bridge.emit({ job: 'job', type: 'failed', reason: 'delayed' });
			expect(store.get('job')?.state).toBe(outcome);
			expect(store.get('job')?.health_reason).toBe('final');
			expect(store.get('job')?.artifact).toEqual(
				outcome === 'failed'
					? undefined
					: { state: outcome, path: 'recording.mp4' },
			);
		},
	);

	it('keeps terminal artifacts queryable across restart', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		await manager.reserve(baseClaims);
		await bridge.emit({ job: 'job', type: 'complete' });

		const reloaded = new JobStore(path);
		await reloaded.initialize();
		const restarted = new JobManager(reloaded, new FakeRendererBridge(), 1);
		await restarted.initialize();

		expect(restarted.query(baseClaims)).toMatchObject({
			state: 'complete',
			artifact: { state: 'complete', path: 'recording.mp4' },
		});
		expect(reloaded.get('job')?.state).toBe('complete');
	});

	it('retries terminal callbacks and persists their acknowledgement', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const terminal = vi
			.fn<(job: import('./types.js').JobRecord) => Promise<void>>()
			.mockRejectedValueOnce(new Error('site unavailable'))
			.mockResolvedValue(undefined);
		const manager = new JobManager(
			store,
			bridge,
			1,
			terminal,
			undefined,
			async () => undefined,
		);
		await manager.reserve(baseClaims);

		await bridge.emit({ job: 'job', type: 'complete' });

		await vi.waitFor(() => expect(terminal).toHaveBeenCalledTimes(2));
		await vi.waitFor(() =>
			expect(store.get('job')?.callback_completed_at).toEqual(
				expect.any(String),
			),
		);

		const reloaded = new JobStore(path);
		await reloaded.initialize();
		const afterRestart = vi.fn(async () => undefined);
		await new JobManager(
			reloaded,
			new FakeRendererBridge(),
			1,
			afterRestart,
		).initialize();
		expect(afterRestart).not.toHaveBeenCalled();
	});

	it('finalizes a stopping job through the local restart hook', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		await manager.reserve(baseClaims);
		await manager.stop(baseClaims, 'stop-1');

		const reloaded = new JobStore(path);
		await reloaded.initialize();
		const restartedBridge = Object.assign(new FakeRendererBridge(), {
			recoverStopping: vi.fn(async () => ({
				type: 'partial' as const,
				artifact: {
					file: 'recording.mp4',
					bytes: 42,
					sha256: 'a'.repeat(64),
					duration_ms: 1000,
				},
				gaps: [
					{
						started_at: '2026-01-01T00:00:00.000Z',
						ended_at: '2026-01-01T00:00:01.000Z',
						reason: 'restart',
					},
				],
			})),
		});
		const restarted = new JobManager(reloaded, restartedBridge, 1);
		await restarted.initialize();

		expect(restartedBridge.recoverStopping).toHaveBeenCalledWith('job');
		expect(reloaded.get('job')).toMatchObject({
			state: 'partial',
			artifact: {
				state: 'partial',
				path: 'recording.mp4',
				bytes: 42,
				sha256: 'a'.repeat(64),
				duration_ms: 1000,
				gaps: [{ reason: 'restart' }],
			},
		});
	});

	it('ignores duplicate artifact completion', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		await manager.reserve(baseClaims);
		await bridge.emit({ job: 'job', type: 'partial', reason: 'capture_gap' });
		await bridge.emit({ job: 'job', type: 'complete' });
		expect(store.get('job')).toMatchObject({
			state: 'partial',
			health_reason: 'capture_gap',
			artifact: { state: 'partial', path: 'recording.mp4' },
		});
	});

	it('keeps failure terminal and cleans up the worker exactly once', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const stop = vi.spyOn(bridge, 'stop');
		const manager = new JobManager(store, bridge, 1);
		await manager.reserve(baseClaims);

		await bridge.emit({ job: 'job', type: 'failed', reason: 'page_crashed' });
		expect(await manager.stop(baseClaims, 'late-stop')).toBe(true);
		await bridge.emit({
			job: 'job',
			type: 'interrupted',
			reason: 'connection_lost',
		});
		await bridge.emit({ job: 'job', type: 'configured' });
		await bridge.emit({ job: 'job', type: 'failed', reason: 'duplicate' });

		expect(store.get('job')).toMatchObject({
			state: 'failed',
			health_reason: 'page_crashed',
			stop_operation_ids: [],
		});
		expect(stop).toHaveBeenCalledOnce();
		expect(bridge.hasWorker('job')).toBe(false);
	});

	it('releases failed capacity for a new reservation', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		await manager.reserve(baseClaims);
		await bridge.emit({ job: 'job', type: 'failed' });

		const next = await manager.reserve({ ...baseClaims, job: 'job-2' });

		expect(next.status).toBe('accepted');
		expect(manager.activeCount).toBe(1);
		expect(bridge.hasWorker('job-2')).toBe(true);
	});

	it('stops a reserved browser when the durable store update fails', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		vi.spyOn(store, 'update').mockRejectedValueOnce(new Error('disk failed'));
		await expect(manager.reserve(baseClaims)).rejects.toThrow('disk failed');
		expect(bridge.stopped.has('job')).toBe(true);
	});

	it('persists stop operation IDs before invoking the bridge and never persists grants', async () => {
		const store = new JobStore(path);
		await store.initialize();
		const bridge = new FakeRendererBridge();
		const manager = new JobManager(store, bridge, 1);
		await manager.reserve(baseClaims);
		await manager.grant(baseClaims, 'secret-grant');
		await manager.stop(baseClaims, 'stop-1');
		await manager.stop(baseClaims, 'stop-1');
		expect(bridge.stopped.size).toBe(1);
		const raw = await readFile(path, 'utf8');
		expect(raw).not.toContain('secret-grant');
		expect(JSON.parse(raw).jobs.job.stop_operation_ids).toEqual(['stop-1']);
	});
});

describe('HTTP contract', () => {
	let app: ReturnType<typeof createApp>;
	let bridge: FakeRendererBridge;
	let logs: LogEntry[];
	let config: Config;

	beforeEach(async () => {
		const directory = await mkdtemp(join(tmpdir(), 'recorder-http-'));
		const store = new JobStore(join(directory, 'ledger.json'));
		await store.initialize();
		bridge = new FakeRendererBridge();
		const jobs = new JobManager(store, bridge, 1);
		config = {
			port: 3010,
			secret,
			site: 'site.test',
			origin: 'https://site.test',
			ledgerPath: join(directory, 'ledger.json'),
			maxConcurrent: 1,
			metricsToken: 'metrics-token-is-at-least-32-bytes',
			chromiumExecutable: '/usr/bin/chromium',
			rendererAssetDirectory: '/app/renderer',
			rendererPort: 0,
			rendererNoSandbox: false,
			rendererReserveTimeoutMs: 10_000,
			rendererConfigureTimeoutMs: 10_000,
			sfuOrigin: 'https://sfu.test',
			sfuSocketPath: '/socket.io',
		};
		logs = [];
		const logger: Logger = {
			info: (entry) => {
				logs.push(entry);
			},
			error: (entry) => {
				logs.push(entry);
			},
		};
		app = createApp(
			config,
			new AuthManager(secret, config.site, config.origin, store),
			jobs,
			logger,
		);
	});

	afterEach(() => vi.restoreAllMocks());

	it('serves liveness but remains unready without a production bridge', async () => {
		const health = await call(app, '/health');
		expect([health.status, await health.json()]).toEqual([
			200,
			{ status: 'ok' },
		]);
		const ready = await call(app, '/ready');
		expect([ready.status, await ready.json()]).toEqual([
			503,
			{ status: 'not_ready' },
		]);
	});

	it('reserves, queries, grants, and stops with exact RecorderClient bodies', async () => {
		const reserve = await call(
			app,
			'/v1/recordings',
			authenticated('POST', { job: 'job' }),
		);
		expect(reserve.status).toBe(202);
		const reserveBody: {
			status: 'accepted';
			job: string;
			accepted_at: string;
			public_jwk: typeof TEST_PUBLIC_JWK;
			state: string;
		} = await reserve.json();
		expect(Object.keys(reserveBody).sort()).toEqual([
			'accepted_at',
			'job',
			'public_jwk',
			'state',
			'status',
		]);
		expect(reserveBody.public_jwk).toEqual(TEST_PUBLIC_JWK);
		expect(
			(
				await call(
					app,
					'/v1/recordings/job',
					authenticated('GET', undefined, token({ operation: 'query' })),
				)
			).status,
		).toBe(200);
		const grant = await call(
			app,
			'/v1/recordings/job/grant',
			authenticated(
				'POST',
				{ grant: 'grant-token' },
				token({ operation: 'grant' }),
			),
		);
		expect([grant.status, await grant.json()]).toEqual([
			200,
			{ status: 'accepted' },
		]);
		const stop = await call(
			app,
			'/v1/recordings/job/stop',
			authenticated(
				'POST',
				{ job: 'job', operation_id: 'stop-1' },
				token({ operation: 'stop' }),
			),
		);
		expect([stop.status, await stop.json()]).toEqual([
			202,
			{ status: 'accepted', job: 'job', operation_id: 'stop-1' },
		]);
		expect(bridge.grants).toEqual([
			{
				job: 'job',
				grant: 'grant-token',
				acceptedAt: expect.any(String),
			},
		]);
	});

	it('binds route and body to signed job and rejects extra fields', async () => {
		expect(
			(
				await call(
					app,
					'/v1/recordings',
					authenticated('POST', { job: 'other' }),
				)
			).status,
		).toBe(422);
		expect(
			(
				await call(
					app,
					'/v1/recordings/other',
					authenticated('GET', undefined, token({ operation: 'query' })),
				)
			).status,
		).toBe(401);
		expect(
			(
				await call(
					app,
					'/v1/recordings',
					authenticated('POST', { job: 'job', extra: true }),
				)
			).status,
		).toBe(422);
	});

	it('checks operation and semantics before consuming a command nonce', async () => {
		const signed = token({ jti: 'body-retry', operation: 'reserve' });
		expect(
			(
				await call(
					app,
					'/v1/recordings',
					authenticated('POST', { job: 'other' }, signed),
				)
			).status,
		).toBe(422);
		expect(
			(
				await call(
					app,
					'/v1/recordings',
					authenticated('POST', { job: 'job' }, signed),
				)
			).status,
		).toBe(202);
		expect(
			(
				await call(
					app,
					'/v1/recordings',
					authenticated('POST', { job: 'job' }, signed),
				)
			).status,
		).toBe(401);
		expect(
			(
				await call(
					app,
					'/v1/recordings/job',
					authenticated('GET', undefined, token({ operation: 'reserve' })),
				)
			).status,
		).toBe(401);
	});

	it('protects metrics independently', async () => {
		expect((await call(app, '/metrics')).status).toBe(401);
		const response = await call(app, '/metrics', {
			headers: { Authorization: `Bearer ${config.metricsToken}` },
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('recorder_capacity 1');
	});

	it('does not log signed identifiers, grants, or tokens', async () => {
		const signed = token();
		await call(
			app,
			'/v1/recordings',
			authenticated('POST', { job: 'job' }, signed),
		);
		const output = JSON.stringify(logs);
		expect(output).not.toContain('room');
		expect(output).not.toContain('recording');
		expect(output).not.toContain('"job":"job"');
		expect(output).not.toContain(signed);
	});
});
