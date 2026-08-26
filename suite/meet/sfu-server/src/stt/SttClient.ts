import WebSocket from 'ws';
import { loggers } from '../utils/logger';

export interface SttStreamMetadata {
	sessionId: string;
	roomId: string;
	participantId: string;
	producerId: string;
	participantName?: string;
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
}

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
	private availableListeners = new Set<() => void>();
	private readonly healthCheckIntervalMs = 10_000;

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
		if (this.healthCheckInFlight) return;
		this.healthCheckInFlight = true;
		fetch(`${this.serverUrl}/health`, { headers: this.authHeaders() })
			.then((res) => {
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
				this.available = false;
				loggers.stt.debug(
					'STT server unreachable at %s: %s',
					this.serverUrl,
					err.message,
				);
			})
			.finally(() => {
				this.healthCheckInFlight = false;
			});
	}

	destroy(): void {
		if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
		this.healthCheckTimer = null;
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
		this.bufferedBytes += frame.length;
		this.sendEvent({
			type: 'input_audio_buffer.append',
			audio: frame.toString('base64'),
		});
	}

	markFinal(durationMs: number): void {
		if (
			!this.ready ||
			this.socket.readyState !== WebSocket.OPEN ||
			this.bufferedBytes === 0
		)
			return;
		this.pendingDurations.push(durationMs);
		this.pendingCommits++;
		this.bufferedBytes = 0;
		this.sendEvent({ type: 'input_audio_buffer.commit' });
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

	private sendEvent(event: object): void {
		if (this.socket.readyState === WebSocket.OPEN)
			this.socket.send(JSON.stringify(event));
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
	private available = true;

	isAvailable(): boolean {
		return this.available;
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
	private chunks: Buffer[] = [];
	private bytes = 0;
	private sequence = 0;

	constructor(
		private metadata: SttStreamMetadata,
		private onTranscript: (event: SttTranscriptEvent) => void,
	) {}

	sendAudio(frame: Buffer): void {
		this.chunks.push(frame);
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
		this.chunks = [];
		this.bytes = 0;
	}

	onUnexpectedClose(_listener: () => void): void {}

	async close(): Promise<void> {
		this.chunks = [];
		this.bytes = 0;
	}
}
