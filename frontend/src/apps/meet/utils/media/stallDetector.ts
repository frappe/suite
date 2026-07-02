/**
 * Stall Detector
 *
 * Detects consumers that are technically "connected" but not actually
 * receiving any media bytes. A stalled consumer usually means a transport
 * is wedged (browser decoder issue, congestion that producer scores hide,
 * or background tab throttling) and the only recovery is an ICE restart.
 *
 * Audio consumers are checked with a much shorter window than video: silence
 * for even ~1.5s is a much worse user experience than a frozen video frame,
 * and audio is also the leading indicator of a wedged transport (audio
 * packets stop arriving before the congestion controller can drop video).
 */

const DEFAULT_STALL_TIMEOUT_MS = 5000;
const DEFAULT_AUDIO_STALL_TIMEOUT_MS = 1500;
const DEFAULT_MIN_CONSUMER_AGE_MS = 3000;
const DEFAULT_RECOVERY_COOLDOWN_MS = 30_000;

export interface ConsumerSample {
	id: string;
	kind?: string;
	isPaused: () => boolean;
	isMuted: () => boolean;
	getBytesReceived: () => number | null;
	getCreatedAt: () => number;
}

interface StallDetectorOptions {
	stallTimeoutMs?: number;
	audioStallTimeoutMs?: number;
	minConsumerAgeMs?: number;
	recoveryCooldownMs?: number;
	now?: () => number;
}

interface ConsumerState {
	lastBytesReceived: number;
	hasReceivedBytes: boolean;
	stallStartedAt: number | null;
	lastRecoveredAt: number | null;
}

export class StallDetector {
	private readonly stallTimeoutMs: number;
	private readonly audioStallTimeoutMs: number;
	private readonly minConsumerAgeMs: number;
	private readonly recoveryCooldownMs: number;
	private readonly now: () => number;
	private readonly state: Map<string, ConsumerState> = new Map();

	constructor(options: StallDetectorOptions = {}) {
		this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
		this.audioStallTimeoutMs =
			options.audioStallTimeoutMs ?? DEFAULT_AUDIO_STALL_TIMEOUT_MS;
		this.minConsumerAgeMs =
			options.minConsumerAgeMs ?? DEFAULT_MIN_CONSUMER_AGE_MS;
		this.recoveryCooldownMs =
			options.recoveryCooldownMs ?? DEFAULT_RECOVERY_COOLDOWN_MS;
		this.now = options.now ?? (() => Date.now());
	}

	check(samples: ConsumerSample[]): string[] {
		const now = this.now();
		const activeIds = new Set<string>();
		const stalled: string[] = [];

		for (const sample of samples) {
			activeIds.add(sample.id);

			if (sample.isPaused()) {
				this.state.delete(sample.id);
				continue;
			}

			if (now - sample.getCreatedAt() < this.minConsumerAgeMs) {
				continue;
			}

			const bytes = sample.getBytesReceived();
			const st = this.ensureState(sample.id);
			if (bytes !== null && bytes > 0) {
				st.hasReceivedBytes = true;
			}

			if (!st.hasReceivedBytes) {
				st.stallStartedAt = null;
				st.lastBytesReceived = bytes ?? 0;
				continue;
			}

			const timeoutMs = this.timeoutFor(sample.kind, st.hasReceivedBytes);

			if (sample.isMuted()) {
				if (st.stallStartedAt === null) {
					st.stallStartedAt = now;
				}
				if (
					now - st.stallStartedAt >= timeoutMs &&
					this.shouldRecover(st, now)
				) {
					stalled.push(sample.id);
					st.lastRecoveredAt = now;
				}
				continue;
			}

			if (bytes === null) {
				const st = this.state.get(sample.id);
				if (st) st.stallStartedAt = null;
				continue;
			}

			const previous = st.lastBytesReceived;
			st.lastBytesReceived = bytes;

			if (bytes > previous) {
				st.stallStartedAt = null;
				continue;
			}

			if (st.stallStartedAt === null) {
				st.stallStartedAt = now;
			}

			if (now - st.stallStartedAt >= timeoutMs && this.shouldRecover(st, now)) {
				stalled.push(sample.id);
				st.lastRecoveredAt = now;
			}
		}

		for (const id of Array.from(this.state.keys())) {
			if (!activeIds.has(id)) {
				this.state.delete(id);
			}
		}

		return stalled;
	}

	private timeoutFor(
		kind: string | undefined,
		hasReceivedBytes: boolean,
	): number {
		return kind === "audio" && hasReceivedBytes
			? this.audioStallTimeoutMs
			: this.stallTimeoutMs;
	}

	private ensureState(id: string): ConsumerState {
		let st = this.state.get(id);
		if (!st) {
			st = {
				lastBytesReceived: 0,
				hasReceivedBytes: false,
				stallStartedAt: null,
				lastRecoveredAt: null,
			};
			this.state.set(id, st);
		}
		return st;
	}

	private shouldRecover(st: ConsumerState, now: number): boolean {
		if (
			st.lastRecoveredAt !== null &&
			st.stallStartedAt !== null &&
			st.lastRecoveredAt >= st.stallStartedAt
		) {
			return false;
		}
		if (
			st.lastRecoveredAt !== null &&
			now - st.lastRecoveredAt < this.recoveryCooldownMs
		) {
			return false;
		}
		return true;
	}

	reset(): void {
		this.state.clear();
	}

	dispose(consumerId: string): void {
		this.state.delete(consumerId);
	}
}

export function extractInboundBytesReceived(
	stats: RTCStatsReport,
): number | null {
	for (const report of stats.values()) {
		if (
			report.type === "inbound-rtp" &&
			typeof report.bytesReceived === "number"
		) {
			return report.bytesReceived;
		}
	}
	return null;
}
