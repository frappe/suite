import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Server as SocketIOServer } from 'socket.io';
import { describe, expect, it } from 'vitest';
import {
	ChromiumRendererBridge,
	type RendererLifecycleEvent,
} from './RendererBridge.js';
import {
	COMMAND_AUDIENCE,
	type CommandClaims,
	type PublicJwk,
} from './types.js';

const chromiumCandidates = [
	process.env.CHROMIUM_EXECUTABLE,
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/usr/bin/google-chrome',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter((value): value is string => Boolean(value));

async function findChromium(): Promise<string | undefined> {
	for (const candidate of chromiumCandidates) {
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Try the next conventional executable location.
		}
	}
	return undefined;
}

const chromium = await findChromium();
const browserTest = chromium ? it : it.skip;

const command: CommandClaims = {
	iss: 'frappe-site:site.test',
	aud: COMMAND_AUDIENCE,
	site: 'site.test',
	origin: 'https://site.test',
	room: 'room-vertical',
	recording: 'recording-vertical',
	job: 'job-vertical',
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
	jti: 'command-nonce',
	iat: 1,
	exp: 2,
};

describe('recorder vertical chain', () => {
	browserTest(
		'proves its browser key before joining and becomes capture-ready with an empty SFU sync',
		async () => {
			const httpServer = createServer();
			const io = new SocketIOServer(httpServer, { path: '/socket.io' });
			await new Promise<void>((resolve) =>
				httpServer.listen(0, '127.0.0.1', resolve),
			);
			const port = (httpServer.address() as AddressInfo).port;
			const packets: Array<{ event: string; data: unknown }> = [];
			const ordering: string[] = [];
			let publicJwk: PublicJwk | undefined;
			let proofAccepted = false;
			let joined = false;

			io.on('connection', (socket) => {
				expect(socket.handshake.auth.token).toBe('recording-grant');
				socket.onAny((event, data) => {
					packets.push({ event, data });
					ordering.push(event);
				});
				const issuedAt = Math.floor(Date.now() / 1000);
				const challenge = {
					version: 1 as const,
					jti: 'grant-jti',
					socket_id: socket.id,
					nonce: randomBytes(24).toString('base64url'),
					issued_at: issuedAt,
					expires_at: issuedAt + 30,
				};
				socket.on('recording:proof', ({ signature }, callback) => {
					const canonical = Buffer.from(
						`meet-recording-proof-v1\n${challenge.jti}\n${challenge.socket_id}\n${challenge.nonce}\n${challenge.issued_at}\n${challenge.expires_at}`,
					);
					proofAccepted = Boolean(
						publicJwk &&
							verify(
								'sha256',
								canonical,
								{
									key: createPublicKey({ key: publicJwk, format: 'jwk' }),
									dsaEncoding: 'ieee-p1363',
								},
								Buffer.from(signature, 'base64url'),
							),
					);
					callback({ success: proofAccepted });
				});
				socket.on('recording:join', (data, callback) => {
					expect(proofAccepted).toBe(true);
					expect(data).toEqual({ roomId: command.room });
					joined = true;
					callback({ success: true });
				});
				type QueryResponse =
					| { rtpCapabilities: { codecs: never[]; headerExtensions: never[] } }
					| { participants: never[] }
					| { producers: never[] };
				const query = (event: string, response: QueryResponse) =>
					socket.on(event, (_data, callback) => {
						expect(joined).toBe(true);
						callback({ success: true, ...response });
					});
				query('get_router_rtp_capabilities', {
					rtpCapabilities: { codecs: [], headerExtensions: [] },
				});
				socket.on('create_webrtc_transport', (data, callback) => {
					expect(joined).toBe(true);
					expect(data.direction).toBe('recv');
					callback({
						success: true,
						id: 'recv-transport',
						iceParameters: {
							usernameFragment: 'recorder',
							password: 'recorder-password-recorder-password',
							iceLite: true,
						},
						iceCandidates: [],
						dtlsParameters: {
							role: 'auto',
							fingerprints: [{ algorithm: 'sha-256', value: '00'.repeat(32) }],
						},
					});
				});
				query('get_room_participants', { participants: [] });
				query('get_existing_producers', { producers: [] });
				socket.emit('recording:challenge', challenge);
			});

			const lifecycle: RendererLifecycleEvent[] = [];
			const bridge = new ChromiumRendererBridge({
				executablePath: chromium as string,
				assetDirectory: resolve(
					process.cwd(),
					'../../../frontend/dist-recorder',
				),
				sfuOrigin: `http://127.0.0.1:${port}`,
				sfuSocketPath: '/socket.io',
				trustedCommandOrigin: command.origin,
				listenerPort: 0,
				noSandbox: process.env.RECORDER_CHROMIUM_NO_SANDBOX === '1',
				reserveTimeoutMs: 15_000,
				configureTimeoutMs: 15_000,
			});
			bridge.onLifecycle(async (event) => {
				lifecycle.push(event);
				ordering.push(`lifecycle:${event.type}`);
			});

			try {
				await bridge.initialize();
				publicJwk = await bridge.reserve(command);
				expect(publicJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
				await bridge.deliverGrant(
					command.job,
					'recording-grant',
					'2026-07-31T12:00:00Z',
				);
				await expect
					.poll(() => lifecycle.at(-1)?.type, { timeout: 15_000 })
					.toMatch(/capture_ready|failed/);
				expect(lifecycle).toEqual(
					['configured', 'proof_complete', 'joined', 'capture_ready'].map(
						(type) =>
							expect.objectContaining({
								job: command.job,
								type,
								occurredAt: expect.any(String),
							}),
					),
				);

				expect(proofAccepted).toBe(true);
				expect(packets[0]?.event).toBe('recording:proof');
				expect(ordering.indexOf('recording:proof')).toBeLessThan(
					ordering.indexOf('recording:join'),
				);
				expect(ordering.indexOf('recording:join')).toBeLessThan(
					ordering.indexOf('get_router_rtp_capabilities'),
				);
				expect(
					packets.filter(({ event }) => event === 'create_webrtc_transport'),
				).toHaveLength(1);
				expect(
					packets.find(({ event }) => event === 'create_webrtc_transport')
						?.data,
				).toMatchObject({ direction: 'recv' });
				expect(
					packets.filter(({ event }) =>
						['create_producer', 'create_consumer'].includes(event),
					),
				).toEqual([]);
			} finally {
				await bridge.close();
				await io.close();
				await new Promise<void>((resolve) => httpServer.close(() => resolve()));
			}
		},
		30_000,
	);
});
