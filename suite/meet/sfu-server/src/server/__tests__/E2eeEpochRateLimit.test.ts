import { describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../utils/rateLimiter';
import { E2EEEpochRelay } from '../E2EEEpochRelay';
import { createMockSocket } from './test-helpers';

function withProductionRateLimits<T>(fn: () => T): T {
	const previousNodeEnv = process.env.NODE_ENV;
	const previousCi = process.env.CI;
	const previousGithubActions = process.env.GITHUB_ACTIONS;
	process.env.NODE_ENV = 'production';
	delete process.env.CI;
	delete process.env.GITHUB_ACTIONS;
	try {
		return fn();
	} finally {
		if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previousNodeEnv;
		if (previousCi === undefined) delete process.env.CI;
		else process.env.CI = previousCi;
		if (previousGithubActions === undefined) delete process.env.GITHUB_ACTIONS;
		else process.env.GITHUB_ACTIONS = previousGithubActions;
	}
}

describe('E2EE epoch relay rate limiting', () => {
	it('rejects rate-limited epoch envelopes before relaying them', () => {
		withProductionRateLimits(() => {
			const socket = createMockSocket({
				id: 'socket-1',
				roomId: 'meeting-1',
				participantId: 'alice',
				senderId: 7,
				scope: 'full',
			});
			const fakeIo = {
				sockets: {
					adapter: { rooms: new Map([['meeting-1', new Set(['socket-1'])]]) },
					sockets: new Map([['socket-1', socket]]),
				},
			} as never;
			const rateLimiter = {
				checkRateLimit: () => false,
			} as unknown as RateLimiter;
			const relay = new E2EEEpochRelay(
				fakeIo,
				new Map([['meeting-1', new Set(['socket-1'])]]),
				new Map([['meeting-1', new Map([['alice', 7]])]]),
				undefined,
				rateLimiter,
			);

			relay.setup(socket);
			socket.fire('e2ee:epoch', {
				type: 'key-package-request',
				epochNumber: 1,
				reason: 'join',
			});

			expect(socket.emitCalls).toEqual([
				expect.objectContaining({
					event: 'sfu_error',
					data: expect.objectContaining({ code: 'RATE_LIMITED' }),
				}),
			]);
		});
	});
});
