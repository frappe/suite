/**
 * Stall Detector
 *
 * Detects consumers that are technically "connected" but not actually
 * receiving any media bytes. A stalled consumer can mean the receive side
 * is wedged, congestion has hidden producer scores, or a background tab was
 * throttled.
 *
 * Audio consumers use a shorter window than video because audio is the
 * leading indicator of a wedged transport, while brief video freezes are
 * expected under congestion.
 */

const DEFAULT_STALL_TIMEOUT_MS = 15_000;
const DEFAULT_AUDIO_STALL_TIMEOUT_MS = 8_000;
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
	startupStartedAt: number;
	wasPaused: boolean;
	stallStartedAt: number | null;
	lastRecoveredAt: number | null;
	recoveryAttempts: number;
}

export class StallDetector {
	private readonly stallTimeoutMs: number;
	private readonly audioStallTimeoutMs: number;
	private readonly minConsumerAgeMs: number;
	private readonly recoveryCooldownMs: number;
	private readonly now: () => number;
	private readonly state: Map<string, ConsumerState> = new Map();
	private lastRecoveryAt: number | null = null;
	private activeStall = false;

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

	check(samples: ConsumerSample[], recoveryEnabled = true): string[] {
		const now = this.now();
		const activeIds = new Set<string>();
		const stalled: string[] = [];
		this.activeStall = false;

		for (const sample of samples) {
			activeIds.add(sample.id);
			const st = this.ensureState(sample.id, sample.getCreatedAt());

			if (sample.isPaused()) {
				st.wasPaused = true;
				st.hasReceivedBytes = false;
				st.stallStartedAt = null;
				continue;
			}
			if (st.wasPaused) {
				st.wasPaused = false;
				st.startupStartedAt = now;
			}

			if (now - sample.getCreatedAt() < this.minConsumerAgeMs) {
				continue;
			}

			const bytes = sample.getBytesReceived();
			if (bytes !== null && bytes > 0) {
				st.hasReceivedBytes = true;
			}

			if (!st.hasReceivedBytes) {
				st.lastBytesReceived = bytes ?? 0;
				if (bytes === null) {
					st.stallStartedAt = null;
					continue;
				}
				if (now - st.startupStartedAt >= this.stallTimeoutMs) {
					this.activeStall = true;
					if (recoveryEnabled && this.shouldRecover(st, now)) {
						stalled.push(sample.id);
						st.lastRecoveredAt = now;
						st.recoveryAttempts += 1;
					}
				}
				continue;
			}

			const timeoutMs = this.timeoutFor(sample.kind, st.hasReceivedBytes);

			if (sample.isMuted()) {
				if (st.stallStartedAt === null) {
					st.stallStartedAt = now;
				}
				if (now - st.stallStartedAt >= timeoutMs) {
					this.activeStall = true;
					if (recoveryEnabled && this.shouldRecover(st, now)) {
						stalled.push(sample.id);
						st.lastRecoveredAt = now;
						st.recoveryAttempts += 1;
					}
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
				st.lastRecoveredAt = null;
				st.recoveryAttempts = 0;
				continue;
			}

			if (st.stallStartedAt === null) {
				st.stallStartedAt = now;
			}

			if (now - st.stallStartedAt >= timeoutMs) {
				this.activeStall = true;
				if (recoveryEnabled && this.shouldRecover(st, now)) {
					stalled.push(sample.id);
					st.lastRecoveredAt = now;
					st.recoveryAttempts += 1;
				}
			}
		}

		for (const id of Array.from(this.state.keys())) {
			if (!activeIds.has(id)) {
				this.state.delete(id);
			}
		}
		if (stalled.length > 0) {
			this.lastRecoveryAt = now;
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

	private ensureState(id: string, createdAt: number): ConsumerState {
		let st = this.state.get(id);
		if (!st) {
			st = {
				lastBytesReceived: 0,
				hasReceivedBytes: false,
				startupStartedAt: createdAt,
				wasPaused: false,
				stallStartedAt: null,
				lastRecoveredAt: null,
				recoveryAttempts: 0,
			};
			this.state.set(id, st);
		}
		return st;
	}

	private shouldRecover(st: ConsumerState, now: number): boolean {
		if (
			this.lastRecoveryAt !== null &&
			now - this.lastRecoveryAt < this.recoveryCooldownMs
		) {
			return false;
		}
		return true;
	}

	getRecoveryAttempts(consumerId: string): number {
		return this.state.get(consumerId)?.recoveryAttempts ?? 0;
	}

	hasReceivedMedia(consumerId: string): boolean {
		return this.state.get(consumerId)?.hasReceivedBytes ?? false;
	}

	hasActiveStall(): boolean {
		return this.activeStall;
	}

	reset(): void {
		this.state.clear();
		this.lastRecoveryAt = null;
		this.activeStall = false;
	}

	suspend(): void {
		this.state.clear();
		this.activeStall = false;
	}

	dispose(consumerId: string): void {
		this.state.delete(consumerId);
	}
}

export interface DecodeSample {
	id: string;
	isPaused: () => boolean;
	bytesReceived: number | null;
	framesDecoded: number | null;
}

export interface DecodeRecoveryAction {
	consumerId: string;
	action: "request-keyframe" | "recreate";
}

interface DecodeState {
	lastBytesReceived: number;
	lastFramesDecoded: number;
	stallStartedAt: number | null;
	phase: "monitoring" | "keyframe-requested";
}

export class DecodeStallDetector {
	private readonly stallTimeoutMs: number;
	private readonly now: () => number;
	private readonly state = new Map<string, DecodeState>();
	private activeStall = false;

	constructor(
		options: { stallTimeoutMs?: number; now?: () => number } = {},
	) {
		this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
		this.now = options.now ?? (() => Date.now());
	}

	check(
		samples: DecodeSample[],
		recoveryEnabled = true,
	): DecodeRecoveryAction[] {
		const now = this.now();
		const activeIds = new Set<string>();
		const actions: DecodeRecoveryAction[] = [];
		this.activeStall = false;

		for (const sample of samples) {
			activeIds.add(sample.id);
			if (
				sample.isPaused() ||
				sample.bytesReceived === null ||
				sample.framesDecoded === null
			) {
				this.state.delete(sample.id);
				continue;
			}

			const existing = this.state.get(sample.id);
			if (!existing) {
				this.state.set(sample.id, {
					lastBytesReceived: sample.bytesReceived,
					lastFramesDecoded: sample.framesDecoded,
					stallStartedAt: now,
					phase: "monitoring",
				});
				continue;
			}

			const rtpProgressed = sample.bytesReceived > existing.lastBytesReceived;
			const decodeProgressed =
				sample.framesDecoded > existing.lastFramesDecoded;
			const countersReset =
				sample.bytesReceived < existing.lastBytesReceived ||
				sample.framesDecoded < existing.lastFramesDecoded;
			existing.lastBytesReceived = sample.bytesReceived;
			existing.lastFramesDecoded = sample.framesDecoded;

			if (countersReset || decodeProgressed || !rtpProgressed) {
				existing.stallStartedAt = null;
				existing.phase = "monitoring";
				continue;
			}

			if (existing.stallStartedAt === null) {
				existing.stallStartedAt = now;
				continue;
			}
			if (now - existing.stallStartedAt < this.stallTimeoutMs) continue;

			this.activeStall = true;
			if (!recoveryEnabled) continue;
			if (existing.phase === "monitoring") {
				actions.push({
					consumerId: sample.id,
					action: "request-keyframe",
				});
				existing.phase = "keyframe-requested";
				existing.stallStartedAt = now;
			} else {
				actions.push({ consumerId: sample.id, action: "recreate" });
				this.state.delete(sample.id);
			}
		}

		for (const id of this.state.keys()) {
			if (!activeIds.has(id)) this.state.delete(id);
		}
		return actions;
	}

	hasActiveStall(): boolean {
		return this.activeStall;
	}

	reset(): void {
		this.state.clear();
		this.activeStall = false;
	}

	suspend(): void {
		this.reset();
	}

	dispose(consumerId: string): void {
		this.state.delete(consumerId);
	}
}

interface InboundRtpReport {
	type?: string;
	isRemote?: boolean;
	kind?: string;
	mediaType?: string;
	codecId?: string;
	bytesReceived?: number;
	framesDecoded?: number;
	mimeType?: string;
}

export function extractInboundRtpCounters(
	stats: {
		values(): IterableIterator<InboundRtpReport>;
		get?(id: string): InboundRtpReport | undefined;
	},
	kind?: "audio" | "video",
): { bytesReceived: number | null; framesDecoded: number | null } {
	let bytesReceived: number | null = null;
	let framesDecoded: number | null = null;
	for (const report of stats.values()) {
		if (report.type !== "inbound-rtp" || report.isRemote) continue;
		const reportKind = report.kind ?? report.mediaType;
		if (kind && reportKind && reportKind !== kind) continue;
		const codec = report.codecId ? stats.get?.(report.codecId) : undefined;
		if (codec?.mimeType?.toLowerCase().includes("rtx")) continue;
		if (typeof report.bytesReceived === "number") {
			bytesReceived = (bytesReceived ?? 0) + report.bytesReceived;
		}
		if (typeof report.framesDecoded === "number") {
			framesDecoded = (framesDecoded ?? 0) + report.framesDecoded;
		}
	}
	return { bytesReceived, framesDecoded };
}

export function extractInboundBytesReceived(
	stats: {
		values(): IterableIterator<{ type: string; bytesReceived?: number }>;
	},
): number | null {
	return extractInboundRtpCounters(stats).bytesReceived;
}
