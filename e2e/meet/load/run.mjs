import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, hostname, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { boundedInteger, containsJwt, delta, parseResourceMetrics, percentile, targetMetadata } from "./report.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
	"sfu-url": { type: "string", default: "http://127.0.0.1:3001" },
	"allow-remote-target": { type: "boolean", default: false },
	"meeting-id": { type: "string", default: `load-${randomUUID()}` },
	site: { type: "string", default: "load.test" },
	count: { type: "string", default: "2" },
	media: { type: "string", default: "none" },
	consume: { type: "string", default: "all" },
	"render-media": { type: "boolean", default: false },
	"ramp-ms": { type: "string", default: "250" },
	"duration-seconds": { type: "string", default: "5" },
	"cleanup-seconds": { type: "string", default: "65" },
	"token-file": { type: "string" },
	"jwt-secret-env": { type: "string", default: "SFU_LOAD_JWT_SECRET" },
	"metrics-token-env": { type: "string", default: "SFU_METRICS_TOKEN" },
	output: { type: "string" },
}, strict: true });

const count = boundedInteger(values.count, "count", 1, 150);
const durationSeconds = boundedInteger(values["duration-seconds"], "duration-seconds", 1, 600);
const cleanupSeconds = boundedInteger(values["cleanup-seconds"], "cleanup-seconds", 1, 90);
const rampMs = boundedInteger(values["ramp-ms"], "ramp-ms", 0, 5000);
if (!["none", "audio", "video", "both"].includes(values.media)) throw new Error("media must be none, audio, video, or both");
if (!["all", "none"].includes(values.consume)) throw new Error("consume must be all or none");
if (!/^load-[0-9a-f-]{36}$/.test(values["meeting-id"]) || !/^load(?:[.-][a-z0-9-]+)*\.test$/i.test(values.site)) {
	throw new Error("Use the generated load UUID room and a load*.test site namespace");
}
const target = targetMetadata(values["sfu-url"], values["allow-remote-target"]);
const output = resolve(values.output || resolve(root, "results", `${new Date().toISOString().replaceAll(":", "-")}.json`));
const metricsToken = process.env[values["metrics-token-env"]];
if (!metricsToken) throw new Error(`Set ${values["metrics-token-env"]} for idle and cleanup measurement`);

const report = {
	schemaVersion: 1,
	scope: target.loopback ? "local-correctness-only" : "server-measurement-only",
	qualified: false,
	startedAt: new Date().toISOString(),
	target,
	config: { count, durationSeconds, cleanupSeconds, rampMs, media: values.media, consume: values.consume,
		renderMedia: values["render-media"], meetingId: values["meeting-id"], site: values.site,
		authSource: values["token-file"] ? "token-file" : "environment-signed" },
	host: { hostname: hostname(), platform: platform(), release: release(), node: process.version,
		logicalCpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryBytes: totalmem() },
	browser: {}, resources: {}, samples: [], participants: [], cleanup: [], errors: [],
};
const beforeUsage = process.resourceUsage();
const beforeMemory = process.memoryUsage();
const pages = [], browsers = [];
let vite;

function endpoint(path) {
	const url = new URL(target.endpoint); url.pathname = `${url.pathname.replace(/\/$/, "")}/${path}`; return url;
}
async function fetchText(path, authenticated = false) {
	const response = await fetch(endpoint(path), { headers: authenticated ? { Authorization: `Bearer ${metricsToken}` } : {},
		signal: AbortSignal.timeout(5000), redirect: "error" });
	if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
	const text = await response.text();
	if (text.length > 2_000_000) throw new Error(`${path} response exceeds 2 MB`);
	return text;
}
async function sample(phase) {
	const health = JSON.parse(await fetchText("health"));
	const resources = parseResourceMetrics(await fetchText("metrics", true));
	const entry = { at: new Date().toISOString(), phase, health, resources };
	report.samples.push(entry); return entry;
}
function isIdle(entry) {
	return entry.health.rooms === 0 && entry.health.peers === 0 &&
		["rooms", "participants", "peers", "transports", "producers", "consumers", "sockets"]
			.every((key) => (entry.resources[key] ?? 0) === 0);
}
function signedToken(secret, participant) {
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const now = Math.floor(Date.now() / 1000);
	const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ user_id: participant.userId,
		user_name: participant.name, meeting_id: values["meeting-id"], site: values.site, scope: "full",
		is_host: false, is_cohost: false, is_guest: false, e2ee_required: false, iat: now, exp: now + 1800 })}`;
	return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}
async function clients() {
	if (values["token-file"]) {
		let parsed;
		try { parsed = (await readFile(resolve(values["token-file"]), "utf8")).split("\n").filter(Boolean).map(JSON.parse); }
		catch { throw new Error("Token file is unreadable or malformed"); }
		if (parsed.length !== count) throw new Error("Token file must contain exactly count JSONL entries");
		return parsed.map(({ userId, name, token }) => ({ userId, name, token }));
	}
	const secret = process.env[values["jwt-secret-env"]];
	if (!secret) throw new Error(`Set ${values["jwt-secret-env"]} or provide --token-file`);
	return Array.from({ length: count }, (_, index) => {
		const participant = { userId: `load-${index + 1}@example.invalid`, name: `Load ${index + 1}` };
		return { ...participant, token: signedToken(secret, participant) };
	});
}
async function wait(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }

try {
	const initial = await sample("before");
	if (!isIdle(initial)) throw new Error("Target is not idle; no traffic was sent");
	const participants = await clients();
	vite = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0 },
		fs: { strict: true, allow: [root], deny: ["**/tokens.jsonl", output] } });
	await vite.listen();
	const address = vite.httpServer.address();
	const clientUrl = `http://127.0.0.1:${address.port}`;
	const browser = await chromium.launch({ headless: true, channel: process.env.CHROME_CHANNEL,
		args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
	browsers.push(browser); report.browser = { version: browser.version(), channel: process.env.CHROME_CHANNEL || "playwright-chromium", contexts: 1 };
	const context = await browser.newContext({ permissions: ["camera", "microphone"] });
	for (const [index, participant] of participants.entries()) {
		const page = await context.newPage(); pages.push(page);
		page.on("pageerror", () => report.errors.push(`participant ${index + 1}: page error`));
		await page.goto(clientUrl, { waitUntil: "networkidle", timeout: 15_000 });
		await page.evaluate((config) => window.meetLoad.start(config), { ...participant, sfuUrl: target.endpoint,
			meetingId: values["meeting-id"], media: values.media, consume: values.consume === "all", renderMedia: values["render-media"] });
		if (rampMs) await wait(rampMs);
	}
	const hold = await sample("hold");
	if (hold.health.rooms !== 1 || hold.health.peers !== count) throw new Error("SFU hold counts do not match this run");
	await wait(durationSeconds * 1000);
	report.participants = await Promise.all(pages.map((page) => page.evaluate(() => window.meetLoad.status())));
	for (const [index, participant] of report.participants.entries()) {
		if (participant.phase !== "running") report.errors.push(`participant ${index + 1}: not running`);
		if (values.media !== "none" && participant.bytesSent === 0) report.errors.push(`participant ${index + 1}: no outbound RTP observed`);
		if (count > 1 && values.consume === "all" && values.media !== "none" && participant.bytesReceived === 0) report.errors.push(`participant ${index + 1}: no inbound RTP observed`);
		report.errors.push(...participant.errors.map((error) => `participant ${index + 1}: ${error}`));
	}
} catch (error) {
	report.errors.push(error instanceof Error ? error.message.replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted]") : "run failed");
} finally {
	report.cleanup = await Promise.all(pages.map(async (page, index) => {
		try { return { participant: index + 1, ...(await page.evaluate(() => window.meetLoad.stop())) }; }
		catch { return { participant: index + 1, localMediaReleased: false }; }
	}));
	await Promise.allSettled(browsers.map((browser) => browser.close()));
	if (vite) await vite.close();
	try {
		const cleanupStarted = Date.now();
		while (Date.now() - cleanupStarted < cleanupSeconds * 1000) {
			const health = JSON.parse(await fetchText("health"));
			if (health.rooms === 0 && health.peers === 0) break;
			await wait(1000);
		}
		report.cleanupElapsedMs = Date.now() - cleanupStarted;
		const after = await sample("after");
		report.resources = { before: report.samples[0]?.resources || {}, hold: report.samples.find((entry) => entry.phase === "hold")?.resources || {},
			after: after.resources, holdDelta: delta(report.samples[0]?.resources || {}, report.samples.find((entry) => entry.phase === "hold")?.resources || {}),
			afterDelta: delta(report.samples[0]?.resources || {}, after.resources) };
		report.cleanupVerified = isIdle(after) && report.cleanup.every((entry) => entry.localMediaReleased);
		if (!report.cleanupVerified) report.errors.push("Cleanup did not return measured resources and local media to idle");
	} catch { report.errors.push("Final resource sample failed"); report.cleanupVerified = false; }
	const usage = process.resourceUsage(); const memory = process.memoryUsage();
	report.host.generatorProcessDelta = { userCpuMicros: usage.userCPUTime - beforeUsage.userCPUTime,
		systemCpuMicros: usage.systemCPUTime - beforeUsage.systemCPUTime,
		maxRssBytes: usage.maxRSS * 1024, rssBytes: memory.rss, rssDeltaBytes: memory.rss - beforeMemory.rss };
	report.summary = { passed: report.errors.length === 0 && report.cleanupVerified,
		joinP50Ms: percentile(report.participants.map((entry) => entry.joinMs), 0.5),
		joinP95Ms: percentile(report.participants.map((entry) => entry.joinMs), 0.95),
		firstRemoteMediaP95Ms: percentile(report.participants.map((entry) => entry.firstRemoteMediaMs), 0.95),
		totalBytesSent: report.participants.reduce((sum, entry) => sum + entry.bytesSent, 0),
		totalBytesReceived: report.participants.reduce((sum, entry) => sum + entry.bytesReceived, 0) };
	report.finishedAt = new Date().toISOString();
	if (containsJwt(report)) throw new Error("Refusing to write a report containing a JWT");
	await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	console.log(`${report.scope}: ${report.summary.passed ? "passed" : "failed"}; qualified=false; report=${output}`);
	process.exitCode = report.summary.passed ? 0 : 1;
}
