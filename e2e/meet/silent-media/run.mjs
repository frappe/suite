import { createServer } from "vite";
import {
	chromium,
	firefox,
} from "../../node_modules/@playwright/test/index.mjs";
import { fork } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
const root = resolve(import.meta.dirname, "../../..");
const secret = randomBytes(32).toString("hex");
const port = 44317,
	webPort = 44318;
const localAddress = Object.values(networkInterfaces())
	.flat()
	.find((address) => address.family === "IPv4" && !address.internal)?.address;
assert(localAddress, "A local IPv4 interface is required for Firefox ICE");
const server = fork(resolve(import.meta.dirname, "server.cjs"), [], {
	cwd: resolve(root, "suite/meet/sfu-server"),
	env: {
		...process.env,
		TS_NODE_TRANSPILE_ONLY: "1",
		NODE_ENV: "test",
		JWT_SECRET: secret,
		HOST: "127.0.0.1",
		PORT: String(port),
		WEBRTC_LISTEN_IP: localAddress,
		WEBRTC_ANNOUNCED_IP: localAddress,
		WEBRTC_SERVER_PORT: "44319",
		MEDIASOUP_NUM_WORKERS: "1",
		SFU_LOG_LEVEL: "error",
	},
	stdio: ["ignore", "pipe", "pipe", "ipc"],
});
server.stdout.on("data", (data) => process.stderr.write(data));
server.stderr.on("data", (data) => process.stderr.write(data));
const vite = await createServer({
	root: import.meta.dirname,
	configFile: false,
	resolve: {
		alias: {
			"@": resolve(root, "frontend/src"),
			"frappe-ui": resolve(root, "frontend/recorder/frappeUi.ts"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: webPort,
		strictPort: true,
		hmr: false,
		watch: null,
		fs: { allow: [root] },
	},
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function token(id, room) {
	const encode = (value) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const body =
		encode({ alg: "HS256", typ: "JWT" }) +
		"." +
		encode({
			user_id: id,
			user_name: id,
			meeting_id: room,
			site: "silent.test",
			scope: "full",
			is_host: false,
			is_cohost: false,
			is_guest: false,
			e2ee_required: false,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 600,
		});
	return (
		body + "." + createHmac("sha256", secret).update(body).digest("base64url")
	);
}
async function wait(check, timeout = 20000) {
	const start = Date.now();
	do {
		if (await check()) return;
		await sleep(200);
	} while (Date.now() - start < timeout);
	throw Error("Condition timed out");
}
function rows(observation) {
	return observation.sample.streams.map((stream) => {
		const reports = stream.reports.filter(
			(row) =>
				row.type ===
				(stream.direction === "send" ? "outbound-rtp" : "inbound-rtp"),
		);
		const rtp = reports[0];
		const bytes = reports.length
			? reports.reduce(
					(total, row) => total + (row.bytesSent ?? row.bytesReceived ?? 0),
					0,
				)
			: undefined;
		const packets = reports.length
			? reports.reduce(
					(total, row) => total + (row.packetsSent ?? row.packetsReceived ?? 0),
					0,
				)
			: undefined;
		return {
			id: stream.id,
			producerId: stream.producerId,
			direction: stream.direction,
			kind: stream.kind,
			participantId: stream.participantId,
			receiveEpoch: observation.receiveEpoch,
			bytes,
			packets,
			energy: rtp?.totalAudioEnergy,
			frames: rtp?.framesDecoded,
		};
	});
}
async function sample(pages) {
	return Promise.all(
		pages.map(async (page) =>
			rows(
				await page.evaluate(async () => {
					const deadline = Date.now() + 1500;
					do {
						const epoch = window.nativeReceiveEpoch ?? 0;
						if (!window.nativeReceivePending) {
							const observation = await window.fixture.sample();
							const missing = observation.sample.streams.some(
								(stream) =>
									stream.direction === "receive" &&
									!stream.reports.some(
										(row) =>
											row.type === "inbound-rtp" && row.bytesReceived > 0,
									),
							);
							if (
								!window.nativeReceivePending &&
								epoch === (window.nativeReceiveEpoch ?? 0) &&
								!(
									missing &&
									Date.now() - (window.nativeReceiveAnsweredAt ?? 0) < 1500
								)
							)
								return { ...observation, receiveEpoch: epoch };
						}
						await new Promise((resolve) => setTimeout(resolve, 20));
					} while (Date.now() < deadline);
					throw Error("Receive stats did not settle within 1500ms");
				}),
			),
		),
	);
}
function progress(before, after, excluded = new Set()) {
	for (let peer = 0; peer < before.length; peer++)
		for (const row of before[peer]) {
			if (excluded.has(row.id)) continue;
			const next = after[peer].find((value) => value.id === row.id);
			assert(next, `Missing unaffected path ${peer}/${row.id}`);
			if (next.bytes < row.bytes && row.direction === "receive") {
				assert(
					next.receiveEpoch > row.receiveEpoch,
					"Counter reset outside an SDP epoch",
				);
				assert(
					next.bytes > 0 && next.packets > 0,
					"No positive RTP after completed SDP answer",
				);
			} else
				assert(
					next.bytes > row.bytes,
					`Unaffected path stopped ${peer}/${row.id}: ${row.bytes} -> ${next.bytes}`,
				);
		}
}
let browser;
try {
	await vite.listen();
	await wait(async () => {
		try {
			return (await fetch(`http://127.0.0.1:${port}/health`)).ok;
		} catch {
			return false;
		}
	});
	const browserName = process.env.MEET_BROWSER || "chromium";
	browser = await { chromium, firefox }[browserName].launch({
		headless: true,
		args:
			browserName === "chromium"
				? ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"]
				: [],
		firefoxUserPrefs: {
			"media.autoplay.default": 0,
			"media.autoplay.block-webaudio": false,
			"media.peerconnection.ice.loopback": true,
			"media.peerconnection.ice.obfuscate_host_addresses": false,
		},
	});
	const context = await browser.newContext();
	const pages = [],
		room = `silent-${Date.now()}`;
	for (const id of ["speaker", "listener", "control"]) {
		const page = await context.newPage();
		pages.push(page);
		page.on("pageerror", (error) => console.error("PAGE", error));
		await page.addInitScript(() => {
			const remote = RTCPeerConnection.prototype.setRemoteDescription;
			const local = RTCPeerConnection.prototype.setLocalDescription;
			const pending = new Set();
			window.nativePeers = [];
			RTCPeerConnection.prototype.setRemoteDescription = async function (
				description,
			) {
				if (!window.nativePeers.includes(this)) window.nativePeers.push(this);
				if (description?.type === "offer") {
					pending.add(this);
					window.nativeReceivePending = pending.size;
				}
				try {
					return await remote.call(this, description);
				} catch (error) {
					pending.delete(this);
					window.nativeReceivePending = pending.size;
					throw error;
				}
			};
			RTCPeerConnection.prototype.setLocalDescription = async function (
				description,
			) {
				const result = await local.call(this, description);
				if (pending.delete(this)) {
					window.nativeReceiveEpoch = (window.nativeReceiveEpoch ?? 0) + 1;
					window.nativeReceiveAnsweredAt = Date.now();
					window.nativeReceivePending = pending.size;
				}
				return result;
			};
		});
		await page.goto(`http://127.0.0.1:${webPort}`);
		await page.waitForFunction(() => Boolean(window.fixture));
		await page.evaluate((config) => window.fixture.configure(config), {
			id,
			room,
			token: token(id, room),
			url: `http://127.0.0.1:${port}`,
			video: Boolean(process.env.MEET_RECEIVE_TRANSPORT),
		});
		await page.click("#start");
		await wait(async () => {
			const state = await page.evaluate(() => window.fixture.status());
			if (state.failure) throw Error(state.failure);
			return state.ready;
		});
	}
	if (process.env.MEET_RECEIVE_TRANSPORT)
		for (const page of pages)
			await page.evaluate(() => window.fixture.demand());
	await sleep(4000);
	console.log("INITIAL", JSON.stringify(await sample(pages)));
	await wait(async () =>
		(await sample(pages)).every(
			(streams) =>
				streams.filter(
					(row) =>
						row.direction === "receive" &&
						row.kind === "audio" &&
						row.bytes > 0,
				).length === 2,
		),
	);
	await sleep(7000);
	for (const control of process.env.MEET_ESCALATE ||
	process.env.MEET_RECEIVE_TRANSPORT
		? []
		: ["muted", "silent", "pause"]) {
		await pages[0].evaluate((name) => window.fixture[name](true), control);
		await sleep(10000);
		const reports = await Promise.all(
			pages.map((page) => page.evaluate(() => window.fixture.diagnostics())),
		);
		for (const report of reports)
			assert.equal(
				(report.audioHealth?.events ?? []).length,
				0,
				`${control} triggered repair`,
			);
		const report = reports[0];
		console.log(
			JSON.stringify({
				browser: browserName,
				control,
				events: report.audioHealth?.events ?? [],
			}),
		);
		await pages[0].evaluate((name) => window.fixture[name](false), control);
		await sleep(4000);
	}
	if (process.env.MEET_RECEIVE_TRANSPORT) {
		await wait(async () =>
			(await sample(pages)).every(
				(rows) => rows.length === 6 && rows.every((row) => row.bytes > 0),
			),
		);
		let last = await sample(pages);
		const originals = last[1].filter((row) => row.direction === "receive");
		const reply = once(server, "message");
		server.send({ id: originals[0].id, transport: true });
		assert.equal((await reply)[0].success, true);
		const started = Date.now();
		let frozen = false,
			repaired = false;
		while (Date.now() - started < 55000 && !repaired) {
			await sleep(1000);
			const next = await sample(pages);
			progress(
				last,
				next,
				new Set(
					last[1]
						.filter((row) => row.direction === "receive")
						.map((row) => row.id),
				),
			);
			const current = next[1].filter((row) => row.direction === "receive");
			frozen ||= originals.every((original) => {
				const previous = last[1].find((row) => row.id === original.id);
				const row = current.find((row) => row.id === original.id);
				return row && previous && row.bytes === previous.bytes;
			});
			repaired =
				frozen &&
				current.length === 4 &&
				originals.every((original) =>
					current.some(
						(row) =>
							row.producerId === original.producerId &&
							row.id !== original.id &&
							row.bytes > 0 &&
							(row.kind === "video" ? row.frames > 0 : row.energy > 0),
					),
				);
			console.log(
				JSON.stringify({
					browser: browserName,
					fault: "receive-transport",
					ms: Date.now() - started,
					rows: next,
				}),
			);
			last = next;
		}
		assert(frozen, "Shared receive impairment did not stop RTP");
		assert(repaired, "Shared audio/video receive transport did not recover");
		for (let i = 0; i < 3; i++) {
			await sleep(1000);
			const next = await sample(pages);
			progress(last, next);
			last = next;
		}
		console.log(
			`PASS ${browserName} shared receive transport audio/video recovery`,
		);
	} else {
		// Native sender detachment: capture remains live and energetic.
		let before = await sample(pages);
		const sender = before[0].find(
			(row) => row.direction === "send" && row.kind === "audio",
		);
		const senderIdentity = await pages[0].evaluate(() =>
			window.fixture.senderIdentity(),
		);
		const affected = (samples) =>
			new Set([
				...samples[0]
					.filter((row) => row.direction === "send")
					.map((row) => row.id),
				...samples
					.slice(1)
					.flatMap((streams) =>
						streams
							.filter((row) => row.participantId === "speaker")
							.map((row) => row.id),
					),
			]);
		await pages[0].evaluate(
			(escalate) => window.fixture.detach(escalate),
			Boolean(process.env.MEET_ESCALATE),
		);
		const started = Date.now();
		let repaired = false,
			frozen = false,
			last = before;
		while (Date.now() - started < 25000 && !repaired) {
			await sleep(1000);
			const next = await sample(pages);
			progress(last, next, affected(last));
			const old = last[1].find((row) => row.participantId === "speaker"),
				current = next[1].find((row) => row.participantId === "speaker");
			if (current?.bytes === old?.bytes && current?.energy === old?.energy)
				frozen = true;
			repaired =
				frozen &&
				(current?.id !== old?.id
					? current?.bytes > 0 && current?.energy > 0
					: current?.bytes > old?.bytes && current?.energy > old?.energy);
			console.log(
				JSON.stringify({
					browser: browserName,
					fault: "sender",
					ms: Date.now() - started,
					rows: next,
				}),
			);
			last = next;
		}
		assert(frozen, "Sender impairment never stopped observed audio RTP");
		assert(repaired, "Sender audio RTP/energy did not recover");
		const senderRepairMs = Date.now() - started;
		const senderHealth = (
			await pages[0].evaluate(() => window.fixture.diagnostics())
		).audioHealth;
		assert.equal(
			(await pages[0].evaluate(() => window.fixture.senderIdentity())).trackId,
			senderIdentity.trackId,
			"Repair replaced the captured track",
		);
		if (process.env.MEET_ESCALATE)
			assert.deepEqual(
				senderHealth.events
					.filter((event) => event.id === "send:microphone")
					.map((event) => event.action),
				["reattach", "restart-send-ice", "republish"],
			);
		console.log(
			JSON.stringify({
				browser: browserName,
				escalation: Boolean(process.env.MEET_ESCALATE),
				senderDetectionMs:
					senderHealth.events.find((event) => event.action === "reattach").at -
					started,
				senderRepairMs,
				health: senderHealth,
			}),
		);
		for (let i = 0; i < 3; i++) {
			await sleep(1000);
			const next = await sample(pages);
			progress(last, next);
			console.log(
				JSON.stringify({
					browser: browserName,
					postSenderWindow: i + 1,
					rows: next,
				}),
			);
			last = next;
		}
		// Pause one native server Consumer; capture/ingress and every other path continue.
		const target = last[1].find((row) => row.participantId === "speaker");
		const reply = once(server, "message");
		server.send({ id: target.id });
		assert.equal((await reply)[0].success, true);
		const receiveStarted = Date.now();
		frozen = false;
		repaired = false;
		while (Date.now() - receiveStarted < 30000 && !repaired) {
			await sleep(1000);
			const next = await sample(pages);
			progress(last, next, new Set([target.id]));
			const old = last[1].find((row) => row.participantId === "speaker"),
				current = next[1].find((row) => row.participantId === "speaker");
			if (
				current?.id === target.id &&
				current.bytes === old?.bytes &&
				current.energy === old?.energy
			)
				frozen = true;
			repaired =
				frozen &&
				current?.id !== target.id &&
				current?.bytes > 0 &&
				current?.energy > 0;
			console.log(
				JSON.stringify({
					browser: browserName,
					fault: "receive",
					ms: Date.now() - receiveStarted,
					rows: next,
				}),
			);
			last = next;
		}
		assert(frozen, "Native Consumer pause never stopped RTP");
		assert(repaired, "Consumer audio RTP/energy did not recover");
		const receiveRepairMs = Date.now() - receiveStarted;
		const receiveHealth = (
			await pages[1].evaluate(() => window.fixture.diagnostics())
		).audioHealth;
		console.log(
			JSON.stringify({
				browser: browserName,
				receiveDetectionMs:
					receiveHealth.events.find(
						(event) => event.action === "recreate-consumer",
					).at - receiveStarted,
				receiveRepairMs,
				health: receiveHealth,
			}),
		);
		for (let i = 0; i < 3; i++) {
			await sleep(1000);
			const next = await sample(pages);
			progress(last, next);
			console.log(
				JSON.stringify({
					browser: browserName,
					postReceiveWindow: i + 1,
					rows: next,
				}),
			);
			last = next;
		}
	}

	for (const page of pages) await page.evaluate(() => window.fixture.stop());
	console.log(`PASS ${browserName} silent-media real faults and controls`);
} catch (error) {
	for (const context of browser?.contexts() ?? [])
		for (const page of context.pages()) {
			try {
				console.error(
					"NATIVE_FAILURE",
					JSON.stringify(
						await page.evaluate(async () =>
							Promise.all(
								(window.nativePeers ?? []).map(async (pc) => ({
									connection: pc.connectionState,
									ice: pc.iceConnectionState,
									gathering: pc.iceGatheringState,
									reports: [...(await pc.getStats()).values()].filter((row) =>
										[
											"candidate-pair",
											"local-candidate",
											"remote-candidate",
										].includes(row.type),
									),
								})),
							),
						),
					),
				);
			} catch {}
		}
	throw error;
} finally {
	await browser?.close();
	await vite.close();
	server.kill("SIGTERM");
	await Promise.race([once(server, "exit"), sleep(5000)]);
}
