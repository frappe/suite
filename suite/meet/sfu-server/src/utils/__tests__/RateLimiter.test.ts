import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../rateLimiter';

describe('RateLimiter', () => {
	let now = 0;
	let limiter: RateLimiter;

	beforeEach(() => {
		now = 1_000_000;
		vi.spyOn(Date, 'now').mockImplementation(() => now);
		limiter = new RateLimiter(60_000);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		limiter.destroy();
	});

	it('allows up to maxRequests inside the window and denies the next one', () => {
		expect(limiter.checkRateLimit('k', 3, 1000)).toBe(true);
		expect(limiter.checkRateLimit('k', 3, 1000)).toBe(true);
		expect(limiter.checkRateLimit('k', 3, 1000)).toBe(true);
		expect(limiter.checkRateLimit('k', 3, 1000)).toBe(false);
		expect(limiter.getCurrentCount('k')).toBe(3);
	});

	it('resets the counter after the window elapses', () => {
		limiter.checkRateLimit('k', 2, 1000);
		limiter.checkRateLimit('k', 2, 1000);
		expect(limiter.checkRateLimit('k', 2, 1000)).toBe(false);

		now += 1001;

		expect(limiter.checkRateLimit('k', 2, 1000)).toBe(true);
		expect(limiter.getCurrentCount('k')).toBe(1);
	});

	it('treats different keys independently', () => {
		expect(limiter.checkRateLimit('a', 1, 1000)).toBe(true);
		expect(limiter.checkRateLimit('a', 1, 1000)).toBe(false);
		expect(limiter.checkRateLimit('b', 1, 1000)).toBe(true);
	});

	it('getTimeUntilReset returns ms remaining in the window', () => {
		limiter.checkRateLimit('k', 5, 1000);
		expect(limiter.getTimeUntilReset('k')).toBe(1000);

		now += 400;
		expect(limiter.getTimeUntilReset('k')).toBe(600);
	});

	it('getTimeUntilReset returns 0 for unknown key', () => {
		expect(limiter.getTimeUntilReset('missing')).toBe(0);
	});

	it('reset() clears the key so it is allowed again immediately', () => {
		limiter.checkRateLimit('k', 1, 1000);
		expect(limiter.checkRateLimit('k', 1, 1000)).toBe(false);
		limiter.reset('k');
		expect(limiter.checkRateLimit('k', 1, 1000)).toBe(true);
	});

	it('cleanup() purges expired entries; getStats reports active count', () => {
		limiter.checkRateLimit('live', 5, 1000);
		limiter.checkRateLimit('dead', 5, 1000);

		now += 2000;

		const stats = limiter.getStats();
		expect(stats.totalKeys).toBe(2);
		expect(stats.activeKeys).toBe(0);

		const cleanupTarget = limiter as unknown as { cleanup(): void };
		cleanupTarget.cleanup();
		expect(limiter.getStats().totalKeys).toBe(0);
	});

	it('destroy() clears all state', () => {
		limiter.checkRateLimit('a', 1, 1000);
		limiter.destroy();
		expect(limiter.getStats().totalKeys).toBe(0);
	});
});
