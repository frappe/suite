import { measureStream } from "./measure.mjs";
export function assess(
	windows,
	{ expectIndicator = false, expectedStreams = 6 } = {},
) {
	const checks = {
			baseline: false,
			recovered: false,
			"blackout-recovered": false,
			impairmentEffective: false,
		},
		observations = [];
	for (const window of windows) {
		const first = window.samples[0],
			last = window.samples.at(-1);
		const tail = window.samples.at(-4) ?? first;
		const streams = last.rows.map((row) => {
			const recent = tail.rows.find((x) => x.producerId === row.producerId);
			let maximumStallMs = 0,
				lastProgress = first.timestamp;
			for (const sample of window.samples) {
				const current = sample.rows.find(
					(x) => x.producerId === row.producerId,
				);
				const previous = window.samples[
					window.samples.indexOf(sample) - 1
				]?.rows.find((x) => x.producerId === row.producerId);
				const field = row.kind === "video" ? "frames" : "bytes";
				if (current && previous && current[field] > previous[field])
					lastProgress = sample.timestamp;
				maximumStallMs = Math.max(
					maximumStallMs,
					sample.timestamp - lastProgress,
				);
			}
			return {
				participant: row.participantId,
				kind: row.kind,
				screen: row.isScreen,
				...measureStream(window.samples, row.producerId),
				tailProgress:
					!!recent &&
					row.bytes > recent.bytes &&
					(row.kind !== "video" || row.frames > recent.frames),
				maximumStallMs,
			};
		});
		if (expectIndicator) {
			if (["baseline", "recovered", "blackout-recovered"].includes(window.name))
				checks["indicator-" + window.name] =
					window.indicator?.domStatus == null;
			if (
				[
					"slow-512k-300ms-5pct",
					"severe-128k-800ms-20pct",
					"media-blackout",
				].includes(window.name)
			)
				checks["indicator-" + window.name] = ["poor", "critical"].includes(
					window.indicator?.domStatus,
				);
		}
		observations.push({
			name: window.name,
			bitrateBps: window.bitrateBps,
			streams,
			relay: window.relay,
		});
		if (["baseline", "recovered", "blackout-recovered"].includes(window.name))
			checks[window.name] =
				streams.length === expectedStreams &&
				streams.every((x) => x.tailProgress);
		if (window.name === "media-blackout")
			checks.impairmentEffective =
				last.rows.length === expectedStreams &&
				last.rows.every(
					(row) =>
						row.bytes ===
						tail.rows.find((x) => x.producerId === row.producerId)?.bytes,
				) &&
				window.relay?.counters.up.dropped > 0 &&
				window.relay?.counters.up.delivered === 0 &&
				window.relay?.counters.down.delivered === 0;
	}
	return { checks, observations, passed: Object.values(checks).every(Boolean) };
}
