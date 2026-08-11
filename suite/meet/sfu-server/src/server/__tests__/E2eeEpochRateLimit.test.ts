import { describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../utils/rateLimiter';
import { E2EEEpochRelay } from '../E2EEEpochRelay';
import { createMockSocket } from './test-helpers';

describe('E2EE epoch relay rate limiting', () => {
	it('rejects rate-limited epoch envelopes before relaying them', () => {
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
