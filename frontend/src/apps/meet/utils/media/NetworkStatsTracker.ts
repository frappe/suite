/** Recent measurements for one direction. Missing browser fields remain unknown. */
export interface NetworkPathStats {
	rtt: number | null;
	packetLoss: number | null;
	jitter: number | null;
	isValid: boolean;
	flowing?: boolean;
	hasMedia?: boolean;
}

export type NetworkReport = {
	id?: string;
	codecId?: string;
	mimeType?: string;
	type?: string;
	state?: string;
	selectedCandidatePairId?: string;
	nominated?: boolean;
	timestamp?: number;
	currentRoundTripTime?: number;
	availableOutgoingBitrate?: number;
	packetsReceived?: number;
	packetsLost?: number;
	fractionLost?: number;
	roundTripTime?: number;
	jitter?: number;
};

/** Keeps loss windows per stream and transport, so old loss cannot mask recovery. */
export class NetworkStatsTracker {
	private remoteTimestamps = new Map<string, number>();
	private previous = new Map<
		string,
		{ received: number; lost: number; at: number }
	>();

	sample(
		direction: "send" | "recv",
		transportId: string,
		reports: Iterable<NetworkReport>,
	): NetworkPathStats & { availableOutgoingBitrate: number } {
		const values = [...reports];
		const activeKeys = new Set<string>();
		const activeRemoteKeys = new Set<string>();
		let received = 0,
			lost = 0;
		const remoteLoss: number[] = [],
			jitter: number[] = [],
			remoteRtt: number[] = [],
			pairRtt: number[] = [];
		let availableOutgoingBitrate = 0,
			isValid = false,
			flowing = false,
			hasMedia = false;
		const hasCodecReports = values.some((report) => report.type === "codec");
		const selectedPair = values.find(
			(report) => report.type === "transport",
		)?.selectedCandidatePairId;
		for (const report of values) {
			const codec = values
				.find((value) => value.id === report.codecId)
				?.mimeType?.toLowerCase();
			// Unbound/probation SSRCs are not an active media receiver. Chromium
			// can retain their loss/jitter even while every real track is healthy.
			if (report.type === "inbound-rtp" && hasCodecReports && !report.codecId)
				continue;
			if (codec?.endsWith("/rtx") || codec?.includes("fec")) continue;
			if (direction === "send" && report.type === "outbound-rtp")
				hasMedia = true;
			if (
				report.type === "candidate-pair" &&
				report.state === "succeeded" &&
				(!selectedPair || report.id === selectedPair)
			) {
				if (Number.isFinite(report.currentRoundTripTime)) {
					pairRtt.push(report.currentRoundTripTime! * 1000);
					isValid = true;
				}
				if (direction === "send" && report.availableOutgoingBitrate)
					availableOutgoingBitrate = report.availableOutgoingBitrate;
			}
			if (direction === "send" && report.type === "remote-inbound-rtp") {
				// Remote reports can stop arriving while the local stats call succeeds.
				if (
					report.timestamp !== undefined &&
					Date.now() - report.timestamp > 10_000
				)
					continue;
				const key = `${transportId}:${report.id ?? values.indexOf(report)}`;
				activeRemoteKeys.add(key);
				const previousTimestamp = this.remoteTimestamps.get(key);
				if (report.timestamp !== undefined) {
					flowing ||=
						previousTimestamp !== undefined &&
						report.timestamp > previousTimestamp;
					this.remoteTimestamps.set(key, report.timestamp);
				}
				if (Number.isFinite(report.roundTripTime))
					remoteRtt.push(report.roundTripTime! * 1000);
				if (Number.isFinite(report.fractionLost))
					remoteLoss.push(Math.max(0, report.fractionLost!) * 100);
				if (Number.isFinite(report.jitter)) jitter.push(report.jitter! * 1000);
				isValid = true;
			}
			if (direction === "recv" && report.type === "inbound-rtp") {
				isValid = true;
				hasMedia = true;
				if (
					report.packetsReceived !== undefined &&
					report.packetsLost !== undefined
				) {
					const key = `${transportId}:${report.id ?? values.indexOf(report)}`;
					activeKeys.add(key);
					const before = this.previous.get(key);
					// A reset/new SSRC begins a new interval. Late packets can reduce lost.
					if (
						before &&
						Date.now() - before.at <= 10_000 &&
						report.packetsReceived >= before.received
					) {
						received += report.packetsReceived - before.received;
						if (report.packetsReceived > before.received) {
							flowing = true;
							if (Number.isFinite(report.jitter))
								jitter.push(report.jitter! * 1000);
						}
						lost += Math.max(0, report.packetsLost - before.lost);
					}
					this.previous.set(key, {
						received: report.packetsReceived,
						lost: report.packetsLost,
						at: Date.now(),
					});
				}
			}
		}
		if (direction === "recv")
			for (const key of this.previous.keys())
				if (!activeKeys.has(key)) this.previous.delete(key);
		if (direction === "send") {
			for (const key of this.remoteTimestamps.keys())
				if (!activeRemoteKeys.has(key)) this.remoteTimestamps.delete(key);
			if (hasMedia && remoteRtt.length === 0 && remoteLoss.length === 0)
				isValid = false;
		}
		const rtts = remoteRtt.length ? remoteRtt : pairRtt;
		return {
			rtt: rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null,
			packetLoss:
				direction === "send"
					? remoteLoss.length
						? Math.max(...remoteLoss)
						: null
					: received + lost > 0
						? (lost * 100) / (received + lost)
						: null,
			jitter: jitter.length ? Math.max(...jitter) : null,
			isValid,
			flowing,
			hasMedia,
			availableOutgoingBitrate,
		};
	}

	reset(): void {
		this.previous.clear();
		this.remoteTimestamps.clear();
	}
}
