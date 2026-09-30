import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
	populations,
	percentile,
	packetLossRatio,
	schedule,
	parseMetrics,
	workerRates,
	isIdle,
	metricGaps,
	sanitize,
	validateMedia,
	validateTalkers,
	leaveOutcome,
	clientServerOptions,
} from "./baseline.mjs";
import { cameraFrame, microphoneFixture, generateFixtures } from "./fixtures.mjs";

test("independent mixed, microphone-only, camera-only and receive-only populations", () => {
	const p = populations(4, 2, 2, 1);
	assert.deepEqual(
		p.map((p) => p.media),
		["both", "audio", "video", "none"],
	);
	assert.deepEqual(
		p.map((p) => p.expectedConsumers),
		[2, 3, 3, 4],
	);
	assert.deepEqual(
		populations(4, 0, 2, 0).map((p) => p.media),
		["video", "video", "none", "none"],
	);
	assert.deepEqual(
		populations(2, 1, 1, 0).map((p) => p.media),
		["audio", "video"],
	);
	assert.deepEqual(
		populations(2, 0, 0, 0).map((p) => p.expectedConsumers),
		[0, 0],
	);
	for (const args of [
		[2, 2, 2, 0],
		[4, 1, 2, 2],
		[4, -1, 1, 0],
		[4, 1.5, 1, 0],
	])
		assert.throws(() => populations(...args));
});

test("screens add independent sources without adding humans or cameras", () => {
	const p = populations(4, 2, 2, 1, 2);
	assert.deepEqual(p.map((p) => p.screen), [1, 1, 0, 0]);
	assert.deepEqual(p.map((p) => p.expectedConsumers), [3, 4, 5, 6]);
	assert.deepEqual(populations(2, 0, 0, 0, 2).map((p) => p.expectedConsumers), [1, 1]);
	for (const args of [[4, 2, 2, 1, 3], [1, 0, 0, 0, 2], [4, 0, 0, 0, -1], [4, 0, 0, 0, 0.5], [25, 0, 0, 0, 0]])
		assert.throws(() => populations(...args));
});

test("nearest-rank percentiles reject missing required observations", () => {
	assert.equal(percentile([100, 400, 200, 300], 0.5), 200);
	assert.equal(
		percentile(
			Array.from({ length: 20 }, (_, i) => i + 1),
			0.95,
		),
		19,
	);
	assert.equal(percentile([], 0.95), null);
	assert.equal(percentile([1, null], 0.95), null);
});

test("packet loss uses lost plus received denominator, handles negative cumulative loss, never invents missing data", () => {
	assert.equal(packetLossRatio([{ packetsLost: 10, packets: 90 }]), 0.1);
	assert.equal(
		packetLossRatio([
			{ packetsLost: -2, packets: 100 },
			{ packetsLost: 10, packets: 90 },
		]),
		0.05,
	);
	assert.equal(packetLossRatio([{ packetsLost: 0, packets: 0 }]), null);
	assert.equal(packetLossRatio([{ packetsLost: null, packets: 100 }]), null);
});

test("cleanup distinguishes unjoined pages, SFU rejection and missing evidence", () => {
	assert.equal(leaveOutcome({ joined: false, acknowledged: false }), null);
	assert.equal(leaveOutcome({ joined: true, acknowledged: true }), null);
	assert.equal(leaveOutcome({ joined: true, acknowledged: false, rejected: true }), "failed");
	assert.equal(leaveOutcome({ joined: true, acknowledged: false }), "invalid");
	assert.equal(leaveOutcome({ acknowledged: false }), "invalid");
	assert.equal(leaveOutcome({ joined: null, acknowledged: true }), "invalid");
});

test("scheduled burst overlaps joins, respects concurrency, preserves scheduled time under backlog", async () => {
	let clock = 1000;
	let active = 0;
	let peak = 0;
	const starts = [];
	const releases = [];
	const running = schedule(
		4,
		2,
		0,
		async (i, timing) => {
			active++;
			peak = Math.max(peak, active);
			starts.push([i, timing]);
			await new Promise((resolve) => releases.push(resolve));
			active--;
		},
		{ now: () => clock, wait: async () => {} },
	);
	await new Promise(setImmediate);
	assert.equal(starts.length, 2);
	assert.equal(active, 2);
	clock = 1200;
	releases.splice(0).forEach((r) => r());
	await new Promise(setImmediate);
	assert.equal(starts.length, 4);
	assert.deepEqual(
		starts.map(([, t]) => t.scheduledAt),
		[1000, 1000, 1000, 1000],
	);
	assert.deepEqual(
		starts.map(([, t]) => t.startedAt),
		[1000, 1000, 1200, 1200],
	);
	releases.splice(0).forEach((r) => r());
	await running;
	assert.equal(peak, 2);
});

test("ramp is anchored to epoch rather than preceding join completion", async () => {
	let clock = 0;
	const timing = [];
	await schedule(
		3,
		1,
		100,
		async (_, t) => {
			timing.push(t);
			clock += 250;
		},
		{
			now: () => clock,
			wait: async (ms) => {
				clock += ms;
			},
		},
	);
	assert.deepEqual(timing, [
		{ scheduledAt: 0, startedAt: 0 },
		{ scheduledAt: 100, startedAt: 250 },
		{ scheduledAt: 200, startedAt: 500 },
	]);
});

test("failed joins drain in-flight work but do not start queued participants; abort stops queue", async () => {
	const started = [];
	await assert.rejects(
		schedule(
			6,
			2,
			0,
			async (i) => {
				started.push(i);
				if (!i) throw new Error("failed");
				await new Promise(setImmediate);
			},
			{ wait: async () => {} },
		),
		/failed/,
	);
	assert.deepEqual(started, [0, 1]);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		schedule(2, 2, 0, () => assert.fail("must not join"), { signal: controller.signal }),
	);
});

test(
	"a failed join cancels future ramp waits, not only queued tasks",
	{ timeout: 1000 },
	async () => {
		await assert.rejects(
			schedule(
				3,
				3,
				100,
				async () => {
					throw new Error("join rejected");
				},
				{
					now: () => 0,
					wait: async (ms, _, { signal }) => {
						if (!ms) return;
						await new Promise((_, reject) =>
							signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
						);
					},
				},
			),
			/join rejected/,
		);
	},
);

test("Prometheus labels and per-worker CPU are independent of core count", () => {
	const before = parseMetrics(
		'# TYPE meet_sfu_worker_cpu_seconds gauge\nmeet_sfu_worker_cpu_seconds{mode="user",worker="0"} 2\nmeet_sfu_worker_cpu_seconds{worker="0",mode="system"} 1',
	);
	const after = parseMetrics(
		'meet_sfu_worker_cpu_seconds{worker="0",mode="system"} 1.1\nmeet_sfu_worker_cpu_seconds{worker="0",mode="user"} 2.6',
	);
	assert.ok(Math.abs(workerRates(before, after, 1000)[0].cpuOneCoreRatio - 0.7) < 1e-10);
	assert.equal(workerRates(after, before, 1000)[0].cpuOneCoreRatio, null);
	assert.equal(workerRates([], after, 1000)[0].cpuOneCoreRatio, null);
	assert.equal(workerRates(before, after, 0)[0].cpuOneCoreRatio, null);
	const unchanged = parseMetrics('meet_sfu_worker_cpu_seconds{worker="0",mode="user"} 0.6\nmeet_sfu_worker_cpu_seconds{worker="0",mode="system"} 0.1');
	assert.equal(workerRates(unchanged, unchanged, 1000)[0].cpuOneCoreRatio, 0);
	assert.equal(parseMetrics('m{label="a\\\"b"} 1e3')[0].labels.label, 'a"b');
	assert.throws(() => parseMetrics("not a sample"));
});

test("idle requires all resource counts, zero rooms alone cannot prove cleanup", () => {
	const text = ["rooms", "participants", "peers", "transports", "producers", "consumers", "sockets"]
		.map((name) => `meet_sfu_resources{resource="${name}"} 0`)
		.join("\n");
	assert.equal(isIdle(parseMetrics(text)), true);
	assert.equal(
		isIdle(parseMetrics(text.replace('resource="transports"} 0', 'resource="transports"} 1'))),
		false,
	);
	assert.equal(isIdle(parseMetrics('meet_sfu_resources{resource="rooms"} 0')), false);
	assert.ok(metricGaps([]).includes("meet_sfu_worker_cpu_seconds"));
	assert.equal(
		isIdle(parseMetrics(`${text}\nmeet_sfu_worker_resources{worker="0",resource="transports"} 1`)),
		false,
	);
	assert.equal(
		isIdle(
			parseMetrics(
				`${text}\nmeet_sfu_resources{resource="peers"} 1\nmeet_sfu_resources{resource="peers"} 0`,
			),
		),
		false,
	);
});

function source(producerId, direction, kind) {
	return {
		producerId,
		direction,
		kind,
		rtp: { codecs: [{ mimeType: `${kind}/test` }] },
		bytes: 100,
		packets: 10,
		firstRtpAt: 1000,
		framesDecoded: 5,
	};
}
test("media gates require every negotiated source, including microphone-only/camera-only endpoints", () => {
	const population = populations(3, 1, 1, 0);
	const entries = [
		[source("a", "send", "audio"), source("v", "recv", "video")],
		[source("v", "send", "video"), source("a", "recv", "audio")],
		[source("v", "recv", "video"), source("a", "recv", "audio")],
	].map((sources) => ({
		phase: "running",
		joinMs: 10,
		acknowledgedAt: 20,
		sources,
		errors: [],
		sendState: "connected",
		recvState: "connected",
	}));
	assert.deepEqual(validateMedia(entries, population, "all"), []);
	entries[2].recvState = "failed";
	assert.ok(
		validateMedia(entries, population, "all").some((f) =>
			f.includes("receive transport not connected"),
		),
	);
	entries[2].recvState = "connected";
	entries[2].sources[0].packets = 0;
	assert.ok(validateMedia(entries, population, "all").some((f) => f.includes("no negotiated RTP")));
	entries[2].sources[0].packets = 10;
	entries[2].sources[0].producerId = "wrong";
	assert.ok(validateMedia(entries, population, "all").some((f) => f.includes("missing source v")));
	entries[2].sources[0].producerId = "v";
	entries[2].sources[0].framesDecoded = 0;
	assert.ok(validateMedia(entries, population, "all").some((f) => f.includes("not decoded")));
});

test("missing participant snapshots fail delivery without throwing", () => {
	assert.ok(
		validateMedia([null], populations(1, 0, 0, 0), "all").includes("participant 1 not running"),
	);
});

// Literal two-of-three phases: {0,1}, {1,2}, {2,0}; no RTP/energy-derived expectations.
const talkerControls = { count: 3, active: 2, periodMs: 1000, epoch: 10000, startedAt: 10200, endedAt: 12800 };
function talkerHold() {
	return [[10300, [1, 1, 0]], [11300, [0, 1, 1]], [12300, [1, 0, 1]]].map(([at, gains], step) => ({
		phase: "hold", at,
		clients: gains.map((audioGain, i) => ({ phase: "running",
			sources: [{ ...source(`audio-${i}`, "send", "audio"), at, paused: false, trackEnabled: true, audioGain }],
			talkerChanges: [{ at: 10000 + step * 1000 + 50, step, gain: audioGain }],
		})),
	}));
}

test("hold talker gate verifies literal rotating subsets, not historical RTP or audio energy", () => {
	assert.deepEqual(validateTalkers(talkerHold(), talkerControls), []);
	const withinPhase = talkerHold();
	const repeated = structuredClone(withinPhase[0]);
	repeated.at = 10800;
	for (const p of repeated.clients) p.sources[0].at = 10800;
	withinPhase.splice(1, 0, repeated);
	assert.deepEqual(validateTalkers(withinPhase, talkerControls), []);
	repeated.clients[1].sources[0].audioGain = 0;
	assert.ok(validateTalkers(withinPhase, talkerControls).length, "The same phase still requires exactly {0,1}");
	for (const change of [{ paused: true }, { trackEnabled: false }, { audioGain: 0 }, { audioGain: null }]) {
		const series = talkerHold();
		Object.assign(series[0].clients[0].sources[0], change);
		assert.ok(validateTalkers(series, talkerControls).length);
	}
	const frozen = talkerHold();
	for (const sample of frozen) sample.clients.forEach((p, i) => { p.sources[0].audioGain = [1, 1, 0][i]; });
	assert.ok(validateTalkers(frozen, talkerControls).length);
});

test("all-active needs no WebAudio history; zero-active proves silence controls, not speech", () => {
	for (const active of [0, 3]) {
		const series = talkerHold();
		for (const s of series) for (const p of s.clients) {
			p.sources[0].audioGain = active === 0 ? 0 : 1;
			p.talkerChanges = active === 3 ? [] : p.talkerChanges.map((c) => ({ ...c, gain: 0 }));
		}
		assert.deepEqual(validateTalkers(series, { ...talkerControls, active }), []);
	}
	assert.deepEqual(validateTalkers([], { ...talkerControls, count: 0, active: 0 }), []);
});

test("missing, stale, future or wrong-step gain events cannot prove hold controls", () => {
	for (const events of [[], [{ at: 10050, step: 0, gain: 0 }], [{ at: 11400, step: 1, gain: 0 }],
		[{ at: 11050, step: 0, gain: 0 }], [{ at: 11050, step: 1, gain: 1 }]]) {
		const series = talkerHold();
		series[1].clients[0].talkerChanges = events;
		assert.ok(validateTalkers(series, talkerControls).length);
	}
	const series = talkerHold();
	series[1].clients[0].talkerChanges.push({ at: 12050, step: 2, gain: 1 });
	assert.deepEqual(validateTalkers(series, talkerControls), [], "Later events cannot override the source-time event");
});

test("only the explicit 100ms boundary window is excluded, never paused or disabled checks", () => {
	for (const at of [10900, 11100]) {
		const series = talkerHold();
		series[1].at = at;
		for (const p of series[1].clients) { p.sources[0].at = at; p.sources[0].audioGain = null; p.talkerChanges = []; }
		assert.deepEqual(validateTalkers(series, talkerControls), []);
		series[1].clients[0].sources[0].paused = true;
		assert.ok(validateTalkers(series, talkerControls).length);
		series[1].clients[0].sources[0].paused = false;
		series[1].clients[0].sources[0].trackEnabled = false;
		assert.ok(validateTalkers(series, talkerControls).length);
	}
	for (const at of [10899, 11101]) {
		const series = talkerHold();
		series[1].at = series[1].clients[0].sources[0].at = at;
		series[1].clients[0].sources[0].audioGain = null;
		assert.ok(validateTalkers(series, talkerControls).length);
	}
});

test("incomplete hold coverage, stale source identities and unobserved rotation are invalid", () => {
	for (const edit of [
		(s) => s.splice(0), (s) => { s[1].clients[0] = null; },
		(s) => { s[1].clients[0].sources = []; },
		(s) => { s[1].clients[0].sources[0].producerId = "replacement"; },
		(s) => { s[1].clients[0].sources[0].at = 10300; },
		(s) => { s[1].clients[0].sources[0].at = NaN; },
	]) {
		const series = talkerHold(); edit(series);
		assert.ok(validateTalkers(series, talkerControls).length);
	}
	assert.ok(validateTalkers(talkerHold(), { ...talkerControls, startedAt: 7000 }).length);
	assert.ok(validateTalkers(talkerHold(), { ...talkerControls, endedAt: 16000 }).length);
	const constantPhase = [talkerHold()[0], structuredClone(talkerHold()[0])];
	constantPhase[1].at = 10800;
	for (const p of constantPhase[1].clients) p.sources[0].at = 10800;
	assert.ok(validateTalkers(constantPhase, { ...talkerControls, endedAt: 10800 }).length);
	const boundaries = talkerHold();
	for (const s of boundaries) { s.at -= 250; for (const p of s.clients) p.sources[0].at = s.at; }
	assert.ok(validateTalkers(boundaries, { ...talkerControls, startedAt: 10000 }).length);
	const gap = talkerHold();
	gap.push(...[13050, 14050, 15050].map((at) => {
		const s = structuredClone(gap[2]); s.at = at;
		for (const p of s.clients) p.sources[0].at = at;
		return s;
	}));
	assert.ok(validateTalkers(gap, { ...talkerControls, endedAt: 15100 }).length,
		"Repeated excluded boundaries cannot fill a gap in verified coverage");
});

test("screen-only delivery requires matching screen identities and decoded RTP", () => {
	const population = [{ audio: 0, camera: 0, screen: 1, expectedConsumers: 0 },
		{ audio: 0, camera: 0, screen: 0, expectedConsumers: 1 }];
	const entries = ["send", "recv"].map((direction) => ({
		phase: "running", joinMs: 10, acknowledgedAt: 20, errors: [],
		sendState: "connected", recvState: "connected",
		sources: [{ ...source("screen", direction, "video"), isScreen: true }],
	}));
	assert.deepEqual(validateMedia(entries, population, "all"), []);
	entries[1].sources[0].isScreen = false;
	assert.ok(validateMedia(entries, population, "all").some((f) => f.includes("wrong screen identity")));
	entries[0].sources[0].isScreen = false;
	assert.ok(validateMedia(entries, population, "all").some((f) => f.includes("wrong screen publishers")));
});

test("serialized and URL-escaped credentials are redacted from raw evidence", () => {
	assert.doesNotThrow(() => sanitize({ text: "\ud800" }, ["\ud800"]));
	const secret = 'opaque"\\secret';
	const text = sanitize(
		{
			metrics: JSON.stringify({ label: secret }),
			url: `https://example.invalid/${encodeURIComponent(secret)}`,
		},
		[secret],
	);
	const evidence = JSON.parse(text);
	assert.ok(!evidence.metrics.includes(JSON.stringify(secret).slice(1, -1)));
	assert.ok(!evidence.url.includes(encodeURIComponent(secret)));
});

test("Vite cannot serve credential files or unrelated repository files", async () => {
	const { createServer } = await import("vite");
	const directory = await mkdtemp(join(tmpdir(), "meet-static-"));
	let vite;
	try {
		const root = join(directory, "client");
		await mkdir(root);
		const secret = join(root, "credentials[private].txt");
		const outside = join(directory, "unrelated.txt");
		await writeFile(secret, "opaque-static-secret");
		await writeFile(outside, "opaque-static-secret");
		vite = await createServer(clientServerOptions(root, [secret]));
		await vite.listen();
		for (const path of [
			"/credentials[private].txt",
			"/credentials[private].txt?raw",
			`/@fs${secret}`,
			`/@fs${outside}`,
		]) {
			const response = await fetch(`http://127.0.0.1:${vite.httpServer.address().port}${path}`);
			assert.equal(response.status, 403, path);
			assert.ok(!(await response.text()).includes("opaque-static-secret"));
		}
	} finally {
		await vite?.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("fixture dimensions, frame motion and PCM envelope have independent expectations", () => {
	const first = cameraFrame(0);
	assert.equal(first.length, 1280 * 720 * 1.5);
	assert.equal(first[0], 16);
	assert.equal(first[1280 * 720], 128);
	assert.notDeepEqual(first, cameraFrame(1));
	const audio = microphoneFixture();
	assert.equal(audio.toString("ascii", 0, 4), "RIFF");
	assert.equal(audio.readUInt32LE(24), 48000);
	assert.equal(audio.readUInt16LE(22), 1);
	assert.equal(audio.length, 96044);
	assert.equal(audio.readInt16LE(44), 0);
	assert.notEqual(audio.readInt16LE(44 + 2400 * 2), 0);
});

test("fixture generator writes complete Chromium-compatible files matching manifest pins", async () => {
	const directory = await mkdtemp(join(tmpdir(), "meet-fixture-files-"));
	try {
		const manifest = await generateFixtures(directory);
		const video = await readFile(join(directory, manifest.video.file));
		const header = "YUV4MPEG2 W1280 H720 F30:1 Ip A1:1 C420jpeg\n";
		assert.equal(video.subarray(0, header.length).toString(), header);
		assert.equal(video.length, header.length + 30 * (6 + (1280 * 720 * 3) / 2));
		for (let i = 0; i < 30; i++) {
			const offset = header.length + i * (6 + (1280 * 720 * 3) / 2);
			assert.equal(video.subarray(offset, offset + 6).toString(), "FRAME\n");
		}
		assert.equal(createHash("sha256").update(video).digest("hex"), manifest.video.sha256);
		const audio = await readFile(join(directory, manifest.audio.file));
		assert.equal(audio.length, 96044);
		assert.equal(createHash("sha256").update(audio).digest("hex"), manifest.audio.sha256);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("redaction removes exact secrets and JWTs even in nested failed-run evidence", () => {
	const serialized = sanitize(
		{ error: "opaque-secret", metrics: "x eyJhbGciOiJIUzI1NiJ9.abc.def", nested: ["bearer"] },
		["opaque-secret", "bearer"],
	);
	assert.ok(!serialized.includes("opaque-secret"));
	assert.ok(!serialized.includes("eyJ"));
	assert.ok(!serialized.includes("bearer"));
	assert.doesNotThrow(() => JSON.parse(serialized));
	assert.equal(
		JSON.parse(
			sanitize({ text: 'quoted"\nsecret', token: "unrecognized-opaque" }, ['quoted"\nsecret']),
		).text,
		"[REDACTED]",
	);
	assert.ok(!sanitize({ token: "unrecognized-opaque" }).includes("unrecognized-opaque"));
});

test("invalid CLI run persists token-free invalid artifact without contacting a target", async () => {
	const directory = await mkdtemp(join(tmpdir(), "meet-baseline-"));
	try {
		const output = join(directory, "invalid.json");
		const run = spawnSync(
			process.execPath,
			[
				new URL("run.mjs", import.meta.url).pathname,
				"--sfu-url",
				"https://user:opaque-secret@example.invalid/?token=eyJabc.def.ghi",
				"--output",
				output,
			],
			{
				encoding: "utf8",
				timeout: 15000,
				env: { ...process.env, SFU_LOAD_JWT_SECRET: "opaque-secret" },
			},
		);
		assert.equal(run.status, 1);
		const text = await readFile(output, "utf8");
		assert.equal(JSON.parse(text).summary.status, "invalid");
		assert.equal(JSON.parse(text).summary.qualified, false);
		assert.equal(JSON.parse(text).summary.scope, "correctness-only");
		assert.ok(![text, run.stdout, run.stderr].join().includes("opaque-secret"));
		assert.ok(!text.includes("eyJ"));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("missing SFU metrics refuses joins, retains before/after snapshots, and redacts failed artifacts", async () => {
	const directory = await mkdtemp(join(tmpdir(), "meet-preflight-"));
	const requests = [];
	const metrics = [
		...["rooms", "participants", "peers", "transports", "producers", "consumers", "sockets"].map(
			(r) => `meet_sfu_resources{resource="${r}"} 0`,
		),
		...["rooms", "peers", "transports", "producers", "consumers"].map(
			(r) => `meet_sfu_worker_resources{worker="0",resource="${r}"} 0`,
		),
		'meet_sfu_worker_cpu_seconds{worker="0",mode="user"} 0',
		'meet_sfu_worker_cpu_seconds{worker="0",mode="system"} 0',
		'meet_sfu_worker_max_resident_memory_bytes{worker="0"} 100',
		"meet_sfu_process_process_resident_memory_bytes 100",
		'test_evidence{label="opaque-metrics-secret"} 1',
	].join("\n");
	const server = createServer((req, res) => {
		requests.push(req.url);
		res.end(req.url === "/metrics" ? metrics : JSON.stringify({ rooms: 0, peers: 0 }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const output = join(directory, "invalid.json");
		let execution;
		try {
			await promisify(execFile)(
				process.execPath,
				[
					new URL("run.mjs", import.meta.url).pathname,
					"--sfu-url",
					`http://127.0.0.1:${server.address().port}`,
					"--output",
					output,
					"--media",
					"none",
					"--browser-version",
					"test-version",
				],
				{
					timeout: 15000,
					env: {
						...process.env,
						SFU_LOAD_JWT_SECRET: "opaque-signing-secret",
						SFU_METRICS_TOKEN: "opaque-metrics-secret",
					},
				},
			);
		} catch (error) {
			execution = error;
		}
		assert.equal(execution?.code, 1);
		const text = await readFile(output, "utf8");
		const report = JSON.parse(text);
		assert.equal(report.summary.status, "invalid");
		assert.ok(report.invalidReasons.includes("Missing SFU metric: meet_sfu_process_nodejs_eventloop_lag_p99_seconds"));
		assert.equal(
			report.manifest.sourceHashes["../../../suite/meet/types/participantMedia.ts"],
			createHash("sha256")
				.update(
					await readFile(new URL("../../../suite/meet/types/participantMedia.ts", import.meta.url)),
				)
				.digest("hex"),
		);
		assert.ok(report.metrics.before && report.metrics.after);
		assert.equal(report.cleanupVerified, false);
		assert.equal(report.timings.length, 0);
		assert.deepEqual(requests, ["/metrics", "/health", "/metrics", "/health"]);
		assert.ok(![text, execution.stdout, execution.stderr].join().includes("opaque-metrics-secret"));
		assert.ok(!text.includes("opaque-signing-secret"));
	} finally {
		await new Promise((resolve) => server.close(resolve));
		await rm(directory, { recursive: true, force: true });
	}
});
test("prom-client startup Nan remains missing evidence rather than a malformed scrape", () => {
	const samples = parseMetrics("meet_sfu_process_nodejs_eventloop_lag_mean_seconds Nan\n");
	assert.ok(Number.isNaN(samples[0].value));
});
