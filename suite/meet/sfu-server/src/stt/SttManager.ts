import type { Producer, Router } from 'mediasoup/types';
import type { ServerToClientEvents, TranscriptSegment } from '../types';
import { loggers } from '../utils/logger';
import { AudioIngester } from './AudioIngester';
import { preloadSpeechDetector } from './SpeechDetector';
import {
	type ISttClient,
	MockSttClient,
	SttCapacityError,
	SttClient,
} from './SttClient';

interface SttManagerOptions {
	/** URL of the STT server (e.g. http://127.0.0.1:8080) */
	sttServerUrl?: string;
	/** Bearer token sent to the STT server, when it requires authentication */
	sttApiKey?: string;
	/** Use mock client in development when no STT server is configured */
	allowMockFallback?: boolean;
	sttClient?: ISttClient;
	onAudioSent?: (seconds: number) => void;
}

type EmitSttToSubscribers = (
	roomId: string,
	socketIds: ReadonlySet<string>,
	event: 'stt:segment',
	data: Parameters<ServerToClientEvents['stt:segment']>[0],
) => void;

export class SttManager {
	private static readonly STREAM_RECOVERY_DELAYS_MS = [0, 1000, 5000, 10_000];
	private static readonly STREAM_RECOVERY_RESET_MS = 60_000;
	private sttClient: ISttClient;
	private activeSessions = new Map<string, AudioIngester>();
	private roomSubscribers = new Map<string, Set<string>>();
	private sessionRecoveries = new Map<string, symbol>();
	private sessionRecoveryHistory = new Map<
		string,
		{ attempt: number; startedAt: number }
	>();
	private stoppingRooms = new Map<string, number>();
	private emitToSubscribers: EmitSttToSubscribers | undefined;
	private getRouter: ((roomId: string) => Router | undefined) | undefined;
	private getRoomNames: ((roomId: string) => string[]) | undefined;
	private restartRoomTranscription:
		| ((roomId: string) => Promise<void>)
		| undefined;
	private configured: boolean;
	private onAudioSent?: (seconds: number) => void;

	constructor(options: SttManagerOptions) {
		this.onAudioSent = options.onAudioSent;
		this.configured = Boolean(
			options.sttClient ||
				options.sttServerUrl?.trim() ||
				options.allowMockFallback,
		);
		if (options.sttClient) {
			this.sttClient = options.sttClient;
		} else if (options.sttServerUrl) {
			const url = options.sttServerUrl.trim();
			loggers.stt.info('Using STT server: %s', url);
			this.sttClient = new SttClient(url, options.sttApiKey);
		} else if (options.allowMockFallback) {
			loggers.stt.warn('No STT server URL configured. Using mock client.');
			this.sttClient = new MockSttClient();
		} else {
			loggers.stt.warn('STT disabled: no server URL and mock fallback is off.');
			this.sttClient = new MockSttClient();
		}
		this.sttClient.onAvailable(() => this.restartSubscribedRooms());
	}

	async prepareSpeechDetection(): Promise<void> {
		if (!this.configured) return;
		try {
			await preloadSpeechDetector();
		} catch (error) {
			loggers.stt.error(
				'Speech detector preload failed: %s',
				(error as Error).message,
			);
		}
	}

	setEmitToSubscribers(fn: EmitSttToSubscribers): void {
		this.emitToSubscribers = fn;
	}

	setGetRouter(fn: (roomId: string) => Router | undefined): void {
		this.getRouter = fn;
	}

	setGetRoomNames(fn: (roomId: string) => string[]): void {
		this.getRoomNames = fn;
	}

	setRestartRoomTranscription(fn: (roomId: string) => Promise<void>): void {
		this.restartRoomTranscription = fn;
		if (this.sttClient.isAvailable()) this.restartSubscribedRooms();
	}

	isAvailable(): boolean {
		return this.configured && this.sttClient.isAvailable();
	}

	hasSubscribers(roomId: string): boolean {
		return (this.roomSubscribers.get(roomId)?.size ?? 0) > 0;
	}

	/** Aggregate rooms, subscribers, ingesters, and held streams; recovering ingesters lack streams. */
	getResourceCounts(): Record<string, number> {
		return {
			stt_subscribed_rooms: this.roomSubscribers.size,
			stt_subscribers: [...this.roomSubscribers.values()].reduce(
				(total, subscribers) => total + subscribers.size,
				0,
			),
			stt_producer_ingesters: this.activeSessions.size,
			stt_realtime_streams: [...this.activeSessions.values()].filter(
				(ingester) => ingester.hasRealtimeStream(),
			).length,
		};
	}

	beginSession(roomId: string, socketId: string): boolean {
		if (!this.isAvailable()) throw new Error('STT is unavailable');
		if ((this.stoppingRooms.get(roomId) ?? 0) > 0) return false;
		if (!this.roomSubscribers.has(roomId)) {
			this.roomSubscribers.set(roomId, new Set());
		}
		const set = this.roomSubscribers.get(roomId)!;
		const wasFirst = set.size === 0;
		set.add(socketId);
		loggers.stt.info(
			'STT subscriber added for room %s (socket: %s, total: %d)',
			roomId,
			socketId,
			set.size,
		);
		return wasFirst;
	}

	removeSubscriber(roomId: string, socketId: string): boolean {
		const set = this.roomSubscribers.get(roomId);
		if (!set) return false;
		set.delete(socketId);
		const isEmpty = set.size === 0;
		if (isEmpty) {
			this.roomSubscribers.delete(roomId);
		}
		loggers.stt.info(
			'STT subscriber removed for room %s (socket: %s, total: %d)',
			roomId,
			socketId,
			set.size,
		);
		return isEmpty;
	}

	async startTranscription(
		roomId: string,
		participantId: string,
		participantName: string | undefined,
		producer: Producer,
		transcriptParticipantId = participantId,
		retryOnCapacity = true,
	): Promise<void> {
		if (producer.closed) return;
		if ((this.stoppingRooms.get(roomId) ?? 0) > 0) return;
		if (!this.hasSubscribers(roomId)) {
			loggers.stt.debug('STT has no subscribers for room %s, skipping', roomId);
			return;
		}

		const sessionKey = this.getSessionKey(roomId, participantId, producer.id);
		if (this.activeSessions.has(sessionKey)) {
			loggers.stt.debug('Transcription already active for %s', sessionKey);
			return;
		}

		if (!this.isAvailable()) {
			loggers.stt.warn('STT server unavailable, cannot start transcription');
			return;
		}

		const router = this.getRouter?.(roomId);
		if (!router) {
			loggers.stt.error('Router not found for room %s', roomId);
			return;
		}

		const ingester = new AudioIngester({
			roomId,
			participantId,
			producer,
			router,
			sttClient: this.sttClient,
			getNames: () => this.getRoomNames?.(roomId) ?? [],
			onAudioSent: this.onAudioSent,
			onUnexpectedStreamClose: () => {
				void this.recoverIngester(
					sessionKey,
					ingester,
					roomId,
					participantId,
					participantName,
					producer,
					transcriptParticipantId,
				).catch((error) => {
					loggers.stt.warn(
						'Failed to recover STT stream for %s: %s',
						sessionKey,
						(error as Error).message,
					);
				});
			},
			onTranscript: (text, isFinal, durationMs) => {
				this.handleTranscript(
					roomId,
					transcriptParticipantId,
					participantName,
					text,
					isFinal,
					durationMs,
				);
			},
		});

		this.activeSessions.set(sessionKey, ingester);
		try {
			await ingester.start();
			if (this.activeSessions.get(sessionKey) === ingester) {
				this.sessionRecoveryHistory.set(sessionKey, {
					attempt: this.sessionRecoveryHistory.get(sessionKey)?.attempt ?? 0,
					startedAt: Date.now(),
				});
			}
		} catch (error) {
			if (this.activeSessions.get(sessionKey) === ingester) {
				if (error instanceof SttCapacityError && retryOnCapacity) {
					void this.recoverIngester(
						sessionKey,
						ingester,
						roomId,
						participantId,
						participantName,
						producer,
						transcriptParticipantId,
					).catch((recoveryError) => {
						loggers.stt.warn(
							'STT capacity recovery failed for %s: %s',
							sessionKey,
							(recoveryError as Error).message,
						);
					});
				} else {
					this.activeSessions.delete(sessionKey);
				}
			}
			throw error;
		}
	}

	async stopTranscription(
		roomId: string,
		participantId: string,
		producerId?: string,
	): Promise<void> {
		if (producerId) {
			const sessionKey = this.getSessionKey(roomId, participantId, producerId);
			this.sessionRecoveries.delete(sessionKey);
			this.sessionRecoveryHistory.delete(sessionKey);
			const ingester = this.activeSessions.get(sessionKey);
			if (!ingester) return;

			this.activeSessions.delete(sessionKey);
			await ingester.stop();
			return;
		}

		// A failed replacement may leave a retry without an active ingester.
		for (const key of new Set([
			...this.sessionRecoveries.keys(),
			...this.sessionRecoveryHistory.keys(),
		])) {
			if (key.startsWith(`${roomId}:${participantId}:`)) {
				this.sessionRecoveries.delete(key);
				this.sessionRecoveryHistory.delete(key);
			}
		}
		const stops: Promise<void>[] = [];
		for (const [key, ingester] of this.activeSessions) {
			if (key.startsWith(`${roomId}:${participantId}:`)) {
				this.sessionRecoveries.delete(key);
				this.activeSessions.delete(key);
				stops.push(ingester.stop());
			}
		}
		await Promise.all(stops);
	}

	async stopRoom(roomId: string, restartIfSubscribed = false): Promise<void> {
		const subscribers = this.roomSubscribers.get(roomId);
		if (!restartIfSubscribed) {
			this.stoppingRooms.set(roomId, (this.stoppingRooms.get(roomId) ?? 0) + 1);
		}
		this.roomSubscribers.delete(roomId);
		try {
			await this.stopRoomTranscriptions(roomId);
			if (restartIfSubscribed && subscribers?.size) {
				this.roomSubscribers.set(roomId, subscribers);
				await this.restartRoomTranscription?.(roomId);
			}
		} finally {
			if (!restartIfSubscribed) {
				this.roomSubscribers.delete(roomId);
				const remainingStops = (this.stoppingRooms.get(roomId) ?? 1) - 1;
				if (remainingStops > 0) this.stoppingRooms.set(roomId, remainingStops);
				else this.stoppingRooms.delete(roomId);
			}
		}
	}

	private async stopRoomTranscriptions(roomId: string): Promise<void> {
		for (const sessionKey of new Set([
			...this.sessionRecoveries.keys(),
			...this.sessionRecoveryHistory.keys(),
		])) {
			if (sessionKey.startsWith(`${roomId}:`)) {
				this.sessionRecoveries.delete(sessionKey);
				this.sessionRecoveryHistory.delete(sessionKey);
			}
		}
		const stops: Promise<void>[] = [];
		for (const [key, ingester] of this.activeSessions) {
			if (key.startsWith(`${roomId}:`)) {
				this.activeSessions.delete(key);
				stops.push(
					ingester.stop().catch((error) => {
						loggers.stt.error(
							'Error stopping ingester: %s',
							(error as Error).message,
						);
					}),
				);
			}
		}
		await Promise.all(stops);
	}

	destroy(): void {
		this.sttClient.destroy?.();
	}

	private handleTranscript(
		roomId: string,
		participantId: string,
		participantName: string | undefined,
		text: string,
		isFinal: boolean,
		durationMs: number,
	): void {
		const now = Date.now();
		const segment: TranscriptSegment = {
			participantId,
			participantName,
			text,
			isFinal,
			timestamp: new Date(now).toISOString(),
			segmentStart: now - durationMs,
			segmentEnd: now,
		};

		const subscribers = this.roomSubscribers.get(roomId);
		if (this.emitToSubscribers && subscribers?.size) {
			this.emitToSubscribers(roomId, subscribers, 'stt:segment', {
				roomId,
				segment,
			});
		}
	}

	private restartSubscribedRooms(): void {
		if (!this.restartRoomTranscription) return;
		for (const roomId of this.roomSubscribers.keys()) {
			this.restartSubscribedRoom(roomId).catch((error) => {
				loggers.stt.warn(
					'Failed to restart STT for room %s: %s',
					roomId,
					(error as Error).message,
				);
			});
		}
	}

	private async restartSubscribedRoom(roomId: string): Promise<void> {
		await this.stopRoomTranscriptions(roomId);
		if (this.hasSubscribers(roomId)) {
			await this.restartRoomTranscription?.(roomId);
		}
	}

	private async recoverIngester(
		sessionKey: string,
		failedIngester: AudioIngester,
		roomId: string,
		participantId: string,
		participantName: string | undefined,
		producer: Producer,
		transcriptParticipantId: string,
	): Promise<void> {
		if (this.activeSessions.get(sessionKey) !== failedIngester) return;
		const recovery = Symbol(sessionKey);
		this.sessionRecoveries.set(sessionKey, recovery);
		const history = this.sessionRecoveryHistory.get(sessionKey);
		// A successful start alone does not prove recovery: rapid runtime exits
		// retain their backoff until a replacement has stayed alive for a minute.
		let attempt =
			history &&
			Date.now() - history.startedAt < SttManager.STREAM_RECOVERY_RESET_MS
				? history.attempt
				: 0;

		try {
			await failedIngester.stop();
			while (this.sessionRecoveries.get(sessionKey) === recovery) {
				const delayMs =
					SttManager.STREAM_RECOVERY_DELAYS_MS[
						Math.min(attempt, SttManager.STREAM_RECOVERY_DELAYS_MS.length - 1)
					];
				attempt = Math.min(
					attempt + 1,
					SttManager.STREAM_RECOVERY_DELAYS_MS.length - 1,
				);
				if (this.sessionRecoveries.get(sessionKey) !== recovery) return;
				const activeIngester = this.activeSessions.get(sessionKey);
				if (activeIngester && activeIngester !== failedIngester) return;
				if (
					!this.hasSubscribers(roomId) ||
					producer.closed ||
					!this.isAvailable()
				) {
					this.activeSessions.delete(sessionKey);
					this.sessionRecoveryHistory.delete(sessionKey);
					return;
				}
				if (delayMs > 0)
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				if (this.sessionRecoveries.get(sessionKey) !== recovery) return;
				const replacement = this.activeSessions.get(sessionKey);
				if (replacement && replacement !== failedIngester) return;
				if (
					!this.hasSubscribers(roomId) ||
					producer.closed ||
					!this.isAvailable()
				) {
					this.activeSessions.delete(sessionKey);
					this.sessionRecoveryHistory.delete(sessionKey);
					return;
				}

				this.activeSessions.delete(sessionKey);
				this.sessionRecoveryHistory.set(sessionKey, {
					attempt,
					startedAt: history?.startedAt ?? Date.now(),
				});
				try {
					await this.startTranscription(
						roomId,
						participantId,
						participantName,
						producer,
						transcriptParticipantId,
						false,
					);
					if (this.activeSessions.has(sessionKey)) return;
					throw new Error('STT replacement did not start');
				} catch (error) {
					if (this.sessionRecoveries.get(sessionKey) !== recovery) return;
					loggers.stt.warn(
						'STT stream recovery attempt failed for %s: %s',
						sessionKey,
						(error as Error).message,
					);
				}
			}
		} finally {
			if (this.sessionRecoveries.get(sessionKey) === recovery) {
				this.sessionRecoveries.delete(sessionKey);
			}
		}
	}

	private getSessionKey(
		roomId: string,
		participantId: string,
		producerId: string,
	): string {
		return `${roomId}:${participantId}:${producerId}`;
	}
}
