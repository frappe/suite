import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
	Consumer,
	PlainTransport,
	Producer,
	Router,
	RtpCapabilities,
} from 'mediasoup/types';
import { loggers } from '../utils/logger';
import { AudioPreRoll } from './AudioPreRoll';
import { updatePcmCaptureTranscript, writePcmCapture } from './PcmCapture';
import type { ISttClient, ISttStream } from './SttClient';

interface AudioIngesterOptions {
	roomId: string;
	participantId: string;
	participantName?: string;
	producer: Producer;
	router: Router;
	sttClient: ISttClient;
	captureDirectory?: string;
	/** Called before each flush; if false, audio is discarded (active-speaker-only mode) */
	isActiveSpeaker?: () => boolean;
	onUnexpectedStreamClose: () => void;
	onTranscript: (text: string, isFinal: boolean, durationMs: number) => void;
}

// ── VAD / Streaming Config ───────────────────────────────────────────────────
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2; // s16le
const OUTPUT_CHANNELS = 1; // ASR input is mono; Meet still publishes stereo Opus.

/** How often we check audio energy (ms) */
const VAD_CHECK_MS = 100;
/** Bytes of audio per VAD check */
const BYTES_PER_CHECK = (SAMPLE_RATE * BYTES_PER_SAMPLE * VAD_CHECK_MS) / 1000;
const PRE_ROLL_CHECKS = Math.max(
	0,
	Math.ceil(
		Number.parseInt(process.env.STT_PRE_ROLL_MS || '300', 10) / VAD_CHECK_MS,
	),
);

/** Consecutive silent checks before we flush (500 ms pause by default) */
const SILENCE_CHECKS_TO_FLUSH = Math.max(
	1,
	Math.ceil(
		Number.parseInt(process.env.STT_SILENCE_MS || '500', 10) / VAD_CHECK_MS,
	),
);
/** Minimum speech before a normal silence final (600 ms by default). */
const MIN_SPEECH_CHECKS = Math.max(
	1,
	Math.ceil(
		Number.parseInt(process.env.STT_MIN_SPEECH_MS || '600', 10) / VAD_CHECK_MS,
	),
);
/** Min speech for short utterance / tail-end catch-up flush (200 ms by default). */
const MIN_TAIL_CHECKS = Math.max(
	1,
	Math.ceil(
		Number.parseInt(process.env.STT_MIN_TAIL_MS || '200', 10) / VAD_CHECK_MS,
	),
);
/** Silence before finalizing a short utterance (700 ms by default). */
const SHORT_UTTERANCE_SILENCE_CHECKS = Math.max(
	SILENCE_CHECKS_TO_FLUSH,
	Math.ceil(
		Number.parseInt(process.env.STT_SHORT_UTTERANCE_SILENCE_MS || '700', 10) /
			VAD_CHECK_MS,
	),
);
/**
 * Normalized RMS threshold for speech vs silence.
 * 0.0 = absolute silence, 1.0 = full-scale square wave.
 * 0.012 works well for typical mic input routed through Mediasoup.
 */
const SPEECH_RMS_THRESHOLD = Number.parseFloat(
	process.env.STT_VAD_THRESHOLD || '0.012',
);

/** Captures one producer, decodes its audio, and streams VAD-delimited speech to STT. */
export class AudioIngester {
	private roomId: string;
	private participantId: string;
	private participantName?: string;
	private producer: Producer;
	private router: Router;
	private sttClient: ISttClient;
	private sttStream: ISttStream | null = null;
	private captureDirectory?: string;
	private captureFrames: Buffer[] = [];
	private pendingCaptureMetadata: string[] = [];
	private sessionId = randomUUID();
	private isActiveSpeaker?: () => boolean;
	private onUnexpectedStreamClose: () => void;
	private onTranscript: (
		text: string,
		isFinal: boolean,
		durationMs: number,
	) => void;

	private plainTransport: PlainTransport | null = null;
	private consumer: Consumer | null = null;
	private ffmpeg: ChildProcess | null = null;
	private ffmpegPort = 0;
	private sdpPath = '';
	private running = false;

	// ── VAD state ──────────────────────────────────────────────────────────────
	private vadQueue: Buffer[] = [];
	private vadQueueBytes = 0;
	private speechCheckCount = 0;
	private silenceCheckCount = 0;
	private isInSpeech = false;
	private vadTimer: NodeJS.Timeout | null = null;
	private streamedBytes = 0;
	private preRoll = new AudioPreRoll(PRE_ROLL_CHECKS);

	constructor(options: AudioIngesterOptions) {
		this.roomId = options.roomId;
		this.participantId = options.participantId;
		this.participantName = options.participantName;
		this.producer = options.producer;
		this.router = options.router;
		this.sttClient = options.sttClient;
		this.captureDirectory = options.captureDirectory;
		this.isActiveSpeaker = options.isActiveSpeaker;
		this.onUnexpectedStreamClose = options.onUnexpectedStreamClose;
		this.onTranscript = options.onTranscript;
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;

		try {
			await this.setupPlainTransport();
			if (!this.running) {
				await this.stop();
				return;
			}
			await this.createConsumer();
			if (!this.running) {
				await this.stop();
				return;
			}
			await this.startFfmpeg();
			if (!this.running) {
				await this.stop();
				return;
			}
			await this.plainTransport!.connect({
				ip: '127.0.0.1',
				port: this.ffmpegPort,
			});
			if (!this.running) {
				await this.stop();
				return;
			}
			const stream = await this.sttClient.createStream(
				{
					sessionId: this.sessionId,
					roomId: this.roomId,
					participantId: this.participantId,
					producerId: this.producer.id,
					participantName: this.participantName,
					sampleRate: SAMPLE_RATE,
					language: process.env.NEMOTRON_LANGUAGE || 'en-US',
				},
				(event) => {
					if (event.isFinal) this.recordCaptureTranscript(event.text);
					this.onTranscript(event.text, event.isFinal, event.durationMs);
				},
			);
			if (!this.running) {
				await stream.close();
				await this.stop();
				return;
			}
			this.sttStream = stream;
			stream.onUnexpectedClose(() => {
				if (!this.running || this.sttStream !== stream) return;
				this.onUnexpectedStreamClose();
			});
			if (!this.running || this.sttStream !== stream) return;
			this.startVadLoop();

			loggers.stt.info(
				'AudioIngester started for %s in room %s (producer %s, session %s, ffmpeg port %d, vadThreshold=%.4f)',
				this.participantId,
				this.roomId,
				this.producer.id,
				this.sessionId,
				this.ffmpegPort,
				SPEECH_RMS_THRESHOLD,
			);
		} catch (error) {
			await this.stop();
			loggers.stt.error(
				'Failed to start AudioIngester for %s: %s',
				this.participantId,
				(error as Error).message,
			);
			throw error;
		}
	}

	async stop(): Promise<void> {
		this.running = false;

		if (this.vadTimer) {
			clearTimeout(this.vadTimer);
			this.vadTimer = null;
		}

		if (this.streamedBytes > 0 && this.speechCheckCount >= MIN_TAIL_CHECKS) {
			this.markFinal();
		}

		const stream = this.sttStream;
		this.sttStream = null;
		if (stream) await stream.close();

		const consumer = this.consumer;
		this.consumer = null;
		if (consumer) {
			try {
				consumer.close();
			} catch {
				/* ignore */
			}
		}
		const plainTransport = this.plainTransport;
		this.plainTransport = null;
		if (plainTransport) {
			try {
				plainTransport.close();
			} catch {
				/* ignore */
			}
		}
		const ffmpeg = this.ffmpeg;
		this.ffmpeg = null;
		if (ffmpeg && !ffmpeg.killed) {
			ffmpeg.kill('SIGTERM');
			setTimeout(() => {
				if (ffmpeg.exitCode === null && ffmpeg.signalCode === null) {
					ffmpeg.kill('SIGKILL');
				}
			}, 1000);
		}
		const sdpPath = this.sdpPath;
		this.sdpPath = '';
		if (sdpPath) {
			try {
				fs.unlinkSync(sdpPath);
			} catch {
				/* ignore */
			}
		}

		loggers.stt.info('AudioIngester stopped for %s', this.participantId);
	}

	// ── Mediasoup plumbing ─────────────────────────────────────────────────────

	private async setupPlainTransport(): Promise<void> {
		this.plainTransport = await this.router.createPlainTransport({
			listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
			rtcpMux: true,
			comedia: false,
		});
	}

	private async createConsumer(): Promise<void> {
		const rtpCapabilities: RtpCapabilities = {
			codecs: [
				{
					mimeType: 'audio/opus',
					kind: 'audio',
					preferredPayloadType: 111,
					clockRate: 48000,
					channels: 2,
					parameters: {},
					rtcpFeedback: [],
				},
			],
			headerExtensions: [],
		};

		this.consumer = await this.plainTransport!.consume({
			producerId: this.producer.id,
			rtpCapabilities,
		});
	}

	private async startFfmpeg(): Promise<void> {
		this.ffmpegPort = await this.findAvailablePort();
		const payloadType =
			this.consumer?.rtpParameters?.codecs?.[0]?.payloadType ?? 111;

		this.sdpPath = path.join(
			os.tmpdir(),
			`stt_${this.roomId}_${this.participantId}_${Date.now()}.sdp`,
		);
		fs.writeFileSync(this.sdpPath, this.buildSdp(this.ffmpegPort, payloadType));

		const args = [
			'-protocol_whitelist',
			'file,crypto,udp,rtp',
			'-i',
			this.sdpPath,
			'-f',
			's16le',
			'-ar',
			String(SAMPLE_RATE),
			'-ac',
			String(OUTPUT_CHANNELS),
			'pipe:1',
		];

		this.ffmpeg = spawn('ffmpeg', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		this.ffmpeg.stdout!.on('data', (data: Buffer) => {
			this.vadQueue.push(data);
			this.vadQueueBytes += data.length;
		});

		this.ffmpeg.stderr!.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg && process.env.SFU_LOG_LEVEL === 'debug') {
				loggers.stt.debug('ffmpeg: %s', msg.slice(0, 200));
			}
		});

		this.ffmpeg.on('error', (error) => {
			loggers.stt.error(
				'ffmpeg error for %s: %s',
				this.participantId,
				error.message,
			);
		});

		this.ffmpeg.on('exit', (code) => {
			if (code !== 0 && this.running) {
				loggers.stt.warn(
					'ffmpeg exited with code %d for %s',
					code,
					this.participantId,
				);
			}
		});
	}

	// ── VAD loop ───────────────────────────────────────────────────────────────

	private startVadLoop(): void {
		const run = () => {
			if (!this.running) return;
			this.runVadCheck()
				.then(() => {
					if (this.running) {
						this.vadTimer = setTimeout(run, VAD_CHECK_MS);
					}
				})
				.catch((error) => {
					loggers.stt.error('VAD check error: %s', (error as Error).message);
					if (this.running) {
						this.vadTimer = setTimeout(run, VAD_CHECK_MS);
					}
				});
		};
		run();
	}

	private async runVadCheck(): Promise<void> {
		while (this.vadQueueBytes >= BYTES_PER_CHECK) {
			const frame = this.dequeueBytes(BYTES_PER_CHECK);
			const frameSumSq = this.calculateSumSq(frame);
			const rms =
				Math.sqrt(frameSumSq / (BYTES_PER_CHECK / BYTES_PER_SAMPLE)) / 32768;
			const isSpeech = rms > SPEECH_RMS_THRESHOLD;

			if (isSpeech) {
				if (!this.isInSpeech) {
					for (const preRollFrame of this.preRoll.drain()) {
						this.sendFrame(preRollFrame);
					}
				}
				this.silenceCheckCount = 0;
				this.speechCheckCount++;
				this.isInSpeech = true;
				this.sendFrame(frame);
			} else {
				this.silenceCheckCount++;
				if (this.isInSpeech) {
					this.sendFrame(frame);
				} else {
					this.preRoll.remember(frame);
				}
			}

			if (this.shouldFlush()) {
				this.markFinal();
			}
		}
	}

	private shouldFlush(): boolean {
		// Flush on silence after enough speech
		if (
			this.isInSpeech &&
			this.silenceCheckCount >= SILENCE_CHECKS_TO_FLUSH &&
			this.speechCheckCount >= MIN_SPEECH_CHECKS
		) {
			return true;
		}
		// Extended silence: flush whatever audio we have, even short utterances.
		// Catches trailing words that didn't reach MIN_SPEECH_CHECKS.
		if (
			this.isInSpeech &&
			this.silenceCheckCount >= SHORT_UTTERANCE_SILENCE_CHECKS &&
			this.speechCheckCount >= MIN_TAIL_CHECKS
		) {
			return true;
		}
		return false;
	}

	private sendFrame(frame: Buffer): void {
		if (this.isActiveSpeaker && !this.isActiveSpeaker()) {
			loggers.stt.debug(
				'Speaker %s not active, discarding frame',
				this.participantId,
			);
			return;
		}
		this.sttStream?.sendAudio(frame);
		if (this.captureDirectory) this.captureFrames.push(Buffer.from(frame));
		this.streamedBytes += frame.length;
	}

	private markFinal(): void {
		if (this.streamedBytes < BYTES_PER_CHECK * MIN_TAIL_CHECKS) {
			this.resetVadState();
			return;
		}
		const durationMs =
			(this.streamedBytes / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
		loggers.stt.debug(
			'Marking final %d ms (%d checks) for %s session %s',
			durationMs.toFixed(0),
			this.speechCheckCount,
			this.participantId,
			this.sessionId,
		);
		this.writeCapture(durationMs);
		this.sttStream?.markFinal(durationMs);
		this.resetVadState();
	}

	private resetVadState(): void {
		this.speechCheckCount = 0;
		this.silenceCheckCount = 0;
		this.isInSpeech = false;
		this.streamedBytes = 0;
		this.captureFrames = [];
		this.preRoll.clear();
	}

	private writeCapture(durationMs: number): void {
		if (!this.captureDirectory || this.captureFrames.length === 0) return;
		try {
			const metadataPath = writePcmCapture(
				this.captureDirectory,
				Buffer.concat(this.captureFrames),
				{
					sessionId: this.sessionId,
					roomId: this.roomId,
					participantId: this.participantId,
					producerId: this.producer.id,
					sampleRate: SAMPLE_RATE,
					channels: OUTPUT_CHANNELS,
					durationMs,
				},
			);
			this.pendingCaptureMetadata.push(metadataPath);
			loggers.stt.info('Captured STT utterance at %s', metadataPath);
		} catch (error) {
			loggers.stt.warn(
				'Failed to capture STT utterance: %s',
				(error as Error).message,
			);
		}
	}

	private recordCaptureTranscript(transcript: string): void {
		const metadataPath = this.pendingCaptureMetadata.shift();
		if (!metadataPath) return;
		try {
			updatePcmCaptureTranscript(metadataPath, transcript);
		} catch (error) {
			loggers.stt.warn(
				'Failed to update STT capture transcript: %s',
				(error as Error).message,
			);
		}
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private calculateSumSq(buffer: Buffer): number {
		let sum = 0;
		for (let i = 0; i < buffer.length; i += BYTES_PER_SAMPLE) {
			const sample = buffer.readInt16LE(i);
			sum += sample * sample;
		}
		return sum;
	}

	/**
	 * Read exactly `n` bytes from the front of the vad queue.
	 * Handles partial buffers by splitting/consuming from the head.
	 */
	private dequeueBytes(n: number): Buffer {
		const out = Buffer.alloc(n);
		let written = 0;

		while (written < n && this.vadQueue.length > 0) {
			const head = this.vadQueue[0];
			const remaining = n - written;

			if (head.length <= remaining) {
				head.copy(out, written);
				written += head.length;
				this.vadQueue.shift();
				this.vadQueueBytes -= head.length;
			} else {
				head.copy(out, written, 0, remaining);
				this.vadQueue[0] = head.subarray(remaining);
				this.vadQueueBytes -= remaining;
				written += remaining;
			}
		}

		return out;
	}

	private buildSdp(port: number, payloadType: number): string {
		return [
			'v=0',
			'o=- 0 0 IN IP4 127.0.0.1',
			's=STT',
			'c=IN IP4 127.0.0.1',
			't=0 0',
			`m=audio ${port} RTP/AVP ${payloadType}`,
			`a=rtpmap:${payloadType} opus/48000/2`,
			'',
		].join('\n');
	}

	private findAvailablePort(): Promise<number> {
		return new Promise((resolve, reject) => {
			const socket = dgram.createSocket('udp4');
			socket.bind(0, '127.0.0.1', () => {
				const address = socket.address();
				socket.close(() => {
					resolve(address.port);
				});
			});
			socket.on('error', reject);
		});
	}
}
