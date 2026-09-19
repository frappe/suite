import WebSocket from 'ws';
import { loggers } from '../utils/logger';

export interface SttStreamMetadata {
	sessionId: string;
	sampleRate: number;
	language?: string;
}

export interface SttTranscriptEvent {
	text: string;
	isFinal: boolean;
	durationMs: number;
	sequence: number;
}

export interface ISttStream {
	sendAudio(frame: Buffer): void;
	markFinal(durationMs: number): void;
	onUnexpectedClose(listener: () => void): void;
	close(): Promise<void>;
}

export interface ISttClient {
	createStream(
		metadata: SttStreamMetadata,
		onTranscript: (event: SttTranscriptEvent) => void,
	): Promise<ISttStream>;
	isAvailable(): boolean;
	onAvailable(listener: () => void): void;
	destroy?(): void;
}

export const MAX_STT_UTTERANCE_MS = 15_000;
const MAX_WEBSOCKET_BUFFERED_BYTES = 1024 * 1024;
const MAX_PENDING_COMMITS = 8;
const HEALTH_CHECK_TIMEOUT_MS = 5000;

interface RealtimeServerMessage {
	type?: string;
	item_id?: string;
	delta?: string;
	transcript?: string;
	error?: { message?: string };
}

export class SttClient implements ISttClient {
	private serverUrl: string;
	private apiKey?: string;
	private available = false;
	private healthCheckInFlight = false;
	private healthCheckTimer: NodeJS.Timeout | null = null;
	private healthCheckController: AbortController | null = null;
	private availableListeners = new Set<() => void>();
	private readonly healthCheckIntervalMs = 10_000;
	private destroyed = false;

	constructor(serverUrl: string, apiKey?: string) {
		this.serverUrl = serverUrl.replace(/\/$/, '');
		this.apiKey = apiKey?.trim() || undefined;
		this.checkHealth();
		this.startHealthCheckLoop();
	}

	private startHealthCheckLoop(): void {
		this.healthCheckTimer = setInterval(() => {
			this.checkHealth();
		}, this.healthCheckIntervalMs);
	}

	private checkHealth(): void {
		if (this.destroyed || this.healthCheckInFlight) return;
		this.healthCheckInFlight = true;
		const controller = new AbortController();
		this.healthCheckController = controller;
		const timeout = setTimeout(
			() => controller.abort(),
			HEALTH_CHECK_TIMEOUT_MS,
		);
		fetch(`${this.serverUrl}/health`, {
			headers: this.authHeaders(),
			signal: controller.signal,
		})
			.then((res) => {
				if (this.destroyed) return;
				if (res.ok || res.status === 404) {
					// 404 means the backend has no health endpoint; treat as reachable.
					const recovered = !this.available;
					this.available = true;
					loggers.stt.info('STT server reachable at %s', this.serverUrl);
					if (recovered) {
						for (const listener of this.availableListeners) listener();
					}
				} else {
					this.available = false;
					loggers.stt.warn(
						'STT server health check failed (status %d)',
						res.status,
					);
				}
			})
			.catch((err) => {
				if (this.destroyed) return;
				this.available = false;
				loggers.stt.debug(
					'STT server unreachable at %s: %s',
					this.serverUrl,
					err.message,
				);
			})
			.finally(() => {
				clearTimeout(timeout);
				if (this.healthCheckController === controller) {
					this.healthCheckController = null;
				}
				this.healthCheckInFlight = false;
			});
	}

	destroy(): void {
		this.destroyed = true;
		if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
		this.healthCheckTimer = null;
		this.healthCheckController?.abort();
		this.healthCheckController = null;
		this.available = false;
		this.availableListeners.clear();
	}

	isAvailable(): boolean {
		return this.available;
	}

	onAvailable(listener: () => void): void {
		this.availableListeners.add(listener);
	}

	async createStream(
		metadata: SttStreamMetadata,
		onTranscript: (event: SttTranscriptEvent) => void,
	): Promise<ISttStream> {
		const socket = new WebSocket(this.getStreamUrl(), {
			headers: this.authHeaders(),
		});
		const stream = new SttStream(socket, metadata, onTranscript);
		try {
			await stream.connect();
			return stream;
		} catch (error) {
			this.available = false;
			await stream.close();
			throw error;
		}
	}

	private authHeaders(): Record<string, string> {
		return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
	}

	private getStreamUrl(): string {
		const wsBase = this.serverUrl
			.replace(/^http:/, 'ws:')
			.replace(/^https:/, 'wss:');
		return `${wsBase}/v1/realtime`;
	}
}

class SttStream implements ISttStream {
	private sequence = 0;
	private bufferedBytes = 0;
	private pendingCommits = 0;
	private pendingDurations: number[] = [];
	private durationByItem = new Map<string, number>();
	private textByItem = new Map<string, string>();
	private pendingWaiters = new Set<() => void>();
	private readyResolve: (() => void) | null = null;
	private readyReject: ((error: Error) => void) | null = null;
	private ready = false;
	private closeRequested = false;
	private unexpectedlyClosed = false;
	private unexpectedCloseDelivered = false;
	private unexpectedCloseListener: (() => void) | null = null;

	constructor(
		private socket: WebSocket,
		private metadata: SttStreamMetadata,
		private onTranscript: (event: SttTranscriptEvent) => void,
	) {
		this.socket.on('message', (data) => this.handleMessage(data.toString()));
		this.socket.on('error', (error) => this.readyReject?.(error));
		this.socket.on('close', (code, reason) => {
			const wasReady = this.ready;
			this.ready = false;
			this.readyReject?.(
				new Error(
					`STT stream closed before setup (${code}: ${reason.toString()})`,
				),
			);
			this.resolvePendingWaiters();
			if (wasReady && !this.closeRequested) {
				this.unexpectedlyClosed = true;
				this.deliverUnexpectedClose();
			}
			loggers.stt.debug(
				'STT stream closed for %s (code=%d, reason=%s)',
				this.metadata.sessionId,
				code,
				reason.toString(),
			);
		});
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error('Timed out configuring STT Realtime session')),
				5000,
			);
			this.readyResolve = () => {
				clearTimeout(timer);
				this.ready = true;
				resolve();
			};
			this.readyReject = (error) => {
				clearTimeout(timer);
				reject(error);
			};
		});
	}

	sendAudio(frame: Buffer): void {
		if (!this.ready || this.socket.readyState !== WebSocket.OPEN) return;
		const maxUtteranceBytes =
			(this.metadata.sampleRate * 2 * MAX_STT_UTTERANCE_MS) / 1000;
		if (this.bufferedBytes + frame.length > maxUtteranceBytes) {
			this.fail(
				new Error(`STT utterance exceeded ${MAX_STT_UTTERANCE_MS} ms limit`),
			);
			return;
		}
		if (
			!this.sendEvent({
				type: 'input_audio_buffer.append',
				audio: frame.toString('base64'),
			})
		)
			return;
		this.bufferedBytes += frame.length;
	}

	markFinal(durationMs: number): void {
		if (
			!this.ready ||
			this.socket.readyState !== WebSocket.OPEN ||
			this.bufferedBytes === 0
		)
			return;
		if (this.pendingCommits >= MAX_PENDING_COMMITS) {
			this.fail(
				new Error('STT server is not acknowledging committed utterances'),
			);
			return;
		}
		if (this.sendEvent({ type: 'input_audio_buffer.commit' })) {
			this.pendingDurations.push(durationMs);
			this.pendingCommits++;
			this.bufferedBytes = 0;
		}
	}

	onUnexpectedClose(listener: () => void): void {
		this.unexpectedCloseListener = listener;
		this.deliverUnexpectedClose();
	}

	async close(): Promise<void> {
		this.closeRequested = true;
		if (this.isSocketClosed()) return;
		await this.waitForPendingCommits();
		if (this.isSocketClosed()) return;
		await new Promise<void>((resolve) => {
			this.socket.once('close', () => resolve());
			this.socket.close();
		});
	}

	private handleMessage(raw: string): void {
		let message: RealtimeServerMessage;
		try {
			message = JSON.parse(raw) as RealtimeServerMessage;
		} catch {
			loggers.stt.warn('Dropping malformed STT Realtime message');
			return;
		}

		if (message.type === 'session.created') {
			this.sendEvent({
				type: 'session.update',
				session: {
					type: 'transcription',
					audio: {
						input: {
							format: { type: 'audio/pcm', rate: this.metadata.sampleRate },
							transcription: {
								model:
									process.env.NEMOTRON_MODEL ||
									'nemotron-3.5-asr-streaming-0.6b',
								language: this.metadata.language || 'en-US',
							},
							turn_detection: null,
						},
					},
				},
			});
			return;
		}
		if (message.type === 'session.updated') {
			this.readyResolve?.();
			this.readyResolve = null;
			this.readyReject = null;
			return;
		}
		if (message.type === 'error') {
			const error = new Error(message.error?.message || 'STT Realtime error');
			if (!this.ready) this.readyReject?.(error);
			else loggers.stt.warn('%s', error.message);
			return;
		}

		const itemId = message.item_id;
		if (!itemId) return;
		if (message.type === 'input_audio_buffer.committed') {
			this.durationByItem.set(itemId, this.pendingDurations.shift() || 0);
			return;
		}
		if (message.type === 'conversation.item.input_audio_transcription.delta') {
			const text = `${this.textByItem.get(itemId) || ''}${message.delta || ''}`;
			this.textByItem.set(itemId, text);
			if (text.trim())
				this.emitTranscript(
					text.trim(),
					false,
					this.durationByItem.get(itemId) || 0,
				);
			return;
		}
		if (
			message.type === 'conversation.item.input_audio_transcription.completed'
		) {
			this.emitTranscript(
				(message.transcript || this.textByItem.get(itemId) || '').trim(),
				true,
				this.durationByItem.get(itemId) || 0,
			);
			this.finishItem(itemId);
			return;
		}
		if (message.type === 'conversation.item.input_audio_transcription.failed') {
			loggers.stt.warn(
				'STT transcription failed for item %s: %s',
				itemId,
				message.error?.message || 'unknown',
			);
			this.finishItem(itemId);
		}
	}

	private emitTranscript(
		text: string,
		isFinal: boolean,
		durationMs: number,
	): void {
		if (!text && !isFinal) return;
		this.sequence++;
		this.onTranscript({ text, isFinal, durationMs, sequence: this.sequence });
	}

	private finishItem(itemId: string): void {
		this.durationByItem.delete(itemId);
		this.textByItem.delete(itemId);
		this.pendingCommits = Math.max(0, this.pendingCommits - 1);
		if (this.pendingCommits === 0) this.resolvePendingWaiters();
	}

	private sendEvent(event: object): boolean {
		if (this.socket.readyState !== WebSocket.OPEN) return false;
		const payload = JSON.stringify(event);
		if (
			this.socket.bufferedAmount + Buffer.byteLength(payload) >
			MAX_WEBSOCKET_BUFFERED_BYTES
		) {
			this.fail(new Error('STT WebSocket outbound buffer limit exceeded'));
			return false;
		}
		this.socket.send(payload);
		return true;
	}

	private fail(error: Error): void {
		if (this.closeRequested || this.unexpectedlyClosed) return;
		loggers.stt.warn('%s', error.message);
		this.ready = false;
		this.unexpectedlyClosed = true;
		this.resolvePendingWaiters();
		this.deliverUnexpectedClose();
		this.socket.terminate();
	}

	private isSocketClosed(): boolean {
		return this.socket.readyState === WebSocket.CLOSED;
	}

	private deliverUnexpectedClose(): void {
		if (
			!this.unexpectedlyClosed ||
			this.unexpectedCloseDelivered ||
			!this.unexpectedCloseListener
		)
			return;
		this.unexpectedCloseDelivered = true;
		this.unexpectedCloseListener();
	}

	private waitForPendingCommits(): Promise<void> {
		if (this.pendingCommits === 0) return Promise.resolve();
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timer);
				this.pendingWaiters.delete(done);
				resolve();
			};
			const timer = setTimeout(done, 15_000);
			this.pendingWaiters.add(done);
		});
	}

	private resolvePendingWaiters(): void {
		for (const resolve of [...this.pendingWaiters]) resolve();
	}
}

export class MockSttClient implements ISttClient {
	isAvailable(): boolean {
		return true;
	}

	onAvailable(_listener: () => void): void {}

	async createStream(
		metadata: SttStreamMetadata,
		onTranscript: (event: SttTranscriptEvent) => void,
	): Promise<ISttStream> {
		return new MockSttStream(metadata, onTranscript);
	}
}

class MockSttStream implements ISttStream {
	private bytes = 0;
	private sequence = 0;

	constructor(
		private metadata: SttStreamMetadata,
		private onTranscript: (event: SttTranscriptEvent) => void,
	) {}

	sendAudio(frame: Buffer): void {
		this.bytes += frame.length;
	}

	markFinal(durationMs: number): void {
		if (this.bytes === 0) return;
		this.sequence++;
		const seconds = this.bytes / 2 / this.metadata.sampleRate;
		loggers.stt.info(
			'[MockSTT] Would transcribe %d bytes (~%ds audio) for session %s',
			this.bytes,
			seconds.toFixed(1),
			this.metadata.sessionId,
		);
		this.onTranscript({
			text: `[Mock #${this.sequence}: ~${seconds.toFixed(1)}s]`,
			isFinal: true,
			durationMs,
			sequence: this.sequence,
		});
		this.bytes = 0;
	}

	onUnexpectedClose(_listener: () => void): void {}

	async close(): Promise<void> {
		this.bytes = 0;
	}
}
