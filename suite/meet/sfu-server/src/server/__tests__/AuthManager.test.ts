import * as jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AuthManager } from '../AuthManager';
import { createMockSocket } from './test-helpers';

const SECRET = 'test-secret';

function token(overrides: Record<string, unknown> = {}): string {
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
});
