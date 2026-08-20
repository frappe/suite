import { inject, onMounted, onUnmounted, type Ref, ref } from "vue";
import {
	type ConsumerSample,
	DecodeStallDetector,
	extractInboundRtpCounters,
	StallDetector,
} from "../utils/media/stallDetector";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import { getClientTelemetry } from "../utils/telemetry/ClientTelemetry";

export type NetworkQuality = "good" | "poor" | "critical";

interface NetworkStats {
	rtt: number;
	packetLoss: number;
	availableOutgoingBitrate: number;
	timestamp: number;
	isValid: boolean;
}

const POOR_RTT_MS = 450;
const CRITICAL_RTT_MS = 900;
const POOR_PACKET_LOSS_PERCENT = 8;
const CRITICAL_PACKET_LOSS_PERCENT = 18;
const POOR_VIDEO_BITRATE_BPS = 350_000;
const CRITICAL_VIDEO_BITRATE_BPS = 200_000;

export function useNetworkQuality(
	sfuManagerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager"),
) {
	const networkQuality = ref<NetworkQuality>("good");
	const downlinkQuality = ref<NetworkQuality>("good");
	const isTransportFailed = ref(false);
	const isPolling = ref(false);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	const stallDetector = new StallDetector();
	const decodeStallDetector = new DecodeStallDetector();
	let active = true;

	const pollIntervalMs = 3000;
	const updateQuality = (stats: NetworkStats) => {
		if (!stats.isValid) {
			// If we can't get valid stats, assume network is good
			networkQuality.value = "good";
			return;
		}

		const hasBitrateEstimate = stats.availableOutgoingBitrate > 0;
		const hasPoorVideoBitrate =
			hasBitrateEstimate &&
			stats.availableOutgoingBitrate < POOR_VIDEO_BITRATE_BPS;
		const hasCriticalVideoBitrate =
			hasBitrateEstimate &&
			stats.availableOutgoingBitrate < CRITICAL_VIDEO_BITRATE_BPS;

		// Prefer clear signs of actual media degradation over moderate RTT spikes.
		const isCritical =
			stats.packetLoss > CRITICAL_PACKET_LOSS_PERCENT ||
			stats.rtt > 1_200 ||
			(stats.rtt > CRITICAL_RTT_MS && hasCriticalVideoBitrate);
		const isPoor =
			stats.packetLoss > POOR_PACKET_LOSS_PERCENT ||
			(stats.rtt > POOR_RTT_MS && hasPoorVideoBitrate);

		if (isCritical) {
			networkQuality.value = "critical";
		} else if (isPoor) {
			networkQuality.value = "poor";
		} else {
			networkQuality.value = "good";
		}
	};

	const checkConsumerStalls = async (allowRecovery: boolean): Promise<void> => {
		const sfuManager = sfuManagerRef?.value;
		if (!sfuManager) return;

		const consumerManager = sfuManager.mediaManager?.consumerManager;
		if (!consumerManager) {
			downlinkQuality.value = "good";
			return;
		}

		const consumers = consumerManager.getAllConsumers();
		if (consumers.length === 0) {
			downlinkQuality.value = "good";
			return;
		}
		if (!active || document.hidden) {
			stallDetector.suspend();
			decodeStallDetector.suspend();
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
		if (!active || document.hidden || sfuManagerRef?.value !== sfuManager) return;
		const isPaused = (entry: (typeof statsResults)[number]["entry"]) => {
			const participant = sfuManager.participantManager.getParticipant(
				entry.participantId,
			);
			return (
				entry.consumer.paused ||
				entry.consumer.producerPaused ||
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
		const clientTelemetry = sfuManager.sfuClient
			? getClientTelemetry(sfuManager.sfuClient)
			: null;
		for (const { entry, bytes } of statsResults) {
			if (bytes !== null && bytes > 0 && (entry.kind === "audio" || entry.kind === "video")) {
				clientTelemetry?.markFirstRemoteMedia(entry.kind);
			}
		}

		const stalledIds = stallDetector.check(samples, allowRecovery);
		const decodeActions = decodeStallDetector.check(
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
		downlinkQuality.value =
			stallDetector.hasActiveStall() || decodeStallDetector.hasActiveStall()
			? "critical"
			: "good";
		for (const recovery of decodeActions) {
			if (!active || document.hidden || sfuManagerRef?.value !== sfuManager) {
				return;
			}
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
				decodeStallDetector.dispose(result.entry.id);
				continue;
			}
			if (recovery.action === "request-keyframe") {
				try {
					await sfuManager.sfuClient?.requestConsumerKeyFrame(result.entry.id);
				} catch (error) {
					console.warn(
						"Failed to request a keyframe for decode-stalled consumer",
						result.entry.id,
						error,
					);
				}
			} else {
				decodeStallDetector.dispose(result.entry.id);
				try {
					await sfuManager.mediaManager.recoverConsumer(current);
				} catch (error) {
					console.warn(
						"Failed to recreate decode-stalled consumer",
						result.entry.id,
						error,
					);
				}
			}
			if (!active || document.hidden || sfuManagerRef?.value !== sfuManager) {
				return;
			}
		}
		if (stalledIds.length === 0) return;
		const stalledSet = new Set(stalledIds);
		clientTelemetry?.reportMediaStalls(
			samples
				.filter((sample) => stalledSet.has(sample.id))
				.map((sample) => sample.kind)
				.filter((kind): kind is "audio" | "video" =>
					kind === "audio" || kind === "video",
				),
		);

		const stalledEntries = statsResults
			.map(({ entry }) => entry)
			.filter((entry) => stalledSet.has(entry.id));
		const neverStartedEntries = stalledEntries.filter(
			(entry) => !stallDetector.hasReceivedMedia(entry.id),
		);
		for (const entry of neverStartedEntries) {
			stallDetector.dispose(entry.id);
			void sfuManager.mediaManager.recoverConsumer(entry);
		}
		const establishedStalls = stalledEntries.filter(
			(entry) => stallDetector.hasReceivedMedia(entry.id),
		);
		if (establishedStalls.length === 0) return;
		const hasAudioStall = establishedStalls.some(
			(entry) => entry.kind === "audio",
		);
		const hasExhaustedVideoRecovery = establishedStalls.some(
			(entry) =>
				entry.kind === "video" && stallDetector.getRecoveryAttempts(entry.id) > 2,
		);
		if (hasAudioStall || hasExhaustedVideoRecovery) {
			void sfuManager.resetReceiveMedia();
			stallDetector.suspend();
			return;
		}

		for (const entry of establishedStalls) {
			if (entry.kind === "video") {
				void sfuManager.sfuClient
					?.requestConsumerKeyFrame(entry.id)
					.catch((error) =>
						console.warn("Failed to recover stalled video consumer", entry.id, error),
					);
			}
		}
	};

	const pollStats = async () => {
		if (isPolling.value) return;

		isPolling.value = true;
		try {
			const transportManager = sfuManagerRef?.value?.transportManager;

			if (!transportManager) {
				networkQuality.value = "good";
				isTransportFailed.value = false;
				return;
			}

			// check for transport failure initially
			const tStats = transportManager.getTransportStats();
			const sendState = tStats?.sendTransport?.state;
			const recvState = tStats?.recvTransport?.state;

			// Only treat "failed" as a hard error.
			const isFailed = sendState === "failed" || recvState === "failed";
			isTransportFailed.value = isFailed;

			if (isFailed) {
				networkQuality.value = "critical";
				stallDetector.suspend();
				decodeStallDetector.suspend();
				return;
			}

			if (transportManager.getNetworkStats) {
				const stats = await transportManager.getNetworkStats();
				updateQuality(stats);
				const sfuClient = sfuManagerRef?.value?.sfuClient;
				if (sfuClient && stats.isValid) {
					getClientTelemetry(sfuClient).reportNetworkQuality(stats);
				}
			}
			await checkConsumerStalls(networkQuality.value === "good");
		} finally {
			isPolling.value = false;
		}
	};

	const handleVisibilityChange = () => {
		stallDetector.suspend();
		decodeStallDetector.suspend();
	};

	onMounted(() => {
		active = true;
		document.addEventListener("visibilitychange", handleVisibilityChange);
		pollInterval = setInterval(pollStats, pollIntervalMs);
	});

	onUnmounted(() => {
		active = false;
		document.removeEventListener("visibilitychange", handleVisibilityChange);
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
		stallDetector.reset();
		decodeStallDetector.reset();
	});

	return {
		networkQuality,
		downlinkQuality,
		isTransportFailed,
	};
}
