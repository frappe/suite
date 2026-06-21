import { inject, onMounted, onUnmounted, type Ref, ref } from "vue";
import {
	type ConsumerSample,
	extractInboundBytesReceived,
	StallDetector,
} from "../utils/media/stallDetector";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";

type NetworkQuality = "good" | "poor" | "critical";

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

export function useNetworkQuality() {
	const networkQuality = ref<NetworkQuality>("good");
	const isPolling = ref(false);
	let pollInterval: ReturnType<typeof setInterval> | null = null;
	const stallDetector = new StallDetector();

	const pollIntervalMs = 3000;
	const sfuManagerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager");

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

	const checkConsumerStalls = async (): Promise<void> => {
		const sfuManager = sfuManagerRef?.value;
		if (!sfuManager) return;

		const consumerManager = sfuManager.mediaManager?.consumerManager;
		if (!consumerManager) return;

		const consumers = consumerManager.getAllConsumers();
		if (consumers.length === 0) return;

		const statsResults = await Promise.all(
			consumers.map(async (entry) => {
				let bytes: number | null = null;
				try {
					const stats = await entry.consumer.getStats();
					bytes = extractInboundBytesReceived(stats);
				} catch {
					bytes = null;
				}
				return { entry, bytes };
			}),
		);

		const samples: ConsumerSample[] = statsResults.map(({ entry, bytes }) => ({
			id: entry.id,
			isPaused: () => entry.consumer.paused,
			isMuted: () => entry.track?.muted ?? false,
			getBytesReceived: () => bytes,
			getCreatedAt: () => entry.createdAt,
		}));

		const stalledIds = stallDetector.check(samples);
		if (stalledIds.length === 0) return;

		const recoveryManager = sfuManager.recoveryManager;
		if (!recoveryManager) return;
		void recoveryManager.recoverTransportIce(
			`consumer_stall_${stalledIds.join(",")}`,
		);
	};

	const pollStats = async () => {
		if (isPolling.value) return;

		isPolling.value = true;
		try {
			const transportManager = sfuManagerRef?.value?.transportManager;

			if (!transportManager) {
				networkQuality.value = "good";
				return;
			}

			// check for transport failure initially
			const tStats = transportManager.getTransportStats();
			const sendState = tStats?.sendTransport?.state;
			const recvState = tStats?.recvTransport?.state;

			// Only treat "failed" as a hard error.
			const isFailed = sendState === "failed" || recvState === "failed";

			if (isFailed) {
				networkQuality.value = "critical";
				return;
			}

			if (transportManager.getNetworkStats) {
				const stats = await transportManager.getNetworkStats();
				updateQuality(stats);
			}

			await checkConsumerStalls();
		} finally {
			isPolling.value = false;
		}
	};

	onMounted(() => {
		pollInterval = setInterval(pollStats, pollIntervalMs);
	});

	onUnmounted(() => {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
		stallDetector.reset();
	});

	return {
		networkQuality,
	};
}
