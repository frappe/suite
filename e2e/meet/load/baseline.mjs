import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";

export function clientServerOptions(root, deniedPaths = []) {
	return {
		root,
		publicDir: false,
		logLevel: "silent",
		server: {
			host: "127.0.0.1",
			port: 0,
			fs: {
				allow: [
					root,
					resolve(root, "../../node_modules"),
					resolve(root, "../../../frontend/src/apps/meet/utils/media/encodings.ts"),
					resolve(root, "../../../suite/meet/types/participantMedia.ts"),
				],
				deny: [
					".env",
					".env.*",
					"*.{crt,pem}",
					"**/.git/**",
					"**/*.jsonl",
					"**/results/**",
					...deniedPaths.map((path) => path.replace(/([*?[\]{}()!+@])/g, "\\$1")),
				],
			},
		},
	};
}

export function populations(count, audio, camera, overlap, screens = 0) {
	if (
		![count, audio, camera, overlap, screens].every(Number.isInteger) ||
		count < 1 ||
		count > 24 ||
		screens < 0 || screens > Math.min(2, count) ||
		Math.min(audio, camera, overlap) < 0 ||
		overlap > Math.min(audio, camera) ||
		audio + camera - overlap > count
	)
		throw new Error("Impossible publisher population");
	return Array.from({ length: count }, (_, i) => {
		const a = i < audio;
		const v = i < overlap || (i >= audio && i < audio + camera - overlap);
		return {
			media: a ? (v ? "both" : "audio") : v ? "video" : "none",
			audio: Number(a),
			camera: Number(v),
			screen: Number(i < screens),
			expectedConsumers: audio + camera + screens - Number(a) - Number(v) - Number(i < screens),
		};
	});
}

export function percentile(numbers, quantile) {
	if (!numbers.length || !numbers.every(Number.isFinite)) return null;
	return [...numbers].sort((a, b) => a - b)[Math.ceil(numbers.length * quantile) - 1];
}

export function packetLossRatio(sources) {
	if (sources.some((s) => !Number.isFinite(s.packetsLost) || !Number.isFinite(s.packets)))
		return null;
	const lost = sources.reduce((sum, s) => sum + Math.max(0, s.packetsLost), 0);
	const received = sources.reduce((sum, s) => sum + s.packets, 0);
	return lost + received > 0 ? lost / (lost + received) : null;
}

export function leaveOutcome(reply) {
	if (reply.joined === null) return "invalid";
	if (reply.joined === false || reply.acknowledged) return null;
	return reply.rejected ? "failed" : "invalid";
}

// One shared queue, anchored to an absolute epoch, never to completion of a join.
export async function schedule(
	count,
	concurrency,
	rampMs,
	task,
	{ signal, now = Date.now, wait = sleep } = {},
) {
	const epoch = now();
	const cancelled = new AbortController();
	const waitSignal = signal ? AbortSignal.any([signal, cancelled.signal]) : cancelled.signal;
	let next = 0;
	let failure;
	await Promise.all(
		Array.from({ length: Math.min(count, concurrency) }, async () => {
			while (next < count && !failure && !signal?.aborted) {
				const index = next++;
				const scheduledAt = epoch + index * rampMs;
				try {
					await wait(Math.max(0, scheduledAt - now()), undefined, { signal: waitSignal });
					if (failure || signal?.aborted) break;
					await task(index, { scheduledAt, startedAt: now() });
				} catch (error) {
					failure ||= error;
					cancelled.abort();
				}
			}
		}),
	);
	if (failure) throw failure;
	signal?.throwIfAborted();
}

export function parseMetrics(text) {
	const samples = [];
	for (const line of text.split("\n")) {
		if (!line || line.startsWith("#")) continue;
		const match = line.match(/^([\w:]+)(\{.*\})?\s+([^\s]+)(?:\s+\S+)?$/);
		if (!match || !/^(?:[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|NaN|[-+]?Inf)$/i.test(match[3]))
			throw new Error("Malformed Prometheus sample");
		const labels = {};
		for (const label of (match[2] || "").matchAll(/(\w+)="((?:\\.|[^"\\])*)"/g)) {
			labels[label[1]] = JSON.parse(`"${label[2]}"`);
		}
		samples.push({ name: match[1], labels, value: Number(match[3]) });
	}
	return samples;
}

export function workerRates(previous, current, elapsedMs) {
	const totals = (samples) => {
		const result = {};
		for (const s of samples.filter((s) => s.name === "meet_sfu_worker_cpu_seconds")) {
			(result[s.labels.worker] ||= {})[s.labels.mode] = s.value;
		}
		return result;
	};
	const before = totals(previous);
	return Object.entries(totals(current)).map(([worker, modes]) => {
		const user = modes.user - before[worker]?.user;
		const system = modes.system - before[worker]?.system;
		return {
			worker,
			cpuOneCoreRatio: elapsedMs > 0 && user >= 0 && system >= 0 ? ((user + system) * 1000) / elapsedMs : null,
		};
	});
}

const resourceNames = [
	"rooms",
	"participants",
	"peers",
	"transports",
	"producers",
	"consumers",
	"sockets",
];
export function resources(samples) {
	const counts = {};
	for (const s of samples.filter((s) => s.name === "meet_sfu_resources")) {
		// Ambiguous duplicate gauges cannot prove an idle target.
		counts[s.labels.resource] = Object.hasOwn(counts, s.labels.resource) ? NaN : s.value;
	}
	return counts;
}
export function isIdle(samples) {
	const counts = resources(samples);
	return (
		resourceNames.every((name) => counts[name] === 0) &&
		samples.filter((s) => s.name === "meet_sfu_worker_resources").every((s) => s.value === 0)
	);
}

export function metricGaps(samples, media = false) {
	const names = [
		"meet_sfu_worker_cpu_seconds",
		"meet_sfu_worker_max_resident_memory_bytes",
		"meet_sfu_worker_resources",
		"meet_sfu_process_process_resident_memory_bytes",
		"meet_sfu_process_nodejs_eventloop_lag_p99_seconds",
	];
	if (media)
		names.push(
			"meet_sfu_room_join_duration_seconds_count",
			"meet_sfu_transport_operation_duration_seconds_count",
			"meet_sfu_media_operation_duration_seconds_count",
			"meet_sfu_media_score_count",
		);
	const gaps = names.filter(
		(name) => !samples.some((s) => s.name === name && Number.isFinite(s.value)),
	);
	const counts = resources(samples);
	for (const name of resourceNames)
		if (!Number.isFinite(counts[name])) gaps.push(`resource:${name}`);
	for (const worker of new Set(
		samples.filter((s) => s.name === "meet_sfu_worker_resources").map((s) => s.labels.worker),
	)) {
		for (const mode of ["user", "system"])
			if (
				!samples.some(
					(s) =>
						s.name === "meet_sfu_worker_cpu_seconds" &&
						s.labels.worker === worker &&
						s.labels.mode === mode &&
						Number.isFinite(s.value),
				)
			)
				gaps.push(`worker:${worker}:${mode}`);
		if (
			!samples.some(
				(s) =>
					s.name === "meet_sfu_worker_max_resident_memory_bytes" &&
					s.labels.worker === worker &&
					Number.isFinite(s.value),
			)
		)
			gaps.push(`worker:${worker}:maxRSS`);
		for (const resource of ["rooms", "peers", "transports", "producers", "consumers"])
			if (
				!samples.some(
					(s) =>
						s.name === "meet_sfu_worker_resources" &&
						s.labels.worker === worker &&
						s.labels.resource === resource &&
						Number.isFinite(s.value),
				)
			)
				gaps.push(`worker:${worker}:${resource}`);
	}
	return gaps;
}

export function sanitize(value, secrets = []) {
	const known = secrets
		.filter((s) => typeof s === "string" && s.length)
		.flatMap((s) => [s, JSON.stringify(s).slice(1, -1), encodeURIComponent(s.toWellFormed())])
		.sort((a, b) => b.length - a.length);
	function scrub(v) {
		if (typeof v === "string") {
			for (const secret of known) v = v.split(secret).join("[REDACTED]");
			return v
				.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED JWT]")
				.replace(/(https?:\/\/)[^\s/]+@/g, "$1[REDACTED]@");
		}
		if (Array.isArray(v)) return v.map(scrub);
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v).map(([key, entry]) => [
					scrub(key),
					/^(?:token|accessToken|refreshToken|password|secret|authorization)$/i.test(key)
						? "[REDACTED]"
						: scrub(entry),
				]),
			);
		return v;
	}
	return JSON.stringify(scrub(value));
}

export function validateTalkers(series, { count, active, periodMs, epoch, startedAt, endedAt }) {
	if (!count) return [];
	const invalid = new Set();
	const hold = series.filter((s) => s.phase === "hold");
	if (hold.length < 2 || hold[0].at - startedAt > 2500 || endedAt - hold.at(-1).at > 2500 ||
		hold.some((s, j) => !Number.isFinite(s.at) || s.at < startedAt || s.at > endedAt ||
			(j > 0 && (s.at <= hold[j - 1].at || s.at - hold[j - 1].at > 2500))))
		invalid.add("Talker controls: incomplete hold coverage");
	for (let index = 0; index < count; index++) {
		const reason = `participant ${index + 1}: talker controls unverified`;
		let previous = startedAt - 1;
		let verifiedAt = startedAt;
		let producerId;
		let observed = 0;
		const phases = new Set();
		for (const sample of hold) {
			const client = sample.clients?.[index];
			const audio = client?.sources?.filter((s) => s.direction === "send" && s.kind === "audio");
			const source = audio?.[0];
			if (client?.phase !== "running" || audio?.length !== 1 || !source.producerId ||
				(producerId && producerId !== source.producerId)) { invalid.add(reason); continue; }
			producerId = source.producerId;
			if (source.paused !== false || source.trackEnabled !== true) invalid.add(reason);
			if (!Number.isFinite(source.at) || Math.abs(source.at - sample.at) > 2500 || source.at > endedAt) {
				invalid.add(reason); continue;
			}
			// A cached pre-hold snapshot is not evidence of hold controls.
			if (source.at < startedAt) continue;
			if (source.at <= previous || source.at - previous > 2500) invalid.add(reason);
			previous = source.at;
			const elapsed = source.at - epoch;
			const step = Math.floor(elapsed / periodMs);
			const offset = elapsed % periodMs;
			// Exclude +/-100ms around the 100ms gain timer boundary, not the whole phase.
			if (active < count && (offset <= 100 || periodMs - offset <= 100)) continue;
			const gain = Number((index - (step % count) + count) % count < active);
			const event = client.talkerChanges?.findLast((c) => Number.isFinite(c.at) && c.at <= source.at);
			if (elapsed < 0 || source.audioGain !== gain || (active < count &&
				(!event || event.step !== step || event.gain !== gain || event.at < epoch + step * periodMs))) {
				invalid.add(reason); continue;
			}
			observed++;
			if (source.at - verifiedAt > 2500) invalid.add(reason);
			verifiedAt = source.at;
			phases.add(step % count);
		}
		if (observed < 2 || endedAt - verifiedAt > 2500 || (active > 0 && active < count && phases.size < 2))
			invalid.add(reason);
	}
	return [...invalid];
}

export function validateMedia(entries, population, consume) {
	const failures = [];
	for (const [i, p] of population.entries()) {
		const entry = entries[i];
		if (!entry || entry.phase !== "running") {
			failures.push(`participant ${i + 1} not running`);
			continue;
		}
		if (!Number.isFinite(entry.joinMs) || !Number.isFinite(entry.acknowledgedAt))
			failures.push(`participant ${i + 1} missing join timing`);
		const sent = entry.sources.filter((s) => s.direction === "send");
		const received = entry.sources.filter((s) => s.direction === "recv");
		for (const [kind, expected] of [
			["audio", p.audio],
			["video", p.camera + (p.screen || 0)],
		]) {
			if (sent.filter((s) => s.kind === kind).length !== expected)
				failures.push(`participant ${i + 1} wrong ${kind} publishers`);
		}
		if (sent.filter((s) => s.isScreen).length !== (p.screen || 0))
			failures.push(`participant ${i + 1} wrong screen publishers`);
		const expected = consume === "all" ? p.expectedConsumers : 0;
		if (sent.length && entry.sendState !== "connected")
			failures.push(`participant ${i + 1} send transport not connected`);
		if (received.length && entry.recvState !== "connected")
			failures.push(`participant ${i + 1} receive transport not connected`);
		if (
			received.length !== expected ||
			new Set(received.map((s) => s.producerId)).size !== expected
		)
			failures.push(`participant ${i + 1} wrong remote sources`);
		for (const source of [...sent, ...received]) {
			if (
				!source.rtp?.codecs?.length ||
				!(source.bytes > 0) ||
				!(source.packets > 0) ||
				!Number.isFinite(source.firstRtpAt)
			)
				failures.push(`participant ${i + 1} no negotiated RTP for ${source.producerId}`);
			if (source.direction === "recv" && source.kind === "video" && !(source.framesDecoded > 0))
				failures.push(`participant ${i + 1} video not decoded: ${source.producerId}`);
		}
		failures.push(...entry.errors.map(() => `participant ${i + 1} client error`));
		if (entry.unexpectedDisconnects?.length)
			failures.push(`participant ${i + 1} unexpected disconnect`);
	}
	// Match every destination to actual declared source identities, not only totals.
	const published = entries.flatMap((e) => e?.sources?.filter((s) => s.direction === "send") || []);
	if (consume === "all")
		for (const [i, entry] of entries.entries()) {
			if (!entry) continue;
			const own = new Set(
				entry.sources.filter((s) => s.direction === "send").map((s) => s.producerId),
			);
			const remote = new Set(
				entry.sources.filter((s) => s.direction === "recv").map((s) => s.producerId),
			);
			for (const source of published)
				if (!own.has(source.producerId) && !remote.has(source.producerId))
					failures.push(`participant ${i + 1} missing source ${source.producerId}`);
			for (const source of entry.sources.filter((s) => s.direction === "recv")) {
				const origin = published.find((s) => s.producerId === source.producerId);
				if (origin && Boolean(origin.isScreen) !== Boolean(source.isScreen))
					failures.push(`participant ${i + 1} wrong screen identity ${source.producerId}`);
			}
		}
	return failures;
}
