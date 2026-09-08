import { Device } from "mediasoup-client";
import type { Consumer, Producer, RtpParameters, TransportOptions } from "mediasoup-client/types";
import { io, type Socket } from "socket.io-client";

type Transport = ReturnType<Device["createSendTransport"]> | ReturnType<Device["createRecvTransport"]>;
type Media = "audio" | "video" | "both" | "none";
interface Config {
	sfuUrl: string; meetingId: string; token: string; userId: string; name: string;
	media: Media; consume: boolean; renderMedia: boolean; rotatingAudio: boolean; audioActive: boolean;
	representativeCamera: boolean;
	representativeScreen: boolean;
}
interface ProducerEvent { producerId: string; participantId?: string; user_id?: string; id?: string; }

let socket: Socket | undefined;
let device: Device | undefined;
let send: Transport | undefined;
let receive: Transport | undefined;
let receivePending: Promise<Transport> | undefined;
let stream: MediaStream | undefined;
let audioContext: AudioContext | undefined;
let audioGain: GainNode | undefined;
let cameraCanvas: HTMLCanvasElement | undefined;
let cameraTimer: number | undefined;
let phase = "idle";
let joinMs: number | null = null;
let firstRemoteMediaMs: number | null = null;
let started = 0;
let stopping = false;
const producers = new Map<string, Producer>();
const consumers = new Map<string, Consumer>();
const renderedVideos = new Map<string, HTMLVideoElement>();
const pending = new Map<string, Promise<void>>();
const errors: string[] = [];

function request<T extends object>(event: string, data: object): Promise<T & { success: true }> {
	return new Promise((resolve, reject) => socket?.timeout(15_000).emit(event, data,
		(error: Error | null, response?: T & { success?: boolean }) => {
			if (error || response?.success !== true) reject(new Error(`${event} failed`));
			else resolve(response as T & { success: true });
		}));
}

function wire(transport: Transport) {
	transport.on("connect", ({ dtlsParameters }, done, fail) => {
		request("connect_webrtc_transport", { transportId: transport.id, dtlsParameters }).then(() => done()).catch(fail);
	});
}

async function receiveTransport() {
	if (receive) return receive;
	if (receivePending) return receivePending;
	receivePending = (async () => {
		const options = await request<TransportOptions>("create_webrtc_transport", { direction: "recv", encryptionEnabled: false });
		receive = device!.createRecvTransport(options); wire(receive); return receive;
	})();
	try { return await receivePending; } finally { receivePending = undefined; }
}

async function subscribe(config: Config, event: ProducerEvent) {
	const producerId = event.producerId || event.id || "";
	const owner = event.participantId || event.user_id;
	if (stopping || !config.consume || owner === config.userId || consumers.has(producerId) || pending.has(producerId)) return;
	const work = (async () => {
		const transport = await receiveTransport();
		const options = await request<{ id: string; producerId: string; kind: "audio" | "video"; rtpParameters: RtpParameters }>(
			"create_consumer", { transportId: transport.id, producerId, rtpCapabilities: device!.rtpCapabilities });
		const consumer = await transport.consume(options);
		if (stopping) return consumer.close();
		consumers.set(producerId, consumer);
		if (config.renderMedia || ((config.representativeCamera || config.representativeScreen) && consumer.kind === "video" &&
			(config.representativeScreen || !renderedVideos.size))) {
			const element = document.createElement(consumer.kind);
			element.autoplay = true; element.muted = true; element.srcObject = new MediaStream([consumer.track]);
			if (consumer.kind === "video") {
				const video = element as HTMLVideoElement; renderedVideos.set(producerId, video);
				if (!config.renderMedia) Object.assign(video.style, { position: "fixed", left: "-2px", width: "1px", height: "1px" });
			}
			document.querySelector("#media")?.append(element); void element.play();
		}
	})();
	pending.set(producerId, work);
	try { await work; } catch { errors.push("consumer setup failed"); } finally { pending.delete(producerId); }
}

async function publish(config: Config) {
	if (config.media === "none") return;
	const audio = config.media === "audio" || config.media === "both";
	const video = config.media === "video" || config.media === "both";
	if (config.rotatingAudio) {
		audioContext = new AudioContext();
		const oscillator = audioContext.createOscillator();
		audioGain = audioContext.createGain();
		const destination = audioContext.createMediaStreamDestination();
		oscillator.frequency.value = 440; audioGain.gain.value = config.audioActive ? 0.15 : 0;
		oscillator.connect(audioGain).connect(destination); oscillator.start();
		stream = destination.stream;
	} else if (config.representativeCamera || config.representativeScreen) {
		cameraCanvas = document.createElement("canvas"); cameraCanvas.width = config.representativeScreen ? 1920 : 1280; cameraCanvas.height = config.representativeScreen ? 1080 : 720;
		const context = cameraCanvas.getContext("2d")!; let frame = 0;
		const draw = () => {
			const { width, height } = cameraCanvas!; const elapsedMs = Math.round(performance.now() - started);
			const hue = (frame * 3 + config.userId.charCodeAt(5)) % 360; context.fillStyle = `hsl(${hue} 60% 35%)`; context.fillRect(0, 0, width, height);
			context.fillStyle = "white"; context.font = "48px monospace"; context.fillText(`${config.userId} frame ${frame} t=${elapsedMs}ms`, 40, 80);
			context.fillRect(frame * 17 % (width - 100), Math.round(height * 0.42), 100, 100); frame++;
		};
		draw(); cameraTimer = window.setInterval(draw, 1000 / 30);
		stream = cameraCanvas.captureStream(30);
	} else stream = await navigator.mediaDevices.getUserMedia({ audio, video });
	const options = await request<TransportOptions>("create_webrtc_transport", { direction: "send", encryptionEnabled: false });
	send = device!.createSendTransport(options); wire(send);
	send.on("produce", ({ kind, rtpParameters, appData }, done, fail) => {
		request<{ id: string }>("create_producer", { transportId: send!.id, kind, rtpParameters, appData })
			.then(({ id }) => done({ id })).catch(fail);
	});
	for (const track of stream.getTracks()) {
		const producer = await send.produce({ track, stopTracks: false,
			appData: { type: config.representativeScreen ? "screen" : "camera" },
			...(config.representativeScreen && track.kind === "video" ? { encodings: [{ maxBitrate: 4_000_000 }] } : {}) });
		producers.set(producer.id, producer);
	}
}

async function start(config: Config) {
	if (phase !== "idle") throw new Error("client already used");
	phase = "starting"; started = performance.now();
	const url = new URL(config.sfuUrl);
	socket = io(url.origin, { path: `${url.pathname.replace(/\/$/, "") || ""}/socket.io`, auth: { token: config.token }, transports: ["websocket"], reconnection: false });
	await new Promise<void>((resolve, reject) => {
		socket!.once("connect", resolve); socket!.once("connect_error", () => reject(new Error("socket connection failed")));
	});
	const queued: ProducerEvent[] = [];
	socket.on("producer_created", (event: ProducerEvent) => device ? void subscribe(config, event) : queued.push(event));
	socket.on("disconnect", () => { if (!stopping) phase = "failed"; });
	const joined = performance.now();
	await request("join_room", {
		roomId: config.meetingId, connectionId: crypto.randomUUID(),
		userData: { name: config.name, userId: config.userId, is_guest: false },
		mediaState: { audio_enabled: ["audio", "both"].includes(config.media), video_enabled: ["video", "both"].includes(config.media) },
		e2ee: { enabled: false, capability: { supported: false, mode: "none" } },
	});
	joinMs = performance.now() - joined;
	const router = await request<{ rtpCapabilities: object }>("get_router_rtp_capabilities", {});
	device = new Device(); await device.load({ routerRtpCapabilities: router.rtpCapabilities as never });
	await publish(config);
	const existing = await request<{ producers: ProducerEvent[] }>("get_existing_producers", {});
	await Promise.all([...queued, ...existing.producers].map((event) => subscribe(config, event)));
	phase = "running";
	return status();
}

async function status() {
	let bytesSent = 0, bytesReceived = 0, packetsLost = 0, packetsReceived = 0;
	const producerStats = [], consumerStats = [];
	for (const [id, endpoint] of producers) { let bytes = 0, framesEncoded: number | null = null, framesPerSecond: number | null = null;
		let totalAudioEnergy: number | null = null, sourceWidth: number | null = null, sourceHeight: number | null = null, sourceFramesPerSecond: number | null = null;
		for (const report of (await endpoint.getStats()).values()) {
			if (report.type === "outbound-rtp" && !report.isRemote) {
				bytes += Number(report.bytesSent || 0); framesEncoded = Number.isFinite(report.framesEncoded) ? Number(report.framesEncoded) : framesEncoded;
				framesPerSecond = Number.isFinite(report.framesPerSecond) ? Number(report.framesPerSecond) : framesPerSecond;
			}
			if (report.type === "media-source") {
				totalAudioEnergy = Number.isFinite(report.totalAudioEnergy) ? Number(report.totalAudioEnergy) : totalAudioEnergy;
				sourceWidth = Number.isFinite(report.width) ? Number(report.width) : sourceWidth; sourceHeight = Number.isFinite(report.height) ? Number(report.height) : sourceHeight;
				sourceFramesPerSecond = Number.isFinite(report.framesPerSecond) ? Number(report.framesPerSecond) : sourceFramesPerSecond;
			}
		} bytesSent += bytes; producerStats.push({ id, kind: endpoint.kind, paused: endpoint.paused, trackEnabled: endpoint.track?.enabled,
			trackReadyState: endpoint.track?.readyState, bytesSent: bytes, framesEncoded, framesPerSecond, totalAudioEnergy,
			mediaSource: { width: sourceWidth, height: sourceHeight, framesPerSecond: sourceFramesPerSecond } }); }
	for (const [producerId, endpoint] of consumers) { let bytes = 0, framesDecoded: number | null = null, frameWidth: number | null = null;
		let frameHeight: number | null = null, framesPerSecond: number | null = null;
		for (const report of (await endpoint.getStats()).values()) if (report.type === "inbound-rtp" && !report.isRemote) {
			bytes += Number(report.bytesReceived || 0); packetsLost += Number(report.packetsLost || 0); packetsReceived += Number(report.packetsReceived || 0);
			framesDecoded = Number.isFinite(report.framesDecoded) ? Number(report.framesDecoded) : framesDecoded;
			frameWidth = Number.isFinite(report.frameWidth) ? Number(report.frameWidth) : frameWidth; frameHeight = Number.isFinite(report.frameHeight) ? Number(report.frameHeight) : frameHeight;
			framesPerSecond = Number.isFinite(report.framesPerSecond) ? Number(report.framesPerSecond) : framesPerSecond;
		} bytesReceived += bytes; consumerStats.push({ producerId, kind: endpoint.kind, paused: endpoint.paused, trackEnabled: endpoint.track.enabled,
			trackReadyState: endpoint.track.readyState, bytesReceived: bytes, framesDecoded, frameWidth, frameHeight, framesPerSecond,
			browserDecodedFrames: renderedVideos.get(producerId)?.getVideoPlaybackQuality().totalVideoFrames ??
				renderedVideos.get(producerId)?.webkitDecodedFrameCount ?? null }); }
	if (bytesReceived && firstRemoteMediaMs === null) firstRemoteMediaMs = performance.now() - started;
	return { phase, sampledAtMs: performance.now(), joinMs, firstRemoteMediaMs, producerCount: producers.size, consumerCount: consumers.size,
		sendTransportState: send?.connectionState ?? null, receiveTransportState: receive?.connectionState ?? null,
		bytesSent, bytesReceived, packetsLost, packetsReceived, errors: [...errors],
		producerStats, consumerStats,
		capture: stream?.getTracks().map((track) => ({ kind: track.kind, settings: track.getSettings() })) || [] };
}

function endpointCounts() {
	return { producerCount: producers.size, consumerCount: consumers.size };
}

function setAudioActive(active: boolean) {
	if (!audioGain || !audioContext) throw new Error("rotating audio source is unavailable");
	audioGain.gain.setValueAtTime(active ? 0.15 : 0, audioContext.currentTime);
}

async function stop() {
	stopping = true; await Promise.allSettled(pending.values());
	if (cameraTimer !== undefined) window.clearInterval(cameraTimer);
	for (const endpoint of consumers.values()) endpoint.close();
	for (const endpoint of producers.values()) endpoint.close();
	receive?.close(); send?.close(); stream?.getTracks().forEach((track) => track.stop());
	await audioContext?.close();
	if (socket?.connected) socket.emit("leave_room", {}); socket?.disconnect(); phase = "stopped";
	cameraCanvas?.remove();
	return { localMediaReleased: !stream || stream.getTracks().every((track) => track.readyState === "ended") };
}

declare global {
	interface HTMLVideoElement { webkitDecodedFrameCount?: number }
	interface Window { meetLoad: { start: typeof start; status: typeof status; endpointCounts: typeof endpointCounts; stop: typeof stop; setAudioActive: typeof setAudioActive } }
}
window.meetLoad = { start, status, endpointCounts, stop, setAudioActive };
