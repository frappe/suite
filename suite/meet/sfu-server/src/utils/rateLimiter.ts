interface RateLimitEntry {
	count: number;
	resetTime: number;
}

interface RateLimiterStats {
	totalKeys: number;
	activeKeys: number;
}

export class RateLimiter {
	private limits: Map<string, RateLimitEntry> = new Map();
	private cleanupInterval: NodeJS.Timeout;

	constructor(cleanupIntervalMs: number = 60 * 1000) {
		this.cleanupInterval = setInterval(() => this.cleanup(), cleanupIntervalMs);
	}

	/**
	 * Check if a request is allowed under the rate limit
	 * @param key Unique identifier for the rate limit (e.g., 'user:123' or 'ip:192.168.1.1')
	 * @param maxRequests Maximum requests allowed in the time window
	 * @param windowMs Time window in milliseconds
	 * @returns true if request is allowed, false if rate limited
	 */
	checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
		const now = Date.now();
		const existing = this.limits.get(key);

		if (!existing || now > existing.resetTime) {
			// First request or window expired
			// clean up expired entry if it exists
			if (existing && now > existing.resetTime) {
				this.limits.delete(key);
			}

			this.limits.set(key, { count: 1, resetTime: now + windowMs });
			return true;
		}

		if (existing.count >= maxRequests) {
			return false;
		}

		existing.count++;
		return true;
	}

	getCurrentCount(key: string): number {
		const entry = this.limits.get(key);
		return entry?.count || 0;
	}

	getTimeUntilReset(key: string): number {
		const entry = this.limits.get(key);
		if (!entry) return 0;

		const remaining = entry.resetTime - Date.now();
		return Math.max(0, remaining);
	}

	reset(key: string): void {
		this.limits.delete(key);
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, limit] of this.limits.entries()) {
			if (now > limit.resetTime) {
				this.limits.delete(key);
			}
		}
	}

	getStats(): RateLimiterStats {
		const now = Date.now();
		let activeKeys = 0;

		for (const [, limit] of this.limits.entries()) {
			if (now <= limit.resetTime) {
				activeKeys++;
			}
		}

		return {
			totalKeys: this.limits.size,
			activeKeys,
		};
	}

	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		this.limits.clear();
	}
}
