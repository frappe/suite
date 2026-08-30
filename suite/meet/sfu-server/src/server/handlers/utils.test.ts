import type { Socket } from 'socket.io';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../utils/rateLimiter';
import { checkSocketRateLimits } from './utils';

function socket(userId: string, address = '127.0.0.1'): Socket {
	return {
		userId,
		handshake: { address, headers: {} },
	} as unknown as Socket;
}

describe('checkSocketRateLimits', () => {
	it('isolates limits by operation and room namespace', () => {
		const limiter = new RateLimiter();
		const participant = socket('user-1');

		expect(
			checkSocketRateLimits(
				participant,
				limiter,
				'room-query:room-1',
				1,
				1,
				60_000,
			),
		).toBe(true);
		expect(
			checkSocketRateLimits(
				participant,
				limiter,
				'room-query:room-1',
				1,
				1,
				60_000,
			),
		).toBe(false);
		expect(
			checkSocketRateLimits(
				participant,
				limiter,
				'room-query:room-2',
				1,
				1,
				60_000,
			),
		).toBe(true);
		expect(
			checkSocketRateLimits(participant, limiter, 'e2ee:room-1', 1, 1, 60_000),
		).toBe(true);

		limiter.destroy();
	});
});
