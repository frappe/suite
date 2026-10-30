import { applyFixturePatches } from "./fixture-patches.mjs";
import { measureStream } from "./measure.mjs";
import { assessPoor } from "./assess-poor.mjs";
import { assess } from "./assess.mjs";
import { createRelay } from "./relay.mjs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, createHmac, randomUUID } from "node:crypto";
import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
const harness = dirname(fileURLToPath(import.meta.url));
const root = resolve(harness, "../camera-demand");
const repo = resolve(root, "../../..");
const { default: vue } = await import(
	resolve(repo, "node_modules/@vitejs/plugin-vue/dist/index.mjs")
);
const output = resolve(
	process.env.MEET_NETWORK_OUTPUT || harness + "/artifacts",
);
await mkdir(output, { recursive: true });
import assert from "node:assert/strict";
const secret = randomBytes(32).toString("hex"),
	metrics = randomBytes(32).toString("hex");
const room = "load-" + randomUUID();
const relay = await createRelay({ bypassPeers: 4 });
const server = spawn(
	process.execPath,
	["-r", "ts-node/register", "src/server.ts"],
	{
		cwd: repo + "/suite/meet/sfu-server",
		env: {
			...process.env,
			TS_NODE_TRANSPILE_ONLY: "1",
			NODE_ENV: "test",
			JWT_SECRET: secret,
			METRICS_TOKEN: metrics,
			HOST: "127.0.0.1",
			PORT: "4317",
			WEBRTC_LISTEN_IP: "127.0.0.2",
			WEBRTC_ANNOUNCED_IP: "127.0.0.1",
			WEBRTC_SERVER_PORT: "44170",
			MEDIASOUP_NUM_WORKERS: "1",
			SFU_LOG_LEVEL: "error",
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
let logs = "";
server.stdout.on("data", (x) => (logs += x));
server.stderr.on("data", (x) => (logs += x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let vite, browser, page, result;
const videoDemo = process.env.MEET_NETWORK_VIDEO === "1";

const beforeDemo = process.env.MEET_NETWORK_BEFORE === "1";
const token = (id) => {
	const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
	const x =
		enc({ alg: "HS256", typ: "JWT" }) +
		"." +
		enc({
			user_id: id,
			user_name: id,
			meeting_id: room,
			site: "load.test",
			scope: "full",
			is_host: false,
			is_cohost: false,
			is_guest: false,
			e2ee_required: false,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 600,
		});
	return x + "." + createHmac("sha256", secret).update(x).digest("base64url");
};
async function resources() {
	const r = await fetch("http://127.0.0.1:4317/metrics", {
		headers: { Authorization: "Bearer " + metrics },
	});
	assert(r.ok);
	const raw = await r.text();
	return raw
		.split("\n")
		.filter((l) => !l.startsWith("#") && /consumers|producers/.test(l));
}
try {
	if (videoDemo) {
		try {
			await readFile(output + "/camera.webm");
		} catch {
			const sample = await fetch(
				"https://webrtc.github.io/samples/src/video/chrome.webm",
			);
			assert(sample.ok, "Could not download the WebRTC sample camera clip");
			await writeFile(
				output + "/camera.webm",
				Buffer.from(await sample.arrayBuffer()),
			);
		}
	}
	for (let i = 0; i < 50; i++) {
		try {
			if ((await fetch("http://127.0.0.1:4317/health")).ok) break;
		} catch {}
		if (server.exitCode !== null) throw new Error(logs);
		await sleep(200);
	}
	vite = await createServer({
		root,
		configFile: false,
		plugins: [
			{
				name: "camera-presentation-stubs",
				transformIndexHtml(html) {
					return videoDemo
						? html.replace(/<style>[\s\S]*?<\/style>/, "")
						: html;
				},
				enforce: "pre",
				async load(id) {
					if (id === "\0empty-indicator") return "export default {}";
					if (beforeDemo && id.startsWith(repo + "/frontend/src/apps/meet/")) {
						const relative = id.slice(
							(repo + "/frontend/src/apps/meet/").length,
						);
						try {
							return await readFile(
								resolve(harness, "artifacts-before/sources", relative),
								"utf8",
							);
						} catch {}
					}
					if (id === "\0session")
						return 'export const session={user:{sessionUser:"receiver"}}';
				},
				transform(code, id) {
					if (id === root + "/client.js") {
						if (videoDemo)
							code = applyFixturePatches(code, [
								["inventory.push(await publish(publishers[0],'screen'));", ""],
								[
									"const canvas=document.createElement('canvas');",
									"const clip=document.createElement('video');clip.src='/@fs/" +
										output +
										"/camera.webm';clip.muted=true;clip.loop=true;clip.currentTime=['a','b','c','d'].indexOf(e.id)*4;await clip.play(); const canvas=document.createElement('canvas');",
								],
								[
									"ctx.fillStyle='white';ctx.fillText",
									"ctx.drawImage(clip,0,0,320,240);ctx.fillStyle='white';ctx.fillText",
								],
								[
									"userData:{userId:config.id,name:config.id},mediaState:{video_enabled:true",
									"userData:{userId:config.id,name:({a:'Alex',b:'Sam',c:'Jordan',d:'Taylor'})[config.id]},mediaState:{video_enabled:true",
								],
								[
									"return ()=>h(MeetingLayout);",
									"return ()=>h(FullCall,{manager},()=>h(MeetingLayout));",
								],
								[
									"import MeetingLayout",
									"import FullCall from '" +
										harness +
										"/FullCall.vue';\nimport MeetingLayout",
								],
								[
									"const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;",
									"const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;",
								],
								[
									"ctx.drawImage(clip,0,0,320,240);ctx.fillStyle='white';ctx.fillText(`${e.id} ${frame}`,30,90)",
									"ctx.drawImage(clip,0,0,640,480)",
								],
								[
									"e.send.produce({track,appData:{type}})",
									"publishWithMeet(e,track,type)",
								],
								[
									"import {Device}",
									"import {TransportManager} from '" +
										repo +
										"/frontend/src/apps/meet/utils/media/TransportManager';\n" +
										"async function publishWithMeet(e,track,type){if(!e.meetTransport){e.meetTransport=new TransportManager();e.meetTransport.device=e.device;e.meetTransport.sendTransport=e.send;e.meetTransport.initialize({getCodecStrategy:()=> 'simulcast',isE2EERequired:()=>false});}const producer=await e.meetTransport.createProducer(track,{type});(e.published??=[]).push(producer);return producer;}\nimport {Device}",
								],
								[
									"publishers[0].send.produce({track:dest.stream.getAudioTracks()[0],appData:{type:'camera'}})",
									"publishWithMeet(publishers[0],dest.stream.getAudioTracks()[0],'microphone')",
								],
								[
									"async stats(){",
									"async stats(){ window.senderPolicies=endpoints.map(e=>({id:e.id,senders:(e.published||[]).map(p=>({kind:p.kind,hint:p.track?.contentHint,parameters:p.rtpSender?.getParameters()}))}));",
								],
								[
									"frames:x.reports",
									"width:x.reports.find(r=>r.type==='inbound-rtp')?.frameWidth,height:x.reports.find(r=>r.type==='inbound-rtp')?.frameHeight,concealedSamples:x.reports.find(r=>r.type==='inbound-rtp')?.concealedSamples,totalSamplesReceived:x.reports.find(r=>r.type==='inbound-rtp')?.totalSamplesReceived,frames:x.reports",
								],
							]);
						return applyFixturePatches(
							"import IndicatorDemo from '" +
								harness +
								"/IndicatorDemo.vue';\n" +
								applyFixturePatches(code, [
									[
										"app.mount(document.getElementById('app'));",
										videoDemo
											? "app.mount(document.getElementById('app'));"
											: "app.mount(document.getElementById('app'));const demoRoot=document.body.appendChild(document.createElement('div')); const demo=createApp(IndicatorDemo,{manager,before:" +
												beforeDemo +
												"});demo.mount(demoRoot);",
									],
								]),
							[
								[
									"onParticipantJoined(p){",
									`onRecoveryStateChange(state,detail){(window.networkEvents??=[]).push({at:Date.now(),type:'recovery',state,detail})}, onNetworkQualityUpdated(id,quality){(window.networkEvents??=[]).push({at:Date.now(),type:'quality',id,quality})}, onParticipantJoined(p){`,
								],
							],
						);
					}
				},
				async resolveId(id, importer) {
					if (id === "#meet-demo-style") {
						const assets = resolve(repo, "suite/public/frontend/assets");
						const css = (await readdir(assets)).find((name) =>
							/^index-.*\.css$/.test(name),
						);
						assert(css, "Build the frontend before recording the full call");
						return resolve(assets, css);
					}
					if (id === "#network-indicator")
						return beforeDemo
							? "\0empty-indicator"
							: repo +
									"/frontend/src/apps/meet/components/NetworkIndicator.vue";
					if (
						!videoDemo &&
						importer?.includes("MeetingLayout.vue") &&
						/\/(ParticipantTile|GroupTile|FloatingReactions)\.vue$/.test(id)
					)
						return root + "/tiles.js";
					if (id === "@/boot/session") return "\0session";
				},
			},
			vue(),
			...(videoDemo
				? [
						(await import("unplugin-icons/vite")).default({
							compiler: "vue3",
							autoInstall: false,
							customCollections: {
								lucide: async (name) =>
									readFile(
										resolve(
											repo,
											"node_modules/lucide-static/icons",
											name + ".svg",
										),
										"utf8",
									),
							},
						}),
						(await import("unplugin-vue-components/vite")).default({
							resolvers: [
								(await import("unplugin-icons/resolver")).default({
									prefix: "",
									enabledCollections: ["lucide"],
								}),
							],
						}),
					]
				: []),
		],
		resolve: {
			alias: {
				"@": resolve(repo, "frontend/src"),
				vue: resolve(repo, "node_modules/vue/dist/vue.runtime.esm-bundler.js"),
				"frappe-ui": videoDemo
					? resolve(repo, "node_modules/frappe-ui/src/index.ts")
					: resolve(harness, "frappeUi.ts"),
			},
		},
		optimizeDeps: { include: ["mediasoup-client", "socket.io-client", "vue"] },
		server: {
			host: "127.0.0.1",
			port: 4318,
			strictPort: true,
			fs: { allow: [root, repo] },
		},
		logLevel: "error",
	});
	await vite.listen();
	browser = await chromium.launch({
		headless: true,
		args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
	});
	page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		...(videoDemo
			? {
					recordVideo: {
						dir: output + "/video",
						size: { width: 1440, height: 900 },
					},
				}
			: {}),
	});
	page.on("console", (m) => {
		if (m.text().startsWith("CAMERA")) console.log(m.text());
	});
	page.on("pageerror", (e) => console.error(e.message));
	await page.goto("http://127.0.0.1:4318");
	await page.waitForFunction(
		() => !!window.cameraCheck,
		{},
		{ timeout: 20000 },
	);
	const inventory = await page.evaluate(
		(configs) =>
			Promise.race([
				window.cameraCheck.start(configs),
				new Promise((_, j) =>
					setTimeout(() => j(new Error("start timed out")), 20000),
				),
			]),
		["a", "b", "c", "d", "receiver"].map((id) => ({
			id,
			room,
			token: token(id),
		})),
	);
	const files = [
		"e2e/meet/network/run.mjs",
		"e2e/meet/network/relay.mjs",
		"e2e/meet/network/assess.mjs",
		"e2e/meet/network/measure.mjs",
		"e2e/meet/network/assess-poor.mjs",
		"e2e/meet/network/FullCall.vue",
		"frontend/src/apps/meet/utils/media/encodings.ts",
		"e2e/meet/network/IndicatorDemo.vue",
		"frontend/src/apps/meet/utils/media/NetworkStatsTracker.ts",
		"frontend/src/apps/meet/components/NetworkIndicator.vue",
		"frontend/src/apps/meet/utils/media/MediaHealthMonitor.ts",
		"frontend/src/apps/meet/composables/useNetworkQuality.ts",
		"e2e/meet/camera-demand/client.js",
		"e2e/meet/camera-demand/tiles.js",
		"e2e/meet/camera-demand/index.html",
		"frontend/src/apps/meet/components/MeetingLayout.vue",
		"frontend/src/apps/meet/utils/SFUMeetingManager.ts",
		"frontend/src/apps/meet/utils/sfu/ParticipantConnection.ts",
		"frontend/src/apps/meet/utils/sfu/SFUMediaManager.ts",
		"frontend/src/apps/meet/utils/media/TransportManager.ts",
		"frontend/src/apps/meet/utils/media/VideoElementManager.ts",
		"suite/meet/sfu-server/src/mediasoup/MediasoupManager.ts",
	];
	result = {
		scope: "real-layout-and-meeting-manager-isolated-SFU",
		revision: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repo,
			encoding: "utf8",
		}).trim(),
		sourceHashes: Object.fromEntries(
			await Promise.all(
				files.map(async (f) => {
					const relative = f.replace("frontend/src/apps/meet/", "");
					let content;
					if (beforeDemo && f.startsWith("frontend/src/apps/meet/")) {
						try {
							content = await readFile(
								resolve(harness, "artifacts-before/sources", relative),
							);
						} catch {}
					}
					content ??= await readFile(resolve(repo, f));
					return [f, createHash("sha256").update(content).digest("hex")];
				}),
			),
		),
		browser: browser.version(),
		node: process.version,
		worker: process.env.MEDIASOUP_WORKER_BIN || "packaged",
		workerSha256: process.env.MEDIASOUP_WORKER_BIN
			? createHash("sha256")
					.update(await readFile(process.env.MEDIASOUP_WORKER_BIN))
					.digest("hex")
			: null,

		inventory,
		windows: [],
	};

	if (videoDemo)
		await page.addStyleTag({
			content: "#network-demo{display:none!important}",
		});
	const scenarios =
		process.env.MEET_NETWORK_POOR_DEMO === "1"
			? [
					{ name: "baseline", seconds: 15, conditions: {} },
					{
						name: "poor",
						seconds: 45,
						conditions: {
							downBps: 187500,
							upBps: 64000,
							delayMs: 250,
							loss: 0,
							maxQueueMs: 100,
						},
					},
					{ name: "recovered", seconds: 25, conditions: {} },
				]
			: [
					{ name: "baseline", seconds: 8, conditions: {} },
					{
						name: "slow-512k-300ms-5pct",
						seconds: 15,
						conditions: { delayMs: 150, downBps: 64000, upBps: 32000, loss: 5 },
					},
					{
						name: "severe-128k-800ms-20pct",
						seconds: 15,
						conditions: { delayMs: 400, downBps: 16000, upBps: 8000, loss: 20 },
					},
					{ name: "recovered", seconds: 30, conditions: {} },
					{ name: "media-blackout", seconds: 10, conditions: { loss: 100 } },
					{ name: "blackout-recovered", seconds: 25, conditions: {} },
				];
	result.scope = videoDemo
		? "isolated real Meet receiver and production participant tiles; fixture call shell and toolbar; four VP8 simulcast sample cameras and oscillator audio; actual UDP impairment on receiver; signaling unaffected"
		: "isolated real Meet receiver; four cameras, screen, oscillator audio; UDP relay conditions apply only to real Meet receiver; first four ordered publisher flows bypass impairment; signaling unaffected";
	result.protocol =
		"userspace UDP relay; aggregate per-direction byte budget, seeded packet loss, one-way delay";
	result.consoleErrors = [];
	page.on("pageerror", (e) => result.consoleErrors.push(e.message));
	for (const scenario of scenarios) {
		await page.evaluate(
			(name) => window.networkDemo.setPhase(name),
			scenario.name,
		);
		if (videoDemo)
			await page.evaluate((name) => {
				document.querySelector("#phase-caption").textContent =
					{
						baseline: "Healthy connection",
						recovered: "Connection restored",
						"media-blackout": "Network interrupted",
						"blackout-recovered": "Connection restored",
					}[name] || "Poor connection";
			}, scenario.name);
		const conditions = scenario.conditions;
		relay.setProfile(conditions);
		const samples = [await page.evaluate(() => window.cameraCheck.stats())];
		for (let i = 0; i < scenario.seconds; i++) {
			await sleep(1000);
			samples.push(
				await page.evaluate(async () => ({
					...(await window.cameraCheck.stats()),
					indicator: window.networkDemo.snapshot(),
				})),
			);
		}
		const before = samples[0],
			after = samples.at(-1),
			elapsedMs = after.timestamp - before.timestamp;
		const streams = after.rows.map((row) => {
			const prior = before.rows.find((x) => x.producerId === row.producerId);
			return {
				participantId: row.participantId,
				kind: row.kind,
				isScreen: row.isScreen,
				stableConsumer: !!prior && prior.id === row.id,
				...measureStream(samples, row.producerId),
			};
		});
		const window = {
			name: scenario.name,
			conditions,
			elapsedMs,
			bitrateBps: streams.reduce(
				(s, r) => s + ((r.bytesDelta || 0) * 8000) / elapsedMs,
				0,
			),
			streams,
			samples,
			resources: await resources(),
			relay: relay.snapshot(),
		};
		window.indicator = await page.evaluate(() => window.networkDemo.snapshot());
		await page.screenshot({ path: output + "/" + scenario.name + ".png" });
		if (!videoDemo)
			await page
				.locator("#network-demo")
				.screenshot({ path: output + "/" + scenario.name + "-indicator.png" });
		result.windows.push(window);
		await writeFile(output + "/result.json", JSON.stringify(result, null, 2));
		console.log(
			scenario.name,
			Math.round(window.bitrateBps) + " bps",
			JSON.stringify(streams),
		);
	}
	relay.setProfile({});
	Object.assign(
		result,
		process.env.MEET_NETWORK_POOR_DEMO === "1"
			? assessPoor(result.windows)
			: assess(result.windows, {
					expectIndicator: !beforeDemo,
					expectedStreams: videoDemo ? 5 : 6,
				}),
	);
	result.checks.producerIdentity = result.windows.every(
		(window) =>
			JSON.stringify(
				window.samples
					.at(-1)
					.rows.map((row) => row.producerId)
					.sort(),
			) === JSON.stringify(inventory.map((row) => row.producerId).sort()),
	);
	result.checks.noPageErrors = result.consoleErrors.length === 0;
	if (videoDemo && !beforeDemo) {
		result.senderPolicies = await page.evaluate(() => window.senderPolicies);
		const senders =
			result.senderPolicies?.flatMap((peer) => peer.senders) ?? [];
		const cameras = senders.filter((sender) => sender.kind === "video");
		const audio = senders.filter((sender) => sender.kind === "audio");
		result.checks.productionCameraPolicy =
			cameras.length === 4 &&
			cameras.every(
				(sender) =>
					sender.hint === "motion" &&
					sender.parameters?.degradationPreference === "maintain-framerate" &&
					sender.parameters.encodings?.length === 3 &&
					sender.parameters.encodings[0].maxBitrate <= 150000 &&
					sender.parameters.encodings.every(
						(encoding) =>
							encoding.priority === "low" && encoding.networkPriority === "low",
					),
			);
		result.checks.productionAudioPriority =
			audio.length === 1 &&
			audio[0].parameters?.encodings?.[0]?.priority === "high" &&
			audio[0].parameters.encodings[0].networkPriority === "high";
	}
	result.passed = Object.values(result.checks).every(Boolean);
	if (!result.passed) process.exitCode = 1;
	result.events = await page.evaluate(() => window.networkEvents ?? []);
	console.log("CHECKS", result.checks);
	await page.evaluate(() => window.cameraCheck.stop());
	await sleep(1000);
	result.cleanup = await resources();
	assert(result.cleanup.includes('meet_sfu_resources{resource="consumers"} 0'));
	assert(result.cleanup.includes('meet_sfu_resources{resource="producers"} 0'));
	await writeFile(output + "/result.json", JSON.stringify(result, null, 2));
	console.log("PASS cleanup", result.cleanup);
} catch (e) {
	if (!result) result = { scope: "startup failure", windows: [] };
	if (result) {
		result.failure = { message: e.message, code: e.code };
		result.passed = false;
		await writeFile(output + "/result.json", JSON.stringify(result, null, 2));
	}
	console.error(e);
	console.error(logs.slice(-3000));
	process.exitCode = 1;
} finally {
	if (page)
		await page.evaluate(() => window.cameraCheck?.stop()).catch(() => {});
	if (result) {
		await sleep(1000);
		result.finalResources = await resources().catch(() => null);
		await writeFile(output + "/result.json", JSON.stringify(result, null, 2));
	}
	const recordedVideo = videoDemo ? page?.video() : null;
	if (recordedVideo) {
		await page.close();
		await recordedVideo.saveAs(output + "/meet-full-call.webm");
	}
	await browser?.close();
	await relay.close();
	await vite?.close();
	server.kill("SIGTERM");
	await writeFile(output + "/server.log", logs);
	await Promise.race([new Promise((r) => server.once("exit", r)), sleep(3000)]);
	if (server.exitCode === null) server.kill("SIGKILL");
}
