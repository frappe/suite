import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHmac, randomUUID } from "node:crypto";
import { createServer as tcpServer } from "node:net";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { generateFixtures } from "./fixtures.mjs";
import { clientServerOptions, parseMetrics, resources, validateMedia } from "./baseline.mjs";

const cliProbe = process.env.MEET_LOAD_LOCAL_CLI === "1";
const measurement = process.env.MEET_LOAD_MEASUREMENT === "1";

test("isolated native SFU: four authenticated clients, identified RTP and acknowledged leave", {
	skip: process.env.MEET_LOAD_LOCAL_SFU !== "1",
	timeout: cliProbe ? 120000 : 30000,
}, async (t) => {
	const root = dirname(fileURLToPath(import.meta.url));
	const directory = await mkdtemp(join(tmpdir(), "meet-local-sfu-"));
	let browser;
	let vite;
	let child;
	let exited;
	let watchdog;
	let hardStop;
	t.after(async () => {
		if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
		await browser?.close();
		if (exited) await exited;
		clearTimeout(watchdog);
		clearTimeout(hardStop);
		await vite?.close();
		await rm(directory, { recursive: true, force: true });
	});
	const tcp = tcpServer();
	tcp.listen(0, "127.0.0.1");
	await once(tcp, "listening");
	const port = tcp.address().port;
	await new Promise((resolve) => tcp.close(resolve));
		let mediaPort;
		for (let attempt = 0; attempt < 8; attempt++) {
			const udp = createSocket("udp4");
			udp.bind(0, "127.0.0.1");
			await once(udp, "listening");
			mediaPort = udp.address().port;
			await new Promise((resolve) => udp.close(resolve));
			if (mediaPort <= 64534) break;
		}
	assert.ok(mediaPort <= 64534, "Ephemeral media port must leave the SFU's required port range");
	const secret = randomUUID();
	const metricsToken = randomUUID();
	const origin = `http://127.0.0.1:${port}`;
	// Start current source, not a cached image or inherited .env. Auth/rate limits stay enabled.
	child = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", "src/server.ts"], {
		cwd: resolve(root, "../../../suite/meet/sfu-server"),
		env: {
			PATH: process.env.PATH,
			NODE_ENV: "test",
			HOST: "127.0.0.1",
			PORT: String(port),
			JWT_SECRET: secret,
			METRICS_TOKEN: metricsToken,
			WEBRTC_LISTEN_IP: "127.0.0.1",
			WEBRTC_ANNOUNCED_IP: "127.0.0.1",
			WEBRTC_SERVER_PORT: String(mediaPort),
			MEDIASOUP_NUM_WORKERS: "1",
			MEDIASOUP_WORKER_LOGLEVEL: "error",
			SFU_LOG_LEVEL: "error",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let diagnostics = "";
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (chunk) => {
			diagnostics = (diagnostics + chunk).slice(-12000);
		});
	exited = once(child, "exit");
	watchdog = setTimeout(() => {
		child.kill("SIGTERM");
		void browser?.close();
	}, cliProbe ? 117000 : 27000);
	hardStop = setTimeout(() => {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
	}, cliProbe ? 119000 : 29000);
	const metrics = async () => {
		const response = await fetch(`${origin}/metrics`, {
			headers: { Authorization: `Bearer ${metricsToken}` },
			signal: AbortSignal.timeout(1000),
		});
		assert.equal(response.status, 200);
		return parseMetrics(await response.text());
	};
	const readyBy = Date.now() + 10000;
	while (true) {
		assert.equal(child.exitCode, null, `Local SFU exited: ${diagnostics}`);
		try {
			await metrics();
			break;
		} catch (error) {
			if (Date.now() >= readyBy) throw error;
			await sleep(100);
		}
	}
	assert.equal((await fetch(`${origin}/metrics`)).status, 401);
	assert.deepEqual(resources(await metrics()), {
		rooms: 0,
		participants: 0,
		peers: 0,
		transports: 0,
		producers: 0,
		consumers: 0,
		sockets: 0,
		workers: 1,
	});
	const fixture = await generateFixtures(directory);
	if (cliProbe) {
		browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL });
		const version = browser.version();
		await browser.close();
		browser = undefined;
		const output = join(directory, "baseline.json");
		const execution = await promisify(execFile)(process.execPath, [
			join(root, "run.mjs"), "--sfu-url", origin, "--count", "4",
			"--audio-publishers", "2", "--camera-publishers", "2", "--overlap-publishers", "1",
			...(measurement ? ["--screen-publishers", "2", "--active-talkers", "1", "--talker-period-seconds", "2"] : []),
			"--ramp-ms", "0", "--duration-seconds", "10", "--cleanup-seconds", "65",
			"--browser-version", version, "--output", output,
			"--video-fixture", join(directory, fixture.video.file), "--video-sha256", fixture.video.sha256,
			"--audio-fixture", join(directory, fixture.audio.file), "--audio-sha256", fixture.audio.sha256,
		], { timeout: 105000, env: { ...process.env, SFU_LOAD_JWT_SECRET: secret, SFU_METRICS_TOKEN: metricsToken } }).catch((error) => error);
		const text = await readFile(output, "utf8");
		const report = JSON.parse(text);
		assert.equal(execution.code, undefined, JSON.stringify({ summary: report.summary, invalidReasons: report.invalidReasons, failures: report.failures }));
		assert.deepEqual(report.summary, { scope: "correctness-only", qualified: false, status: "passed", passed: true });
		assert.equal(report.cleanupVerified, true);
		assert.equal(report.participants.length, 4);
		assert.deepEqual(report.participants.map((p) => p.consumerCount), measurement ? [3, 4, 5, 6] : [2, 3, 3, 4]);
		assert.ok(report.cleanup.every((p) => p.localMediaReleased));
		if (measurement) {
			const screens = report.participants.flatMap((p) => p.sources.filter((s) => s.direction === "send" && s.isScreen));
			assert.equal(screens.length, 2);
			for (const s of screens) {
				assert.equal(s.settings.width, 1920);
				assert.equal(s.settings.height, 1080);
				assert.equal(s.settings.frameRate, 30);
				assert.equal(s.rtp.encodings[0].maxBitrate, 4000000);
			}
			assert.deepEqual(report.participants.map((p) => p.sources.filter((s) => s.direction === "recv" && s.isScreen).length), [1, 1, 2, 2]);
			for (const [i, p] of report.participants.slice(0, 2).entries()) {
				assert.ok(p.talkerChanges.length >= 4);
				assert.ok(p.talkerChanges.every((c) => c.gain === (c.step % 2 === i ? 1 : 0)));
				const samples = report.series.filter((s) => s.phase === "hold" && s.clients?.[i]);
				const silent = samples.findIndex((s, j) => j > 0 &&
					s.clients[i].talkerChanges.at(-1).gain === 0 &&
					s.clients[i].talkerChanges.at(-1).step === samples[j - 1].clients[i].talkerChanges.at(-1).step);
				assert.ok(silent > 0, "Observe traffic across a stable silent-gain interval");
				const sent = samples[silent].clients[i].sources.find((s) => s.direction === "send" && s.kind === "audio");
				const before = samples[silent - 1].clients[i].sources.find((s) => s.producerId === sent.producerId);
				assert.equal(sent.audioGain, 0);
				assert.equal(sent.paused, false);
				assert.equal(sent.trackEnabled, true);
				assert.ok(sent.bytes > before.bytes && sent.packets > before.packets);
			}
		}
		assert.ok(report.cleanup.every((p) => p.acknowledged));
		const cleanup = report.series.filter((s) => s.phase === "cleanup");
		assert.ok(report.series.at(-1).at - cleanup[0].at >= 64000);
		assert.equal(text.includes(secret) || text.includes(metricsToken), false);
		assert.deepEqual(resources(parseMetrics(report.metrics.after)), {
			rooms: 0, participants: 0, peers: 0, transports: 0, producers: 0, consumers: 0, sockets: 0, workers: 1,
		});
		console.log(JSON.stringify({ probe: "local-cli", chromium: version, summary: report.summary,
			measurement, consumers: report.participants.map((p) => p.consumerCount),
			localMediaReleased: true, cleanupVerified: true }));
		return;
	}
	vite = await createServer(clientServerOptions(root));
	await vite.listen();
	const pageOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		channel: process.env.CHROME_CHANNEL,
		args: [
			"--use-fake-device-for-media-stream",
			"--use-fake-ui-for-media-stream",
			"--autoplay-policy=no-user-gesture-required",
			"--mute-audio",
			`--use-file-for-fake-video-capture=${join(directory, fixture.video.file)}`,
			`--use-file-for-fake-audio-capture=${join(directory, fixture.audio.file)}`,
		],
	});
	const context = await browser.newContext({ serviceWorkers: "block" });
	await context.route("**/*", (route) =>
		[origin, pageOrigin].includes(new URL(route.request().url()).origin)
			? route.continue()
			: route.abort(),
	);
	await context.routeWebSocket("**/*", (route) => {
		const url = new URL(route.url());
		if (url.hostname === "127.0.0.1" && [String(port), new URL(pageOrigin).port].includes(url.port))
			route.connectToServer();
		else route.close();
	});
	const meetingId = `load-${randomUUID()}`;
	// Independent four-person fixture: both, microphone, camera, receive-only.
	const population = [
		{ media: "both", audio: 1, camera: 1, expectedConsumers: 2 },
		{ media: "audio", audio: 1, camera: 0, expectedConsumers: 3 },
		{ media: "video", audio: 0, camera: 1, expectedConsumers: 3 },
		{ media: "none", audio: 0, camera: 0, expectedConsumers: 4 },
	];
	const pages = await Promise.all(
		population.map(async () => {
			const page = await context.newPage();
			await page.goto(pageOrigin);
			await page.waitForFunction(() => Boolean(window.meetLoad));
			return page;
		}),
	);
	const starts = await Promise.allSettled(
		pages.map((page, i) => {
			const userId = `load-${i + 1}@example.invalid`;
			const name = `Load ${i + 1}`;
			const unsigned = [
				{ alg: "HS256", typ: "JWT" },
				{
					user_id: userId,
					user_name: name,
					meeting_id: meetingId,
					site: "load.test",
					scope: "full",
					is_host: false,
					exp: Math.floor(Date.now() / 1000) + 60,
				},
			]
				.map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
				.join(".");
			return page.evaluate((config) => window.meetLoad.start(config), {
				sfuUrl: origin,
				meetingId,
				userId,
				name,
				connectionId: randomUUID(),
				token: `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`,
				media: population[i].media,
				consume: "all",
				renderMedia: true,
				videoCodec: "VP9",
				scalabilityMode: "L3T1_KEY",
			});
		}),
	);
	assert.ok(starts.every((s) => s.status === "fulfilled"), JSON.stringify(
		await Promise.all(pages.map((page) => page.evaluate(() => window.meetLoad.status()))),
	));
	let entries;
	let failures;
	const mediaBy = Date.now() + 8000;
	do {
		entries = await Promise.all(pages.map((page) => page.evaluate(() => window.meetLoad.status())));
		failures = validateMedia(entries, population, "all");
		if (!failures.length || entries.some((e) => e.errors.length)) break;
		await sleep(200);
	} while (Date.now() < mediaBy);
	const first = entries;
	await sleep(600);
	entries = await Promise.all(pages.map((page) => page.evaluate(() => window.meetLoad.status())));
	failures = validateMedia(entries, population, "all");
	const active = resources(await metrics());
	const leaves = await Promise.all(
		pages.map((page) => page.evaluate(() => window.meetLoad.stop())),
	);
	for (const leave of leaves) {
		assert.equal(leave.joined, true);
		assert.equal(leave.acknowledged, true, JSON.stringify(leave));
		assert.equal(leave.rejected, false);
	}
	let after;
	for (let attempt = 0; attempt < 20; attempt++) {
		after = resources(await metrics());
		if (after.sockets === 0) break;
		await sleep(50);
	}
	assert.deepEqual(after, {
		rooms: 1,
		participants: 0,
		peers: 0,
		transports: 0,
		producers: 0,
		consumers: 0,
		sockets: 0,
		workers: 1,
	});
	assert.deepEqual(
		failures,
		[],
		JSON.stringify({ failures, rejections: entries.map((e) => e.rejections) }),
	);
	assert.deepEqual(active, {
		rooms: 1,
		participants: 4,
		peers: 4,
		transports: 7,
		producers: 4,
		consumers: 12,
		sockets: 4,
		workers: 1,
	});
	for (const [i, entry] of entries.entries()) {
		assert.equal(entry.participantMediaProtocolVersion, 1);
		assert.equal(entry.mediaCapabilities.queueConfigurationQualified, false);
		assert.deepEqual(entry.mediaCapabilities.attachmentQueue, {
			concurrency: 4,
			maxDepth: 256,
			operationTimeoutMs: 4000,
			deadlineMs: 10000,
			retryCount: 2,
			retryDelayMs: 250,
		});
		assert.deepEqual(entry.mediaCapabilities.consumerCreateQueue, {
			concurrency: 8,
			maxQueueDepth: 512,
			operationTimeoutMs: 4000,
		});
		for (const source of entry.sources) {
			const previous = first[i].sources.find(
				(s) => s.direction === source.direction && s.producerId === source.producerId,
			);
			assert.ok(previous, "Every source must exist in both observations");
			assert.ok(source.bytes > previous.bytes, `RTP must keep flowing for ${source.producerId}`);
			assert.ok(source.packets > previous.packets);
			assert.ok(
				source.rtp.codecs.some(
					(c) =>
						c.mimeType.toLowerCase() === (source.kind === "audio" ? "audio/opus" : "video/vp9"),
				),
			);
		}
	}
	console.log(
		JSON.stringify({
			probe: "local-native-sfu-not-capacity-baseline",
			chromium: browser.version(),
			active,
			after,
			receivedSources: entries.map((e) => e.sources.filter((s) => s.direction === "recv").length),
			limitation:
				"Room grace is 60s; only acknowledged peer/media cleanup verified within the 30s bound",
		}),
	);
});
