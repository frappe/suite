import { Device } from "mediasoup-client";
import type { Consumer, Producer, RtpParameters, TransportOptions } from "mediasoup-client/types";
import { io, type Socket } from "socket.io-client";
import { PARTICIPANT_MEDIA_PROTOCOL_VERSION } from "../../../suite/meet/types/participantMedia";
import {
	audioCodecOptions,
	videoCodecOptions,
	svcEncodingTemplate,
	videoEncodings,
} from "../../../frontend/src/apps/meet/utils/media/encodings";

type SendTransport = ReturnType<Device["createSendTransport"]>;
type RecvTransport = ReturnType<Device["createRecvTransport"]>;

type MediaMode = "audio" | "video" | "both" | "none";
type ConsumeMode = "all" | "none";

interface LoadClientConfig {
	sfuUrl: string;
	socketPath?: string;
	meetingId: string;
	token: string;
	userId: string;
	name: string;
	connectionId: string;
	media: MediaMode;
	consume: ConsumeMode;
	renderMedia: boolean;
	videoCodec: "VP9" | "VP8";
	scalabilityMode: string;
	screen?: boolean;
	talkers?: { index: number; count: number; active: number; periodMs: number; epoch: number };
}

interface ProducerEvent {
	producerId: string;
	participantId: string;
	kind?: "audio" | "video";
	isScreen?: boolean;
}

interface SelectionChange {
	at: number;
	revision: number;
	producerIds: string[];
}

interface LoadClientStatus {
	phase: "idle" | "starting" | "running" | "failed" | "stopped";
	joinMs: number | null;
	producerCount: number;
	consumerCount: number;
	selectionRevision: number;
	acknowledgedRevision: number;
	selectedVideos: string[];
	selectionChanges: SelectionChange[];
	warmVideoCount: number;
	bytesSent: number;
	bytesReceived: number;
	packetsLost: number;
	packetsReceived: number;
	firstRemoteMediaMs: number | null;
	sendState: string;
	recvState: string;
	errors: string[];
	startedAt: number | null;
	acknowledgedAt: number | null;
	firstRemoteMediaAt: number | null;
	unexpectedDisconnects: Array<{ at: number; reason: string }>;
	sources: SourceStatus[];
	mediaPolicy: object | null;
	participantMediaProtocolVersion: number;
	mediaCapabilities: Record<string, number | boolean | null | Record<string, number | null>> | null;
	rejections: RejectionStatus[];
	admissionInvalid: boolean;
	talkerChanges: Array<{ at: number; step: number; gain: number }>;
}

const rejectionCodes = [
	"MEDIA_PROTOCOL_VERSION_MISMATCH",
	"ROOM_FULL",
	"MEDIA_CAPACITY_UNAVAILABLE",
	"VIDEO_CONSUMER_LIMIT",
	"PARTICIPANT_CONNECTION_CONFLICT",
] as const;

interface RejectionStatus {
	at: number;
	event: string;
	code: (typeof rejectionCodes)[number] | "UNKNOWN_REJECTION";
	supportedParticipantMediaProtocolVersion: number | null;
}

interface SourceStatus {
	direction: "send" | "recv";
	producerId: string;
	consumerId: string | null;
	kind: string;
	isScreen: boolean;
	paused: boolean;
	trackEnabled: boolean | null;
	audioGain: number | null;
	rtp: RtpParameters;
	settings?: MediaTrackSettings;
	bytes: number;
	packets: number;
	firstRtpAt: number | null;
	bitrateBps: number | null;
	packetsLost: number | null;
	jitter: number | null;
	rtt: number | null;
	nackCount: number | null;
	pliCount: number | null;
	firCount: number | null;
	framesDecoded: number | null;
	at: number;
	rtpReports: object[];
}

type SuccessfulResponse<T extends object = object> = T & { success: true };

let socket: Socket | null = null;
let device: Device | null = null;
let sendTransport: SendTransport | null = null;
let recvTransport: RecvTransport | null = null;
let recvTransportPromise: Promise<RecvTransport> | null = null;
let localStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let audioInput: MediaStreamAudioSourceNode | null = null;
let audioGain: GainNode | null = null;
let generatedAudio: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let talkerTimer: number | null = null;
let screenTimer: number | null = null;
let statsTimer: number | null = null;
let startedAt = 0;
let firstRemoteMediaMs: number | null = null;
const producers = new Map<string, Producer>();
const consumers = new Map<string, Consumer>();
const pendingConsumers = new Map<string, Promise<void>>();
let selectedVideos = new Set<string>();
let selectionRevision = 0;
let acknowledgedRevision = -1;
let subscriptionGeneration = 0;
let churnActive = false;
let renderMediaFlag = false;
const videoProducers = new Map<string, ProducerEvent>();
const selectionChanges: SelectionChange[] = [];
let selectionTail = Promise.resolve();
const errors: string[] = [];
const sources = new Map<string, SourceStatus>();
let stopping = false;
let joined: boolean | null = false;
let statusPromise: Promise<LoadClientStatus> | null = null;
const status: LoadClientStatus = {
	phase: "idle",
	joinMs: null,
	producerCount: 0,
	consumerCount: 0,
	bytesSent: 0,
	bytesReceived: 0,
	packetsLost: 0,
	packetsReceived: 0,
	firstRemoteMediaMs: null,
	sendState: "closed",
	recvState: "closed",
	errors,
	startedAt: null,
	acknowledgedAt: null,
	firstRemoteMediaAt: null,
	unexpectedDisconnects: [],
	sources: [],
	mediaPolicy: null,
	participantMediaProtocolVersion: PARTICIPANT_MEDIA_PROTOCOL_VERSION,
	mediaCapabilities: null,
	rejections: [],
	admissionInvalid: false,
	talkerChanges: [],
	selectionRevision: 0,
	acknowledgedRevision: -1,
	selectedVideos: [],
	selectionChanges,
	warmVideoCount: 0,
};

function safePositiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function readField(value: unknown, key: string): unknown {
	return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

function recordRejection(event: string, value: unknown): void {
	const code =
		rejectionCodes.find((code) => code === readField(value, "code")) ?? "UNKNOWN_REJECTION";
	if (code === "MEDIA_PROTOCOL_VERSION_MISMATCH") status.admissionInvalid = true;
	if (status.rejections.length >= 64) return;
	status.rejections.push({
		at: Date.now(),
		event,
		code,
		supportedParticipantMediaProtocolVersion:
			code === "MEDIA_PROTOCOL_VERSION_MISMATCH"
				? safePositiveInteger(readField(value, "supportedParticipantMediaProtocolVersion"))
				: null,
	});
}

function fail(_error: unknown): never {
	errors.push("Participant startup failed");
	status.phase = "failed";
	throw new Error("Participant startup failed");
}

function endpoint(sfuUrl: string, explicitPath?: string) {
	const url = new URL(sfuUrl);
	const basePath = url.pathname.replace(/\/$/, "");
	return {
		origin: url.origin,
		path: explicitPath || (basePath ? `${basePath}/socket.io` : "/socket.io"),
	};
}

async function request<T extends object>(
	event: string,
	data: object,
): Promise<SuccessfulResponse<T>> {
	if (!socket) throw new Error("Socket is not connected");
	return new Promise((resolve, reject) => {
		socket
			?.timeout(15_000)
			.emit(
				event,
				data,
				(
					error: Error | null,
					response: (T & { success?: boolean; error?: string }) | undefined,
				) => {
					if (error) return reject(new Error(`${event}: acknowledgment unavailable`));
					if (response?.success === false) {
						recordRejection(event, response);
						return reject(new Error(`${event}: request rejected`, { cause: "rejected" }));
					}
					if (response?.success !== true)
						return reject(new Error(`${event}: malformed acknowledgment`));
					resolve(response as SuccessfulResponse<T>);
				},
			);
	});
}

async function connectSocket(config: LoadClientConfig): Promise<void> {
	const target = endpoint(config.sfuUrl, config.socketPath);
	socket = io(target.origin, {
		path: target.path,
		auth: {
			token: config.token,
			participantMediaProtocolVersion: PARTICIPANT_MEDIA_PROTOCOL_VERSION,
		},
		transports: ["websocket"],
		forceNew: true,
		reconnection: false,
		autoConnect: false,
	});
	await new Promise<void>((resolve, reject) => {
		const timeout = window.setTimeout(
			() => reject(new Error("Socket connection timed out")),
			15_000,
		);
		socket?.once("connect", () => {
			window.clearTimeout(timeout);
			resolve();
		});
		socket?.once("connect_error", (error) => {
			window.clearTimeout(timeout);
			recordRejection("connect", (error as Error & { data?: unknown }).data);
			socket?.disconnect();
			reject(new Error("Socket connection rejected"));
		});
		socket?.connect();
	});
}

async function createSendTransport(): Promise<SendTransport> {
	if (!device) throw new Error("Device is not initialized");
	const params = await request<TransportOptions>("create_webrtc_transport", {
		direction: "send",
		encryptionEnabled: false,
	});
	const transport = device.createSendTransport(params);
	transport.on("connect", ({ dtlsParameters }, callback, errback) => {
		request("connect_webrtc_transport", { transportId: transport.id, dtlsParameters })
			.then(() => callback())
			.catch(errback);
	});
	transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
		request<{ id: string }>("create_producer", {
			transportId: transport.id,
			kind,
			rtpParameters,
			appData,
		})
			.then(({ id }) => callback({ id }))
			.catch(errback);
	});
	transport.on("connectionstatechange", (state) => {
		status.sendState = state;
	});
	return transport;
}

async function ensureReceiveTransport(): Promise<RecvTransport> {
	if (recvTransport) return recvTransport;
	if (recvTransportPromise) return recvTransportPromise;
	if (!device) throw new Error("Device is not initialized");
	recvTransportPromise = (async () => {
		const params = await request<TransportOptions>("create_webrtc_transport", {
			direction: "recv",
			encryptionEnabled: false,
		});
		const transport = device!.createRecvTransport(params);
		transport.on("connect", ({ dtlsParameters }, callback, errback) => {
			request("connect_webrtc_transport", { transportId: transport.id, dtlsParameters })
				.then(() => callback())
				.catch(errback);
		});
		transport.on("connectionstatechange", (state) => {
			status.recvState = state;
		});
		recvTransport = transport;
		return transport;
	})();
	try {
		return await recvTransportPromise;
	} finally {
		recvTransportPromise = null;
	}
}

function attachConsumer(consumer: Consumer): void {
	const element = document.createElement(consumer.kind === "video" ? "video" : "audio");
	element.autoplay = true;
	element.muted = true;
	element.srcObject = new MediaStream([consumer.track]);
	document.querySelector("#media")?.append(element);
	void element.play().catch(() => undefined);
}

function dropConsumer(consumerId: string): boolean {
	for (const [producerId, consumer] of consumers) {
		if (consumer.id !== consumerId) continue;
		try {
			consumer.close();
		} catch {
			// Local close is best effort; server state is authoritative.
		}
		consumers.delete(producerId);
		sources.delete(consumerId);
		return true;
	}
	return false;
}

function validSelection(ids: unknown): ids is string[] {
	return (
		Array.isArray(ids) &&
		ids.length <= 16 &&
		new Set(ids).size === ids.length &&
		ids.every((id) => typeof id === "string" && id.length > 0)
	);
}

async function createConsumer(event: ProducerEvent, renderMedia: boolean): Promise<void> {
	if (!device) throw new Error("Device is not initialized");
	const transport = await ensureReceiveTransport();
	const response = await request<{
		id: string;
		producerId: string;
		kind: "audio" | "video";
		rtpParameters: RtpParameters;
	}>("create_consumer", {
		transportId: transport.id,
		producerId: event.producerId,
		rtpCapabilities: device.rtpCapabilities,
	});
	const consumer = await transport.consume(response);
	if (stopping) {
		consumer.close();
		return;
	}
	consumers.set(event.producerId, consumer);
	sources.set(
		consumer.id, sourceStatus("recv", event.producerId, consumer, event.isScreen === true),
	);
	if (consumer.kind === "video") {
		await request("consumer:update_preferences", {
			consumerId: consumer.id,
			visible: true,
			width: 320,
			height: 180,
		});
	}
	if (renderMedia) attachConsumer(consumer);
}

// Bounded churn control: replace the selected video set with exactly the given
// producer IDs. Audio consumers are never touched. The SFU owns warm eviction;
// local removals follow consumer_closed events or acknowledged retention.
async function setSelection(producerIds: string[]): Promise<void> {
	if (!validSelection(producerIds)) throw new Error("Invalid video selection");
	churnActive = true;
	const ids = [...producerIds];
	const task = selectionTail.catch(() => undefined).then(async () => {
		if (!device) throw new Error("Device is not initialized");
		const generation = subscriptionGeneration;
		const revision = ++selectionRevision;
		selectedVideos = new Set(ids);
		const acknowledgment = await request<{
			revision: number;
			retainedConsumerIds: string[];
		}>("video:set_selection", { revision, producerIds: ids });
		if (generation !== subscriptionGeneration) return;
		if (revision !== selectionRevision) return;
		if (
			acknowledgment.revision !== revision ||
			!Array.isArray(acknowledgment.retainedConsumerIds)
		) {
			errors.push("Invalid video selection acknowledgment");
			throw new Error("Invalid video selection acknowledgment");
		}
		acknowledgedRevision = revision;
		if (selectionChanges.length >= 64) selectionChanges.shift();
		selectionChanges.push({ at: Date.now(), revision, producerIds: [...ids] });
		const retained = new Set(acknowledgment.retainedConsumerIds);
		for (const consumer of [...consumers.values()]) {
			if (consumer.kind !== "video" || retained.has(consumer.id)) continue;
			// Unknown to the server (already expired remotely): drop locally
			// without a stale close that could hit a promoted object.
			dropConsumer(consumer.id);
		}
		for (const [producerId, consumer] of [...consumers]) {
			if (consumer.kind !== "video" || !selectedVideos.has(producerId)) continue;
			if (!consumer.paused) continue;
			try {
				await request("consumer:update_preferences", {
					consumerId: consumer.id,
					visible: true,
					width: 320,
					height: 180,
				});
			} catch {
				errors.push("Consumer setup failed");
			}
		}
		for (const producerId of ids) {
			if (revision !== selectionRevision || generation !== subscriptionGeneration) return;
			if (consumers.has(producerId)) continue;
			const event = videoProducers.get(producerId);
			if (!event) continue;
			if (pendingConsumers.has(producerId)) {
				await pendingConsumers.get(producerId)?.catch(() => undefined);
				continue;
			}
			try {
				await createConsumer(event, renderMediaFlag);
			} catch {
				errors.push("Consumer setup failed");
			}
		}
	});
	selectionTail = task.catch(() => undefined);
	await task;
}

// Test-only stale-revision probe: a delayed close with an old revision must be
// rejected by the server and must retain a promoted consumer.
async function closeConsumerAtRevision(consumerId: string, revision: number): Promise<void> {
	await request("close_consumer", { consumerId, selectionRevision: revision });
}

async function subscribe(config: LoadClientConfig, event: ProducerEvent): Promise<void> {
	if (
		stopping ||
		config.consume === "none" ||
		event.participantId === config.userId ||
		consumers.has(event.producerId)
	) {
		return;
	}
	if (event.kind === "video") {
		videoProducers.set(event.producerId, event);
		// After churn starts, unselected videos never auto-subscribe; selected
		// videos are created by setSelection without resending intents.
		if (churnActive && !selectedVideos.has(event.producerId)) return;
	}
	const existing = pendingConsumers.get(event.producerId);
	if (existing) return existing;
	const pending = (async () => {
		if (!device) throw new Error("Device is not initialized");
		if (event.kind === "video" && !churnActive) {
			// Serialize cumulative intents so overlapping producer events cannot deselect each other.
			selectionTail = selectionTail.then(async () => {
				selectedVideos.add(event.producerId);
				const acknowledgment = await request<{
					revision: number;
					retainedConsumerIds: unknown;
				}>("video:set_selection", {
					revision: ++selectionRevision,
					producerIds: [...selectedVideos],
				});
				if (acknowledgment.revision !== selectionRevision) {
					errors.push("Invalid video selection acknowledgment");
					throw new Error("Invalid video selection acknowledgment");
				}
				acknowledgedRevision = selectionRevision;
				if (selectionChanges.length >= 64) selectionChanges.shift();
				selectionChanges.push({
					at: Date.now(),
					revision: selectionRevision,
					producerIds: [...selectedVideos],
				});
			});
			await selectionTail;
		}
		await createConsumer(event, config.renderMedia);
	})();
	pendingConsumers.set(event.producerId, pending);
	try {
		await pending;
	} catch {
		errors.push("Consumer setup failed");
	} finally {
		pendingConsumers.delete(event.producerId);
	}
}

async function publish(config: LoadClientConfig): Promise<void> {
	if (config.media === "none" && !config.screen) return;
	const wantsAudio = config.media === "audio" || config.media === "both";
	const wantsVideo = config.media === "video" || config.media === "both";
	localStream = wantsAudio || wantsVideo
		? await navigator.mediaDevices.getUserMedia({
			audio: wantsAudio,
			video: wantsVideo
				? { width: { exact: 1280 }, height: { exact: 720 }, frameRate: { exact: 30 } }
				: false,
		})
		: new MediaStream();
	const tracks = localStream.getTracks();
	if (wantsAudio && config.talkers && config.talkers.active < config.talkers.count) {
		const t = config.talkers;
		audioContext = new AudioContext();
		audioInput = audioContext.createMediaStreamSource(new MediaStream(localStream.getAudioTracks()));
		audioGain = audioContext.createGain();
		const destination = audioContext.createMediaStreamDestination();
		audioInput.connect(audioGain).connect(destination);
		generatedAudio = destination.stream;
		let previous = -1;
		const gate = () => {
			const step = Math.max(0, Math.floor((Date.now() - t.epoch) / t.periodMs));
			if (step === previous) return;
			previous = step;
			const gain = Number((t.index - (step % t.count) + t.count) % t.count < t.active);
			audioGain!.gain.value = gain;
			if (status.talkerChanges.length < 1000)
				status.talkerChanges.push({ at: Date.now(), step, gain });
		};
		gate();
		await audioContext.resume();
		talkerTimer = window.setInterval(gate, 100);
		tracks.splice(
			tracks.findIndex((track) => track.kind === "audio"), 1, generatedAudio.getAudioTracks()[0]!,
		);
	}
	if (config.screen) {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas capture unavailable");
		let frame = 0;
		const draw = () => {
			context.fillStyle = "#182438";
			context.fillRect(0, 0, 1920, 1080);
			context.fillStyle = "#8ecae6";
			for (let row = 0; row < 12; row++)
				context.fillRect((frame * 8 + row * 131) % 1920, row * 90, 240, 60);
			frame++;
		};
		draw();
		screenTimer = window.setInterval(draw, 1000 / 30);
		screenStream = canvas.captureStream(30);
		tracks.push(...screenStream.getVideoTracks());
	}
	sendTransport = await createSendTransport();
	for (const track of tracks) {
		const isScreen = screenStream?.getVideoTracks().includes(track) === true;
		const settings = track.getSettings();
		if (
			track.kind === "video" &&
			(settings.width !== (isScreen ? 1920 : 1280) ||
				settings.height !== (isScreen ? 1080 : 720) || settings.frameRate !== 30)
		)
			throw new Error("Fixture did not negotiate declared capture dimensions/fps");
		const mimeType = track.kind === "video" ? `video/${config.videoCodec}` : "audio/opus";
		const codec = device!.rtpCapabilities.codecs?.find(
			(c) => c.mimeType.toLowerCase() === mimeType.toLowerCase(),
		);
		if (!codec) throw new Error(`Pinned codec unavailable: ${mimeType}`);
		const producer = await sendTransport.produce({
			track,
			codec,
			encodings:
				track.kind === "video"
					? isScreen
						? [{ maxBitrate: 4000000, maxFramerate: 30 }]
						: config.videoCodec === "VP9"
							? svcEncodingTemplate(config.scalabilityMode)
							: videoEncodings
					: undefined,
			codecOptions: track.kind === "video" ? videoCodecOptions : audioCodecOptions,
			stopTracks: false,
			appData: { type: isScreen ? "screen" : "camera" },
		});
		producers.set(producer.id, producer);
		sources.set(producer.id, sourceStatus("send", producer.id, producer, isScreen));
	}
}

async function start(config: LoadClientConfig): Promise<LoadClientStatus> {
	if (status.phase !== "idle") throw new Error("Participant already started; use a new page");
	const t = config.talkers;
	if (t && (
		!Number.isInteger(t.count) || t.count < 0 || t.count > 24 ||
		!Number.isInteger(t.active) || t.active < 0 || t.active > t.count ||
		!Number.isInteger(t.index) || t.index < 0 || t.index >= 24 ||
		!Number.isFinite(t.periodMs) || t.periodMs < 1000 || t.periodMs > 600000 ||
		!Number.isFinite(t.epoch) ||
		((config.media === "audio" || config.media === "both") && t.index >= t.count)
	))
		throw new Error("Invalid talker controls");
	status.phase = "starting";
	startedAt = performance.now();
	renderMediaFlag = config.renderMedia;
	status.startedAt = Date.now();
	status.mediaPolicy = {
		audioCodecOptions,
		videoCodecOptions,
		encodings:
			config.videoCodec === "VP9" ? svcEncodingTemplate(config.scalabilityMode) : videoEncodings,
		videoCodec: config.videoCodec,
		audioCodec: "opus",
		width: 1280,
		height: 720,
		fps: 30,
		screen: config.screen ? {
			identity: "canvas-moving-bars-1080p30-v1",
			width: 1920, height: 1080, fps: 30, maxBitrate: 4000000,
		} : null,
	};
	statsTimer = window.setInterval(() => {
		void getStatus().catch(() => {
			errors.push("RTP stats collection failed");
		});
	}, 500);
	const queuedProducerEvents: ProducerEvent[] = [];
	try {
		await connectSocket(config);
		socket?.on("disconnect", (reason) => {
			if (!stopping) {
				status.unexpectedDisconnects.push({ at: Date.now(), reason });
				status.phase = "failed";
			}
		});
		socket?.on("producer_created", (event: ProducerEvent) => {
			if (!device?.loaded) {
				queuedProducerEvents.push(event);
				return;
			}
			void subscribe(config, event);
		});
		socket?.on("consumer_closed", (event: { consumerId?: string }) => {
			if (typeof event?.consumerId === "string") dropConsumer(event.consumerId);
		});
		socket?.on("producer_closed", (event: { producerId?: string }) => {
			if (typeof event?.producerId !== "string") return;
			videoProducers.delete(event.producerId);
			const consumer = consumers.get(event.producerId);
			if (consumer) dropConsumer(consumer.id);
		});
		const joinStarted = performance.now();
		joined = null;
		const admission = await request<{ mediaCapabilities?: unknown }>("join_room", {
			participantMediaProtocolVersion: PARTICIPANT_MEDIA_PROTOCOL_VERSION,
			roomId: config.meetingId,
			connectionId: config.connectionId,
			userData: { name: config.name, userId: config.userId, is_guest: false },
			mediaState: {
				audio_enabled: config.media === "audio" || config.media === "both",
				video_enabled: config.media === "video" || config.media === "both",
			},
			e2ee: { enabled: false, capability: { supported: false, mode: "none" } },
		}).catch((error) => {
			if (error instanceof Error && error.cause === "rejected") joined = false;
			throw error;
		});
		status.joinMs = performance.now() - joinStarted;
		joined = true;
		status.acknowledgedAt = Date.now();
		const announced = admission.mediaCapabilities;
		// Retain only known fields, never arbitrary server diagnostics.
		status.mediaCapabilities = {
			participantMediaProtocolVersion: safePositiveInteger(
				readField(announced, "participantMediaProtocolVersion"),
			),
			participantCeiling: safePositiveInteger(readField(announced, "participantCeiling")),
			videoConsumerCeiling: safePositiveInteger(readField(announced, "videoConsumerCeiling")),
			capacityProfileVersion: null,
		};
		for (const key of [
			"qualified150",
			"admissionEnforced",
			"boundedVideoSubscriptions",
			"routerPool",
			"e2eeRequired",
			"queueConfigurationQualified",
		]) {
			const value = readField(announced, key);
			status.mediaCapabilities[key] = typeof value === "boolean" ? value : null;
		}
		let invalidQueue = false;
		for (const [name, keys] of Object.entries({
			attachmentQueue: [
				"concurrency",
				"maxDepth",
				"operationTimeoutMs",
				"deadlineMs",
				"retryCount",
				"retryDelayMs",
			],
			consumerCreateQueue: ["concurrency", "maxQueueDepth", "operationTimeoutMs"],
		})) {
			const queue = readField(announced, name);
			status.mediaCapabilities[name] = Object.fromEntries(
				keys.map((key) => {
					const field = readField(queue, key);
					const value =
						key === "retryCount" && field === 0 ? 0 : safePositiveInteger(field);
					if (value === null) invalidQueue = true;
					return [key, value];
				}),
			);
		}
		if (
			invalidQueue ||
			status.mediaCapabilities.participantMediaProtocolVersion !==
				PARTICIPANT_MEDIA_PROTOCOL_VERSION ||
			status.mediaCapabilities.qualified150 !== false ||
			status.mediaCapabilities.queueConfigurationQualified !== false ||
			readField(announced, "capacityProfileVersion") !== null ||
			Object.entries(status.mediaCapabilities).some(
				([key, value]) => key !== "capacityProfileVersion" && value === null,
			)
		) {
			status.admissionInvalid = true;
			throw new Error("Invalid participant media capabilities");
		}
		const capabilities = await request<{ rtpCapabilities: object }>(
			"get_router_rtp_capabilities",
			{},
		);
		device = new Device();
		await device.load({
			routerRtpCapabilities: capabilities.rtpCapabilities as never,
		});
		await Promise.all(queuedProducerEvents.splice(0).map((event) => subscribe(config, event)));
		await publish(config);
		const existing = await request<{
			producers: Array<ProducerEvent & { id?: string; user_id?: string }>;
		}>("get_existing_producers", {});
		await Promise.all(
			existing.producers.map((producer) =>
				subscribe(config, {
					...producer,
					producerId: producer.producerId || producer.id || "",
					participantId: producer.participantId || producer.user_id || "",
				}),
			),
		);
		if (status.unexpectedDisconnects.length) throw new Error("Disconnected during startup");
		status.phase = "running";
		return getStatus();
	} catch (error) {
		return fail(error);
	}
}

function sourceStatus(
	direction: "send" | "recv",
	producerId: string,
	endpoint: Producer | Consumer,
	isScreen = false,
): SourceStatus {
	return {
		direction,
		producerId,
		consumerId: direction === "recv" ? endpoint.id : null,
		kind: endpoint.kind,
		isScreen,
		paused: endpoint.paused,
		trackEnabled: endpoint.track?.enabled ?? null,
		audioGain: null,
		rtp: endpoint.rtpParameters,
		settings: endpoint.track?.getSettings(),
		bytes: 0,
		packets: 0,
		firstRtpAt: null,
		bitrateBps: null,
		packetsLost: null,
		jitter: null,
		rtt: null,
		nackCount: null,
		pliCount: null,
		firCount: null,
		framesDecoded: null,
		at: Date.now(),
		rtpReports: [],
	};
}

async function collectStatus(): Promise<LoadClientStatus> {
	let bytesSent = 0;
	let bytesReceived = 0;
	let packetsLost = 0;
	let packetsReceived = 0;
	for (const endpoint of [...producers.values(), ...consumers.values()]) {
		const source = sources.get(endpoint.id)!;
		const reports = [...(await endpoint.getStats()).values()];
		const sending = source.direction === "send";
		const ssrcs = new Set(source.rtp.encodings?.map((e) => e.ssrc));
		// Some handlers expose transport-wide reports. Attribute only negotiated primary
		// SSRCs, once each; RTX and other tracks must not satisfy this source's gates.
		const rtp = [
			...new Map(
				reports
					.filter(
						(r) =>
							r.type === (sending ? "outbound-rtp" : "inbound-rtp") &&
							!r.isRemote &&
							r.ssrc !== undefined &&
							ssrcs.has(r.ssrc),
					)
					.map((r) => [r.ssrc, r]),
			).values(),
		];
		const sum = (key: string): number | null => {
			const numbers = rtp.map((r) => r[key]).filter(Number.isFinite);
			return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
		};
		const at = Date.now();
		const bytes = sum(sending ? "bytesSent" : "bytesReceived") || 0;
		const packets = sum(sending ? "packetsSent" : "packetsReceived") || 0;
		const pair = reports.find(
			(r) => r.type === "candidate-pair" && r.state === "succeeded" && r.nominated,
		);
		const remote = reports.find((r) => r.type === "remote-inbound-rtp" && ssrcs.has(r.ssrc));
		Object.assign(source, {
			paused: endpoint.paused,
			trackEnabled: endpoint.track?.enabled ?? null,
			audioGain: sending && source.kind === "audio" ? (audioGain?.gain.value ?? 1) : null,
			bytes,
			packets,
			at,
			rtpReports: rtp.map((r) => ({
				...r,
				codec: reports.find((c) => c.id === r.codecId) ?? null,
			})),
			firstRtpAt: source.firstRtpAt ?? (bytes > 0 && packets > 0 ? at : null),
			bitrateBps:
				at > source.at && bytes >= source.bytes
					? ((bytes - source.bytes) * 8000) / (at - source.at)
					: at === source.at && bytes === source.bytes
						? source.bitrateBps
						: null,
			packetsLost: sum("packetsLost"),
			jitter: sum("jitter"),
			rtt: remote?.roundTripTime ?? pair?.currentRoundTripTime ?? null,
			nackCount: sum("nackCount"),
			pliCount: sum("pliCount"),
			firCount: sum("firCount"),
			framesDecoded: sum("framesDecoded"),
		});
		if (sending) bytesSent += bytes;
		else {
			bytesReceived += bytes;
			packetsReceived += packets;
			packetsLost += Math.max(0, source.packetsLost || 0);
		}
	}
	if (
		firstRemoteMediaMs === null &&
		[...sources.values()].some(
			(s) => s.direction === "recv" && s.bytes > 0 && s.packets > 0,
		)
	) {
		firstRemoteMediaMs = performance.now() - startedAt;
		status.firstRemoteMediaAt = Date.now();
	}
	Object.assign(status, {
		producerCount: producers.size,
		consumerCount: consumers.size,
		selectionRevision,
		acknowledgedRevision,
		selectedVideos: [...selectedVideos],
		selectionChanges: selectionChanges.map((s) => ({ ...s, producerIds: [...s.producerIds] })),
		warmVideoCount: [...consumers].filter(
			([producerId, consumer]) => consumer.kind === "video" && !selectedVideos.has(producerId),
		).length,
		bytesSent,
		bytesReceived,
		packetsLost,
		packetsReceived,
		firstRemoteMediaMs,
		sources: [...sources.values()].map((s) => ({ ...s })),
		sendState: sendTransport?.connectionState || "closed",
		recvState: recvTransport?.connectionState || "closed",
	});
	return {
		...status,
		errors: [...errors],
		rejections: status.rejections.map((r) => ({ ...r })),
		selectedVideos: [...selectedVideos],
		selectionChanges: selectionChanges.map((s) => ({ ...s, producerIds: [...s.producerIds] })),
	};
}

function getStatus(): Promise<LoadClientStatus> {
	statusPromise ??= collectStatus().finally(() => {
		statusPromise = null;
	});
	return statusPromise;
}

async function stop(): Promise<{
	joined: boolean | null;
	acknowledged: boolean;
	rejected: boolean;
	at: number;
	rejections: RejectionStatus[];
	admissionInvalid: boolean;
	localMediaReleased: boolean;
}> {
	stopping = true;
	subscriptionGeneration++;
	if (statsTimer !== null) window.clearInterval(statsTimer);
	statsTimer = null;
	if (talkerTimer !== null) window.clearInterval(talkerTimer);
	if (screenTimer !== null) window.clearInterval(screenTimer);
	talkerTimer = screenTimer = null;
	let acknowledged = false;
	let rejected = false;
	let localMediaReleased = false;
	try {
		await Promise.allSettled(pendingConsumers.values());
		await statusPromise;
		if (joined !== false && socket?.connected) {
			await request("leave_room", {});
			acknowledged = true;
		}
	} catch (error) {
		if (!(error instanceof Error) || error.cause !== "rejected") throw error;
		rejected = true;
	} finally {
		for (const consumer of consumers.values()) consumer.close();
		for (const producer of producers.values()) producer.close();
		consumers.clear();
		producers.clear();
		recvTransport?.close();
		sendTransport?.close();
		localStream?.getTracks().forEach((track) => track.stop());
		generatedAudio?.getTracks().forEach((track) => track.stop());
		screenStream?.getTracks().forEach((track) => track.stop());
		audioInput?.disconnect();
		audioGain?.disconnect();
		if (audioContext) await audioContext.close();
		localMediaReleased = [localStream, generatedAudio, screenStream].every(
			(stream) => !stream || stream.getTracks().every((track) => track.readyState === "ended"),
		) && (!audioContext || audioContext.state === "closed") &&
			talkerTimer === null && screenTimer === null;
		audioContext = audioInput = audioGain = null;
		generatedAudio = screenStream = localStream = null;
		socket?.disconnect();
		status.phase = "stopped";
	}
	return {
		joined,
		acknowledged,
		rejected,
		at: Date.now(),
		rejections: status.rejections.map((r) => ({ ...r })),
		admissionInvalid: status.admissionInvalid,
		localMediaReleased,
	};
}

declare global {
	interface Window {
		meetLoad: {
			start: typeof start;
			status: typeof getStatus;
			stop: typeof stop;
			setSelection: typeof setSelection;
			closeConsumerAtRevision: typeof closeConsumerAtRevision;
		};
	}
}

window.meetLoad = {
	start,
	status: getStatus,
	stop,
	setSelection,
	closeConsumerAtRevision,
};
