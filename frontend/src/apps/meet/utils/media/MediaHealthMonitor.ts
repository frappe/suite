import type { ConsumerEntry } from "./ConsumerManager";
import {
	type ConsumerSample,
	DecodeStallDetector,
	extractInboundRtpCounters,
	StallDetector,
} from "./stallDetector";
import {
	type ClientTelemetryEvent,
	getClientTelemetry,
} from "../telemetry/ClientTelemetry";

export type NetworkQuality = "good" | "poor" | "critical";

/** Current uplink, downlink, and transport health exposed to the UI. */
export interface MediaHealthState {
	networkQuality: NetworkQuality;
	downlinkQuality: NetworkQuality;
	isTransportFailed: boolean;
}

interface NetworkStats {
	rtt: number;
	packetLoss: number;
	availableOutgoingBitrate: number;
	timestamp: number;
	isValid: boolean;
}

/** Manager operations used to inspect and recover live meeting media. */
export interface MediaHealthManager {
	transportManager?: {
		getTransportStats(): {
			sendTransport?: { state?: string };
			recvTransport?: { state?: string };
		} | null;
		getNetworkStats?: () => Promise<NetworkStats>;
	};
	mediaManager?: {
		consumerManager?: {
			getAllConsumers(): ConsumerEntry[];
			getConsumer?(consumerId: string): ConsumerEntry | undefined;
		};
		recoverConsumer(entry: ConsumerEntry): Promise<void>;
	};
	participantManager: {
		getParticipant(participantId: string):
			| { audio_enabled?: boolean; video_enabled?: boolean }
			| undefined;
	};
	sfuClient?: {
		requestConsumerKeyFrame?(consumerId: string): Promise<unknown>;
		sendClientTelemetry(event: ClientTelemetryEvent): void;
	};
	reconcileExpectedMedia?(): Promise<void>;
	recoverBrowserLifecycle?(): Promise<void>;
	observeRemoteMediaProgress?(
		producerId: string,
		media: "audio" | "video",
		flowing: boolean,
		decoding: boolean,
	): void;
	resetReceiveMedia(): Promise<void>;
}

type LifecycleEvent = "offline" | "online" | "pageshow";
type ScheduledPoll = () => void | Promise<void>;

/** Injectable browser lifecycle and timer boundary used by the monitor. */
export interface MediaHealthEnvironment {
	now(): number;
	isHidden(): boolean;
	isOnline(): boolean;
	setInterval(callback: ScheduledPoll, intervalMs: number): unknown;
	clearInterval(handle: unknown): void;
	onVisibilityChange(listener: () => void): () => void;
	onLifecycleEvent(event: LifecycleEvent, listener: () => void): () => void;
}

const browserEnvironment: MediaHealthEnvironment = {
	now: () => Date.now(),
	isHidden: () => document.hidden,
	isOnline: () => navigator.onLine !== false,
	setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
	clearInterval: (handle) =>
		clearInterval(handle as ReturnType<typeof setInterval>),
	onVisibilityChange: (listener) => {
		document.addEventListener("visibilitychange", listener);
		return () => document.removeEventListener("visibilitychange", listener);
	},
	onLifecycleEvent: (event, listener) => {
		window.addEventListener(event, listener);
		return () => window.removeEventListener(event, listener);
	},
};

const POOR_RTT_MS = 450;
const CRITICAL_RTT_MS = 900;
const POOR_PACKET_LOSS_PERCENT = 8;
const CRITICAL_PACKET_LOSS_PERCENT = 18;
const POOR_VIDEO_BITRATE_BPS = 350_000;
const CRITICAL_VIDEO_BITRATE_BPS = 200_000;
const POLL_INTERVAL_MS = 3000;

/**
 * Polls live media health and applies recovery policy independently of Vue.
 * Call `start` once mounted, subscribe to state changes, and call `stop` during
 * teardown. The optional environment makes lifecycle races deterministic in tests.
 */
export class MediaHealthMonitor {
	private stateValue: MediaHealthState = {
		networkQuality: "good",
		downlinkQuality: "good",
		isTransportFailed: false,
	};
	private readonly listeners = new Set<(state: MediaHealthState) => void>();
	private readonly stallDetector: StallDetector;
	private readonly decodeStallDetector: DecodeStallDetector;
	private readonly expectedMediaCounters = new Map<
		string,
		{ bytesReceived: number | null; framesDecoded: number | null }
	>();
	private interval: unknown = null;
	private removeLifecycleListeners: (() => void)[] = [];
	private active = false;
	private polling = false;
	private lifecycleGeneration = 0;

	constructor(
		private readonly getManager: () => MediaHealthManager | null,
		private readonly environment: MediaHealthEnvironment = browserEnvironment,
	) {
		const now = () => this.environment.now();
		this.stallDetector = new StallDetector({ now });
		this.decodeStallDetector = new DecodeStallDetector({ now });
	}

	get state(): Readonly<MediaHealthState> {
		return this.stateValue;
	}

	/** Subscribes to state changes and immediately emits the current state. */
	subscribe(listener: (state: MediaHealthState) => void): () => void {
		this.listeners.add(listener);
		listener(this.stateValue);
		return () => this.listeners.delete(listener);
	}

	/** Starts polling and browser lifecycle observation. */
	start(): void {
		if (this.active) return;
		this.active = true;
		this.removeLifecycleListeners = [
			this.environment.onVisibilityChange(this.handleVisibilityChange),
			this.environment.onLifecycleEvent("offline", this.suspendLifecycle),
			this.environment.onLifecycleEvent("online", this.recoverLifecycle),
			this.environment.onLifecycleEvent("pageshow", this.recoverLifecycle),
		];
		this.interval = this.environment.setInterval(
			() => this.pollStats(),
			POLL_INTERVAL_MS,
		);
	}

	/** Stops polling, removes lifecycle listeners, and clears health baselines. */
	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.lifecycleGeneration += 1;
		for (const removeListener of this.removeLifecycleListeners)
			removeListener();
		this.removeLifecycleListeners = [];
		if (this.interval !== null) {
			this.environment.clearInterval(this.interval);
			this.interval = null;
		}
		this.stallDetector.reset();
		this.decodeStallDetector.reset();
		this.expectedMediaCounters.clear();
	}

	private readonly handleVisibilityChange = () => {
		if (this.environment.isHidden()) {
			this.suspendLifecycle();
		} else {
			void this.recoverLifecycle();
		}
	};

	private readonly suspendLifecycle = () => {
		this.lifecycleGeneration += 1;
		this.resetHealthBaselines();
	};

	private readonly recoverLifecycle = async () => {
		const generation = ++this.lifecycleGeneration;
		this.resetHealthBaselines();
		if (this.isLifecycleSuspended()) return;
		const manager = this.getManager();
		await manager?.recoverBrowserLifecycle?.();
		if (
			generation !== this.lifecycleGeneration ||
			this.isLifecycleSuspended() ||
			this.getManager() !== manager
		) {
			return;
		}
	};

	private isLifecycleSuspended(): boolean {
		return (
			!this.active ||
			this.environment.isHidden() ||
			!this.environment.isOnline()
		);
	}

	private resetHealthBaselines(): void {
		this.stallDetector.suspend();
		this.decodeStallDetector.suspend();
		this.expectedMediaCounters.clear();
	}

	private setState(update: Partial<MediaHealthState>): void {
		const next = { ...this.stateValue, ...update };
		if (
			next.networkQuality === this.stateValue.networkQuality &&
			next.downlinkQuality === this.stateValue.downlinkQuality &&
			next.isTransportFailed === this.stateValue.isTransportFailed
		) {
			return;
		}
		this.stateValue = next;
		for (const listener of this.listeners) listener(next);
	}

	private updateQuality(stats: NetworkStats): void {
		if (!stats.isValid) {
			this.setState({ networkQuality: "good" });
			return;
		}

		const hasBitrateEstimate = stats.availableOutgoingBitrate > 0;
		const hasPoorVideoBitrate =
			hasBitrateEstimate &&
			stats.availableOutgoingBitrate < POOR_VIDEO_BITRATE_BPS;
		const hasCriticalVideoBitrate =
			hasBitrateEstimate &&
			stats.availableOutgoingBitrate < CRITICAL_VIDEO_BITRATE_BPS;
		const isCritical =
			stats.packetLoss > CRITICAL_PACKET_LOSS_PERCENT ||
			stats.rtt > 1_200 ||
			(stats.rtt > CRITICAL_RTT_MS && hasCriticalVideoBitrate);
		const isPoor =
			stats.packetLoss > POOR_PACKET_LOSS_PERCENT ||
			(stats.rtt > POOR_RTT_MS && hasPoorVideoBitrate);

		this.setState({
			networkQuality: isCritical ? "critical" : isPoor ? "poor" : "good",
		});
	}

	private async pollStats(): Promise<void> {
		if (this.polling) return;
		if (this.isLifecycleSuspended()) {
			this.resetHealthBaselines();
			return;
		}

		this.polling = true;
		const generation = this.lifecycleGeneration;
		try {
			const manager = this.getManager();
			const transportManager = manager?.transportManager;
			if (!transportManager) {
				this.setState({
					networkQuality: "good",
					isTransportFailed: false,
				});
				return;
			}

			const transportStats = transportManager.getTransportStats();
			const isFailed =
				transportStats?.sendTransport?.state === "failed" ||
				transportStats?.recvTransport?.state === "failed";
			this.setState({
				isTransportFailed: isFailed,
				...(isFailed ? { networkQuality: "critical" as const } : {}),
			});

			if (isFailed) {
				this.stallDetector.suspend();
				this.decodeStallDetector.suspend();
				return;
			}

			if (transportManager.getNetworkStats) {
				const stats = await transportManager.getNetworkStats();
				if (
					generation !== this.lifecycleGeneration ||
					this.isLifecycleSuspended()
				) {
					return;
				}
				this.updateQuality(stats);
				const telemetryClient = this.getManager()?.sfuClient;
				if (telemetryClient && stats.isValid) {
					getClientTelemetry(telemetryClient).reportNetworkQuality(stats);
				}
			}
			await this.getManager()?.reconcileExpectedMedia?.();
			await this.checkConsumerStalls(this.stateValue.networkQuality === "good");
		} finally {
			this.polling = false;
		}
	}

	private async checkConsumerStalls(allowRecovery: boolean): Promise<void> {
		const manager = this.getManager();
		if (!manager) return;
		const consumerManager = manager.mediaManager?.consumerManager;
		if (!consumerManager) {
			this.setState({ downlinkQuality: "good" });
			return;
		}

		const consumers = consumerManager.getAllConsumers();
		if (consumers.length === 0) {
			this.setState({ downlinkQuality: "good" });
			return;
		}
		if (this.isLifecycleSuspended()) {
			this.resetHealthBaselines();
			return;
		}

		const statsResults = await Promise.all(
			consumers.map(async (entry) => {
				let bytesReceived: number | null = null;
				let framesDecoded: number | null = null;
				try {
					const stats = await entry.consumer.getStats();
					const counters = extractInboundRtpCounters(stats, entry.kind);
					bytesReceived = counters.bytesReceived;
					framesDecoded = counters.framesDecoded;
				} catch {
					bytesReceived = null;
				}
				return { entry, bytes: bytesReceived, framesDecoded };
			}),
		);
		if (this.isLifecycleSuspended() || this.getManager() !== manager) return;

		const isPaused = (entry: ConsumerEntry) => {
			const participant = manager.participantManager.getParticipant(
				entry.participantId,
			);
			return (
				entry.consumer.paused ||
				(entry.consumer as typeof entry.consumer & { producerPaused?: boolean })
					.producerPaused ||
				entry.adaptivelyPaused ||
				(entry.kind === "audio" && participant?.audio_enabled === false) ||
				(entry.kind === "video" &&
					!entry.isScreen &&
					participant?.video_enabled === false)
			);
		};
		const samples: ConsumerSample[] = statsResults.map(({ entry, bytes }) => ({
			id: entry.id,
			kind: entry.kind,
			isPaused: () => isPaused(entry),
			isMuted: () => entry.track?.muted ?? false,
			getBytesReceived: () => bytes,
			getCreatedAt: () => entry.createdAt,
		}));
		const telemetry = manager.sfuClient
			? getClientTelemetry(manager.sfuClient)
			: null;
		for (const { entry, bytes, framesDecoded } of statsResults) {
			const previous = this.expectedMediaCounters.get(entry.id);
			manager.observeRemoteMediaProgress?.(
				entry.producerId,
				entry.kind === "audio" ? "audio" : "video",
				bytes !== null && bytes > (previous?.bytesReceived ?? 0),
				entry.kind !== "video" ||
					(framesDecoded !== null &&
						framesDecoded > (previous?.framesDecoded ?? 0)),
			);
			this.expectedMediaCounters.set(entry.id, {
				bytesReceived: bytes,
				framesDecoded,
			});
			if (
				bytes !== null &&
				bytes > 0 &&
				(entry.kind === "audio" || entry.kind === "video")
			) {
				telemetry?.markFirstRemoteMedia(entry.kind);
			}
		}

		const stalledIds = this.stallDetector.check(samples, allowRecovery);
		const decodeActions = this.decodeStallDetector.check(
			statsResults
				.filter(({ entry }) => entry.kind === "video")
				.map(({ entry, bytes, framesDecoded }) => ({
					id: entry.id,
					isPaused: () => isPaused(entry),
					bytesReceived: bytes,
					framesDecoded,
				})),
			allowRecovery,
		);
		this.setState({
			downlinkQuality:
				this.stallDetector.hasActiveStall() ||
				this.decodeStallDetector.hasActiveStall()
					? "critical"
					: "good",
		});

		for (const recovery of decodeActions) {
			if (this.isLifecycleSuspended() || this.getManager() !== manager) return;
			const result = statsResults.find(
				({ entry }) => entry.id === recovery.consumerId,
			);
			if (!result) continue;
			const current =
				consumerManager.getConsumer?.(result.entry.id) ??
				consumerManager
					.getAllConsumers()
					.find((entry) => entry.id === result.entry.id);
			if (
				!current ||
				current.consumer !== result.entry.consumer ||
				isPaused(current)
			) {
				this.decodeStallDetector.dispose(result.entry.id);
				continue;
			}
			if (recovery.action === "request-keyframe") {
				try {
					await manager.sfuClient?.requestConsumerKeyFrame?.(result.entry.id);
				} catch (error) {
					console.warn(
						"Failed to request a keyframe for decode-stalled consumer",
						result.entry.id,
						error,
					);
				}
			} else {
				this.decodeStallDetector.dispose(result.entry.id);
				try {
					await manager.mediaManager?.recoverConsumer(current);
				} catch (error) {
					console.warn(
						"Failed to recreate decode-stalled consumer",
						result.entry.id,
						error,
					);
				}
			}
			if (this.isLifecycleSuspended() || this.getManager() !== manager) return;
		}

		if (stalledIds.length === 0) return;
		const stalledSet = new Set(stalledIds);
		telemetry?.reportMediaStalls(
			samples
				.filter((sample) => stalledSet.has(sample.id))
				.map((sample) => sample.kind)
				.filter(
					(kind): kind is "audio" | "video" =>
						kind === "audio" || kind === "video",
				),
		);

		const stalledEntries = statsResults
			.map(({ entry }) => entry)
			.filter((entry) => stalledSet.has(entry.id));
		const neverStartedEntries = stalledEntries.filter(
			(entry) => !this.stallDetector.hasReceivedMedia(entry.id),
		);
		for (const entry of neverStartedEntries) {
			this.stallDetector.dispose(entry.id);
			void manager.mediaManager?.recoverConsumer(entry);
		}
		const establishedStalls = stalledEntries.filter((entry) =>
			this.stallDetector.hasReceivedMedia(entry.id),
		);
		if (establishedStalls.length === 0) return;
		const hasAudioStall = establishedStalls.some(
			(entry) => entry.kind === "audio",
		);
		const hasExhaustedVideoRecovery = establishedStalls.some(
			(entry) =>
				entry.kind === "video" &&
				this.stallDetector.getRecoveryAttempts(entry.id) > 2,
		);
		if (hasAudioStall || hasExhaustedVideoRecovery) {
			try {
				await manager.resetReceiveMedia();
			} catch (error) {
				console.warn("Failed to reset stalled receive media", error);
			}
			this.stallDetector.suspend();
			return;
		}

		for (const entry of establishedStalls) {
			if (entry.kind === "video") {
				void manager.sfuClient
					?.requestConsumerKeyFrame?.(entry.id)
					.catch((error) =>
						console.warn(
							"Failed to recover stalled video consumer",
							entry.id,
							error,
						),
					);
			}
		}
	}
}
