import { randomUUID } from 'node:crypto';
import fs, { type WriteStream } from 'node:fs';
import path from 'node:path';
import type { Consumer, Producer } from 'mediasoup/types';

const SAMPLE_RATE = 24_000;
const MAX_SECONDS = 60;
const MAX_PCM_BYTES = SAMPLE_RATE * 2 * MAX_SECONDS;
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_QUEUED_BYTES = 256 * 1024;
const DEFAULT_MAX_SESSIONS = 10;
const HARD_MAX_SESSIONS = 20;
let captureAttempts = 0;

type Boundary = 'before-vad' | 'stt-sent';
type DiagnosticValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| DiagnosticValue[]
	| { [field: string]: DiagnosticValue };
interface CaptureIdentity {
	roomId: string;
	participantId: string;
	producerId: string;
	sessionId: string;
}

/** Private, bounded diagnostic slices; never enabled by a caption subscriber. */
export class SttDiagnostics {
	private startedAt = performance.now();
	private offsets: Record<Boundary, number> = {
		'before-vad': 0,
		'stt-sent': 0,
	};
	private eventBytes = 0;
	private ended = false;
	private closing: Promise<void> | null = null;
	private timer: NodeJS.Timeout;
	private streams: Record<Boundary | 'events', WriteStream>;

	static create(identity: CaptureIdentity): SttDiagnostics | undefined {
		const directory = process.env.STT_DIAGNOSTICS_DIR;
		const roomIds = (
			process.env.STT_DIAGNOSTICS_ROOM_IDS ||
			process.env.STT_DIAGNOSTICS_ROOM_ID ||
			''
		)
			.split(',')
			.map((value) => value.trim());
		const configuredLimit = process.env.STT_DIAGNOSTICS_MAX_SESSIONS;
		const maxSessions =
			configuredLimit === undefined
				? DEFAULT_MAX_SESSIONS
				: /^\d+$/.test(configuredLimit)
					? Number(configuredLimit)
					: 0;
		if (
			!directory ||
			!path.isAbsolute(directory) ||
			roomIds.length > HARD_MAX_SESSIONS ||
			roomIds.some(
				(value) => !value || value.length > 140 || value.includes('*'),
			) ||
			!roomIds.includes(identity.roomId) ||
			maxSessions < 1 ||
			maxSessions > HARD_MAX_SESSIONS ||
			captureAttempts >= maxSessions
		)
			return undefined;
		captureAttempts++;
		try {
			const capture = new SttDiagnostics(directory, identity, maxSessions);
			return capture;
		} catch {
			// Diagnostics must never prevent audio publication or transcription.
			return undefined;
		}
	}

	private constructor(
		directory: string,
		identity: CaptureIdentity,
		maxSessions: number,
	) {
		fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
		const capturePath = path.join(directory, randomUUID());
		fs.mkdirSync(capturePath, { mode: 0o700 });
		fs.writeFileSync(
			path.join(capturePath, 'metadata.json'),
			`${JSON.stringify({
				version: 1,
				...identity,
				startedAt: new Date().toISOString(),
				format: { encoding: 's16le', sampleRate: SAMPLE_RATE, channels: 1 },
				limits: {
					seconds: MAX_SECONDS,
					pcmBytesPerBoundary: MAX_PCM_BYTES,
					eventBytes: MAX_EVENT_BYTES,
					sessionsPerProcess: maxSessions,
				},
				meaning:
					'stt-sent means queued on websocket, not acknowledged by the STT server',
			})}\n`,
			{ mode: 0o600, flag: 'wx' },
		);
		const open = (name: string) =>
			fs.createWriteStream(path.join(capturePath, name), {
				mode: 0o600,
				flags: 'wx',
			});
		this.streams = {
			'before-vad': open('before-vad.pcm'),
			'stt-sent': open('stt-sent.pcm'),
			events: open('events.jsonl'),
		};
		for (const stream of Object.values(this.streams)) {
			stream.on('error', () => {
				void this.close('io-error');
			});
		}
		this.timer = setTimeout(() => {
			void this.close('time-limit');
		}, MAX_SECONDS * 1000);
		this.timer.unref();
	}

	pcm(boundary: Boundary, audio: Buffer): void {
		if (this.ended) return;
		if (this.offsets[boundary] + audio.length > MAX_PCM_BYTES) {
			void this.close('pcm-limit');
			return;
		}
		if (
			this.streams[boundary].writableLength + audio.length >
			MAX_QUEUED_BYTES
		) {
			void this.close('write-backlog');
			return;
		}
		const offset = this.offsets[boundary];
		this.streams[boundary].write(audio);
		this.offsets[boundary] += audio.length;
		this.event('pcm', { boundary, offset, bytes: audio.length });
	}

	event(type: string, fields: Record<string, DiagnosticValue> = {}): void {
		if (this.ended) return;
		const line = `${JSON.stringify({
			type,
			elapsedMs: performance.now() - this.startedAt,
			...fields,
		})}\n`;
		const bytes = Buffer.byteLength(line);
		if (
			this.eventBytes + bytes > MAX_EVENT_BYTES - 1024 ||
			this.streams.events.writableLength + bytes > MAX_QUEUED_BYTES
		) {
			void this.close('event-limit');
			return;
		}
		this.streams.events.write(line);
		this.eventBytes += bytes;
	}

	isCapturing(): boolean {
		return !this.ended;
	}

	async rtpStats(producer: Producer, consumer: Consumer | null): Promise<void> {
		if (this.ended) return;
		const snapshots = await Promise.allSettled([
			producer.getStats(),
			consumer?.getStats() ?? Promise.resolve([]),
		]);
		const counters = [
			'type',
			'timestamp',
			'kind',
			'mimeType',
			'ssrc',
			'rtxSsrc',
			'packetCount',
			'byteCount',
			'bitrate',
			'packetsLost',
			'packetsDiscarded',
			'packetsRepaired',
			'packetsRetransmitted',
			'rtxPacketCount',
			'rtxByteCount',
			'jitter',
			'score',
		];
		const sanitize = (result: PromiseSettledResult<unknown>) =>
			result.status === 'fulfilled' && Array.isArray(result.value)
				? result.value.map((row) =>
						Object.fromEntries(
							counters.flatMap((key) => {
								const value = row[key];
								return (typeof value === 'number' && Number.isFinite(value)) ||
									(typeof value === 'string' && value.length <= 80)
									? [[key, value]]
									: [];
							}),
						),
					)
				: [];
		this.event('rtp.stats', {
			producerPaused: producer.paused,
			producerClosed: producer.closed,
			consumerPaused: consumer?.paused,
			consumerProducerPaused: consumer?.producerPaused,
			consumerClosed: consumer?.closed,
			producerStats: sanitize(snapshots[0]),
			consumerStats: sanitize(snapshots[1]),
			producerStatsUnavailable: snapshots[0].status === 'rejected',
			consumerStatsUnavailable: snapshots[1].status === 'rejected',
		});
	}

	commit(): void {
		this.event('stt.commit.sent', { audioOffset: this.offsets['stt-sent'] });
	}

	close(reason = 'ingester-stopped'): Promise<void> {
		if (this.closing) return this.closing;
		if (!this.ended) {
			// Keep termination evidence even if normal event capture reached its bound.
			const line = `${JSON.stringify({
				type: 'capture.end',
				elapsedMs: performance.now() - this.startedAt,
				reason,
				offsets: this.offsets,
			})}\n`;
			if (
				!this.streams.events.destroyed &&
				this.eventBytes + Buffer.byteLength(line) <= MAX_EVENT_BYTES
			)
				this.streams.events.write(line);
		}
		this.ended = true;
		clearTimeout(this.timer);
		this.closing = Promise.all(
			Object.values(this.streams).map(
				(stream) =>
					new Promise<void>((resolve) => {
						if (stream.closed) {
							resolve();
							return;
						}
						stream.once('close', resolve);
						stream.end();
					}),
			),
		).then(() => {});
		return this.closing;
	}
}
