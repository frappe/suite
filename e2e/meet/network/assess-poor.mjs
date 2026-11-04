// These thresholds describe this fixture's promised usable-poor-link behavior.
// Use actual time and decoded progress; a burst followed by a freeze cannot pass.
function recentSamples(window) {
	const samples = window?.samples ?? [];
	const end = samples.at(-1)?.timestamp;
	if (!Number.isFinite(end)) return [];
	const start = samples.findLastIndex(
		(sample) => sample.timestamp <= end - 5000,
	);
	if (start < 0) return [];
	const recent = samples.slice(start);
	if (
		recent.some(
			(sample, i) =>
				!Number.isFinite(sample.timestamp) ||
				(i > 0 &&
					(sample.timestamp <= recent[i - 1].timestamp ||
						sample.timestamp - recent[i - 1].timestamp > 2000)),
		)
	)
		return [];
	return recent;
}

function streamProgress(samples, stream) {
	let bytes = 0,
		frames = 0,
		decoded = 0,
		concealed = 0;
	let lastDelivery = samples[0].timestamp,
		lastDecode = lastDelivery;
	let deliveryStall = 0,
		decodeStall = 0;
	for (let i = 1; i < samples.length; i++) {
		const before = samples[i - 1].rows.find(
			(row) => row.producerId === stream.producerId,
		);
		const current = samples[i].rows.find(
			(row) => row.producerId === stream.producerId,
		);
		if (before && current && before.id === current.id) {
			const byteDelta = current.bytes - before.bytes;
			const frameDelta = current.frames - before.frames;
			const sampleDelta =
				current.totalSamplesReceived - before.totalSamplesReceived;
			const concealedDelta = current.concealedSamples - before.concealedSamples;
			if (byteDelta > 0) {
				bytes += byteDelta;
				lastDelivery = samples[i].timestamp;
			}
			if (stream.kind === "video" && frameDelta > 0) {
				frames += frameDelta;
				lastDecode = samples[i].timestamp;
			}
			if (stream.kind === "audio" && sampleDelta >= 0 && concealedDelta >= 0) {
				decoded += Math.max(0, sampleDelta - concealedDelta);
				concealed += concealedDelta;
				if (sampleDelta > concealedDelta) lastDecode = samples[i].timestamp;
			}
		}
		deliveryStall = Math.max(
			deliveryStall,
			samples[i].timestamp - lastDelivery,
		);
		decodeStall = Math.max(decodeStall, samples[i].timestamp - lastDecode);
	}
	return {
		delivery: bytes > 0 && deliveryStall <= 2000,
		decode:
			decodeStall <= 2000 &&
			(stream.kind === "video"
				? frames >= 10
				: decoded > 0 && concealed / (decoded + concealed) < 0.1),
	};
}

function phaseProgress(samples) {
	if (samples.length < 4)
		return {
			audioContinues: false,
			audioDecodes: false,
			videoContinues: false,
		};
	const rows = samples.at(-1).rows;
	const audio = rows.filter((row) => row.kind === "audio");
	const videos = rows.filter((row) => row.kind === "video");
	const sound = audio.length === 1 ? streamProgress(samples, audio[0]) : null;
	return {
		audioContinues: sound?.delivery ?? false,
		audioDecodes: sound?.decode ?? false,
		videoContinues:
			videos.length === 4 &&
			new Set(videos.map((row) => row.producerId)).size === 4 &&
			videos.every((row) => {
				const flow = streamProgress(samples, row);
				return flow.delivery && flow.decode;
			}),
	};
}

export function assessPoor(windows) {
	const baseline = windows.find((window) => window.name === "baseline");
	const poor = windows.find((window) => window.name === "poor");
	const recovered = windows.find((window) => window.name === "recovered");
	const checks = {
		baselineFlows: false,
		audioContinues: false,
		audioDecodes: false,
		videoContinues: false,
		videoDownscales: false,
		poorWarning: false,
		recovers: false,
	};
	if (!baseline || !poor || !recovered) return { checks, passed: false };
	const baseSamples = recentSamples(baseline),
		poorSamples = recentSamples(poor),
		recoveredSamples = recentSamples(recovered);
	checks.baselineFlows = Object.values(phaseProgress(baseSamples)).every(
		Boolean,
	);
	Object.assign(checks, phaseProgress(poorSamples));
	const baseRows = baseSamples.at(-1)?.rows ?? [];
	checks.videoDownscales = (poorSamples.at(-1)?.rows ?? []).some((row) => {
		const original = baseRows.find(
			(prior) => prior.producerId === row.producerId,
		);
		return row.kind === "video" && row.width > 0 && original?.width > row.width;
	});
	checks.poorWarning =
		poorSamples.length >= 4 &&
		poorSamples
			.slice(-3)
			.every((sample) => sample.indicator?.domStatus === "poor");
	checks.recovers =
		recovered.indicator?.domStatus === null &&
		Object.values(phaseProgress(recoveredSamples)).every(Boolean);
	return { checks, passed: Object.values(checks).every(Boolean) };
}
