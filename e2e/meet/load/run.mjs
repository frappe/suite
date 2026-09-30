import { createHmac, createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { hostname, cpus, totalmem, release, platform } from "node:os";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
	populations,
	percentile,
	packetLossRatio,
	schedule,
	parseMetrics,
	workerRates,
	resources,
	isIdle,
	metricGaps,
	sanitize,
	validateMedia,
	validateTalkers,
	leaveOutcome,
	clientServerOptions,
} from "./baseline.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const options = {
	scenario: { type: "string", default: "one-router-baseline" },
	"sfu-url": { type: "string" },
	"socket-path": { type: "string" },
	"meeting-id": { type: "string", default: `load-${randomUUID()}` },
	site: { type: "string", default: "load.test" },
	count: { type: "string", default: "2" },
	"audio-publishers": { type: "string" },
	"camera-publishers": { type: "string" },
	"overlap-publishers": { type: "string" },
	"screen-publishers": { type: "string", default: "0" },
	"active-talkers": { type: "string" },
	"talker-period-seconds": { type: "string", default: "5" },
	media: { type: "string" },
	consume: { type: "string", default: "all" },
	"ramp-ms": { type: "string", default: "500" },
	"join-concurrency": { type: "string", default: "4" },
	"join-timeout-ms": { type: "string", default: "60000" },
	"duration-seconds": { type: "string", default: "30" },
	"cleanup-seconds": { type: "string", default: "65" },
	"render-media": { type: "boolean", default: false },
	"browser-per-client": { type: "boolean", default: false },
	"browser-version": { type: "string" },
	"build-id": { type: "string" },
	"video-codec": { type: "string", default: "VP9" },
	"scalability-mode": { type: "string", default: "L3T1_KEY" },
	"video-fixture": { type: "string" },
	"video-sha256": { type: "string" },
	"audio-fixture": { type: "string" },
	"audio-sha256": { type: "string" },
	"token-file": { type: "string" },
	"jwt-secret-env": { type: "string", default: "SFU_LOAD_JWT_SECRET" },
	"metrics-token-env": { type: "string", default: "SFU_METRICS_TOKEN" },
	"require-idle": { type: "boolean", default: true },
	"max-join-p95-ms": { type: "string", default: "2000" },
	"max-first-remote-media-p95-ms": { type: "string", default: "3000" },
	"max-packet-loss-ratio": { type: "string", default: "0.03" },
	output: { type: "string" },
};

const abort = new AbortController();
const onSignal = () => {
	invalid("Run interrupted by operator signal");
	abort.abort(new Error("Run aborted"));
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
const result = {
	startedAt: Date.now(),
	manifest: {},
	participants: [],
	timings: [],
	series: [],
	metrics: { before: null, after: null },
	cleanup: [],
	invalidReasons: [],
	failures: [],
};
const secrets = [];
const pages = [];
const browsers = [];
let vite;
let output = resolve(root, "results", `${new Date().toISOString().replaceAll(":", "-")}.json`);
let values;
let sample;
let sampler;
let sampling = false;
let phase = "setup";
let stage = "configuration";
let attempted = false;
let population = [];
let final = [];

function invalid(reason) {
	if (!result.invalidReasons.includes(reason)) result.invalidReasons.push(reason);
}
function bounded(value, name, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n) || n < min || n > max)
		throw new Error(`Invalid ${name}: expected ${min}..${max}`);
	return n;
}
async function timeout(promise, ms, onTimeout = () => {}) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					onTimeout();
					reject(new Error("Operation timed out"));
				}, ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
async function fixture(kind, required) {
	if (!required) return null;
	const path = values[`${kind}-fixture`];
	const expected = values[`${kind}-sha256`];
	if (!path || !/^[a-f0-9]{64}$/.test(expected || ""))
		throw new Error(`Pinned ${kind} fixture and SHA256 required`);
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(resolve(path))) hash.update(chunk);
	const sha256 = hash.digest("hex");
	if (sha256 !== expected) throw new Error(`${kind} fixture hash mismatch`);
	return { path: resolve(path), sha256 };
}
async function fetchText(url, token) {
	const response = await fetch(url, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		signal: AbortSignal.timeout(3000),
		redirect: "error",
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const reader = response.body.getReader();
	let bytes = 0;
	const chunks = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.length;
			if (bytes > 2_000_000) throw new Error("Response exceeds evidence bound");
			chunks.push(Buffer.from(value));
		}
	} finally {
		await reader.cancel();
	}
	return Buffer.concat(chunks).toString("utf8");
}

try {
	({ values } = parseArgs({ options, strict: true }));
	if (values.output) output = resolve(values.output);
	secrets.push(process.env[values["jwt-secret-env"]], process.env[values["metrics-token-env"]]);
	if (values.scenario !== "one-router-baseline") {
		invalid("Unsupported scenario: only one-router-baseline correctness checks are implemented");
		throw new Error("Unsupported scenario");
	}
	const target = new URL(values["sfu-url"]);
	if (
		!["http:", "https:"].includes(target.protocol) ||
		target.username ||
		target.password ||
		target.search ||
		target.hash
	)
		throw new Error("Target must be HTTP(S), without credentials, query or fragment");
	if (
		!/^load-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			values["meeting-id"],
		) ||
		!/^load(?:[.-][a-zA-Z0-9-]+)*\.test$/.test(values.site)
	)
		throw new Error("Use a unique load-UUIDv4 namespace and load*.test site");
	if (!values["require-idle"]) throw new Error("One-router baseline requires an idle target");
	const count = bounded(values.count, "count", 1, 24);
	const rampMs = bounded(values["ramp-ms"], "ramp-ms", 0, 5000);
	const concurrency = bounded(values["join-concurrency"], "join-concurrency", 1, 24);
	const duration = bounded(values["duration-seconds"], "duration-seconds", 1, 600);
	const cleanup = bounded(values["cleanup-seconds"], "cleanup-seconds", 65, 120);
	const joinTimeout = bounded(values["join-timeout-ms"], "join-timeout-ms", 1000, 60000);
	if (![count, concurrency].every(Number.isInteger)) throw new Error("Counts must be integers");
	const maxJoin = bounded(values["max-join-p95-ms"], "join SLO", 1, 60000);
	const maxFirst = bounded(values["max-first-remote-media-p95-ms"], "media SLO", 1, 60000);
	const maxLoss = bounded(values["max-packet-loss-ratio"], "loss SLO", 0, 1);
	if (
		!["all", "none"].includes(values.consume) ||
		!["VP9", "VP8"].includes(values["video-codec"]) ||
		!["L3T1_KEY", "L3T1", "L2T1", "L2T1_KEY", "L1T1"].includes(values["scalability-mode"])
	)
		throw new Error("Unsupported media configuration");
	if (values.media && !["both", "audio", "video", "none"].includes(values.media))
		throw new Error("Unsupported media mode");
	if (
		values.media &&
		["audio-publishers", "camera-publishers", "overlap-publishers"].some(
			(k) => values[k] !== undefined,
		)
	)
		throw new Error("Use --media or publisher counts, not both");
	const mode = values.media || "both";
	const audio = Number(
		values["audio-publishers"] ?? (["both", "audio"].includes(mode) ? count : 0),
	);
	const camera = Number(
		values["camera-publishers"] ?? (["both", "video"].includes(mode) ? count : 0),
	);
	const overlap = Number(values["overlap-publishers"] ?? Math.min(audio, camera));
	const screens = Number(values["screen-publishers"]);
	const activeTalkers = bounded(values["active-talkers"] ?? audio, "active-talkers", 0, audio);
	const talkerPeriodMs =
		bounded(values["talker-period-seconds"], "talker-period-seconds", 1, 600) * 1000;
	if (!Number.isInteger(activeTalkers)) throw new Error("Active talkers must be an integer");
	population = populations(count, audio, camera, overlap, screens);
	result.manifest = {
		purpose: "correctness-baseline-not-capacity-qualification",
		arguments: { ...values, "token-file": values["token-file"] ? "[provided]" : null },
		population,
		activeTalkers,
		talkerPeriodMs,
		generator: {
			hostname: hostname(),
			cpuModel: cpus()[0]?.model,
			logicalCpus: cpus().length,
			memoryBytes: totalmem(),
			kernel: release(),
			platform: platform(),
			node: process.version,
		},
		browserVersions: [],
		browserChannel: process.env.CHROME_CHANNEL || "playwright-chromium",
	};
	try {
		result.manifest.build = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		result.manifest.dirty = Boolean(
			execFileSync("git", ["status", "--porcelain"], {
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim(),
		);
	} catch {
		result.manifest.build = values["build-id"] || null;
		result.manifest.dirty = null;
		if (!result.manifest.build)
			invalid("Build identity unavailable; container requires --build-id");
	}
	result.manifest.sourceHashes = {};
	for (const file of [
		"run.mjs",
		"client.ts",
		"baseline.mjs",
		"../../../frontend/src/apps/meet/utils/media/encodings.ts",
		"../../../suite/meet/types/participantMedia.ts",
		"../../yarn.lock",
	]) {
		result.manifest.sourceHashes[file] = createHash("sha256")
			.update(await readFile(resolve(root, file)))
			.digest("hex");
	}
	stage = "fixture and browser pins";
	result.manifest.fixtures = {
		video: await fixture("video", camera > 0),
		audio: await fixture("audio", audio > 0),
		screen: screens ? {
			identity: "canvas-moving-bars-1080p30-v1",
			width: 1920, height: 1080, fps: 30, maxBitrate: 4000000,
		} : null,
	};
	if (!values["browser-version"])
		throw new Error("--browser-version must pin the exact installed Chromium version");
	stage = "credentials";
	const clients = [];
	if (values["token-file"]) {
		const text = await readFile(resolve(values["token-file"]), "utf8");
		// Never echo parser exceptions: malformed credential files may contain secrets.
		let parsed;
		try {
			parsed = text
				.split("\n")
				.filter((line) => line.trim())
				.map((line) => JSON.parse(line));
		} catch {
			throw new Error("Malformed token file");
		}
		for (const p of parsed) if (typeof p?.token === "string") secrets.push(p.token);
		if (parsed.length !== count) throw new Error("Token file must match participant count exactly");
		clients.push(...parsed.map(({ userId, name, token }) => ({ userId, name, token })));
	} else {
		const secret = process.env[values["jwt-secret-env"]];
		if (!secret) throw new Error("Signing secret or token file required");
		for (let i = 0; i < count; i++) {
			const p = { userId: `load-${i + 1}@example.invalid`, name: `Load ${i + 1}` };
			const now = Math.floor(Date.now() / 1000);
			const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
			const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
				user_id: p.userId,
				user_name: p.name,
				meeting_id: values["meeting-id"],
				site: values.site,
				scope: "full",
				is_host: false,
				is_cohost: false,
				is_guest: false,
				e2ee_required: false,
				iat: now,
				exp: now + 3600,
			})}`;
			clients.push({
				...p,
				token: `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`,
			});
		}
	}
	if (new Set(clients.map((p) => p.userId)).size !== count)
		throw new Error("Duplicate participant identities");
	for (const p of clients) {
		if (
			typeof p.userId !== "string" ||
			!p.userId ||
			typeof p.name !== "string" ||
			typeof p.token !== "string"
		)
			throw new Error("Invalid participant identity");
		secrets.push(p.token);
		let claims;
		try {
			claims = JSON.parse(Buffer.from(p.token.split(".")[1], "base64url").toString());
		} catch {
			throw new Error("Invalid participant token");
		}
		if (
			claims.meeting_id !== values["meeting-id"] ||
			claims.site !== values.site ||
			claims.user_id !== p.userId ||
			claims.scope !== "full" ||
			!Number.isFinite(claims.exp) ||
			claims.exp * 1000 <
				Date.now() +
					Math.ceil(count / concurrency) * joinTimeout +
					count * rampMs +
					(duration + cleanup + 120) * 1000
		)
			throw new Error("Token namespace, scope, identity or lifetime mismatch");
	}
	const metricUrl = new URL(target);
	for (const p of clients) p.connectionId = `${p.userId}-${randomUUID()}`;
	result.manifest.connections = clients.map(({ userId, name, connectionId }) => ({
		userId,
		name,
		connectionId,
	}));
	metricUrl.pathname = `${target.pathname.replace(/\/$/, "")}/metrics`;
	const healthUrl = new URL(target);
	healthUrl.pathname = `${target.pathname.replace(/\/$/, "")}/health`;
	const metricsToken = process.env[values["metrics-token-env"]];
	if (!metricsToken) throw new Error("Metrics credentials required for idle and cleanup checks");
	stage = "idle and evidence preflight";
	let previous;
	sample = async () => {
		if (result.series.length >= 1000) {
			abort.abort();
			throw new Error("Evidence sample bound reached");
		}
		const at = Date.now();
		const entry = { at, phase };
		try {
			entry.text = await fetchText(metricUrl, metricsToken);
			entry.samples = parseMetrics(entry.text);
			entry.health = JSON.parse(await fetchText(healthUrl));
			for (const gap of metricGaps(entry.samples, entry.phase === "hold" && audio + camera + screens > 0))
				invalid(`Missing SFU metric: ${gap}`);
			if (previous) {
				entry.workers = workerRates(previous.samples, entry.samples, at - previous.at);
				if (entry.workers.some((w) => w.cpuOneCoreRatio === null))
					invalid("Worker counter reset or incomplete CPU evidence");
			}
			previous = entry;
			const counts = resources(entry.samples);
			if (
				attempted &&
				(entry.health.rooms > 1 ||
					entry.health.peers > count ||
					counts.rooms > 1 ||
					counts.participants > count ||
					counts.peers > count ||
					counts.sockets > count)
			) {
				invalid("Unexpected target activity; aborted");
				abort.abort();
			}
		} catch {
			invalid("SFU scrape unavailable or malformed");
		}
		if (entry.phase === "hold") {
			entry.clients = await Promise.all(
				pages.map(async (page) => {
					try {
						return await timeout(
							page.evaluate(() => window.meetLoad.status()),
							3000,
						);
					} catch {
						invalid("Browser stats unavailable");
						return null;
					}
				}),
			);
			if (entry.clients.some((c) => c?.phase === "failed")) {
				result.failures.push("Participant failed during hold");
				abort.abort();
			}
		}
		if (result.series.length && entry.phase !== "setup" && at - result.series.at(-1).at > 2500)
			invalid("Evidence cadence exceeded 2.5 seconds");
		result.series.push(entry);
		if (attempted && result.invalidReasons.length && ["join", "hold"].includes(phase))
			abort.abort();
		return entry;
	};
	const initial = await sample();
	result.metrics.before = initial.text || null;
	if (
		!initial.samples ||
		!isIdle(initial.samples) ||
		initial.health?.rooms !== 0 ||
		initial.health?.peers !== 0
	)
		throw new Error("Target not provably idle");
	// Fail closed before sending traffic if required SFU metrics are unavailable.
	if (result.invalidReasons.length) throw new Error("Required preflight evidence unavailable");
	stage = "browser preparation";
	const { chromium } = await import("@playwright/test");
	const { createServer } = await import("vite");
	vite = await createServer(
		clientServerOptions(root, [
			output,
			...(values["token-file"] ? [resolve(values["token-file"])] : []),
		]),
	);
	await vite.listen();
	const address = vite.httpServer.address();
	const clientUrl = `http://127.0.0.1:${address.port}`;
	const args = [
		"--use-fake-ui-for-media-stream",
		"--use-fake-device-for-media-stream",
		"--autoplay-policy=no-user-gesture-required",
	];
	if (camera) args.push(`--use-file-for-fake-video-capture=${result.manifest.fixtures.video.path}`);
	if (audio) args.push(`--use-file-for-fake-audio-capture=${result.manifest.fixtures.audio.path}`);
	result.manifest.browserArgs = args;
	let context;
	for (let i = 0; i < count; i++) {
		abort.signal.throwIfAborted();
		if (!context || values["browser-per-client"]) {
			const browser = await chromium.launch({
				headless: true,
				channel: process.env.CHROME_CHANNEL,
				args,
			});
			browsers.push(browser);
			result.manifest.browserVersions.push(browser.version());
			if (browser.version() !== values["browser-version"])
				throw new Error("Browser version differs from pin");
			context = await browser.newContext({ permissions: ["camera", "microphone"] });
		}
		const page = await context.newPage();
		pages.push(page);
		page.on("pageerror", () => {
			result.failures.push(`participant ${i + 1} page error`);
		});
		await page.goto(clientUrl, { waitUntil: "networkidle", timeout: 15000 });
		await page.waitForFunction(() => Boolean(window.meetLoad), undefined, { timeout: 15000 });
	}
	const ready = await sample();
	if (
		!ready.samples ||
		!isIdle(ready.samples) ||
		ready.health?.rooms !== 0 ||
		ready.health?.peers !== 0
	)
		throw new Error("Target changed during preparation");
	if (result.invalidReasons.length)
		throw new Error("Evidence became unavailable during preparation");
	phase = "join";
	stage = "join";
	sampling = true;
	sampler = (async () => {
		while (sampling) {
			const start = Date.now();
			try {
				await sample();
			} catch {
				invalid("Sampling failed");
				abort.abort();
			}
			await delay(Math.max(0, 1000 - (Date.now() - start)));
		}
	})();
	attempted = true;
	const talkerEpoch = Date.now();
	result.manifest.talkerEpoch = talkerEpoch;
	await schedule(
		count,
		concurrency,
		rampMs,
		async (i, timing) => {
			result.timings[i] = timing;
			try {
				const status = await timeout(
					pages[i].evaluate((config) => window.meetLoad.start(config), {
						...clients[i],
						media: population[i].media,
						screen: Boolean(population[i].screen),
						talkers: {
							index: i, count: audio, active: activeTalkers,
							periodMs: talkerPeriodMs, epoch: talkerEpoch,
						},
						sfuUrl: values["sfu-url"],
						socketPath: values["socket-path"],
						meetingId: values["meeting-id"],
						consume: values.consume,
						renderMedia: values["render-media"],
						videoCodec: values["video-codec"],
						scalabilityMode: values["scalability-mode"],
					}),
					joinTimeout,
					() => {
						invalid(`participant ${i + 1}: join timed out; admission state unknown`);
						void pages[i].close().catch(() => {});
					},
				);
				Object.assign(timing, {
					browserStartedAt: status.startedAt,
					acknowledgedAt: status.acknowledgedAt,
					queueDelayMs: timing.startedAt - timing.scheduledAt,
					outcome: "started",
				});
			} catch (error) {
				Object.assign(timing, {
					outcome: "failed",
					failedAt: Date.now(),
					queueDelayMs: timing.startedAt - timing.scheduledAt,
				});
				throw error;
			}
		},
		{ signal: abort.signal },
	);
	phase = "hold";
	stage = "hold";
	const holdStartedAt = Date.now();
	await delay(duration * 1000, undefined, { signal: abort.signal });
	final = await Promise.all(
		pages.map((page) =>
			timeout(
				page.evaluate(() => window.meetLoad.status()),
				5000,
			),
		),
	);
	result.participants = final;
	result.failures.push(...validateMedia(final, population, values.consume));
	for (const reason of validateTalkers(result.series, {
		count: audio, active: activeTalkers, periodMs: talkerPeriodMs, epoch: talkerEpoch,
		startedAt: holdStartedAt, endedAt: Date.now(),
	})) invalid(reason);
	const held = result.series.filter((s) => s.phase === "hold" && s.samples).at(-1);
	if (!held) invalid("No complete hold evidence sample");
	else {
		const counts = resources(held.samples);
		const expectedConsumers = values.consume === "all" ? (audio + camera + screens) * (count - 1) : 0;
		if (
			counts.rooms !== 1 ||
			counts.participants !== count ||
			counts.peers !== count ||
			counts.producers !== audio + camera + screens ||
			counts.consumers !== expectedConsumers
		)
			result.failures.push("SFU hold resource counts differ from declared population");
	}
	for (const [i, entry] of final.entries())
		Object.assign(result.timings[i], {
			firstRemoteMediaAt: entry.firstRemoteMediaAt,
			firstRemoteMediaMs: entry.firstRemoteMediaMs,
		});
	const joinP95Ms = percentile(
		final.map((e) => e.joinMs),
		0.95,
	);
	const firstEntries = final.filter((e) =>
		e.sources.some((s) => s.direction === "recv"),
	);
	const firstRemoteMediaP95Ms = percentile(
		firstEntries.map((e) => e.firstRemoteMediaMs),
		0.95,
	);
	const received = final.flatMap((e) =>
		e.sources.filter((s) => s.direction === "recv"),
	);
	const scoreCount = (samples) =>
		(samples || [])
			.filter((m) => m.name === "meet_sfu_media_score_count" && m.labels.direction === "recv")
			.reduce((sum, m) => sum + m.value, 0);
	if (received.length && scoreCount(held?.samples) <= scoreCount(result.series[0]?.samples)) {
		invalid("No new consumer score observations for this run");
	}
	for (const s of received)
		for (const key of [
			"packetsLost",
			"jitter",
			"rtt",
			"bitrateBps",
			...(s.kind === "video" ? ["nackCount", "pliCount", "firCount"] : []),
		]) {
			if (!Number.isFinite(s[key])) invalid(`Required RTP metric unavailable: ${s.kind}:${key}`);
		}
	const lossRatio = packetLossRatio(received);
	result.calculations = { joinP95Ms, firstRemoteMediaP95Ms, packetLossRatio: lossRatio };
	if (joinP95Ms > maxJoin) result.failures.push("Join P95 exceeds limit");
	if (firstEntries.length && (firstRemoteMediaP95Ms === null || firstRemoteMediaP95Ms > maxFirst))
		result.failures.push("First remote media P95 missing or exceeds limit");
	if (lossRatio > maxLoss) result.failures.push("Packet loss exceeds limit");
} catch {
	// Browser/protocol/parser errors can embed credentials. Persist bounded classifications only.
	if (!result.invalidReasons.length && !result.failures.length) {
		if (["join", "hold"].includes(stage))
			result.failures.push(`Participant operation failed during ${stage}`);
		else invalid(`Run could not complete during ${stage}`);
	}
	result.stoppedDuring = stage;
} finally {
	phase = "leave";
	if (!result.participants.length)
		result.participants = await Promise.all(
			pages.map(async (page) => {
				try {
					return await timeout(
						page.evaluate(() => window.meetLoad.status()),
						3000,
					);
				} catch {
					return null;
				}
			}),
		);
	result.manifest.mediaPolicy =
		result.participants.find((p) => p?.mediaPolicy)?.mediaPolicy || null;
	if (result.participants.some((p) => p?.admissionInvalid))
		invalid("Participant media protocol mismatch or invalid capability evidence; no fallback");
	for (const [i, p] of result.participants.entries())
		if (p && result.timings[i])
			Object.assign(result.timings[i], {
				browserStartedAt: p.startedAt,
				acknowledgedAt: p.acknowledgedAt,
				firstRemoteMediaAt: p.firstRemoteMediaAt,
				firstRemoteMediaMs: p.firstRemoteMediaMs,
			});
	result.cleanup = await Promise.all(
		pages.map(async (page, i) => {
			if (!result.timings[i]) return { participant: i + 1, joined: false, acknowledged: false };
			try {
				return {
					participant: i + 1,
					...(await timeout(
						page.evaluate(() => window.meetLoad.stop()),
						17000,
						() => {
							void page.close().catch(() => {});
						},
					)),
				};
			} catch {
				return { participant: i + 1, acknowledged: false };
			}
		}),
	);
	for (const reply of result.cleanup) {
		if (reply.joined === true && reply.localMediaReleased !== true)
			invalid(`participant ${reply.participant}: local media cleanup unverified`);
		if (reply.admissionInvalid)
			invalid("Participant media protocol mismatch or invalid capability evidence; no fallback");
		if (leaveOutcome(reply) === "failed")
			result.failures.push(`participant ${reply.participant}: SFU rejected leave cleanup`);
		if (leaveOutcome(reply) === "invalid")
			invalid(`participant ${reply.participant}: leave acknowledgment unavailable`);
	}
	const closed = await Promise.allSettled(
		browsers.map((browser) => timeout(browser.close(), 10000)),
	);
	if (closed.some((c) => c.status === "rejected")) invalid("Browser shutdown failed");
	if (attempted && sample) {
		phase = "cleanup";
		await delay(Number(values["cleanup-seconds"]) * 1000);
	}
	sampling = false;
	await sampler;
	if (sample) {
		phase = "after";
		try {
			const after = await sample();
			result.metrics.after = after.text || null;
			result.cleanupVerified = Boolean(
				after.samples &&
					!metricGaps(after.samples).length &&
					isIdle(after.samples) &&
					after.health?.rooms === 0 &&
					after.health?.peers === 0,
			);
			if (attempted && !result.cleanupVerified)
				result.failures.push("Room resources did not return to zero after cleanup grace");
		} catch {
			invalid("Final cleanup evidence unavailable");
		}
	}
	if (vite) {
		try {
			await timeout(vite.close(), 10000);
		} catch {
			invalid("Vite shutdown failed");
		}
	}
	if (!result.metrics.before || !result.metrics.after)
		invalid("Required before/after metrics unavailable");
	result.finishedAt = Date.now();
	result.summary = {
		scope: "correctness-only",
		qualified: false,
		status: result.invalidReasons.length ? "invalid" : result.failures.length ? "failed" : "passed",
		passed: !result.invalidReasons.length && !result.failures.length,
	};
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, `${sanitize(result, secrets)}\n`, { mode: 0o600 });
	console.log(
		`Correctness baseline ${result.summary.status}; ${result.invalidReasons.length} invalid reasons, ${result.failures.length} failures. Not capacity qualification.`,
	);
	process.exitCode = result.summary.passed ? 0 : 1;
	process.off("SIGINT", onSignal);
	process.off("SIGTERM", onSignal);
}
