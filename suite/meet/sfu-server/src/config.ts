import { isIP } from 'node:net';
import * as os from 'node:os';
import type {
	MediasoupConfig,
	WebRTCServerOptions,
	WebRTCTransportOptions,
	WorkerLogLevel,
	WorkerSettings,
} from './types';

export type SFULogLevel = 'debug' | 'info' | 'warn' | 'error';
type RuntimeMode = 'development' | 'test' | 'production';

export interface SFUConfig {
	server: {
		host: string;
		port: number;
		jwtSecret: string;
	};
	socket: {
		pingTimeout: number;
		pingInterval: number;
	};
	mediasoup: MediasoupConfig;
	persistence: {
		recordingGrantFile?: string;
		e2eeRosterDirectory?: string;
	};
	runtime: {
		mode: RuntimeMode;
		allowPlainTransport: boolean;
		bypassRateLimits: boolean;
	};
	metrics: {
		token?: string;
	};
	logging: {
		level: SFULogLevel;
	};
	sentry: {
		dsn?: string;
		environment: string;
		release?: string;
	};
}

export interface SFUSystemInfo {
	cpuCount: number;
	localIpv4?: string;
}

export class ConfigError extends Error {
	constructor(readonly issues: string[]) {
		super(
			`Invalid SFU configuration:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
		);
		this.name = 'ConfigError';
	}
}

const WORKER_LOG_LEVELS = ['debug', 'warn', 'error', 'none'] as const;
const SFU_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const RUNTIME_MODES = ['development', 'test', 'production'] as const;

const mediaCodecs = [
	{
		kind: 'audio' as const,
		mimeType: 'audio/opus',
		clockRate: 48000,
		channels: 2,
	},
	{
		kind: 'video' as const,
		mimeType: 'video/VP8',
		clockRate: 90000,
		parameters: { 'x-google-start-bitrate': 1000 },
	},
	{
		kind: 'video' as const,
		mimeType: 'video/VP9',
		clockRate: 90000,
		parameters: { 'x-google-start-bitrate': 1000 },
	},
	{
		kind: 'video' as const,
		mimeType: 'video/h264',
		clockRate: 90000,
		parameters: {
			'packetization-mode': 1,
			'profile-level-id': '4d0032',
			'level-asymmetry-allowed': 1,
			'x-google-start-bitrate': 1000,
		},
	},
	{
		kind: 'video' as const,
		mimeType: 'video/h264',
		clockRate: 90000,
		parameters: {
			'packetization-mode': 1,
			'profile-level-id': '42e01f',
			'level-asymmetry-allowed': 1,
			'x-google-start-bitrate': 1000,
		},
	},
];

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
	return env[name]?.trim() || undefined;
}

function required(
	env: NodeJS.ProcessEnv,
	name: string,
	issues: string[],
): string {
	const value = optional(env, name);
	if (!value) issues.push(`${name} is required`);
	return value ?? '';
}

function integer(
	env: NodeJS.ProcessEnv,
	name: string,
	fallback: number,
	issues: string[],
	min = 1,
	max = Number.MAX_SAFE_INTEGER,
): number {
	const raw = optional(env, name);
	if (raw === undefined) return fallback;
	if (!/^\d+$/.test(raw)) {
		issues.push(`${name} must be a whole number between ${min} and ${max}`);
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < min || value > max) {
		issues.push(`${name} must be a whole number between ${min} and ${max}`);
		return fallback;
	}
	return value;
}

function choice<T extends string>(
	env: NodeJS.ProcessEnv,
	name: string,
	values: readonly T[],
	fallback: T,
	issues: string[],
): T {
	const raw = optional(env, name)?.toLowerCase();
	if (raw === undefined) return fallback;
	if (!values.includes(raw as T)) {
		issues.push(`${name} must be one of: ${values.join(', ')}`);
		return fallback;
	}
	return raw as T;
}

function boolean(
	env: NodeJS.ProcessEnv,
	name: string,
	issues: string[],
): boolean {
	const raw = optional(env, name)?.toLowerCase();
	if (raw === undefined) return false;
	if (raw !== 'true' && raw !== 'false') {
		issues.push(`${name} must be true or false`);
		return false;
	}
	return raw === 'true';
}

function getSystemInfo(): SFUSystemInfo {
	let localIpv4: string | undefined;
	for (const entries of Object.values(os.networkInterfaces())) {
		localIpv4 = entries?.find(
			(entry) => entry.family === 'IPv4' && !entry.internal,
		)?.address;
		if (localIpv4) break;
	}
	return {
		cpuCount: Math.max(1, os.cpus()?.length || 2),
		localIpv4,
	};
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) deepFreeze(child);
	}
	return value;
}

export function loadConfig(
	env: NodeJS.ProcessEnv = process.env,
	system: SFUSystemInfo = getSystemInfo(),
): SFUConfig {
	const issues: string[] = [];
	const mode = choice(env, 'NODE_ENV', RUNTIME_MODES, 'production', issues);
	const host = optional(env, 'HOST') ?? '0.0.0.0';
	const port = integer(env, 'PORT', 3000, issues, 1, 65535);
	const jwtSecret = required(env, 'JWT_SECRET', issues);
	const pingTimeout = integer(
		env,
		'SOCKET_PING_TIMEOUT',
		60_000,
		issues,
		1,
		2_147_483_647,
	);
	const pingInterval = integer(
		env,
		'SOCKET_PING_INTERVAL',
		25_000,
		issues,
		1,
		2_147_483_647,
	);

	const configuredListenIp = optional(env, 'WEBRTC_LISTEN_IP');
	if (
		configuredListenIp &&
		configuredListenIp !== '0.0.0.0' &&
		isIP(configuredListenIp) !== 4
	) {
		issues.push('WEBRTC_LISTEN_IP must be an IPv4 address');
	}
	const listenIp =
		configuredListenIp ??
		(mode === 'development' ? '127.0.0.1' : (system.localIpv4 ?? '127.0.0.1'));
	if (
		mode === 'production' &&
		(!configuredListenIp || configuredListenIp === '0.0.0.0') &&
		!system.localIpv4
	) {
		issues.push(
			'WEBRTC_LISTEN_IP is required when no local IPv4 address can be detected',
		);
	}
	const configuredAnnouncedAddress = optional(env, 'WEBRTC_ANNOUNCED_IP');
	if (mode === 'production' && !configuredAnnouncedAddress) {
		issues.push('WEBRTC_ANNOUNCED_IP is required in production');
	}
	if (configuredAnnouncedAddress && isIP(configuredAnnouncedAddress) !== 4) {
		issues.push('WEBRTC_ANNOUNCED_IP must be an IPv4 address');
	}
	const announcedAddress =
		configuredAnnouncedAddress ??
		(configuredListenIp === '0.0.0.0' && mode === 'development'
			? (system.localIpv4 ?? '127.0.0.1')
			: (system.localIpv4 ?? listenIp));

	const basePort = integer(env, 'WEBRTC_SERVER_PORT', 40_000, issues, 1, 65535);
	const numWorkers = integer(
		env,
		'MEDIASOUP_NUM_WORKERS',
		Math.max(1, system.cpuCount),
		issues,
	);
	if (basePort + numWorkers + 1000 > 65535) {
		issues.push(
			'WEBRTC_SERVER_PORT and MEDIASOUP_NUM_WORKERS exceed the available UDP port range',
		);
	}
	const workerLogLevel = choice(
		env,
		'MEDIASOUP_WORKER_LOGLEVEL',
		WORKER_LOG_LEVELS,
		'warn',
		issues,
	) as WorkerLogLevel;
	const logLevel = choice(env, 'SFU_LOG_LEVEL', SFU_LOG_LEVELS, 'info', issues);
	const ci = boolean(env, 'CI', issues);
	const githubActions = boolean(env, 'GITHUB_ACTIONS', issues);

	const sentryDsn = optional(env, 'SENTRY_DSN');
	if (sentryDsn) {
		try {
			const url = new URL(sentryDsn);
			if (url.protocol !== 'http:' && url.protocol !== 'https:')
				throw new Error();
		} catch {
			issues.push('SENTRY_DSN must be a valid HTTP or HTTPS URL');
		}
	}

	if (issues.length) throw new ConfigError(issues);

	const webRtcServer: WebRTCServerOptions = {
		listenIp,
		announcedAddress,
		basePort,
	};
	const worker: WorkerSettings = {
		logLevel: workerLogLevel,
		logTags: [
			'info',
			'ice',
			'dtls',
			'rtp',
			'srtp',
			'rtcp',
			'rtx',
			'bwe',
			'score',
			'simulcast',
			'svc',
			'sctp',
		],
		rtcMinPort: basePort + numWorkers,
		rtcMaxPort: basePort + numWorkers + 1000,
	};
	const webRtcTransport: WebRTCTransportOptions = {
		enableTcp: false,
		initialAvailableOutgoingBitrate: 2_500_000,
	};

	return deepFreeze({
		server: { host, port, jwtSecret },
		socket: { pingTimeout, pingInterval },
		mediasoup: {
			numWorkers,
			worker,
			router: { mediaCodecs },
			webRtcTransport,
			webRtcServer,
		},
		persistence: {
			recordingGrantFile: optional(env, 'RECORDING_GRANT_PERSISTENCE_FILE'),
			e2eeRosterDirectory: optional(env, 'E2EE_ROSTER_PERSISTENCE_DIR'),
		},
		runtime: {
			mode,
			allowPlainTransport: mode === 'development',
			bypassRateLimits: mode === 'development' || ci || githubActions,
		},
		metrics: { token: optional(env, 'METRICS_TOKEN') },
		logging: { level: logLevel },
		sentry: {
			dsn: sentryDsn,
			environment: optional(env, 'SENTRY_ENVIRONMENT') ?? mode,
			release: optional(env, 'SENTRY_RELEASE'),
		},
	});
}
