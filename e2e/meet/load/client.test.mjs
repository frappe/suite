import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(await readFile(new URL("client.ts", import.meta.url), "utf8"), {
	compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const protocol = {};
vm.runInNewContext(
	ts.transpileModule(
		await readFile(
			new URL("../../../suite/meet/types/participantMedia.ts", import.meta.url),
			"utf8",
		),
		{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
	).outputText,
	{ exports: protocol },
);

// Independent expectations for the offline admission stage, not copied from its implementation.
const expectedCapabilities = {
	participantMediaProtocolVersion: 1,
	participantCeiling: 18,
	videoConsumerCeiling: 20,
	capacityProfileVersion: null,
	qualified150: false,
	admissionEnforced: false,
	boundedVideoSubscriptions: false,
	routerPool: false,
	e2eeRequired: false,
	attachmentQueue: {
		concurrency: 4,
		maxDepth: 256,
		operationTimeoutMs: 4000,
		deadlineMs: 10000,
		retryCount: 2,
		retryDelayMs: 250,
	},
	consumerCreateQueue: { concurrency: 8, maxQueueDepth: 512, operationTimeoutMs: 4000 },
	queueConfigurationQualified: false,
};

const mismatch = {
	code: "MEDIA_PROTOCOL_VERSION_MISMATCH",
	supportedParticipantMediaProtocolVersion: 1,
	message: "opaque protocol secret",
	action: "retry",
	retryable: true,
};

function client({
	rejectJoin = false,
	rejectLeave = false,
	missingJoin = false,
	authRejection,
	joinRejection,
	mediaCapabilities = expectedCapabilities,
	sharedProtocol = protocol,
	enforceAt = "auth",
	clock = { now: () => Date.now() },
	withAudio = false,
} = {}) {
	const calls = [];
	const timers = new Map();
	const mediaTracks = [];
	const gains = [];
	let audioClosed = false;
	const track = () => {
		const value = { kind: "audio", enabled: true, readyState: "live", stopped: false, getSettings: () => ({}), stop() { this.stopped = true; this.readyState = "ended"; } };
		mediaTracks.push(value);
		return value;
	};
	class MediaStream {
		constructor(tracks = []) { this.tracks = tracks; }
		getTracks() { return [...this.tracks]; }
		getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
	}
	class AudioContext {
		state = "running";
		createMediaStreamSource() { return { connect: (node) => node, disconnect() {} }; }
		createGain() {
			const node = { gain: { value: 1 }, connect() {}, disconnect() {} };
			gains.push(node);
			return node;
		}
		createMediaStreamDestination() { return { stream: new MediaStream([track()]) }; }
		async resume() {}
		async close() { audioClosed = true; this.state = "closed"; }
	}
	const payloads = [];
	let socketOptions;
	const handlers = {};
	let serverRevision = -1;
	const serverSelected = new Set();
	const serverConsumers = new Set();
	const reports = new Map([
		[
			"one",
			{
				id: "one",
				type: "inbound-rtp",
				ssrc: 11,
				bytesReceived: 100,
				packetsReceived: 10,
				framesDecoded: 2,
			},
		],
		[
			"duplicate",
			{
				id: "duplicate",
				type: "inbound-rtp",
				ssrc: 11,
				bytesReceived: 100,
				packetsReceived: 10,
				framesDecoded: 2,
			},
		],
		[
			"two",
			{
				id: "two",
				type: "inbound-rtp",
				ssrc: 22,
				bytesReceived: 900,
				packetsReceived: 90,
				framesDecoded: 20,
			},
		],
		[
			"repair",
			{ id: "repair", type: "inbound-rtp", ssrc: 33, bytesReceived: 50, packetsReceived: 5 },
		],
		[
			"audio",
			{
				id: "audio",
				type: "inbound-rtp",
				ssrc: 44,
				bytesReceived: 50,
				packetsReceived: 5,
			},
		],
	]);
	const socket = {
		connected: true,
		on(event, callback) {
			handlers[event] = callback;
		},
		once(event, callback) {
			if (event === "connect") this.connectCallback = callback;
			if (event === "connect_error") this.errorCallback = callback;
		},
		connect() {
			const data =
				authRejection ||
				(enforceAt === "auth" && socketOptions.auth.participantMediaProtocolVersion !== 1
					? mismatch
					: null);
			if (data) {
				this.connected = false;
				return this.errorCallback(Object.assign(new Error("opaque protocol secret"), { data }));
			}
			this.connectCallback();
		},
		disconnect() {
			this.connected = false;
		},
		timeout() {
			return this;
		},
		emit(event, data, callback) {
			calls.push(event);
			payloads.push({ event, data });
			const response = { success: true };
			if (event === "join_room" && missingJoin) return callback(null, undefined);
			if (event === "join_room") {
				response.mediaCapabilities = mediaCapabilities;
				const rejection =
					joinRejection || (data.participantMediaProtocolVersion !== 1 ? mismatch : null);
				if (rejection) return callback(null, { success: false, ...rejection });
			}
			if ((event === "join_room" && rejectJoin) || (event === "leave_room" && rejectLeave))
				Object.assign(response, { success: false, error: "opaque protocol secret" });
			if (event === "get_existing_producers")
				response.producers = [
					{ producerId: "a", participantId: "other", kind: "video" },
					{ producerId: "b", participantId: "other", kind: "video" },
					...(withAudio
						? [{ producerId: "audio-1", participantId: "other", kind: "audio" }]
						: []),
				];
			if (event === "video:set_selection") {
				const ids = data.producerIds;
				const valid =
					Array.isArray(ids) &&
					ids.length <= 16 &&
					new Set(ids).size === ids.length &&
					ids.every((id) => typeof id === "string" && id.length > 0);
				if (!valid || !Number.isSafeInteger(data.revision) || data.revision < 0)
					return callback(null, { success: false, error: "Invalid selected video set" });
				serverRevision = data.revision;
				serverSelected.clear();
				for (const id of ids) serverSelected.add(id);
				Object.assign(response, {
					revision: serverRevision,
					// Retention is server-owned; tests explicitly supply closure evidence.
					retainedConsumerIds: [...serverConsumers],
				});
				return callback(null, response);
			}
			if (event === "create_consumer") {
				const audio = data.producerId === "audio-1";
				if (!audio && !serverSelected.has(data.producerId))
					return callback(null, { success: false, code: "VIDEO_CONSUMER_LIMIT" });
				serverConsumers.add(data.producerId);
				Object.assign(response, {
					id: data.producerId,
					producerId: data.producerId,
					kind: audio ? "audio" : "video",
					rtpParameters: audio
						? {
							codecs: [{ mimeType: "audio/opus" }],
							encodings: [{ ssrc: 44 }],
						}
						: {
							codecs: [{ mimeType: "video/VP9" }],
							encodings: [{ ssrc: data.producerId === "a" ? 11 : 22, rtx: { ssrc: 33 } }],
						},
				});
				return callback(null, response);
			}
			if (event === "close_consumer") {
				if (data.selectionRevision !== serverRevision)
					return callback(null, { success: false, error: "Stale consumer close" });
				serverConsumers.delete(data.consumerId);
				return callback(null, response);
			}
			if (event === "consumer:update_preferences") {
				if (!serverSelected.has(data.consumerId))
					return callback(null, { success: false, error: "Consumer is no longer selected" });
				return callback(null, response);
			}
			callback(null, response);
		},
	};
	class Device {
		rtpCapabilities = { codecs: [{ mimeType: "audio/opus" }] };
		createSendTransport() {
			return {
				on() {}, close() {},
				async produce(options) {
					return { id: "local", kind: "audio", track: options.track, paused: false,
						rtpParameters: { codecs: [{ mimeType: "audio/opus" }] }, getStats: async () => new Map(), close() {} };
				},
			};
		}
		async load() {
			this.loaded = true;
		}
		createRecvTransport() {
			return {
				on() {},
				close() {},
				async consume(response) {
					return {
						...response,
						paused: false,
						closed: false,
						track: { getSettings: () => ({}) },
						getStats: async () => reports,
						close() {
							this.closed = true;
						},
					};
				},
			};
		}
	}
	let timerId = 0;
	const window = {
		setTimeout: (fn, ms) => {
			const id = ++timerId;
			timers.set(id, { fn, ms });
			return id;
		},
		clearTimeout: (id) => timers.delete(id),
		setInterval: (fn, ms) => {
			const id = ++timerId;
			timers.set(id, { fn, ms });
			return id;
		},
		clearInterval: (id) => timers.delete(id),
	};
	vm.runInNewContext(compiled, {
		exports: {},
		window,
		performance,
		URL,
		Date: class extends Date { static now() { return clock.now(); } },
		MediaStream,
		AudioContext,
		navigator: { mediaDevices: { getUserMedia: async () => new MediaStream([track()]) } },
		require: (name) => {
			if (name === "mediasoup-client") return { Device };
			if (name === "socket.io-client")
				return {
					io: (_, options) => {
						socketOptions = options;
						return socket;
					},
				};
			if (name === "../../../suite/meet/types/participantMedia") return sharedProtocol;
			if (name === "../../../frontend/src/apps/meet/utils/media/encodings")
				return { svcEncodingTemplate: () => [] };
			throw new Error(`Unexpected client import: ${name}`);
		},
	});
	return {
		api: window.meetLoad,
		calls,
		payloads,
		serverConsumers,
		handlers,
		timers, mediaTracks, gains,
		get audioClosed() { return audioClosed; },
		get socketOptions() {
			return socketOptions;
		},
		config: {
			sfuUrl: "http://127.0.0.1",
			media: "none",
			consume: "all",
			userId: "me",
			videoCodec: "VP9",
			scalabilityMode: "L3T1_KEY",
		},
	};
}

test("client counts each negotiated primary SSRC once, never another source or RTX", async () => {
	const { api, config } = client();
	const status = await api.start(config);
	assert.equal(status.sources[0].bytes, 100);
	assert.equal(status.sources[0].packets, 10);
	assert.equal(status.sources[0].rtpReports.length, 1);
	assert.equal(status.sources[1].bytes, 900);
	assert.equal(status.bytesReceived, 1000);
	await api.stop();
});

test("three talkers rotate one gain window without pausing or disabling allocated audio; cleanup drains handles", async () => {
	const expected = [[1, 0, 0, 1], [0, 1, 0, 0], [0, 0, 1, 0]];
	for (let index = 0; index < 3; index++) {
		let now = 10000;
		const c = client({ clock: { now: () => now } });
		await c.api.start({ ...c.config, media: "audio", consume: "none",
			talkers: { index, count: 3, active: 1, periodMs: 5000, epoch: 10000 } });
		const observed = [c.gains[0].gain.value];
		for (const at of [15000, 20000, 25000]) {
			now = at;
			[...c.timers.values()].find((t) => t.ms === 100).fn();
			observed.push(c.gains[0].gain.value);
		}
		assert.deepEqual(observed, expected[index]);
		const status = await c.api.status();
		assert.equal(status.sources[0].paused, false);
		assert.equal(status.sources[0].trackEnabled, true);
		assert.equal(c.mediaTracks.length, 2);
		assert.equal((await c.api.stop()).localMediaReleased, true);
		assert.ok(c.mediaTracks.every((t) => t.stopped));
		assert.equal(c.audioClosed, true);
		assert.equal(c.timers.size, 0);
	}
});

test("default all talkers uses original track; invalid controls fail before auth", async () => {
	const c = client();
	await c.api.start({ ...c.config, media: "audio", consume: "none" });
	assert.equal(c.gains.length, 0);
	assert.equal((await c.api.status()).sources[0].audioGain, 1);
	await c.api.stop();
	for (const change of [{ active: 3 }, { active: -1 }, { active: 0.5 }, { periodMs: 0 }, { count: 25 }, { index: 2 }]) {
		const c = client();
		await assert.rejects(c.api.start({ ...c.config, media: "audio",
			talkers: { index: 0, count: 2, active: 1, periodMs: 5000, epoch: 0, ...change } }));
		assert.deepEqual(c.calls, []);
	}
});

test("zero active talkers stays silent and a two-of-three window wraps", async () => {
	for (const [active, expected] of [[0, [0, 0, 0, 0]], [2, [1, 0, 1, 1]]]) {
		let now = 0;
		const c = client({ clock: { now: () => now } });
		await c.api.start({ ...c.config, media: "audio", consume: "none",
			talkers: { index: 0, count: 3, active, periodMs: 5000, epoch: 0 } });
		const observed = [c.gains[0].gain.value];
		for (const at of [5000, 10000, 15000]) {
			now = at;
			[...c.timers.values()].find((t) => t.ms === 100).fn();
			observed.push(c.gains[0].gain.value);
		}
		assert.deepEqual(observed, expected);
		await c.api.stop();
	}
});

test("rejected join leaves no acknowledgment obligation and does not retain server errors", async () => {
	const { api, calls, config } = client({ rejectJoin: true });
	await assert.rejects(api.start(config));
	const status = await api.status();
	assert.ok(!JSON.stringify(status).includes("opaque protocol secret"));
	const stopped = await api.stop();
	assert.equal(stopped.joined, false);
	assert.ok(!calls.includes("leave_room"));
});

test("explicit cleanup rejection is distinguishable from unavailable acknowledgment", async () => {
	const { api, config } = client({ rejectLeave: true });
	await api.start(config);
	const stopped = await api.stop();
	assert.equal(stopped.joined, true);
	assert.equal(stopped.acknowledged, false);
	assert.equal(stopped.rejected, true);
});

test("a missing join acknowledgment leaves admission unknown even after a leave acknowledgment", async () => {
	const { api, config } = client({ missingJoin: true });
	await assert.rejects(api.start(config));
	const stopped = await api.stop();
	assert.equal(stopped.joined, null);
	assert.equal(stopped.acknowledged, true);
});

test("shared version 1 is sent in auth and join, and safe capabilities are retained", async () => {
	const c = client({
		mediaCapabilities: {
			...expectedCapabilities,
			token: "opaque protocol secret",
			diagnostic: "opaque protocol secret",
			attachmentQueue: {
				...expectedCapabilities.attachmentQueue,
				diagnostic: "opaque protocol secret",
			},
		},
	});
	const status = await c.api.start(c.config);
	assert.equal(c.socketOptions.auth.participantMediaProtocolVersion, 1);
	assert.equal(c.socketOptions.reconnection, false);
	assert.equal(
		c.payloads.find((p) => p.event === "join_room").data.participantMediaProtocolVersion,
		1,
	);
	assert.equal(status.participantMediaProtocolVersion, 1);
	assert.deepEqual(JSON.parse(JSON.stringify(status.mediaCapabilities)), expectedCapabilities);
	assert.equal(status.admissionInvalid, false);
	assert.ok(!JSON.stringify(status).includes("opaque protocol secret"));
	await c.api.stop();
});

for (const seam of ["auth", "join"])
	for (const version of [undefined, 0, 2])
		test(`${seam} rejects missing/old/future version ${version} terminally without fallback`, async () => {
			const c = client({
				sharedProtocol: { ...protocol, PARTICIPANT_MEDIA_PROTOCOL_VERSION: version },
				enforceAt: seam,
			});
			await assert.rejects(c.api.start(c.config));
			await assert.rejects(c.api.start(c.config), /already started/);
			const status = await c.api.status();
			assert.equal(status.phase, "failed");
			assert.equal(status.admissionInvalid, true);
			assert.equal(status.rejections.length, 1);
			assert.equal(status.rejections[0].code, "MEDIA_PROTOCOL_VERSION_MISMATCH");
			assert.equal("action" in status.rejections[0], false);
			assert.equal("retryable" in status.rejections[0], false);
			assert.equal(status.rejections[0].supportedParticipantMediaProtocolVersion, 1);
			assert.deepEqual(c.calls, seam === "auth" ? [] : ["join_room"]);
			assert.ok(!JSON.stringify(status).includes("opaque protocol secret"));
			await c.api.stop();
		});

test("safe rejection codes are finite and supported versions cannot carry strings or nonfinite values", async () => {
	for (const supported of ["opaque protocol secret", Infinity, NaN, -1, 1.5]) {
		const c = client({
			authRejection: { ...mismatch, supportedParticipantMediaProtocolVersion: supported },
		});
		await assert.rejects(c.api.start(c.config));
		assert.equal(
			(await c.api.status()).rejections[0].supportedParticipantMediaProtocolVersion,
			null,
		);
		await c.api.stop();
	}
	for (const code of [
		"ROOM_FULL",
		"MEDIA_CAPACITY_UNAVAILABLE",
		"VIDEO_CONSUMER_LIMIT",
		"PARTICIPANT_CONNECTION_CONFLICT",
		"opaque protocol secret",
		"__proto__",
	]) {
		const c = client({ joinRejection: { code, diagnostic: "opaque protocol secret" } });
		await assert.rejects(c.api.start(c.config));
		const status = await c.api.status();
		assert.equal(
			status.rejections[0].code,
			["opaque protocol secret", "__proto__"].includes(code) ? "UNKNOWN_REJECTION" : code,
		);
		assert.equal(status.admissionInvalid, false);
		assert.ok(!JSON.stringify(status).includes("opaque protocol secret"));
		await c.api.stop();
	}
});

test("missing, incompatible or unsafe capability evidence stops before media allocation but still leaves", async () => {
	for (const mediaCapabilities of [
		null,
		{ ...expectedCapabilities, qualified150: true },
		{ ...expectedCapabilities, participantMediaProtocolVersion: 2 },
		{ ...expectedCapabilities, participantCeiling: Infinity },
		{ ...expectedCapabilities, videoConsumerCeiling: "opaque protocol secret" },
		{ ...expectedCapabilities, capacityProfileVersion: "opaque protocol secret" },
		{ ...expectedCapabilities, attachmentQueue: null },
		{
			...expectedCapabilities,
			consumerCreateQueue: { ...expectedCapabilities.consumerCreateQueue, concurrency: Infinity },
		},
		{
			...expectedCapabilities,
			attachmentQueue: { ...expectedCapabilities.attachmentQueue, retryCount: -1 },
		},
		{ ...expectedCapabilities, queueConfigurationQualified: true },
	]) {
		const c = client({ mediaCapabilities });
		await assert.rejects(c.api.start(c.config));
		const status = await c.api.status();
		assert.equal(status.admissionInvalid, true);
		assert.deepEqual(c.calls, ["join_room"]);
		assert.ok(!JSON.stringify(status).includes("opaque protocol secret"));
		const stopped = await c.api.stop();
		assert.equal(stopped.joined, true);
		assert.equal(stopped.acknowledged, true);
	}
});

test("concurrent remote videos are selected cumulatively before creation and resumed after attachment", async () => {
	const c = client();
	await c.api.start(c.config);
	const selections = c.payloads.filter((p) => p.event === "video:set_selection");
	assert.deepEqual(JSON.parse(JSON.stringify(selections.map((p) => p.data))), [
		{ revision: 1, producerIds: ["a"] },
		{ revision: 2, producerIds: ["a", "b"] },
	]);
	for (const id of ["a", "b"]) {
		const selected = c.payloads.findIndex(
			(p) => p.event === "video:set_selection" && p.data.producerIds.includes(id),
		);
		const created = c.payloads.findIndex(
			(p) => p.event === "create_consumer" && p.data.producerId === id,
		);
		const resumed = c.payloads.findIndex(
			(p) =>
				p.event === "consumer:update_preferences" &&
				p.data.consumerId === id &&
				p.data.visible === true,
		);
		assert.ok(selected >= 0 && selected < created && created < resumed);
	}
	await c.api.stop();
});

test("bounded churn alternates a one-video budget, keeps audio, and stays bounded", async () => {
	const c = client({ withAudio: true });
	await c.api.start(c.config);
	let status = await c.api.status();
	assert.deepEqual(JSON.parse(JSON.stringify(status.selectedVideos)), ["a", "b"]);
	assert.equal(status.consumerCount, 3);
	const audioBefore = status.sources.find((s) => s.kind === "audio");
	assert.ok(audioBefore);

	await c.api.setSelection(["a"]);
	status = await c.api.status();
	assert.deepEqual(JSON.parse(JSON.stringify(status.selectedVideos)), ["a"]);
	assert.equal(status.selectionRevision, 3);
	assert.equal(status.acknowledgedRevision, 3);
	// Deselected video stays local until server evidence; audio is never touched.
	assert.equal(status.consumerCount, 3);
	assert.equal(status.warmVideoCount, 1);
	assert.ok(status.sources.some((s) => s.producerId === "a" && s.kind === "video"));
	assert.ok(status.sources.some((s) => s.producerId === "b" && s.kind === "video"));
	assert.ok(status.sources.some((s) => s.producerId === "audio-1" && s.kind === "audio"));
	assert.equal(c.payloads.filter((p) => p.event === "close_consumer").length, 0);

	assert.ok(![...c.timers.values()].some((t) => t.ms === 5000));
	// An acknowledgment excluding an expired object reconciles local retention.
	c.serverConsumers.delete("b");
	await c.api.setSelection(["a"]);
	status = await c.api.status();
	assert.equal(status.consumerCount, 2);
	assert.equal(status.warmVideoCount, 0);
	assert.ok(!status.sources.some((s) => s.producerId === "b"));
	assert.ok(status.sources.some((s) => s.producerId === "audio-1" && s.kind === "audio"));
	const closes = c.payloads.filter((p) => p.event === "close_consumer");
	assert.equal(closes.length, 0);

	await c.api.setSelection(["b"]);
	status = await c.api.status();
	assert.deepEqual(JSON.parse(JSON.stringify(status.selectedVideos)), ["b"]);
	assert.equal(status.selectionRevision, 5);
	assert.ok(status.sources.some((s) => s.producerId === "b" && s.kind === "video"));
	assert.ok(status.sources.some((s) => s.producerId === "audio-1" && s.kind === "audio"));
	assert.ok(status.consumerCount <= 3);
	const revisions = status.selectionChanges.map((s) => s.revision);
	assert.deepEqual(JSON.parse(JSON.stringify(revisions)), [1, 2, 3, 4, 5]);
	await c.api.stop();
});

test("re-selection reuses a retained consumer without client eviction while audio continues", async () => {
	const c = client({ withAudio: true });
	await c.api.start(c.config);
	await c.api.setSelection(["a"]);
	assert.equal((await c.api.status()).warmVideoCount, 1);
	await c.api.setSelection(["a", "b"]);
	const status = await c.api.status();
	assert.equal(status.warmVideoCount, 0);
	assert.equal(status.consumerCount, 3);
	assert.equal(c.payloads.filter((p) => p.event === "create_consumer").length, 3);
	assert.ok(status.sources.some((s) => s.producerId === "audio-1"));
	assert.equal(c.payloads.filter((p) => p.event === "close_consumer").length, 0);
	await c.api.stop();
});

test("server-expired warm video drops via consumer_closed while audio continues", async () => {
	const c = client({ withAudio: true });
	await c.api.start(c.config);
	await c.api.setSelection(["a"]);
	let status = await c.api.status();
	assert.equal(status.consumerCount, 3);
	c.serverConsumers.delete("b");
	c.handlers["consumer_closed"]({ consumerId: "b" });
	c.handlers["consumer_closed"]({ consumerId: "missing" });
	status = await c.api.status();
	assert.ok(!status.sources.some((s) => s.producerId === "b"));
	assert.ok(status.sources.some((s) => s.producerId === "audio-1"));
	assert.equal(status.consumerCount, 2);
	assert.equal(c.serverConsumers.size, 2);
	assert.equal(status.warmVideoCount, 0);
	assert.equal(c.payloads.filter((p) => p.event === "close_consumer").length, 0);
	await c.api.stop();
});

test("stale close revision is rejected and cannot remove a promoted consumer", async () => {
	const c = client();
	await c.api.start(c.config);
	await c.api.setSelection(["a"]);
	const status = await c.api.status();
	assert.deepEqual(JSON.parse(JSON.stringify(status.selectedVideos)), ["a"]);
	await assert.rejects(c.api.closeConsumerAtRevision("a", status.acknowledgedRevision - 1));
	const after = await c.api.status();
	assert.ok(after.sources.some((s) => s.producerId === "a"));
	assert.ok(after.sources.some((s) => s.producerId === "b"));
	assert.equal(after.consumerCount, 2);
	await c.api.stop();
});

test("invalid churn selection is rejected before any wire intent", async () => {
	const c = client();
	await c.api.start(c.config);
	const calls = c.calls.length;
	for (const ids of [["a", "a"], [""], [null], [new Array(17).fill("x")][0]])
		await assert.rejects(c.api.setSelection(ids));
	assert.equal(c.calls.length, calls);
	await c.api.setSelection([]);
	assert.deepEqual(JSON.parse(JSON.stringify((await c.api.status()).selectedVideos)), []);
	await c.api.stop();
});

test("unselected late videos never auto-subscribe once churn starts", async () => {
	const c = client();
	await c.api.start(c.config);
	await c.api.setSelection(["a"]);
	const creates = c.payloads.filter((p) => p.event === "create_consumer").length;
	c.handlers["producer_created"]({ producerId: "late", participantId: "other", kind: "video" });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(c.payloads.filter((p) => p.event === "create_consumer").length, creates);
	assert.ok(!c.payloads.some((p) => p.event === "create_consumer" && p.data.producerId === "late"));
	await c.api.stop();
});
