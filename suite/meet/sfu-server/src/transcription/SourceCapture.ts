import { createHash, randomUUID } from 'node:crypto';
import type { Producer, Router } from 'mediasoup/types';
import { AudioIngester } from '../stt/AudioIngester';
import { createSpeechDetector } from '../stt/SpeechDetector';
import type { ISttClient } from '../stt/SttClient';
import { SpeechSegmenter } from './SpeechSegmenter';

export interface Gap {
	start_ms: number;
	end_ms: number;
	reason: string;
}
/** One decoded microphone source. No live ASR service or caption subscriber is involved. */
export class SourceCapture {
	private ingester: AudioIngester;
	private segmenter: SpeechSegmenter | null = null;
	private pcmWork: Promise<void> = Promise.resolve();
	private queuedPcmBytes = 0;
	private lastEndMs = 0;
	private lastDecodedAt = 0;
	private byteTail = Buffer.alloc(0);
	private pending = 0;
	private stopped = false;
	private stopping: Promise<void> | null = null;
	private acknowledgedEndMs = 0;
	private uploads: Promise<void> = Promise.resolve();
	private failed = false;
	constructor(
		private readonly options: {
			capture: string;
			speakerId: string;
			speakerName: string;
			producer: Producer;
			router: Router;
			epoch: number;
			maxDurationMs: number;
			recorderOrigin: string;
			token: string;
			onFailure: (gap: Gap) => void;
		},
	) {
		// AudioIngester's capture tap returns before opening any inference stream.
		const noInference: ISttClient = {
			createStream: async () => {
				throw new Error('inference_disabled');
			},
			isAvailable: () => false,
			onAvailable: () => {},
		};
		this.ingester = new AudioIngester({
			roomId: options.capture,
			participantId: options.speakerId,
			producer: options.producer,
			router: options.router,
			sttClient: noInference,
			onPcm: (pcm) => this.pcm(pcm),
			onUnexpectedStreamClose: () => this.failure('source_interrupted'),
			onTranscript: () => {},
		});
	}
	async start(): Promise<void> {
		this.segmenter = new SpeechSegmenter(
			await createSpeechDetector(),
			(audio, start, end) => this.upload(audio, start, end),
		);
		await this.ingester.start();
	}
	flushIdle(): void {
		if (this.lastDecodedAt && performance.now() - this.lastDecodedAt >= 700) {
			this.lastDecodedAt = 0;
			this.pcmWork = this.pcmWork
				.then(() => this.segmenter!.finishSpan())
				.catch(() => this.failure('source_interrupted'));
		}
	}
	private failure(reason: string): void {
		if (this.failed) return;
		this.failed = true;
		const end = Math.min(
			this.options.maxDurationMs,
			Math.max(
				1,
				Math.ceil(
					Math.max(this.lastEndMs, performance.now() - this.options.epoch),
				),
			),
		);
		this.options.onFailure({
			start_ms: Math.max(
				0,
				Math.min(Math.floor(this.acknowledgedEndMs), end - 1),
			),
			end_ms: end,
			reason,
		});
	}
	private pcm(data: Buffer): void {
		if (this.stopped || this.failed) return;
		this.lastDecodedAt = performance.now();
		const joined = this.byteTail.length
			? Buffer.concat([this.byteTail, data])
			: data;
		const audio = Buffer.from(
			joined.subarray(0, joined.length - (joined.length % 2)),
		);
		this.byteTail = Buffer.from(joined.subarray(audio.length));
		if (!audio.length) return;
		const observedEnd = Math.min(
			this.options.maxDurationMs,
			performance.now() - this.options.epoch,
		);
		const observedStart = Math.max(0, observedEnd - audio.length / 48);
		const discontinuity = observedStart - this.lastEndMs > 500;
		const start =
			this.lastEndMs === 0 || discontinuity ? observedStart : this.lastEndMs;
		const count = Math.min(
			audio.length,
			Math.max(0, Math.floor((this.options.maxDurationMs - start) * 24) * 2),
		);
		if (!count) return;
		this.lastEndMs = start + count / 48;
		if (this.queuedPcmBytes + count > 2880000) {
			this.failure('source_interrupted');
			return;
		}
		this.queuedPcmBytes += count;
		this.pcmWork = this.pcmWork
			.then(async () => {
				if (this.failed) return;
				if (discontinuity) await this.segmenter!.finishSpan();
				await this.segmenter!.push(audio.subarray(0, count), start);
			})
			.catch(() => this.failure('source_interrupted'))
			.finally(() => {
				this.queuedPcmBytes -= count;
			});
	}
	private upload(audio: Buffer, start: number, end: number): void {
		if (Math.round(end) <= Math.round(start)) return;
		const id = randomUUID();
		if (this.pending >= 4) {
			this.failure('upload_failed');
			return;
		}
		this.pending++;
		this.uploads = this.uploads
			.then(async () => {
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						const response = await fetch(
							`${this.options.recorderOrigin}/v1/transcriptions/${encodeURIComponent(this.options.capture)}/segments/${id}`,
							{
								method: 'PUT',
								headers: {
									authorization: `Bearer ${this.options.token}`,
									'content-type': 'application/octet-stream',
									'x-speaker-id': encodeURIComponent(this.options.speakerId),
									'x-speaker-name': encodeURIComponent(
										this.options.speakerName,
									),
									'x-start-ms': String(Math.round(start)),
									'x-end-ms': String(Math.round(end)),
									'x-sha256': createHash('sha256').update(audio).digest('hex'),
								},
								body: new Uint8Array(audio),
								signal: AbortSignal.timeout(10000),
								redirect: 'error',
							},
						);
						if (!response.ok) throw new Error('source_upload_failed');
						this.acknowledgedEndMs = Math.max(this.acknowledgedEndMs, end);
						return;
					} catch {
						if (attempt === 2) this.failure('upload_failed');
					}
				}
			})
			.finally(() => {
				this.pending--;
			});
	}
	async stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		this.stopping = (async () => {
			await this.ingester.stop();
			this.stopped = true;
			await this.pcmWork;
			await this.segmenter?.finishSpan();
			await this.uploads;
		})();
		return this.stopping;
	}
}
