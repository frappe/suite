import type { Producer, Router } from 'mediasoup/types';
import type { ServerToClientEvents, TranscriptSegment } from '../types';
import { loggers } from '../utils/logger';
import { AudioIngester } from './AudioIngester';
import { type ISttClient, MockSttClient, SttClient } from './SttClient';

interface SttManagerOptions {
	/** URL of the STT server (e.g. http://127.0.0.1:8080) */
	sttServerUrl?: string;
	/** Bearer token sent to the STT server, when it requires authentication */
	sttApiKey?: string;
	/** Use mock client in development when no STT server is configured */
	allowMockFallback?: boolean;
	captureDirectory?: string;
	sttClient?: ISttClient;
}

type EmitSttToSubscribers = (
	roomId: string,
	socketIds: ReadonlySet<string>,
	event: 'stt:segment',
	data: Parameters<ServerToClientEvents['stt:segment']>[0],
) => void;

export class SttManager {
	private static readonly STREAM_RECOVERY_DELAYS_MS = [0, 1000, 5000, 10_000];
	private sttClient: ISttClient;
	private activeSessions = new Map<string, AudioIngester>();
	private roomSubscribers = new Map<string, Set<string>>();
	private roomActiveSpeakers = new Map<string, Set<string>>();
	private sessionRecoveries = new Map<string, symbol>();
	private stoppingRooms = new Map<string, number>();
	private emitToSubscribers: EmitSttToSubscribers | undefined;
	private getRouter: ((roomId: string) => Router | undefined) | undefined;
	private restartRoomTranscription:
		| ((roomId: string) => Promise<void>)
		| undefined;
	private captureDirectory?: string;

	constructor(options: SttManagerOptions) {
		this.captureDirectory = options.captureDirectory;
		if (this.captureDirectory) {
			loggers.stt.warn(
				'STT diagnostic audio capture enabled at %s',
				this.captureDirectory,
			);
		}
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
			(this.sttClient as MockSttClient).isAvailable = () => false;
		}
		this.sttClient.onAvailable(() => this.restartSubscribedRooms());
	}

	setEmitToSubscribers(fn: EmitSttToSubscribers): void {
		this.emitToSubscribers = fn;
	}

	setGetRouter(fn: (roomId: string) => Router | undefined): void {
		this.getRouter = fn;
	}

	setRestartRoomTranscription(fn: (roomId: string) => Promise<void>): void {
		this.restartRoomTranscription = fn;
		if (this.sttClient.isAvailable()) this.restartSubscribedRooms();
	}

	setActiveSpeakers(roomId: string, participantIds: string[]): void {
		this.roomActiveSpeakers.set(roomId, new Set(participantIds));
	}

	isActiveSpeaker(roomId: string, participantId: string): boolean {
		const speakers = this.roomActiveSpeakers.get(roomId);
		if (!speakers) return true;
		return speakers.has(participantId);
	}

	hasSubscribers(roomId: string): boolean {
		return (this.roomSubscribers.get(roomId)?.size ?? 0) > 0;
	}

	getSubscribers(roomId: string): Set<string> | undefined {
		return this.roomSubscribers.get(roomId);
	}

	addSubscriber(roomId: string, socketId: string): boolean {
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
	): Promise<void> {
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

		if (!this.sttClient.isAvailable()) {
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
			participantName,
			producer,
			router,
			sttClient: this.sttClient,
			captureDirectory: this.captureDirectory,
			isActiveSpeaker: () => this.isActiveSpeaker(roomId, participantId),
			onUnexpectedStreamClose: () => {
				void this.recoverIngester(
					sessionKey,
					ingester,
					roomId,
					participantId,
					participantName,
					producer,
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
					participantId,
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
		} catch (error) {
			if (this.activeSessions.get(sessionKey) === ingester) {
				this.activeSessions.delete(sessionKey);
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
			const ingester = this.activeSessions.get(sessionKey);
			if (!ingester) return;

			this.activeSessions.delete(sessionKey);
			await ingester.stop();
			return;
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
		this.roomActiveSpeakers.delete(roomId);
		try {
			await this.stopRoomTranscriptions(roomId);
			if (restartIfSubscribed && subscribers?.size) {
				this.roomSubscribers.set(roomId, subscribers);
				await this.restartRoomTranscription?.(roomId);
			}
		} finally {
			if (!restartIfSubscribed) {
				this.roomSubscribers.delete(roomId);
				this.roomActiveSpeakers.delete(roomId);
				const remainingStops = (this.stoppingRooms.get(roomId) ?? 1) - 1;
				if (remainingStops > 0) this.stoppingRooms.set(roomId, remainingStops);
				else this.stoppingRooms.delete(roomId);
			}
		}
	}

	private async stopRoomTranscriptions(roomId: string): Promise<void> {
		for (const sessionKey of this.sessionRecoveries.keys()) {
			if (sessionKey.startsWith(`${roomId}:`)) {
				this.sessionRecoveries.delete(sessionKey);
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
		if (typeof (this.sttClient as SttClient).destroy === 'function') {
			(this.sttClient as SttClient).destroy();
		}
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
	): Promise<void> {
		if (this.activeSessions.get(sessionKey) !== failedIngester) return;
		const recovery = Symbol(sessionKey);
		this.sessionRecoveries.set(sessionKey, recovery);

		try {
			await failedIngester.stop();
			let currentIngester = failedIngester;
			let attempt = 0;
			while (this.sessionRecoveries.get(sessionKey) === recovery) {
				const delayMs =
					SttManager.STREAM_RECOVERY_DELAYS_MS[
						Math.min(attempt, SttManager.STREAM_RECOVERY_DELAYS_MS.length - 1)
					];
				attempt++;
				if (this.sessionRecoveries.get(sessionKey) !== recovery) return;
				if (this.activeSessions.get(sessionKey) !== currentIngester) return;
				if (
					!this.hasSubscribers(roomId) ||
					producer.closed ||
					!this.sttClient.isAvailable()
				) {
					this.activeSessions.delete(sessionKey);
					return;
				}
				if (delayMs > 0)
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				if (this.sessionRecoveries.get(sessionKey) !== recovery) return;
				if (this.activeSessions.get(sessionKey) !== currentIngester) return;

				this.activeSessions.delete(sessionKey);
				try {
					await this.startTranscription(
						roomId,
						participantId,
						participantName,
						producer,
					);
					const replacement = this.activeSessions.get(sessionKey);
					if (replacement && replacement !== currentIngester) return;
					throw new Error('STT replacement did not start');
				} catch (error) {
					if (this.sessionRecoveries.get(sessionKey) !== recovery) return;
					currentIngester =
						this.activeSessions.get(sessionKey) ?? currentIngester;
					this.activeSessions.set(sessionKey, currentIngester);
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
