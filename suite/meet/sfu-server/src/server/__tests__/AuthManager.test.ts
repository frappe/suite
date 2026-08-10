import * as jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import type { JWTPayload } from '../../types';
import { AuthManager } from '../AuthManager';
import { createMockSocket } from './test-helpers';

const SECRET = 'test-secret';

function token(
	overrides: Partial<JWTPayload> & { user_avatar?: string | null } = {},
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
