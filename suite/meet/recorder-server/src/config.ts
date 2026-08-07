import { isAbsolute, resolve } from 'node:path';

export interface Config {
	port: number;
	secret: string;
	site: string;
	origin: string;
	ledgerPath: string;
	maxConcurrent: number;
	metricsToken: string;
	chromiumExecutable: string;
	rendererAssetDirectory: string;
	rendererPort: number;
	rendererNoSandbox: boolean;
	rendererReserveTimeoutMs: number;
	rendererConfigureTimeoutMs: number;
	sfuOrigin: string;
	sfuSocketPath: string;
	dataRoot: string;
	segmentSeconds: number;
	ffmpegExecutable: string;
	xvfbExecutable: string;
	pulseaudioExecutable: string;
	pactlExecutable: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (!value || value.trim() !== value)
		throw new Error(
			`${name} must be configured without surrounding whitespace`,
		);
	return value;
}

function integer(
	env: NodeJS.ProcessEnv,
	name: string,
	fallback: number,
	min: number,
	max: number,
): number {
	const raw = env[name] ?? String(fallback);
	if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max)
		throw new Error(`${name} is out of range`);
	return value;
}

function origin(value: string, allowHttp = false): string {
	const parsed = new URL(value);
	if (
		(parsed.protocol !== 'https:' &&
			!(allowHttp && parsed.protocol === 'http:')) ||
		parsed.origin !== value ||
		parsed.username ||
		parsed.password
	) {
		throw new Error('RECORDER_SITE_ORIGIN must be an exact HTTPS origin');
	}
	return value;
}

function boolean(
	env: NodeJS.ProcessEnv,
	name: string,
	fallback = false,
): boolean {
	const value = env[name] ?? String(fallback);
	if (value !== 'true' && value !== 'false')
		throw new Error(`${name} must be true or false`);
	return value === 'true';
}

function socketPath(value: string): string {
	if (!value.startsWith('/') || value.includes('?') || value.includes('#'))
		throw new Error('SFU_SOCKET_PATH must be an absolute URL path');
	return value.replace(/\/$/, '') || '/';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const secret = required(env, 'RECORDER_SECRET');
	const metricsToken = required(env, 'RECORDER_METRICS_TOKEN');
	if (Buffer.byteLength(secret) < 32)
		throw new Error('RECORDER_SECRET must be at least 32 bytes');
	if (Buffer.byteLength(metricsToken) < 32)
		throw new Error('RECORDER_METRICS_TOKEN must be at least 32 bytes');
	const path = required(env, 'RECORDER_LEDGER_PATH');
	const allowHttp = boolean(env, 'RECORDER_ALLOW_HTTP');
	return {
		port: integer(env, 'PORT', 3010, 1, 65535),
		secret,
		site: required(env, 'RECORDER_SITE'),
		origin: origin(required(env, 'RECORDER_SITE_ORIGIN'), allowHttp),
		ledgerPath: isAbsolute(path) ? path : resolve(path),
		maxConcurrent: integer(env, 'RECORDER_MAX_CONCURRENT', 1, 1, 1024),
		metricsToken,
		chromiumExecutable: required(env, 'CHROMIUM_EXECUTABLE'),
		rendererAssetDirectory: resolve(
			required(env, 'RECORDER_RENDERER_ASSET_DIR'),
		),
		rendererPort: integer(env, 'RECORDER_RENDERER_PORT', 0, 0, 65535),
		rendererNoSandbox: boolean(env, 'RECORDER_CHROMIUM_NO_SANDBOX'),
		rendererReserveTimeoutMs: integer(
			env,
			'RECORDER_RESERVE_TIMEOUT_MS',
			10_000,
			100,
			60_000,
		),
		rendererConfigureTimeoutMs: integer(
			env,
			'RECORDER_CONFIGURE_TIMEOUT_MS',
			10_000,
			100,
			60_000,
		),
		sfuOrigin: origin(required(env, 'SFU_ORIGIN'), allowHttp),
		sfuSocketPath: socketPath(required(env, 'SFU_SOCKET_PATH')),
		dataRoot: resolve(env.RECORDER_DATA_ROOT ?? '/data/captures'),
		segmentSeconds: integer(
			env,
			'RECORDER_SEGMENT_SECONDS',
			30,
			env.NODE_ENV === 'test' ? 1 : 30,
			300,
		),
		ffmpegExecutable: env.FFMPEG_EXECUTABLE ?? '/usr/bin/ffmpeg',
		xvfbExecutable: env.XVFB_EXECUTABLE ?? '/usr/bin/Xvfb',
		pulseaudioExecutable: env.PULSEAUDIO_EXECUTABLE ?? '/usr/bin/pulseaudio',
		pactlExecutable: env.PACTL_EXECUTABLE ?? '/usr/bin/pactl',
	};
}
