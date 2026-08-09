import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const system = { cpuCount: 4, localIpv4: '10.0.0.8' };

function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	return {
		JWT_SECRET: 'secret',
		NODE_ENV: 'production',
		WEBRTC_ANNOUNCED_IP: '203.0.113.10',
		...overrides,
	};
}

describe('loadConfig', () => {
	it('builds one frozen configuration snapshot', () => {
		const config = loadConfig(validEnv(), system);

		expect(config.server).toEqual({
			host: '0.0.0.0',
			port: 3000,
			jwtSecret: 'secret',
		});
		expect(config.mediasoup).toMatchObject({
			numWorkers: 4,
			webRtcServer: {
				listenIp: '10.0.0.8',
				announcedAddress: '203.0.113.10',
				basePort: 40000,
			},
		});
		expect(config.runtime).toEqual({
			mode: 'production',
			allowPlainTransport: false,
			bypassRateLimits: false,
		});
		expect(Object.isFrozen(config)).toBe(true);
		expect(Object.isFrozen(config.mediasoup.worker)).toBe(true);
	});

	it('uses development policy and local addresses without production settings', () => {
		const config = loadConfig(
			validEnv({
				NODE_ENV: 'development',
				WEBRTC_ANNOUNCED_IP: '',
				WEBRTC_LISTEN_IP: '0.0.0.0',
			}),
			system,
		);

		expect(config.mediasoup.webRtcServer).toMatchObject({
			listenIp: '127.0.0.1',
			announcedAddress: '127.0.0.1',
		});
		expect(config.runtime.allowPlainTransport).toBe(true);
		expect(config.runtime.bypassRateLimits).toBe(true);
	});

	it('derives CI rate-limit policy from validated booleans', () => {
		const config = loadConfig(validEnv({ CI: 'true' }), system);
		expect(config.runtime.bypassRateLimits).toBe(true);
	});

	it('rejects partial numbers and invalid enum values', () => {
		expect(() =>
			loadConfig(
				validEnv({
					PORT: '3000junk',
					SFU_LOG_LEVEL: 'verbose',
					MEDIASOUP_WORKER_LOGLEVEL: 'info',
				}),
				system,
			),
		).toThrowError(ConfigError);

		try {
			loadConfig(
				validEnv({
					PORT: '3000junk',
					SFU_LOG_LEVEL: 'verbose',
					MEDIASOUP_WORKER_LOGLEVEL: 'info',
				}),
				system,
			);
		} catch (error) {
			expect((error as ConfigError).issues).toHaveLength(3);
		}
	});

	it('reports all missing and invalid production settings together', () => {
		try {
			loadConfig(
				{
					NODE_ENV: 'production',
					CI: 'sometimes',
					WEBRTC_LISTEN_IP: 'not-an-ip',
					SENTRY_DSN: 'not-a-url',
				},
				system,
			);
			throw new Error('Expected loadConfig to fail');
		} catch (error) {
			const configError = error as ConfigError;
			expect(configError.issues).toEqual([
				'JWT_SECRET is required',
				'WEBRTC_LISTEN_IP must be an IPv4 address',
				'WEBRTC_ANNOUNCED_IP is required in production',
				'CI must be true or false',
				'SENTRY_DSN must be a valid HTTP or HTTPS URL',
			]);
		}
	});

	it('rejects media port allocations that exceed the UDP range', () => {
		expect(() =>
			loadConfig(
				validEnv({
					WEBRTC_SERVER_PORT: '65000',
					MEDIASOUP_NUM_WORKERS: '4',
				}),
				system,
			),
		).toThrow('exceed the available UDP port range');
	});

	it('rejects an invalid announced address', () => {
		expect(() =>
			loadConfig(
				validEnv({ WEBRTC_ANNOUNCED_IP: 'public.example.com' }),
				system,
			),
		).toThrow('WEBRTC_ANNOUNCED_IP must be an IPv4 address');
	});

	it('requires an explicit listen address when production detection fails', () => {
		expect(() => loadConfig(validEnv(), { cpuCount: 2 })).toThrow(
			'WEBRTC_LISTEN_IP is required when no local IPv4 address can be detected',
		);
	});
});
