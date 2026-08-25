export type ExpectedMediaStage =
	| "disabled"
	| "desired"
	| "captured"
	| "published"
	| "subscribed"
	| "flowing"
	| "decoding"
	| "failed";

export type MediaRepairStage =
	| "capture"
	| "publication"
	| "subscription"
	| "rtp"
	| "decode";

export type MediaRepairAction =
	| "reacquire"
	| "recreate_producer"
	| "subscribe"
	| "recreate_consumer"
	| "request_keyframe";

export interface ExpectedMediaObservation {
	key: string;
	direction: "local" | "remote";
	media: "audio" | "video";
	source: "camera" | "microphone" | "screen" | "remote";
	desired: boolean;
	captured?: boolean;
	published?: boolean;
	subscribed?: boolean;
	flowing?: boolean;
	decoding?: boolean;
}

export interface ExpectedMediaEntry extends ExpectedMediaObservation {
	stage: ExpectedMediaStage;
	attempts: number;
	healthySamples: number;
}

export interface MediaRepairTelemetry {
	media: "audio" | "video";
	source: "camera" | "microphone" | "screen" | "remote";
	stage: MediaRepairStage;
	action: MediaRepairAction;
	attempt: number;
	outcome: "success" | "failure" | "exhausted" | "cancelled";
	durationMs: number;
}

interface ActiveRepair {
	stage: MediaRepairStage;
	action: MediaRepairAction;
	attempt: number;
	startedAt: number;
}

interface HealthWaiter {
	resolve: () => void;
	reject: (error: unknown) => void;
	timer: ReturnType<typeof setTimeout>;
	abort: () => void;
}

export class ExpectedMediaReconciler {
	private readonly entries = new Map<string, ExpectedMediaEntry>();
	private readonly tails = new Map<string, Promise<unknown>>();
	private readonly activeRepairs = new Map<string, ActiveRepair>();
	private readonly exhausted = new Set<string>();
	private readonly healthWaiters = new Set<HealthWaiter>();
	private generation = 0;

	constructor(
		private readonly report: (event: MediaRepairTelemetry) => void = () => {},
		private readonly now: () => number = () => performance.now(),
		private readonly maxAttempts = 3,
	) {}

	observe(observation: ExpectedMediaObservation): ExpectedMediaEntry {
		const previous = this.entries.get(observation.key);
		const stage = this.stageFor(observation);
		const healthy = this.isHealthy(observation);
		const healthySamples = healthy ? (previous?.healthySamples ?? 0) + 1 : 0;
		const entry: ExpectedMediaEntry = {
			...observation,
			stage,
			attempts: previous?.attempts ?? 0,
			healthySamples,
		};

		if (!observation.desired) {
			entry.attempts = 0;
			this.finishRepair(observation.key, previous, "cancelled");
			this.exhausted.delete(observation.key);
		} else if (healthySamples >= 2) {
			entry.attempts = 0;
			this.finishRepair(observation.key, entry, "success");
			this.exhausted.delete(observation.key);
		}
		this.entries.set(observation.key, entry);
		this.resolveHealthyWaiters();
		return { ...entry };
	}

	get(key: string): ExpectedMediaEntry | undefined {
		const entry = this.entries.get(key);
		return entry ? { ...entry } : undefined;
	}

	snapshot(): ExpectedMediaEntry[] {
		return Array.from(this.entries.values(), (entry) => ({ ...entry }));
	}

	waitForHealthy(signal: AbortSignal, timeoutMs = 15_000): Promise<void> {
		if (this.allExpectedMediaHealthy()) return Promise.resolve();
		if (signal.aborted) return Promise.reject(signal.reason);
		return new Promise<void>((resolve, reject) => {
			const waiter = {} as HealthWaiter;
			const finish = (complete: () => void) => {
				clearTimeout(waiter.timer);
				signal.removeEventListener("abort", waiter.abort);
				this.healthWaiters.delete(waiter);
				complete();
			};
			waiter.resolve = () => finish(resolve);
			waiter.reject = (error) => finish(() => reject(error));
			waiter.abort = () => waiter.reject(signal.reason);
			waiter.timer = setTimeout(
				() => waiter.reject(new Error("Expected media did not become healthy")),
				timeoutMs,
			);
			this.healthWaiters.add(waiter);
			signal.addEventListener("abort", waiter.abort, { once: true });
		});
	}

	repair(
		key: string,
		stage: MediaRepairStage,
		action: MediaRepairAction,
		operation: () => Promise<void>,
	): Promise<boolean> {
		const entry = this.entries.get(key);
		if (!entry?.desired) return Promise.resolve(false);
		if (entry.attempts >= this.maxAttempts) {
			if (!this.exhausted.has(key)) {
				this.exhausted.add(key);
				this.reportRepair(entry, stage, action, entry.attempts, "exhausted", 0);
			}
			entry.stage = "failed";
			return Promise.resolve(false);
		}

		const pending = this.tails.get(key);
		if (pending) return pending.then(() => false);
		this.finishRepair(key, entry, "failure");
		entry.attempts += 1;
		const repair: ActiveRepair = {
			stage,
			action,
			attempt: entry.attempts,
			startedAt: this.now(),
		};
		this.activeRepairs.set(key, repair);
		const generation = this.generation;
		const promise = Promise.resolve()
			.then(async () => {
				if (generation !== this.generation) throw this.cancelled();
				await operation();
				if (generation !== this.generation) throw this.cancelled();
				return true;
			})
			.catch((error) => {
				const outcome =
					(error as { name?: unknown } | null)?.name === "AbortError"
						? "cancelled"
						: "failure";
				this.finishRepair(key, entry, outcome);
				throw error;
			})
			.finally(() => {
				if (this.tails.get(key) === promise) this.tails.delete(key);
			});
		this.tails.set(key, promise);
		return promise;
	}

	reset(): void {
		this.generation += 1;
		for (const [key, entry] of this.entries) {
			this.finishRepair(key, entry, "cancelled");
		}
		this.entries.clear();
		this.tails.clear();
		this.exhausted.clear();
		for (const waiter of Array.from(this.healthWaiters)) {
			waiter.reject(this.cancelled());
		}
	}

	private stageFor(observation: ExpectedMediaObservation): ExpectedMediaStage {
		if (!observation.desired) return "disabled";
		if (observation.decoding) return "decoding";
		if (observation.flowing) return "flowing";
		if (observation.subscribed) return "subscribed";
		if (observation.published) return "published";
		if (observation.captured) return "captured";
		return "desired";
	}

	private isHealthy(observation: ExpectedMediaObservation): boolean {
		if (observation.direction === "local") return observation.flowing === true;
		return observation.media === "video"
			? observation.decoding === true
			: observation.flowing === true;
	}

	private allExpectedMediaHealthy(): boolean {
		return Array.from(this.entries.values())
			.filter((entry) => entry.desired)
			.every((entry) => entry.healthySamples >= 2);
	}

	private resolveHealthyWaiters(): void {
		if (!this.allExpectedMediaHealthy()) return;
		for (const waiter of Array.from(this.healthWaiters)) waiter.resolve();
	}

	private finishRepair(
		key: string,
		entry: ExpectedMediaObservation | undefined,
		outcome: "success" | "failure" | "cancelled",
	): void {
		const repair = this.activeRepairs.get(key);
		if (!repair || !entry) return;
		this.activeRepairs.delete(key);
		this.reportRepair(
			entry,
			repair.stage,
			repair.action,
			repair.attempt,
			outcome,
			this.now() - repair.startedAt,
		);
	}

	private reportRepair(
		entry: ExpectedMediaObservation,
		stage: MediaRepairStage,
		action: MediaRepairAction,
		attempt: number,
		outcome: MediaRepairTelemetry["outcome"],
		durationMs: number,
	): void {
		this.report({
			media: entry.media,
			source: entry.source,
			stage,
			action,
			attempt,
			outcome,
			durationMs: Math.max(0, Math.min(300_000, Math.round(durationMs))),
		});
	}

	private cancelled(): DOMException {
		return new DOMException("Expected media lifecycle ended", "AbortError");
	}
}
