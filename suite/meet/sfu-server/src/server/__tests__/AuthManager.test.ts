import * as jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JWTPayload } from '../../types';
import { AuthManager } from '../AuthManager';
import { createMockSocket } from './test-helpers';

const SECRET = 'test-secret';

afterEach(() => {
	vi.useRealTimers();
});

function token(
	overrides: Partial<JWTPayload> & {
		user_avatar?: string | null;
		guest_generation?: number;
	} = {},
): string {
	return jwt.sign(
		{
			user_id: 'user-1',
			user_name: 'Alice',
			meeting_id: 'room-1',
			site: 'site-a',
			is_host: false,
			scope: 'full',
			...overrides,
		},
		SECRET,
	);
}

describe('AuthManager', () => {
	it('binds the JWT site claim to the socket', () => {
		const manager = new AuthManager(SECRET);
		const authToken = token();
		const socket = createMockSocket({
			handshake: {
				auth: { token: authToken },
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(manager.authenticateSocket(socket)).toBe(true);

		expect(socket.site).toBe('site-a');
	});

	it('accepts a null avatar from the participant token issuer', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			handshake: {
				auth: { token: token({ user_avatar: null }) },
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(manager.authenticateSocket(socket)).toBe(true);
	});

	it('rejects legacy guest tokens without an authorization generation', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			handshake: {
				auth: {
					token: token({ user_id: 'guest_1', is_guest: true }),
				},
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(manager.authenticateSocket(socket)).toBe(false);
	});

	it('rejects guest tokens with a non-positive authorization generation', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			handshake: {
				auth: {
					token: token({
						user_id: 'guest_1',
						is_guest: true,
						guest_generation: 0,
					}),
				},
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(manager.authenticateSocket(socket)).toBe(false);
	});

	it('binds guest authorization generation and preserves it on refresh', () => {
		const manager = new AuthManager(SECRET);
		const authToken = token({
			user_id: 'guest_1',
			is_guest: true,
			guest_generation: 3,
		});
		const socket = createMockSocket({
			handshake: {
				auth: { token: authToken },
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(manager.authenticateSocket(socket)).toBe(true);
		expect(socket.guestGeneration).toBe(3);
		expect(() =>
			manager.updateSocketToken(
				socket,
				token({
					user_id: 'guest_1',
					is_guest: true,
					guest_generation: 3,
				}),
			),
		).not.toThrow();
	});

	it.each([
		['missing', {}],
		['changed', { guest_generation: 4 }],
	] as const)('rejects guest token refresh with %s generation', (_case, claims) => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			userId: 'guest_1',
			meetingId: 'room-1',
			site: 'site-a',
			scope: 'full',
			isGuest: true,
			guestGeneration: 3,
			handshake: {
				auth: {},
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(() =>
			manager.updateSocketToken(
				socket,
				token({ user_id: 'guest_1', is_guest: true, ...claims }),
			),
		).toThrow();
	});

	it('rejects guest token refresh with a different guest identity', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			userId: 'guest_1',
			meetingId: 'room-1',
			site: 'site-a',
			scope: 'full',
			isGuest: true,
			guestGeneration: 3,
		});

		expect(() =>
			manager.updateSocketToken(
				socket,
				token({
					user_id: 'guest_2',
					is_guest: true,
					guest_generation: 3,
				}),
			),
		).toThrow('Token user mismatch');
	});

	it('rejects token refreshes that change site', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			userId: 'user-1',
			meetingId: 'room-1',
			site: 'site-a',
			handshake: {
				auth: {},
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(() =>
			manager.updateSocketToken(socket, token({ site: 'site-b' })),
		).toThrow('Token site mismatch');
	});

	it('updates live socket roles from a refreshed token', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			userId: 'user-1',
			meetingId: 'room-1',
			site: 'site-a',
			isHost: false,
			isCohost: false,
			handshake: {
				auth: {},
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		manager.updateSocketToken(socket, token({ is_cohost: true }));

		expect(socket.isHost).toBe(false);
		expect(socket.isCohost).toBe(true);
	});

	it.each([
		['scope', { scope: 'presence-preview' }],
		['guest status', { is_guest: true, guest_generation: 1 }],
	] as const)('rejects token refreshes that change %s', (_field, override) => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			userId: 'user-1',
			meetingId: 'room-1',
			site: 'site-a',
			scope: 'full',
			isGuest: false,
			handshake: {
				auth: {},
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(() => manager.updateSocketToken(socket, token(override))).toThrow(
			'Token identity mismatch',
		);
	});

	it('updates the validated display identity from a replacement token', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			userId: 'user-1',
			userName: 'Old Name',
			meetingId: 'room-1',
			site: 'site-a',
			scope: 'full',
			isGuest: false,
			handshake: {
				auth: {},
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		manager.updateSocketToken(socket, token({ user_name: 'Current Name' }));

		expect(socket.userName).toBe('Current Name');
	});

	it('allows a valid refresh during the expired-token grace period', async () => {
		vi.useFakeTimers();
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			userId: 'user-1',
			meetingId: 'room-1',
			site: 'site-a',
			scope: 'full',
			isGuest: false,
			tokenExpiresAt: Date.now() - 1,
		});
		const disconnect = vi.spyOn(socket, 'disconnect');

		manager.triggerTokenExpiry(socket, 'middleware_guard');
		manager.updateSocketToken(
			socket,
			token({ exp: Math.floor(Date.now() / 1000) + 60 }),
		);
		await vi.advanceTimersByTimeAsync(5000);

		expect(disconnect).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('disconnects after the expired-token grace period without refresh', async () => {
		vi.useFakeTimers();
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({ tokenExpiresAt: Date.now() - 1 });
		const disconnect = vi.spyOn(socket, 'disconnect');

		manager.triggerTokenExpiry(socket, 'middleware_guard');
		await vi.advanceTimersByTimeAsync(4999);
		expect(disconnect).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(disconnect).toHaveBeenCalledWith(true);
	});

	it('deduplicates and cleans the expired-token grace timer', () => {
		vi.useFakeTimers();
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({ tokenExpiresAt: Date.now() - 1 });

		manager.triggerTokenExpiry(socket, 'middleware_guard');
		manager.triggerTokenExpiry(socket, 'idle_sweep');

		expect(vi.getTimerCount()).toBe(1);
		expect(
			socket.emitCalls.filter(({ event }) => event === 'auth:expired'),
		).toHaveLength(1);

		manager.cleanupSocket(socket);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('rejects recording scope on the participant JWT path', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			handshake: {
				auth: { token: token({ scope: 'recording' }) },
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(manager.authenticateSocket(socket)).toBe(false);
	});

	it('delegates recording grants and exposes no access before proof', () => {
		const claims = {
			iss: 'frappe-site:site-a',
			aud: 'meet-sfu-recorder',
			scope: 'recording',
			jti: 'grant-1',
			site: 'site-a',
			meeting_id: 'room-1',
			recording_id: 'recording-1',
			recorder_job_id: 'job-1',
			cnf: { jwk: {}, jkt: 'thumbprint' },
			iat: 1,
			exp: 2,
			authorization_expires_at: 3,
		} as const;
		const grantManager = { verifyGrant: vi.fn(() => claims) };
		const manager = new AuthManager(SECRET, grantManager as never);
		const grant = jwt.sign({}, SECRET, {
			header: { typ: 'meet-recording-grant+jwt' },
		});
		const socket = createMockSocket({
			handshake: {
				auth: { token: grant },
				query: {},
				headers: {},
				address: '127.0.0.1',
			} as never,
		});

		expect(manager.authenticateSocket(socket)).toBe(true);
		expect(grantManager.verifyGrant).toHaveBeenCalledWith(grant);
		expect(socket).toMatchObject({
			userId: 'recorder:recording-1',
			meetingId: 'room-1',
			site: 'site-a',
			scope: 'recording',
			recordingProofComplete: false,
			e2eeRequired: false,
			e2eeReady: false,
		});
		expect(() => manager.ensureMediaConsumerAccess(socket)).toThrow(
			'Recording proof required',
		);
	});

	it('keeps recorder access distinct from full access and disables refresh', () => {
		const manager = new AuthManager(SECRET);
		const socket = createMockSocket({
			scope: 'recording',
			recordingProofComplete: true,
			recordingClaims: {
				iss: 'frappe-site:site-a',
				aud: 'meet-sfu-recorder',
				scope: 'recording',
				jti: 'grant-1',
				site: 'site-a',
				meeting_id: 'room-1',
				recording_id: 'recording-1',
				recorder_job_id: 'job-1',
				cnf: { jwk: {}, jkt: 'thumbprint' },
				iat: 1,
				exp: 2,
				authorization_expires_at: 3,
			},
			site: 'site-a',
			meetingId: 'room-1',
		});

		expect(() => manager.ensureFullAccess(socket)).toThrow(
			'Insufficient scope',
		);
		expect(() => manager.ensureRecorderAccess(socket)).not.toThrow();
		expect(() => manager.updateSocketToken(socket, token())).toThrow(
			'Recording authorization cannot be refreshed',
		);
	});
});
