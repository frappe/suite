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
import {
	createSpeechDetector,
	SILERO_REVISION,
	SILERO_SHA256,
	type SpeechDetector,
} from './SpeechDetector';
import {
	type ISttClient,
	type ISttStream,
	MAX_STT_UTTERANCE_MS,
} from './SttClient';
import { SttDiagnostics } from './SttDiagnostics';

interface AudioIngesterOptions {
	speechDetector?: SpeechDetector;
	roomId: string;
	participantId: string;
	producer: Producer;
	router: Router;
	sttClient: ISttClient;
	getNames?: () => string[];
	onAudioSent?: (seconds: number) => void;
	onUnexpectedStreamClose: () => void;
	onTranscript: (text: string, isFinal: boolean, durationMs: number) => void;
}

// ── VAD / Streaming Config ───────────────────────────────────────────────────
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2; // s16le
const OUTPUT_CHANNELS = 1; // ASR input is mono; Meet still publishes stereo Opus.

/** Duration of each decoded-audio speech check (ms) */
const VAD_CHECK_MS = 100;
/** Bytes of audio per VAD check */
const BYTES_PER_CHECK = (SAMPLE_RATE * BYTES_PER_SAMPLE * VAD_CHECK_MS) / 1000;
const MAX_UTTERANCE_BYTES =
	(SAMPLE_RATE * BYTES_PER_SAMPLE * MAX_STT_UTTERANCE_MS) / 1000;
const SILENCE_CHECKS_TO_FLUSH = Math.max(
	1,
	Math.ceil(
		Number.parseInt(process.env.STT_SILENCE_MS || '500', 10) / VAD_CHECK_MS,
	),
);
const MIN_SPEECH_CHECKS = Math.max(
	1,
	Math.ceil(
		Number.parseInt(process.env.STT_MIN_SPEECH_MS || '600', 10) / VAD_CHECK_MS,
	),
);
const MIN_TAIL_CHECKS = Math.max(
	1,
	Math.ceil(
		Number.parseInt(process.env.STT_MIN_TAIL_MS || '200', 10) / VAD_CHECK_MS,
	),
);
const SHORT_UTTERANCE_SILENCE_CHECKS = Math.max(
	SILENCE_CHECKS_TO_FLUSH,
	Math.ceil(
		Number.parseInt(process.env.STT_SHORT_UTTERANCE_SILENCE_MS || '700', 10) /
			VAD_CHECK_MS,
	),
);

/** Captures one producer, decodes its audio, and streams VAD-delimited speech to STT. */
export class AudioIngester {
	private roomId: string;
	private participantId: string;
	private producer: Producer;
	private router: Router;
	private sttClient: ISttClient;
	private getNames?: () => string[];
	private onAudioSent?: (seconds: number) => void;
	private sttStream: ISttStream | null = null;
	private sessionId = randomUUID();
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
	private pendingSpeechFrames: Buffer[] = [];
	private pendingSpeechBytes = 0;
	private preRollFrames: Buffer[] = [];
	private failureNotified = false;
	private diagnostics: SttDiagnostics | undefined;
	private diagnosticsTimer: NodeJS.Timeout | null = null;
	private lastDecodedAudioAt: number | null = null;
	private speechDetector: SpeechDetector | undefined;
	private vadGeneration = 0;
	private closingTranscriptGeneration: number | null = null;
	private stopping: Promise<void> | null = null;
	private readonly configuredPreRollChecks: number | undefined;

	constructor(options: AudioIngesterOptions) {
		this.speechDetector = options.speechDetector;
		const configuredPreRoll = process.env.STT_PRE_ROLL_MS;
		if (configuredPreRoll !== undefined) {
			const milliseconds = Number(configuredPreRoll);
			if (
				!configuredPreRoll.trim() ||
				!Number.isFinite(milliseconds) ||
				milliseconds < 0 ||
				milliseconds > MAX_STT_UTTERANCE_MS - VAD_CHECK_MS
			)
				throw new Error('STT_PRE_ROLL_MS must be between 0 and 14900');
			this.configuredPreRollChecks = Math.ceil(milliseconds / VAD_CHECK_MS);
		}
		this.roomId = options.roomId;
		this.participantId = options.participantId;
		this.producer = options.producer;
		this.router = options.router;
		this.sttClient = options.sttClient;
		this.getNames = options.getNames;
		this.onAudioSent = options.onAudioSent;
		this.onUnexpectedStreamClose = options.onUnexpectedStreamClose;
		this.onTranscript = options.onTranscript;
	}

	private get preRollChecks(): number {
		// Preserve real soft onsets while the learned detector accumulates context.
		return this.configuredPreRollChecks ?? 20;
	}

	/** Whether an ingester currently holds a stream; false between closure and recovery. */
	hasRealtimeStream(): boolean {
		return this.sttStream !== null;
	}

	async start(): Promise<void> {
		if (this.running) return;
		if (this.stopping) await this.stopping;
		if (this.running) return;
		const generation = ++this.vadGeneration;
		this.running = true;
		this.failureNotified = false;
		this.lastDecodedAudioAt = null;
		this.diagnostics = SttDiagnostics.create({
			roomId: this.roomId,
			participantId: this.participantId,
			producerId: this.producer.id,
			sessionId: this.sessionId,
		});

		try {
			const detector = this.speechDetector ?? (await createSpeechDetector());
			if (generation !== this.vadGeneration || !this.running) return;
			this.speechDetector = detector;
			detector.reset();
			this.diagnostics?.event('vad.configuration', {
				mode: this.speechDetector.mode,
				preRollMs: this.preRollChecks * VAD_CHECK_MS,
				revision:
					this.speechDetector.mode === 'silero' ? SILERO_REVISION : undefined,
				sha256:
					this.speechDetector.mode === 'silero' ? SILERO_SHA256 : undefined,
			});
			if (!this.running || generation !== this.vadGeneration) {
				if (!this.running) await this.stop();
				return;
			}
			await this.setupPlainTransport(generation);
			if (!this.running || generation !== this.vadGeneration) {
				if (!this.running) await this.stop();
				return;
			}
			await this.createConsumer(generation);
			if (!this.running || generation !== this.vadGeneration) {
				if (!this.running) await this.stop();
				return;
			}
			await this.startFfmpeg(generation);
			if (!this.running || generation !== this.vadGeneration) {
				if (!this.running) await this.stop();
				return;
			}
			await this.plainTransport!.connect({
				ip: '127.0.0.1',
				port: this.ffmpegPort,
			});
			if (!this.running || generation !== this.vadGeneration) {
				if (!this.running) await this.stop();
				return;
			}
			const stream = await this.sttClient.createStream(
				{
					sessionId: this.sessionId,
					sampleRate: SAMPLE_RATE,
					language: process.env.NEMOTRON_LANGUAGE || 'en-US',
					getNames: this.getNames,
					diagnostics: this.diagnostics,
				},
				(event) => {
					if (
						generation === this.vadGeneration ||
						generation === this.closingTranscriptGeneration
					)
						this.onTranscript(event.text, event.isFinal, event.durationMs);
				},
			);
			if (!this.running || generation !== this.vadGeneration) {
				await stream.close();
				if (!this.running) await this.stop();
				return;
			}
			this.sttStream = stream;
			stream.onUnexpectedClose(() => {
				if (!this.running || this.sttStream !== stream) return;
				this.notifyFailure();
			});
			if (!this.running || this.sttStream !== stream) return;
			this.startVadLoop();
			this.startDiagnosticStats();

			loggers.stt.info(
				'AudioIngester started for %s in room %s (producer %s, session %s, ffmpeg port %d, vad=%s, preRollMs=%d)',
				this.participantId,
				this.roomId,
				this.producer.id,
				this.sessionId,
				this.ffmpegPort,
				this.speechDetector.mode,
				this.preRollChecks * VAD_CHECK_MS,
			);
		} catch (error) {
			if (generation !== this.vadGeneration) return;
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
		if (this.stopping) return this.stopping;
		const stopping = this.stopResources();
		this.stopping = stopping;
		try {
			await stopping;
		} finally {
			if (this.stopping === stopping) this.stopping = null;
		}
	}

	private async stopResources(): Promise<void> {
		this.closingTranscriptGeneration = this.sttStream
			? this.vadGeneration
			: null;
		this.running = false;
		this.vadGeneration++;
		this.speechDetector?.reset();
		if (this.diagnosticsTimer) clearTimeout(this.diagnosticsTimer);
		this.diagnosticsTimer = null;
		this.lastDecodedAudioAt = null;

		if (this.vadTimer) {
			clearTimeout(this.vadTimer);
			this.vadTimer = null;
		}

		if (this.streamedBytes > 0 && this.speechCheckCount >= MIN_TAIL_CHECKS) {
			this.markFinal();
		}

		this.resetVadState();
		this.vadQueue = [];
		this.vadQueueBytes = 0;
		const stream = this.sttStream;
		this.sttStream = null;
		try {
			if (stream) await stream.close();
		} finally {
			this.closingTranscriptGeneration = null;
		}
		void this.diagnostics?.close();

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

	private async setupPlainTransport(generation: number): Promise<void> {
		const transport = await this.router.createPlainTransport({
			listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
			rtcpMux: true,
			comedia: false,
		});
		if (!this.running || generation !== this.vadGeneration) {
			transport.close();
			return;
		}
		this.plainTransport = transport;
	}

	private async createConsumer(generation: number): Promise<void> {
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

		const consumer = await this.plainTransport!.consume({
			producerId: this.producer.id,
			rtpCapabilities,
		});
		if (!this.running || generation !== this.vadGeneration) {
			consumer.close();
			return;
		}
		this.consumer = consumer;
	}

	private async startFfmpeg(generation: number): Promise<void> {
		const port = await this.findAvailablePort();
		if (!this.running || generation !== this.vadGeneration) return;
		this.ffmpegPort = port;
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
			// Muted/DTX producers can stop sending RTP indefinitely. Keep the
			// decoder ready for resumed audio instead of restarting the ingester.
			'-listen_timeout',
			'-1',
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

		const ffmpeg = spawn('ffmpeg', args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		this.ffmpeg = ffmpeg;
		ffmpeg.stdout!.on('data', (data: Buffer) => {
			if (
				this.running &&
				this.ffmpeg === ffmpeg &&
				generation === this.vadGeneration
			)
				this.handleDecodedAudio(data);
		});

		ffmpeg.stderr!.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg && process.env.SFU_LOG_LEVEL === 'debug') {
				loggers.stt.debug('ffmpeg: %s', msg.slice(0, 200));
			}
		});

		this.watchFfmpeg(ffmpeg);
	}

	private handleDecodedAudio(data: Buffer): void {
		if (!data.length) return;
		this.lastDecodedAudioAt = performance.now();
		this.diagnostics?.pcm('before-vad', data);
		if (this.vadQueueBytes + data.length > MAX_UTTERANCE_BYTES) {
			this.notifyFailure();
			return;
		}
		this.vadQueue.push(data);
		this.vadQueueBytes += data.length;
	}

	private watchFfmpeg(ffmpeg: ChildProcess): void {
		ffmpeg.on('error', (error) => {
			loggers.stt.error(
				'ffmpeg error for %s: %s',
				this.participantId,
				error.message,
			);
			if (this.ffmpeg === ffmpeg) this.notifyFailure();
		});

		ffmpeg.on('exit', (code, signal) => {
			if (this.ffmpeg === ffmpeg && this.running) {
				loggers.stt.warn(
					'ffmpeg exited unexpectedly (code=%s, signal=%s, producerPaused=%s, decodedAudioIdleMs=%s) for %s',
					code,
					signal,
					this.producer.paused,
					this.lastDecodedAudioAt === null
						? null
						: Math.round(performance.now() - this.lastDecodedAudioAt),
					this.participantId,
				);
				this.notifyFailure();
			}
		});
	}

	private startDiagnosticStats(): void {
		const capture = this.diagnostics;
		if (!capture) return;
		const sample = async () => {
			if (!this.running || !capture.isCapturing()) return;
			await capture.rtpStats(this.producer, this.consumer).catch(() => {});
			if (this.running && capture.isCapturing()) {
				this.diagnosticsTimer = setTimeout(() => {
					void sample();
				}, 2000);
				this.diagnosticsTimer.unref();
			}
		};
		void sample();
	}

	// ── VAD loop ───────────────────────────────────────────────────────────────

	private startVadLoop(): void {
		const generation = this.vadGeneration;
		const run = () => {
			if (!this.running || generation !== this.vadGeneration) return;
			this.runVadCheck()
				.then(() => {
					if (this.running && generation === this.vadGeneration) {
						this.vadTimer = setTimeout(run, VAD_CHECK_MS);
					}
				})
				.catch((error) => {
					if (!this.running || generation !== this.vadGeneration) return;
					loggers.stt.error('VAD check error: %s', (error as Error).message);
					this.notifyFailure();
				});
		};
		run();
	}

	private async runVadCheck(): Promise<void> {
		const generation = this.vadGeneration;
		const stream = this.sttStream;
		if (!this.speechDetector)
			throw new Error('Speech detector is not initialized');
		while (this.vadQueueBytes >= BYTES_PER_CHECK) {
			const frame = this.dequeueBytes(BYTES_PER_CHECK);
			const decision = await this.speechDetector.detect(frame);
			if (generation !== this.vadGeneration || stream !== this.sttStream)
				return;
			const isSpeech = decision.speech;
			this.diagnostics?.event('vad.decision', {
				speech: isSpeech,
				probability: decision.probability,
			});

			if (isSpeech) {
				if (!this.isInSpeech) {
					for (const preRollFrame of this.preRollFrames) {
						this.sendFrame(preRollFrame);
					}
					this.preRollFrames = [];
				}
				this.silenceCheckCount = 0;
				this.speechCheckCount++;
				this.isInSpeech = true;
				this.sendFrame(frame);
			} else {
				this.silenceCheckCount++;
				if (this.isInSpeech) {
					this.sendFrame(frame);
				} else if (this.preRollChecks > 0) {
					this.preRollFrames.push(frame);
					if (this.preRollFrames.length > this.preRollChecks) {
						this.preRollFrames.shift();
					}
				}
			}

			if (this.shouldFlush()) {
				this.markFinal();
			}
			if (this.streamedBytes >= MAX_UTTERANCE_BYTES) this.markFinal();
		}
		await this.flushIdleUtterance(generation, stream);
	}

	private async flushIdleUtterance(
		generation: number,
		stream: ISttStream | null,
	): Promise<void> {
		// DTX can stop PCM entirely: expire context and endpoint real buffered audio
		// by elapsed inactivity, without synthesizing samples or leaking a server buffer.
		if (
			this.lastDecodedAudioAt === null ||
			this.vadQueueBytes % BYTES_PER_SAMPLE !== 0
		)
			return;
		const silenceChecks =
			this.isInSpeech && this.speechCheckCount >= MIN_SPEECH_CHECKS
				? SILENCE_CHECKS_TO_FLUSH
				: SHORT_UTTERANCE_SILENCE_CHECKS;
		if (
			performance.now() - this.lastDecodedAudioAt <
			silenceChecks * VAD_CHECK_MS
		)
			return;
		if (!this.isInSpeech) {
			this.resetVadState();
			this.vadQueue = [];
			this.vadQueueBytes = 0;
			this.lastDecodedAudioAt = null;
			this.speechDetector?.reset();
			return;
		}
		if (this.vadQueueBytes > 0) {
			const tail = this.dequeueBytes(this.vadQueueBytes);
			await this.speechDetector!.detect(tail);
			if (generation !== this.vadGeneration || stream !== this.sttStream)
				return;
			this.sendFrame(tail);
		}
		if (
			this.lastDecodedAudioAt === null ||
			this.vadQueueBytes > 0 ||
			performance.now() - this.lastDecodedAudioAt < silenceChecks * VAD_CHECK_MS
		)
			return;
		if (this.streamedBytes < BYTES_PER_CHECK * MIN_TAIL_CHECKS) {
			// Subminimum audio stays local, so discarding it leaves capture and
			// the server stream intact for the next utterance.
			this.diagnostics?.event('vad.idle-discard', {
				bytes: this.pendingSpeechBytes,
			});
			this.resetVadState();
			this.lastDecodedAudioAt = null;
			this.speechDetector?.reset();
			return;
		}
		this.diagnostics?.event('vad.idle-final', {
			idleMs: performance.now() - this.lastDecodedAudioAt,
		});
		this.markFinal();
		this.lastDecodedAudioAt = null;
		this.speechDetector?.reset();
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
		// Do not gate on the 800 ms speaker observer: short utterances can end
		// before its first update. Each producer already has its own VAD stream.
		const stream = this.sttStream;
		if (!stream) return;
		// Keep a candidate locally until it can be finalized. A tiny DTX fragment
		// must not leave stale server audio or force a new transport/decoder.
		this.pendingSpeechFrames.push(frame);
		this.pendingSpeechBytes += frame.length;
		if (
			this.streamedBytes === 0 &&
			this.pendingSpeechBytes < BYTES_PER_CHECK * MIN_TAIL_CHECKS
		)
			return;
		for (const pending of this.pendingSpeechFrames) {
			if (stream.sendAudio(pending)) {
				this.onAudioSent?.(pending.length / BYTES_PER_SAMPLE / SAMPLE_RATE);
				this.streamedBytes += pending.length;
			}
		}
		this.pendingSpeechFrames = [];
		this.pendingSpeechBytes = 0;
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
		this.sttStream?.markFinal(durationMs);
		this.resetVadState();
	}

	private resetVadState(): void {
		this.speechCheckCount = 0;
		this.silenceCheckCount = 0;
		this.isInSpeech = false;
		this.streamedBytes = 0;
		this.pendingSpeechFrames = [];
		this.pendingSpeechBytes = 0;
		this.preRollFrames = [];
	}

	private notifyFailure(): void {
		if (!this.running || this.failureNotified) return;
		this.failureNotified = true;
		this.onUnexpectedStreamClose();
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

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
