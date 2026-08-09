import type { AppData, Consumer, Producer } from "mediasoup-client/types";
import { computed, inject, onUnmounted, type Ref, ref, watch } from "vue";
import type { SFUMeetingManager } from "../utils/SFUMeetingManager";
import { isUnknownRecord } from "../types";

type StatsReport = Record<string, unknown> & {
	id?: string;
	type?: string;
	timestamp?: number;
};

type CounterSample = {
	bytes: number;
	packets: number;
	lost: number;
	timestamp: number;
};

export type RTCStreamStats = {
	id: string;
	direction: "send" | "receive";
	kind: "audio" | "video";
	source: "microphone" | "camera" | "screen" | "remote audio" | "remote video" | "remote screen";
	participantId?: string;
	codec?: string;
	bitrate?: number;
	packetLoss?: number;
	jitter?: number;
	rtt?: number;
	width?: number;
	height?: number;
	fps?: number;
	framesDropped?: number;
	framesProcessed?: number;
	qualityLimitation?: string;
	scalabilityMode?: string;
	nackCount?: number;
	pliCount?: number;
	firCount?: number;
	jitterBufferDelay?: number;
	concealedSamples?: number;
	totalSamples?: number;
	paused: boolean;
	muted: boolean;
};

export type RTCStatsSnapshot = {
	timestamp: number;
	quality: "good" | "poor" | "critical" | "unknown";
	rtt?: number;
	jitter?: number;
	inboundPacketLoss?: number;
	outboundPacketLoss?: number;
	uploadBitrate: number;
	downloadBitrate: number;
	availableOutgoingBitrate?: number;
	protocol?: string;
	localCandidateType?: string;
	remoteCandidateType?: string;
	signalingConnected: boolean;
	sendTransportState: string;
	receiveTransportState: string;
	streams: RTCStreamStats[];
};

const EMPTY_SNAPSHOT: RTCStatsSnapshot = {
	timestamp: 0,
	quality: "unknown",
	uploadBitrate: 0,
	downloadBitrate: 0,
	signalingConnected: false,
	sendTransportState: "closed",
	receiveTransportState: "closed",
	streams: [],
};

export const RTC_STATS_POLL_INTERVAL_MS = 1000;

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function reports(stats: unknown): StatsReport[] {
	if (!stats || typeof stats !== "object") return [];
	const values = (stats as { values?: () => IterableIterator<unknown> }).values?.();
	return values
		? Array.from(values).filter(
				(report): report is StatsReport => isUnknownRecord(report),
			)
		: [];
}

export function selectPrimaryRtpReport(
	stats: unknown,
	type: "inbound-rtp" | "outbound-rtp",
): StatsReport | undefined {
	const allReports = reports(stats);
	return allReports.find((report) => {
		if (report.type !== type || report.isRemote === true) return false;
		const codecId = stringValue(report.codecId);
		const codec = allReports.find((candidate) => candidate.id === codecId);
		return stringValue(codec?.mimeType)?.toLowerCase() !== "video/rtx";
	});
}

export function calculateBitrate(
	previous: CounterSample | undefined,
	current: CounterSample,
): number | undefined {
	if (!previous || current.bytes < previous.bytes) return undefined;
	const elapsedMs = current.timestamp - previous.timestamp;
	if (elapsedMs <= 0) return undefined;
	return ((current.bytes - previous.bytes) * 8 * 1000) / elapsedMs;
}

export function calculatePacketLoss(
	previous: CounterSample | undefined,
	current: CounterSample,
): number | undefined {
	if (!previous || current.packets < previous.packets || current.lost < previous.lost) {
		return undefined;
	}
	const packetDelta = current.packets - previous.packets;
	const lostDelta = current.lost - previous.lost;
	const total = packetDelta + lostDelta;
	return total > 0 ? (lostDelta / total) * 100 : 0;
}

function codecName(report: StatsReport | undefined): string | undefined {
	const mimeType = stringValue(report?.mimeType);
	return mimeType?.split("/").pop()?.toUpperCase();
}

function mean(values: Array<number | undefined>): number | undefined {
	const valid = values.filter((value): value is number => value !== undefined);
	return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : undefined;
}

function sum(values: Array<number | undefined>): number {
	return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function qualityFor(snapshot: RTCStatsSnapshot): RTCStatsSnapshot["quality"] {
	const loss = Math.max(snapshot.inboundPacketLoss ?? 0, snapshot.outboundPacketLoss ?? 0);
	if (loss > 18 || (snapshot.rtt ?? 0) > 1200) return "critical";
	if (loss > 8 || (snapshot.rtt ?? 0) > 450) return "poor";
	return snapshot.rtt === undefined && snapshot.streams.length === 0 ? "unknown" : "good";
}

function sourceForProducer(producer: Producer): RTCStreamStats["source"] {
	if (producer.kind === "audio") return "microphone";
	return producer.appData?.type === "screen" ? "screen" : "camera";
}

function sourceForConsumer(entry: {
	kind: string;
	isScreen?: boolean;
	appData?: AppData;
}): RTCStreamStats["source"] {
	if (entry.kind === "audio") return "remote audio";
	return entry.isScreen || entry.appData?.type === "screen"
		? "remote screen"
		: "remote video";
}

export function useRTCStats(active: Ref<boolean>) {
	const managerRef = inject<Ref<SFUMeetingManager | null>>("sfuManager");
	const snapshot = ref<RTCStatsSnapshot>({ ...EMPTY_SNAPSHOT });
	const isPolling = ref(false);
	const error = ref<string | null>(null);
	const samples = new Map<string, CounterSample>();
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function streamStats(options: {
		id: string;
		direction: "send" | "receive";
		kind: "audio" | "video";
		source: RTCStreamStats["source"];
		participantId?: string;
		paused: boolean;
		muted: boolean;
		track?: MediaStreamTrack | null;
		getStats: () => Promise<unknown>;
	}): Promise<RTCStreamStats | null> {
		try {
			const allReports = reports(await options.getStats());
			const primaryType = options.direction === "send" ? "outbound-rtp" : "inbound-rtp";
			const primary = selectPrimaryRtpReport(allReports, primaryType);
			if (!primary) return null;

			const remoteId = stringValue(primary.remoteId);
			const remote = options.direction === "send"
				? allReports.find((report) =>
					report.type === "remote-inbound-rtp" &&
					(report.id === remoteId || report.localId === primary.id),
				) ?? allReports.find((report) => report.type === "remote-inbound-rtp")
				: undefined;
			const codecId = stringValue(primary.codecId);
			const codec = allReports.find((report) => report.id === codecId);
			const bytes = numberValue(options.direction === "send" ? primary.bytesSent : primary.bytesReceived) ?? 0;
			const lossReport = remote ?? primary;
			const lost = Math.max(0, numberValue(lossReport.packetsLost) ?? 0);
			const packets = options.direction === "send"
				? numberValue(remote?.packetsReceived) ?? Math.max(0, (numberValue(primary.packetsSent) ?? 0) - lost)
				: numberValue(primary.packetsReceived) ?? 0;
			const timestamp = numberValue(primary.timestamp) ?? Date.now();
			const key = `${options.direction}:${options.id}`;
			const currentSample = { bytes, packets, lost, timestamp };
			const previous = samples.get(key);
			samples.set(key, currentSample);
			const trackSettings = options.track?.getSettings?.() ?? {};
			const jitterBufferEmitted = numberValue(primary.jitterBufferEmittedCount);
			const jitterBufferTotal = numberValue(primary.jitterBufferDelay);

			return {
				id: options.id,
				direction: options.direction,
				kind: options.kind,
				source: options.source,
				...(options.participantId ? { participantId: options.participantId } : {}),
				codec: codecName(codec),
				bitrate: calculateBitrate(previous, currentSample),
				packetLoss: calculatePacketLoss(previous, currentSample),
				jitter: numberValue(lossReport.jitter) !== undefined ? numberValue(lossReport.jitter)! * 1000 : undefined,
				rtt: numberValue(remote?.roundTripTime) !== undefined ? numberValue(remote?.roundTripTime)! * 1000 : undefined,
				width: numberValue(primary.frameWidth) ?? trackSettings.width,
				height: numberValue(primary.frameHeight) ?? trackSettings.height,
				fps: numberValue(primary.framesPerSecond) ?? trackSettings.frameRate,
				framesDropped: numberValue(primary.framesDropped),
				framesProcessed: numberValue(options.direction === "send" ? primary.framesEncoded : primary.framesDecoded),
				qualityLimitation: stringValue(primary.qualityLimitationReason),
				scalabilityMode: stringValue(primary.scalabilityMode),
				nackCount: numberValue(primary.nackCount),
				pliCount: numberValue(primary.pliCount),
				firCount: numberValue(primary.firCount),
				jitterBufferDelay: jitterBufferTotal !== undefined && jitterBufferEmitted
					? (jitterBufferTotal / jitterBufferEmitted) * 1000
					: undefined,
				concealedSamples: numberValue(primary.concealedSamples),
				totalSamples: numberValue(primary.totalSamplesReceived),
				paused: options.paused,
				muted: options.muted,
			};
		} catch {
			return null;
		}
	}

	async function getRoute(manager: SFUMeetingManager) {
		const transports = [manager.transportManager.sendTransport, manager.transportManager.recvTransport].filter(Boolean);
		for (const transport of transports) {
			try {
				const allReports = reports(await transport?.getStats());
				const candidatePairs = allReports.filter((report) => report.type === "candidate-pair");
				const pair = candidatePairs.find((report) => report.selected === true || report.nominated === true)
					?? candidatePairs.find((report) => report.state === "succeeded");
				if (!pair) continue;
				const localId = stringValue(pair.localCandidateId);
				const remoteId = stringValue(pair.remoteCandidateId);
				const local = allReports.find((report) => report.id === localId);
				const remote = allReports.find((report) => report.id === remoteId);
				return {
					rtt: numberValue(pair.currentRoundTripTime) !== undefined ? numberValue(pair.currentRoundTripTime)! * 1000 : undefined,
					availableOutgoingBitrate: numberValue(pair.availableOutgoingBitrate),
					protocol: stringValue(local?.protocol) ?? stringValue(pair.protocol),
					localCandidateType: stringValue(local?.candidateType),
					remoteCandidateType: stringValue(remote?.candidateType),
				};
			} catch {
				// A recovering transport can disappear between selection and collection.
			}
		}
		return {};
	}

	async function poll() {
		if (isPolling.value || !active.value) return;
		const manager = managerRef?.value;
		if (!manager) {
			snapshot.value = { ...EMPTY_SNAPSHOT };
			return;
		}

		isPolling.value = true;
		try {
			const producers = [
				manager.mediaHandler.audioProducer,
				manager.mediaHandler.videoProducer,
				manager.mediaHandler.screenProducer,
			].filter((producer): producer is Producer => !!producer && !producer.closed);
			const consumers = manager.consumerManager.getAllConsumers();
			const streamPromises: Array<Promise<RTCStreamStats | null>> = [
				...producers.map((producer) => streamStats({
					id: producer.id,
					direction: "send",
					kind: producer.kind,
					source: sourceForProducer(producer),
					paused: producer.paused,
					muted: producer.track?.muted ?? false,
					track: producer.track,
					getStats: () => producer.getStats(),
				})),
				...consumers.map((entry) => streamStats({
					id: entry.id,
					direction: "receive",
					kind: entry.kind,
					source: sourceForConsumer(entry),
					participantId: entry.participantId,
					paused: entry.consumer.paused,
					muted: entry.track?.muted ?? false,
					track: entry.track,
					getStats: () => entry.consumer.getStats(),
				})),
			];
			const [route, streamResults] = await Promise.all([
				getRoute(manager),
				Promise.all(streamPromises),
			]);
			const streams = streamResults.filter((stream): stream is RTCStreamStats => !!stream);
			const sending = streams.filter((stream) => stream.direction === "send");
			const receiving = streams.filter((stream) => stream.direction === "receive");
			const next: RTCStatsSnapshot = {
				timestamp: Date.now(),
				quality: "unknown",
				...route,
				rtt: mean([route.rtt, ...sending.map((stream) => stream.rtt)]),
				jitter: mean(streams.map((stream) => stream.jitter)),
				inboundPacketLoss: mean(receiving.map((stream) => stream.packetLoss)),
				outboundPacketLoss: mean(sending.map((stream) => stream.packetLoss)),
				uploadBitrate: sum(sending.map((stream) => stream.bitrate)),
				downloadBitrate: sum(receiving.map((stream) => stream.bitrate)),
				signalingConnected: manager.sfuClient?.getConnectionStatus?.().connected ?? false,
				sendTransportState: manager.transportManager.sendTransport?.connectionState ?? "closed",
				receiveTransportState: manager.transportManager.recvTransport?.connectionState ?? "closed",
				streams,
			};
			next.quality = qualityFor(next);
			snapshot.value = next;
			error.value = null;
		} catch (pollError) {
			error.value = pollError instanceof Error ? pollError.message : "Could not read WebRTC statistics";
		} finally {
			isPolling.value = false;
		}
	}

	function stop() {
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = null;
	}

	watch(active, (isActive) => {
		stop();
		if (!isActive) return;
		void poll();
		pollTimer = setInterval(poll, RTC_STATS_POLL_INTERVAL_MS);
	}, { immediate: true });

	onUnmounted(stop);

	return {
		snapshot,
		isPolling,
		error,
		sendStreams: computed(() => snapshot.value.streams.filter((stream) => stream.direction === "send")),
		receiveStreams: computed(() => snapshot.value.streams.filter((stream) => stream.direction === "receive")),
		poll,
	};
}
