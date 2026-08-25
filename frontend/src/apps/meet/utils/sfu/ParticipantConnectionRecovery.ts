export type ParticipantRecoveryScope =
	| "publication"
	| "subscription"
	| "transport"
	| "signaling";

export interface ParticipantRecoveryTrigger {
	scope: ParticipantRecoveryScope;
	direction?: "send" | "recv" | "both";
	reason: string;
}

export type ParticipantRecoveryPhase =
	| "healthy"
	| "rebuilding_participant_connection"
	| "verifying"
	| "terminal_failed"
	| "stopped";

export interface ParticipantRecoveryTransition {
	phase: ParticipantRecoveryPhase;
	trigger: ParticipantRecoveryTrigger;
	attempt: number;
	maxAttempts: number;
	delayMs: number;
}

interface ParticipantConnectionRecoveryOptions {
	rebuild: (
		trigger: ParticipantRecoveryTrigger,
		attempt: number,
		signal: AbortSignal,
	) => Promise<void>;
	verify: (trigger: ParticipantRecoveryTrigger, signal: AbortSignal) => Promise<void>;
	onTransition?: (transition: ParticipantRecoveryTransition) => void;
	random?: () => number;
	sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

/**
 * Exhausted media, transport, signaling, and snapshot repairs converge here:
 * rebuild a fresh Participant Connection, verify it, or enter terminal failure.
 */
export class ParticipantConnectionRecovery {
	private readonly random: () => number;
	private readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
	private readonly maxAttempts: number;
	private readonly baseDelayMs: number;
	private readonly maxDelayMs: number;
	private active: Promise<boolean> | null = null;

	constructor(private readonly options: ParticipantConnectionRecoveryOptions) {
		this.random = options.random ?? Math.random;
		this.sleep = options.sleep ?? this.delay;
		this.maxAttempts = options.maxAttempts ?? 3;
		this.baseDelayMs = options.baseDelayMs ?? 1000;
		this.maxDelayMs = options.maxDelayMs ?? 10_000;
	}

	recover(
		trigger: ParticipantRecoveryTrigger,
		signal: AbortSignal,
	): Promise<boolean> {
		if (this.active) return this.active;
		const recovery = this.run(trigger, signal).finally(() => {
			if (this.active === recovery) this.active = null;
		});
		this.active = recovery;
		return recovery;
	}

	stop(trigger: ParticipantRecoveryTrigger): void {
		this.transition("stopped", trigger, 0, 0);
	}

	private async run(
		trigger: ParticipantRecoveryTrigger,
		signal: AbortSignal,
	): Promise<boolean> {
		for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
			const delayMs = this.retryDelay(attempt);
			if (delayMs > 0) await this.sleep(delayMs, signal);
			this.throwIfAborted(signal);
			this.transition(
				"rebuilding_participant_connection",
				trigger,
				attempt,
				delayMs,
			);
			try {
				await this.options.rebuild(trigger, attempt, signal);
				this.throwIfAborted(signal);
				this.transition("verifying", trigger, attempt, delayMs);
				await this.options.verify(trigger, signal);
				this.throwIfAborted(signal);
				this.transition("healthy", trigger, attempt, delayMs);
				return true;
			} catch (error) {
				if (signal.aborted) throw error;
				if (attempt === this.maxAttempts) {
					this.transition("terminal_failed", trigger, attempt, delayMs);
					return false;
				}
			}
		}
		return false;
	}

	private retryDelay(attempt: number): number {
		if (attempt === 1) return 0;
		const ceiling = Math.min(
			this.maxDelayMs,
			this.baseDelayMs * 2 ** (attempt - 2),
		);
		return Math.floor(this.random() * ceiling);
	}

	private transition(
		phase: ParticipantRecoveryPhase,
		trigger: ParticipantRecoveryTrigger,
		attempt: number,
		delayMs: number,
	): void {
		this.options.onTransition?.({
			phase,
			trigger,
			attempt,
			maxAttempts: this.maxAttempts,
			delayMs,
		});
	}

	private throwIfAborted(signal: AbortSignal): void {
		if (signal.aborted) {
			throw signal.reason ?? new DOMException("Recovery stopped", "AbortError");
		}
	}

	private delay(delayMs: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => finish(resolve), delayMs);
			const abort = () => {
				clearTimeout(timeout);
				finish(() => reject(signal.reason));
			};
			const finish = (complete: () => void) => {
				signal.removeEventListener("abort", abort);
				complete();
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	}
}
