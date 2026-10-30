import type { NetworkPathStats } from "./NetworkStatsTracker";
import type { ConsumerEntry } from "./ConsumerManager";
import {
	type ConsumerSample,
	DecodeStallDetector,
	extractInboundRtpCounters,
	StallDetector,
} from "./stallDetector";
export type NetworkQuality = "unknown" | "good" | "poor" | "critical";

/** Current uplink, downlink, and transport health exposed to the UI. */
export interface MediaHealthState {
	networkQuality: NetworkQuality;
	downlinkQuality: NetworkQuality;
	isTransportFailed: boolean;
	status: "checking" | "good" | "degraded" | "reconnecting" | "disconnected";
	issue: "send" | "receive" | "both" | null;
}

interface MediaHealthNetworkStats {
	rtt: number;
	packetLoss: number;
	availableOutgoingBitrate: number;
	timestamp: number;
	isValid: boolean;
	uplink?: NetworkPathStats | null;
	downlink?: NetworkPathStats | null;
}

/** Media inspection, recovery, and telemetry operations used by the monitor. */
export interface MediaHealthPort {
	onRecoveryVerified?(reason: string): void;
	hasMissingExpectedReceiveMedia?(): boolean;
	hasExpectedSendMedia?(): boolean;
	isSignalingConnected?(): boolean;
	getTransportStats(): {
		sendTransport?: { state?: string };
		recvTransport?: { state?: string };
	} | null;
	getNetworkStats(): Promise<MediaHealthNetworkStats>;
	getConsumers(): ConsumerEntry[];
	getConsumer(consumerId: string): ConsumerEntry | undefined;
	isConsumerPaused(entry: ConsumerEntry): boolean;
	recoverConsumer(entry: ConsumerEntry): Promise<void>;
	requestConsumerKeyFrame(consumerId: string): Promise<unknown>;
	reconcileExpectedMedia(): Promise<void>;
	recoverBrowserLifecycle(): Promise<void>;
	observeRemoteMediaProgress(
		producerId: string,
		media: "audio" | "video",
		flowing: boolean,
		decoding: boolean,
	): void;
	resetReceiveMedia(): Promise<void>;
	reportNetworkQuality(stats: MediaHealthNetworkStats): void;
	markFirstRemoteMedia(media: "audio" | "video"): void;
	reportMediaStalls(media: Array<"audio" | "video">): void;
}

interface ConsumerHealthSample {
	entry: ConsumerEntry;
	bytes: number | null;
	framesDecoded: number | null;
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

const POLL_INTERVAL_MS = 3000;

/**
 * Polls live media health and applies recovery policy independently of Vue.
 * Call `start` once mounted, subscribe to state changes, and call `stop` during
 * teardown. The optional environment makes lifecycle races deterministic in tests.
 */
export class MediaHealthMonitor {
	private stateValue: MediaHealthState = {
		networkQuality: "unknown",
		downlinkQuality: "unknown",
		status: "checking",
		issue: null,
		isTransportFailed: false,
	};
	private readonly listeners = new Set<(state: MediaHealthState) => void>();
	private readonly stallDetector: StallDetector;
	private readonly decodeStallDetector: DecodeStallDetector;
	private readonly expectedMediaCounters = new Map<
		string,
		{ bytesReceived: number | null; framesDecoded: number | null }
	>();
	private lastSendProgressAt: number | null = null;
	private missingReceiveSince: number | null = null;
	private hasSendMedia = false;
	private receiveQuality: NetworkQuality = "unknown";
	private receiveProgress = new Map<
		string,
		{
			bytes: number | null;
			frames: number | null;
			at: number;
			bytesAt: number;
			framesAt: number;
		}
	>();
	private qualityCandidates = new Map<
		"networkQuality" | "downlinkQuality",
		{ quality: NetworkQuality; since: number }
	>();
	private lastCompletedAt = 0;
	private needsSendSample = false;
	private needsReceiveSample = false;
	private interrupted: "send" | "receive" | "both" | null = null;
	private recovering: {
		reason: string;
		direction: "send" | "recv" | "both";
		goodSince: number | null;
	} | null = null;
	private interval: unknown = null;
	private removeLifecycleListeners: (() => void)[] = [];
	private active = false;
	private polling = false;
	private lifecycleGeneration = 0;

	constructor(
		private readonly port: MediaHealthPort,
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
		this.lastCompletedAt = this.environment.now();
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
		this.receiveProgress.clear();
		this.qualityCandidates.clear();
		this.recovering = null;
		this.interrupted = null;
		this.missingReceiveSince = null;
		this.lastSendProgressAt = null;
		this.receiveQuality = "unknown";
		this.setState({
			networkQuality: "unknown",
			downlinkQuality: "unknown",
			isTransportFailed: false,
		});
	}

	private readonly handleVisibilityChange = () => {
		if (this.environment.isHidden()) {
			this.suspendLifecycle();
		} else {
			void this.recoverLifecycle();
		}
	};

	/** Recovery control completion alone must never clear the media warning. */
	beginRecovery(direction: "send" | "recv" | "both", reason: string): void {
		const previous = this.recovering;
		if (direction !== "recv") this.lastSendProgressAt = null;
		this.recovering = {
			reason,
			direction:
				previous && previous.direction !== direction ? "both" : direction,
			goodSince: null,
		};
		this.setState({});
	}

	private readonly suspendLifecycle = () => {
		this.lifecycleGeneration += 1;
		this.resetHealthBaselines();
		this.setState({ networkQuality: "unknown", downlinkQuality: "unknown" });
	};

	private readonly recoverLifecycle = async () => {
		const generation = ++this.lifecycleGeneration;
		this.resetHealthBaselines();
		if (this.isLifecycleSuspended()) return;
		this.setState({ networkQuality: "unknown", downlinkQuality: "unknown" });
		await this.port.recoverBrowserLifecycle();
		if (
			generation !== this.lifecycleGeneration ||
			this.isLifecycleSuspended()
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
		this.receiveProgress.clear();
		this.qualityCandidates.clear();
		if (this.recovering) this.recovering.goodSince = null;
		this.lastSendProgressAt = null;
		this.stallDetector.suspend();
		this.decodeStallDetector.suspend();
		this.expectedMediaCounters.clear();
	}

	private setState(update: Partial<MediaHealthState>): void {
		const next = { ...this.stateValue, ...update };
		const sendBad =
			next.networkQuality === "poor" || next.networkQuality === "critical";
		const receiveBad =
			next.downlinkQuality === "poor" || next.downlinkQuality === "critical";
		next.issue =
			this.interrupted ??
			(sendBad && receiveBad
				? "both"
				: sendBad
					? "send"
					: receiveBad
						? "receive"
						: null);
		const awaitingMeasurement =
			(this.needsSendSample && next.networkQuality === "unknown") ||
			(this.needsReceiveSample && next.downlinkQuality === "unknown");
		if (!this.environment.isOnline()) next.status = "disconnected";
		else if (
			this.interrupted ||
			this.recovering ||
			this.port.isSignalingConnected?.() === false
		)
			next.status = "reconnecting";
		else if (sendBad || receiveBad) next.status = "degraded";
		else if (awaitingMeasurement) next.status = "checking";
		else
			next.status =
				next.networkQuality === "good" || next.downlinkQuality === "good"
					? "good"
					: "checking";
		if (
			next.networkQuality === this.stateValue.networkQuality &&
			next.downlinkQuality === this.stateValue.downlinkQuality &&
			next.isTransportFailed === this.stateValue.isTransportFailed &&
			next.status === this.stateValue.status &&
			next.issue === this.stateValue.issue
		)
			return;
		this.stateValue = next;
		for (const listener of this.listeners) listener(next);
	}

	private classify(path: NetworkPathStats | null | undefined): NetworkQuality {
		if (!path?.isValid) return "unknown";
		if (
			(path.packetLoss ?? 0) >= 18 ||
			(path.rtt ?? 0) >= 1200 ||
			(path.jitter ?? 0) >= 150
		)
			return "critical";
		if (
			(path.packetLoss ?? 0) >= 5 ||
			(path.rtt ?? 0) >= 450 ||
			(path.jitter ?? 0) >= 40
		)
			return "poor";
		return "good";
	}

	private updateQuality(stats: MediaHealthNetworkStats): void {
		const uplink =
			stats.uplink === undefined
				? {
						rtt: stats.rtt,
						packetLoss: stats.packetLoss,
						jitter: null,
						isValid: stats.isValid,
					}
				: stats.uplink;
		this.hasSendMedia = uplink?.hasMedia ?? false;
		if (uplink?.flowing) this.lastSendProgressAt = this.environment.now();
		this.applyQuality("networkQuality", this.classify(uplink));
		this.receiveQuality = this.classify(stats.downlink);
	}

	private applyQuality(
		direction: "networkQuality" | "downlinkQuality",
		quality: NetworkQuality,
		immediate = false,
	): void {
		const current = this.stateValue[direction];
		if (quality === current) {
			this.qualityCandidates.delete(direction);
			return;
		}
		// Missing measurements cannot prove that an outstanding warning recovered.
		if (
			quality === "unknown" &&
			(current === "poor" || current === "critical")
		) {
			this.qualityCandidates.delete(direction);
			return;
		}
		if (immediate || quality === "unknown" || current === "unknown") {
			this.qualityCandidates.delete(direction);
			this.setState({ [direction]: quality });
			return;
		}
		let candidate = this.qualityCandidates.get(direction);
		if (candidate && candidate.quality !== "good" && quality !== "good") {
			candidate.quality = quality;
		}
		if (candidate?.quality !== quality) {
			candidate = { quality, since: this.environment.now() };
			this.qualityCandidates.set(direction, candidate);
		}
		if (
			this.environment.now() - candidate.since >=
			(quality === "good" ? 6000 : 3000)
		) {
			this.qualityCandidates.delete(direction);
			this.setState({ [direction]: quality });
		}
	}

	private observeReceiveQuality(results: ConsumerHealthSample[]): void {
		const now = this.environment.now();
		const ids = new Set(results.map((result) => result.entry.id));
		for (const id of this.receiveProgress.keys())
			if (!ids.has(id)) this.receiveProgress.delete(id);
		let quality = this.receiveQuality;
		let observed = false;
		let missingMeasurement = false;
		for (const { entry, bytes, framesDecoded } of results) {
			if (this.port.isConsumerPaused(entry)) {
				this.receiveProgress.delete(entry.id);
				continue;
			}
			const previous = this.receiveProgress.get(entry.id);
			if (bytes === null) {
				missingMeasurement = true;
				continue;
			}
			if (bytes === 0 && quality === "good") quality = "unknown";
			observed = true;
			const bytesAt =
				!previous || bytes > (previous.bytes ?? 0) ? now : previous.bytesAt;
			const framesAt =
				!previous ||
				framesDecoded === null ||
				framesDecoded > (previous.frames ?? 0)
					? now
					: previous.framesAt;
			this.receiveProgress.set(entry.id, {
				bytes,
				frames: framesDecoded,
				at: now,
				bytesAt,
				framesAt,
			});
			const stalledFor = entry.isScreen
				? bytesAt === now && framesDecoded !== null
					? now - framesAt
					: 0
				: Math.max(
						now - bytesAt,
						entry.kind === "video" && framesDecoded !== null
							? now - framesAt
							: 0,
					);
			// Static screens may send no new frames; detect their decode stalls only when RTP arrives.
			const deadline = entry.isScreen ? 15_000 : 6000;
			if (stalledFor >= deadline) {
				quality = "critical";
				continue;
			}
			if (stalledFor >= deadline / 2) {
				if (quality !== "critical") quality = "poor";
			} else if (quality === "unknown" && bytes > 0) quality = "good";
		}
		if (
			(missingMeasurement || !observed) &&
			quality !== "poor" &&
			quality !== "critical" &&
			results.some((result) => !this.port.isConsumerPaused(result.entry))
		)
			quality = "unknown";
		if (this.port.hasMissingExpectedReceiveMedia?.()) {
			this.missingReceiveSince ??= now;
			if (now - this.missingReceiveSince >= 6000) quality = "critical";
			else if (quality !== "poor" && quality !== "critical")
				quality = "unknown";
		} else this.missingReceiveSince = null;
		this.applyQuality("downlinkQuality", quality, quality === "critical");
		this.verifyRecovery(results, now, quality);
	}

	private verifyRecovery(
		results: ConsumerHealthSample[],
		now: number,
		effectiveReceiveQuality: NetworkQuality,
	): void {
		if (!this.recovering) return;
		const sendState = this.port.getTransportStats()?.sendTransport?.state;
		const sendHealthy =
			this.recovering.direction === "recv" ||
			(!this.port.hasExpectedSendMedia?.() && !this.hasSendMedia) ||
			(sendState === "connected" &&
				this.hasSendMedia &&
				this.stateValue.networkQuality === "good" &&
				this.lastSendProgressAt !== null &&
				now - this.lastSendProgressAt < 6000);
		const activeReceivers = results.filter(
			({ entry }) => !this.port.isConsumerPaused(entry),
		);
		const receivingNormally = activeReceivers.every(({ entry, bytes }) => {
			const progress = this.receiveProgress.get(entry.id);
			if (!progress || bytes === null || progress.at !== now) return false;
			if (entry.isScreen && progress.bytesAt !== now)
				return (progress.frames ?? 0) > 0;
			return (
				progress.bytesAt === now &&
				(entry.kind !== "video" ||
					progress.frames === null ||
					progress.framesAt === now)
			);
		});
		const receivePathHealthy =
			(activeReceivers.length === 0 || effectiveReceiveQuality === "good") &&
			!this.port.hasMissingExpectedReceiveMedia?.();
		const receiveHealthy =
			this.recovering.direction === "send" ||
			(receivePathHealthy && receivingNormally);
		if (
			this.interrupted ||
			!sendHealthy ||
			!receiveHealthy ||
			this.port.isSignalingConnected?.() === false
		) {
			this.recovering.goodSince = null;
			return;
		}
		this.recovering.goodSince ??= now;
		if (now - this.recovering.goodSince < 6000) return;
		const reason = this.recovering.reason;
		this.recovering = null;
		this.setState({});
		this.port.onRecoveryVerified?.(reason);
	}

	private expireMeasurements(): void {
		this.qualityCandidates.clear();
		if (this.recovering) this.recovering.goodSince = null;
		this.setState({ networkQuality: "unknown", downlinkQuality: "unknown" });
	}

	private async pollStats(): Promise<void> {
		if (
			this.environment.now() - this.lastCompletedAt > 9000 &&
			this.active &&
			!this.environment.isHidden()
		)
			this.expireMeasurements();
		if (this.polling) return;
		if (this.isLifecycleSuspended()) {
			this.resetHealthBaselines();
			return;
		}

		this.polling = true;
		const generation = this.lifecycleGeneration;
		try {
			const transportStats = this.port.getTransportStats();
			this.needsSendSample =
				transportStats?.sendTransport?.state === "connected";
			this.needsReceiveSample =
				!!this.port.hasMissingExpectedReceiveMedia?.() ||
				this.port
					.getConsumers()
					.some((entry) => !this.port.isConsumerPaused(entry));
			const interrupted = (state: string | undefined) =>
				state === "failed" || state === "disconnected";
			const sendInterrupted = interrupted(transportStats?.sendTransport?.state),
				receiveInterrupted = interrupted(transportStats?.recvTransport?.state);
			this.interrupted =
				sendInterrupted && receiveInterrupted
					? "both"
					: sendInterrupted
						? "send"
						: receiveInterrupted
							? "receive"
							: null;
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

			const stats = await this.port.getNetworkStats();
			if (
				generation !== this.lifecycleGeneration ||
				this.isLifecycleSuspended()
			) {
				return;
			}
			if (
				"uplink" in stats &&
				this.environment.now() - stats.timestamp > 9000
			) {
				this.setState({
					networkQuality: "unknown",
					downlinkQuality: "unknown",
				});
				return;
			}
			this.updateQuality(stats);
			if (stats.isValid) this.port.reportNetworkQuality(stats);
			await this.port.reconcileExpectedMedia();
			await this.checkConsumerStalls(
				this.stateValue.networkQuality === "good" ||
					this.stateValue.networkQuality === "unknown",
			);
			this.lastCompletedAt = this.environment.now();
		} catch {
			if (this.environment.now() - this.lastCompletedAt >= 9000)
				this.setState({
					networkQuality: "unknown",
					downlinkQuality: "unknown",
				});
		} finally {
			this.polling = false;
		}
	}

	private async checkConsumerStalls(allowRecovery: boolean): Promise<void> {
		const generation = this.lifecycleGeneration;
		const consumers = this.port.getConsumers();
		if (consumers.length === 0) {
			this.observeReceiveQuality([]);
			return;
		}
		if (this.isLifecycleSuspended()) {
			this.resetHealthBaselines();
			return;
		}

		let statsResults = await Promise.all(
			consumers.map(async (entry): Promise<ConsumerHealthSample> => {
				try {
					const stats = await entry.consumer.getStats();
					const { bytesReceived: bytes, framesDecoded } =
						extractInboundRtpCounters(stats, entry.kind);
					return { entry, bytes, framesDecoded };
				} catch {
					return { entry, bytes: null, framesDecoded: null };
				}
			}),
		);
		if (generation !== this.lifecycleGeneration || this.isLifecycleSuspended())
			return;
		statsResults = statsResults.filter(
			({ entry }) =>
				this.port.getConsumer(entry.id)?.consumer === entry.consumer,
		);
		this.observeReceiveQuality(statsResults);

		const samples: ConsumerSample[] = statsResults.map(({ entry, bytes }) => ({
			id: entry.id,
			kind: entry.kind,
			isPaused: () => this.port.isConsumerPaused(entry),
			isMuted: () => entry.track?.muted ?? false,
			getBytesReceived: () => bytes,
			getCreatedAt: () => entry.createdAt,
		}));
		for (const { entry, bytes, framesDecoded } of statsResults) {
			const previous = this.expectedMediaCounters.get(entry.id);
			this.port.observeRemoteMediaProgress(
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
				this.port.markFirstRemoteMedia(entry.kind);
			}
		}

		const stalledIds = this.stallDetector.check(samples, allowRecovery);
		const decodeActions = this.decodeStallDetector.check(
			statsResults
				.filter(({ entry }) => entry.kind === "video")
				.map(({ entry, bytes, framesDecoded }) => ({
					id: entry.id,
					isPaused: () => this.port.isConsumerPaused(entry),
					bytesReceived: bytes,
					framesDecoded,
				})),
			allowRecovery,
		);

		for (const recovery of decodeActions) {
			if (this.isLifecycleSuspended()) return;
			const result = statsResults.find(
				({ entry }) => entry.id === recovery.consumerId,
			);
			if (!result) continue;
			const current =
				this.port.getConsumer(result.entry.id) ??
				this.port.getConsumers().find((entry) => entry.id === result.entry.id);
			if (
				!current ||
				current.consumer !== result.entry.consumer ||
				this.port.isConsumerPaused(current)
			) {
				this.decodeStallDetector.dispose(result.entry.id);
				continue;
			}
			if (recovery.action === "request-keyframe") {
				try {
					await this.port.requestConsumerKeyFrame(result.entry.id);
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
					await this.port.recoverConsumer(current);
				} catch (error) {
					console.warn(
						"Failed to recreate decode-stalled consumer",
						result.entry.id,
						error,
					);
				}
			}
			if (this.isLifecycleSuspended()) return;
		}

		if (stalledIds.length === 0) return;
		const stalledSet = new Set(stalledIds);
		this.port.reportMediaStalls(
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
			void this.port.recoverConsumer(entry);
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
				await this.port.resetReceiveMedia();
			} catch (error) {
				console.warn("Failed to reset stalled receive media", error);
			}
			this.stallDetector.suspend();
			return;
		}

		for (const entry of establishedStalls) {
			if (entry.kind === "video") {
				void this.port
					.requestConsumerKeyFrame(entry.id)
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
