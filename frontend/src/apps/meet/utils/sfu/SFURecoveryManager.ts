/**
 * SFU Recovery Manager
 * Handles ICE restart and connection recovery logic
 */

import type { TransportManager } from "../media/TransportManager";
import type { SFUClient } from "../SFUClient";

interface RecoveryManagerOptions {
	sfuClient: SFUClient;
	transportManager: TransportManager;
	meetingId: () => string | null;
	onRecovered?: (reason: string) => Promise<void> | void;
	onFailed?: (reason: string) => Promise<void> | void;
}

type TransportDirection = "send" | "recv";
export type RecoveryResult = "recovered" | "failed" | "skipped";

export class SFURecoveryManager {
	private sfuClient: SFUClient;
	private transportManager: TransportManager;
	private getMeetingId: () => string | null;
	private onRecovered?: (reason: string) => Promise<void> | void;
	private onFailed?: (reason: string) => Promise<void> | void;
	private recoveryInProgress = false;
	private activeRecovery: Promise<RecoveryResult> | null = null;
	private failedRecoveryCallback: Promise<RecoveryResult> | null = null;
	private lastRecoveryAt = 0;
	private static readonly RECOVERY_COOLDOWN_MS = 7000;
	private static readonly DISCONNECTED_GRACE_MS = 3000;
	private static readonly WATCHDOG_INTERVAL_MS = 1000;
	private disconnectedSince: Map<TransportDirection, number> = new Map();
	private watchdogHandle: ReturnType<typeof setInterval> | null = null;

	constructor(options: RecoveryManagerOptions) {
		this.sfuClient = options.sfuClient;
		this.transportManager = options.transportManager;
		this.getMeetingId = options.meetingId;
		this.onRecovered = options.onRecovered;
		this.onFailed = options.onFailed;
	}

	get isRecovering(): boolean {
		return this.recoveryInProgress;
	}

	recoverTransportIce(reason: string): Promise<RecoveryResult> {
		if (this.activeRecovery) return this.activeRecovery;

		if (!this.sfuClient?.isConnected?.()) {
			return Promise.resolve("skipped");
		}

		const now = Date.now();
		if (now - this.lastRecoveryAt < SFURecoveryManager.RECOVERY_COOLDOWN_MS) {
			return Promise.resolve("skipped");
		}

		this.recoveryInProgress = true;
		this.lastRecoveryAt = now;

		this.activeRecovery = (async (): Promise<RecoveryResult> => {
			try {
				console.warn("Restarting SFU transport ICE", {
					reason,
					meetingId: this.getMeetingId(),
				});

				const restarted =
					await this.transportManager.restartAllTransportIce();
				if (!restarted) {
					return "failed";
				}

				console.log("SFU transport ICE restart completed", { reason });
				await this.onRecovered?.(reason);
				return "recovered";
			} catch (error) {
				console.error("SFU transport ICE restart failed:", error);
				return "failed";
			} finally {
				this.recoveryInProgress = false;
				this.activeRecovery = null;
			}
		})();

		return this.activeRecovery;
	}

	private recoverTransportFailure(
		reason: string,
		onRecovered?: () => void,
	): void {
		const recovery = this.recoverTransportIce(reason);
		void recovery
			.then(async (result) => {
				if (result === "recovered") {
					onRecovered?.();
				}

				if (result === "failed") {
					if (this.failedRecoveryCallback === recovery) return;
					this.failedRecoveryCallback = recovery;
					await this.onFailed?.(reason);
				}
			})
			.finally(() => {
				if (this.failedRecoveryCallback === recovery) {
					this.failedRecoveryCallback = null;
				}
			})
			.catch((error) => {
				console.warn("SFU recovery failure fallback failed:", error);
			});
	}

	handleTransportConnectionStateChange(direction: string, state: string): void {
		if (state === "failed" || state === "closed") {
			this.disconnectedSince.delete(direction as TransportDirection);
			this.recoverTransportFailure(`transport_${direction}_${state}`);
			return;
		}

		if (state === "disconnected") {
			if (!this.disconnectedSince.has(direction as TransportDirection)) {
				this.disconnectedSince.set(direction as TransportDirection, Date.now());
			}
			return;
		}

		this.disconnectedSince.delete(direction as TransportDirection);
	}

	private runWatchdog(): void {
		if (this.disconnectedSince.size === 0) return;
		const now = Date.now();
		for (const [direction, since] of this.disconnectedSince) {
			if (now - since >= SFURecoveryManager.DISCONNECTED_GRACE_MS) {
				const reason = `transport_${direction}_disconnected_timeout`;
				this.recoverTransportFailure(reason, () => {
					this.disconnectedSince.delete(direction);
				});
			}
		}
	}

	setupTransportEventHandlers(): void {
		this.transportManager.setEventHandlers({
			onTransportConnectionStateChange: ({
				direction,
				state,
			}: {
				direction: string;
				state: string;
			}) => {
				this.handleTransportConnectionStateChange(direction, state);
			},
		});

		if (this.watchdogHandle === null) {
			this.watchdogHandle = setInterval(
				() => this.runWatchdog(),
				SFURecoveryManager.WATCHDOG_INTERVAL_MS,
			);
		}
	}

	reset(): void {
		this.recoveryInProgress = false;
		this.failedRecoveryCallback = null;
		this.lastRecoveryAt = 0;
		this.disconnectedSince.clear();
		if (this.watchdogHandle !== null) {
			clearInterval(this.watchdogHandle);
			this.watchdogHandle = null;
		}
	}
}
