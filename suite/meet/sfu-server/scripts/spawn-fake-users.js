const { io } = require("socket.io-client");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { spawn } = require("child_process");

const argv = yargs(hideBin(process.argv))
	.option("meeting", {
		type: "string",
		demandOption: true,
		describe: "Meeting ID / room ID to join",
	})
	.option("count", {
		type: "number",
		default: 5,
		describe: "Number of fake users to spawn",
	})
	.option("sfu-url", {
		type: "string",
		default: "http://localhost",
		describe: "Base SFU URL (protocol+host)",
	})
	.option("sfu-port", {
		type: "number",
		default: 3000,
		describe: "SFU port if not implicit in URL",
	})
	.option("secret", {
		type: "string",
		default: process.env.JWT_SECRET,
		describe: "JWT signing secret used by SFU (required)",
	})
	.option("with-producers", {
		type: "boolean",
		default: false,
		describe: "Create real fake audio/video producers using FFmpeg",
	})
	.option("auto-toggle", {
		type: "boolean",
		default: false,
		describe: "Periodically send media_control events",
	})
	.option("lifetime", {
		type: "number",
		default: 0,
		describe: "Milliseconds before disconnecting (0 = keep alive)",
	})
	.help().argv;

const {
	meeting: meetingId,
	count,
	sfuUrl,
	sfuPort,
	secret,
	withProducers,
	autoToggle,
	lifetime,
} = argv;

if (!secret) {
	console.error("Error: JWT secret is required. Provide --secret or set JWT_SECRET environment variable.");
	process.exit(1);
}

const endpoint = (() => {
	try {
		const u = new URL(sfuUrl);
		if (u.port) return u.origin;
		return `${u.protocol}//${u.hostname}:${sfuPort}`;
	} catch (_) {
		return `${sfuUrl.replace(/\/$/, "")}:${sfuPort}`;
	}
})();

console.log("Spawning fake users with config:", {
	meetingId,
	count,
	endpoint,
	withProducers,
	autoToggle,
	lifetime,
});

function makeToken(userId, index) {
	const now = Math.floor(Date.now() / 1000);
	return jwt.sign(
		{
			user_id: userId,
			meeting_id: meetingId,
			user_name: `Fake User ${index}`,
			scope: "full",
			iat: now,
			exp: now + 3600,
		},
		secret,
		{ algorithm: "HS256" },
	);
}

function randomDelay(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

const dgram = require("dgram");

// Create RTP packet with audio level header extension for active speaker detection
function createOpusPacket(seq, ts, ssrc, isSpeaking) {
	// Audio level: 0 = loudest (speaking), 127 = silence
	const audioLevel = isSpeaking ? 30 : 127; // 30 is "fairly loud"
	
	// RTP Header (12 bytes) + Header Extension (4 + 4 bytes)
	const header = Buffer.alloc(20);
	
	// RTP fixed header
	header.writeUInt8(0x90, 0); // Version 2, no padding, HAS extension (X=1), no CSRC
	header.writeUInt8(111, 1);  // Payload type 111 (Opus), Marker=0
	header.writeUInt16BE(seq % 65536, 2);
	header.writeUInt32BE(ts % 4294967296, 4);
	header.writeUInt32BE(ssrc, 8);
	
	// RTP Header Extension (RFC 5285 one-byte header)
	header.writeUInt16BE(0xBEDE, 12); // One-byte header profile
	header.writeUInt16BE(1, 14);       // Length: 1 word (4 bytes)
	
	// Extension element: ID=1 (ssrc-audio-level), Length=0 (1 byte data)
	// Format: 4-bit ID | 4-bit length-1, then data bytes
	header.writeUInt8(0x10, 16);       // ID=1, Length=0 (means 1 byte)
	header.writeUInt8(0x80 | audioLevel, 17); // V=1 (voice activity), Level
	header.writeUInt8(0x00, 18);       // Padding
	header.writeUInt8(0x00, 19);       // Padding
	
	// Opus payload: TOC byte + minimal data
	const opus = isSpeaking 
		? Buffer.from([0xF8, 0x7F, 0x7F, 0x7F, 0x7F]) // "loud" noise
		: Buffer.from([0xF8, 0x00, 0x00, 0x00, 0x00]); // silence
	
	return Buffer.concat([header, opus]);
}

async function startProducers(socket, audioTransport, videoTransport, index) {
	// Create audio producer
	const audioRtp = {
		codecs: [{ mimeType: "audio/opus", clockRate: 48000, payloadType: 111, channels: 2 }],
		headerExtensions: [
			{ uri: "urn:ietf:params:rtp-hdrext:ssrc-audio-level", id: 1 }
		],
		encodings: [{ ssrc: 111111 + index }],
	};

	await new Promise((resolve, reject) => {
		socket.emit("create_producer", {
			transportId: audioTransport.id,
			kind: "audio",
			rtpParameters: audioRtp,
			appData: { source: "mic" }
		}, (resp) => {
			if (resp.success) resolve(resp.id);
			else reject(new Error(resp.error || "Audio producer failed"));
		});
	});
	console.log(`[#${index}] 🎤 Audio Producer created`);

	// Create video producer
	const videoRtp = {
		codecs: [{ mimeType: "video/VP8", clockRate: 90000, payloadType: 96 }],
		encodings: [{ ssrc: 222222 + index }],
	};

	await new Promise((resolve, reject) => {
		socket.emit("create_producer", {
			transportId: videoTransport.id,
			kind: "video",
			rtpParameters: videoRtp,
			appData: { source: "webcam" }
		}, (resp) => {
			if (resp.success) resolve(resp.id);
			else reject(new Error(resp.error || "Video producer failed"));
		});
	});
	console.log(`[#${index}] 📷 Video Producer created`);

	// Setup audio via UDP (lightweight, no FFmpeg)
	const audioIp = audioTransport.ip === "0.0.0.0" ? "127.0.0.1" : audioTransport.ip;
	const audioPort = audioTransport.port;
	const audioSsrc = 111111 + index;
	const udpSocket = dgram.createSocket("udp4");
	
	let seq = 0;
	let ts = 0;
	let isSpeaking = false;
	let nextToggle = Date.now() + 1000 + Math.random() * 3000;
	
	const audioInterval = setInterval(() => {
		// Toggle speaking state randomly
		if (Date.now() > nextToggle) {
			isSpeaking = !isSpeaking;
			const duration = isSpeaking 
				? 2000 + Math.random() * 4000  // Talk 2-6s
				: 3000 + Math.random() * 6000; // Pause 3-9s
			nextToggle = Date.now() + duration;
			if (isSpeaking) console.log(`[#${index}] 🗣️ Speaking...`);
		}
		
		const packet = createOpusPacket(seq++, ts, audioSsrc, isSpeaking);
		udpSocket.send(packet, audioPort, audioIp);
		ts += 960; // 20ms @ 48kHz
	}, 20);
	
	console.log(`[#${index}] 🔊 Audio streaming started`);

	// Video via FFmpeg (only if needed for visual debugging)
	const videoIp = videoTransport.ip === "0.0.0.0" ? "127.0.0.1" : videoTransport.ip;
	const videoArgs = [
		"-re",
		"-f", "lavfi", "-i", `color=c=blue:s=160x120:r=5,drawtext=text='User ${index}':fontcolor=white:fontsize=24:x=(w-text_w)/2:y=(h-text_h)/2`,
		"-c:v", "libvpx",
		"-b:v", "50k",
		"-ssrc", String(222222 + index),
		"-payload_type", "96",
		"-f", "rtp",
		`rtp://${videoIp}:${videoTransport.port}`,
	];

	const videoFfmpeg = spawn("ffmpeg", videoArgs, { stdio: ["pipe", "pipe", "pipe"] });
	videoFfmpeg.stderr.on("data", () => {}); // Suppress output
	console.log(`[#${index}] 📺 Video streaming started`);

	return { 
		stop: () => { 
			clearInterval(audioInterval); 
			udpSocket.close();
			videoFfmpeg.kill("SIGTERM"); 
		}
	};
}

async function spawnUser(index) {
	const userId = `fake.user${index}@example.com`;
	const token = makeToken(userId, index);

	const socket = io(endpoint, {
		auth: { token },
		transports: ["websocket", "polling"],
		reconnection: true,
		reconnectionAttempts: 3,
		reconnectionDelay: 1000,
	});

	let ffmpegProcesses = null;

	socket.on("connect", () => {
		console.log(`[#${index}] ✅ Connected as ${userId}`);

		socket.emit(
			"join_room",
			{
				roomId: meetingId,
				userData: {
					name: `Fake User ${index}`,
					userId: userId,
					avatar: undefined,
				},
				mediaState: {
					audio_enabled: true,
					video_enabled: true,
				},
			},
			async (response) => {
				if (response.success) {
					console.log(`[#${index}] ✅ Joined room ${meetingId}`);

					// Only half the users get producers (odd-indexed users)
					const hasMedia = index % 2 === 1;
					if (withProducers && hasMedia) {
						try {
							// Request Audio PlainTransport
							const audioTransport = await new Promise((resolve, reject) => {
								socket.emit("create_plain_transport", {}, (resp) => {
									if (resp.success) resolve(resp);
									else reject(new Error(resp.error || "Transport failed"));
								});
							});
							console.log(`[#${index}] 🔊 Audio PlainTransport on port ${audioTransport.port}`);

							// Request Video PlainTransport
							const videoTransport = await new Promise((resolve, reject) => {
								socket.emit("create_plain_transport", {}, (resp) => {
									if (resp.success) resolve(resp);
									else reject(new Error(resp.error || "Transport failed"));
								});
							});
							console.log(`[#${index}] 📺 Video PlainTransport on port ${videoTransport.port}`);

							ffmpegProcesses = await startProducers(
								socket,
								audioTransport,
								videoTransport,
								index
							);
						} catch (e) {
							console.error(`[#${index}] Producer setup error:`, e.message);
						}
					}
				} else {
					console.error(`[#${index}] ❌ Failed to join room: ${response.error}`);
				}
			},
		);
	});

	socket.on("disconnect", (reason) => {
		console.log(`[#${index}] 🔌 Disconnected: ${reason}`);
		ffmpegProcesses?.stop?.();
	});

	socket.on("connect_error", (err) =>
		console.error(`[#${index}] ❌ Connect error:`, err.message),
	);

	socket.on("participant_joined", (d) =>
		console.log(`[#${index}] 👥 participant_joined`, d.participantId),
	);
	socket.on("participant_left", (d) =>
		console.log(`[#${index}] 👋 participant_left`, d.participantId),
	);
	socket.on("producer_created", (d) =>
		console.log(`[#${index}] 🎥 producer_created`, d.producerId, d.kind),
	);
	socket.on("media_control_update", (d) =>
		console.log(
			`[#${index}] 🎛️ media_control_update`,
			d.action,
			"from",
			d.participantId,
		),
	);

	if (autoToggle) {
		const actions = ["mute", "unmute", "video_off", "video_on"];
		const interval = setInterval(
			() => {
				if (socket.connected) {
					const action = actions[Math.floor(Math.random() * actions.length)];
					socket.emit("media_control", { action });
					console.log(`[#${index}] 🔄 Sent media_control ${action}`);
				}
			},
			randomDelay(4000, 7000),
		);
		socket.on("disconnect", () => clearInterval(interval));
	}

	if (lifetime > 0) {
		setTimeout(() => {
			console.log(`[#${index}] ⏱️ Lifetime reached, disconnecting`);
			socket.disconnect();
		}, lifetime + randomDelay(0, 3000));
	}

	return { socket, cleanup: () => ffmpegProcesses?.stop?.() };
}

(async () => {
	const clients = [];
	for (let i = 0; i < count; i++) {
		await new Promise((r) => setTimeout(r, randomDelay(150, 600)));
		clients.push(await spawnUser(i + 1));
	}
	console.log(`🚀 Spawned ${clients.length} fake users.`);

	process.on("SIGINT", () => {
		console.log("\n🛑 Caught SIGINT, disconnecting fake users...");
		for (const c of clients) {
			c.cleanup();
			c.socket.disconnect();
		}
		process.exit(0);
	});
})();
