/**
 * SFU Media Manager
 * Handles producer/consumer operations and media track management
 */

import type { Producer } from "mediasoup-client/types";
import type { ConsumerEntry, ConsumerManager } from "../media/ConsumerManager";
import type { ParticipantManager } from "../media/ParticipantManager";
import type { TransportManager } from "../media/TransportManager";
import type { VideoElementManager } from "../media/VideoElementManager";
import { publishInitialMediaWithRetry } from "./initialMediaPublication";

interface MediaHandler {
	localStream: MediaStream | null;
	audioProducer: Producer | null;
	videoProducer: Producer | null;
	screenProducer: Producer | null;
	setProducers(producers?: Partial<MediaHandler>): void;
	stopScreenShare(): void;
	cleanup(): void;
}

function createMediaHandler(): MediaHandler {
	return {
		localStream: null,
		audioProducer: null,
		videoProducer: null,
		screenProducer: null,
		setProducers(producers = {}) {
			Object.assign(this, producers);
		},
		stopScreenShare() {
			this.screenProducer = null;
		},
		cleanup() {
			for (const p of [
				this.audioProducer,
				this.videoProducer,
				this.screenProducer,
			]) {
				try {
					p?.close();
				} catch (error: unknown) {
					console.warn("Failed to close producer during cleanup:", error);
				}
			}

			this.localStream = null;
			this.audioProducer = null;
			this.videoProducer = null;
			this.screenProducer = null;
		},
	};
}

interface MediaManagerOptions {
	transportManager: TransportManager;
	videoManager: VideoElementManager;
	consumerManager: ConsumerManager;
	participantManager: ParticipantManager;
}

export interface PublishedMedia {
	videoProducer?: Producer;
	audioProducer?: Producer;
	screenProducer?: Producer;
	videoError?: unknown;
	audioError?: unknown;
}

export interface ConsumerMetadata {
	isScreen?: boolean;
}

interface MediaEventHandlers {
	onScreenShareStarted?: (data: MediaScreenShareEvent) => void;
	onScreenShareStopped?: (data: MediaScreenShareEvent) => void;
	onRecoveryExhausted?: () => void;
}

export interface MediaScreenShareEvent {
	participantId: string;
	stream?: MediaStream;
	consumer?: ConsumerEntry;
}

export class SFUMediaManager {
	transportManager: TransportManager;
	videoManager: VideoElementManager;
	consumerManager: ConsumerManager;
	participantManager: ParticipantManager;
	mediaHandler: MediaHandler;

	processedConsumers: Set<string>;
	isScreenShareActive: boolean;
	eventTarget: EventTarget;

	private eventHandlers: MediaEventHandlers = {};
	private getCurrentUserId: () => string | null;
	private resubscribeAttempts: Map<string, number> = new Map();
	private pendingSubscriptions: Map<string, Promise<unknown | null>> = new Map();
	private resubscribeTimers = new Set<ReturnType<typeof setTimeout>>();
	private subscriptionGeneration = 0;
	private receiveSubscriptionsClosed = false;
	private sendMediaMutationQueue: Promise<unknown> = Promise.resolve();
	private sendMediaMutationGeneration = 0;
	private cleanupPromise: Promise<void> | null = null;
	private static readonly MAX_RESUBSCRIBE_ATTEMPTS = 3;
	private static readonly RESUBSCRIBE_DELAY_MS = 250;

	constructor(
		options: MediaManagerOptions,
		getCurrentUserId: () => string | null,
	) {
		this.transportManager = options.transportManager;
		this.videoManager = options.videoManager;
		this.consumerManager = options.consumerManager;
		this.participantManager = options.participantManager;
		this.mediaHandler = createMediaHandler();
		this.processedConsumers = new Set();
		this.isScreenShareActive = false;
		this.eventTarget = new EventTarget();
		this.getCurrentUserId = getCurrentUserId;
	}

	setEventHandlers(handlers: MediaEventHandlers): void {
		this.eventHandlers = handlers;
	}

	setLocalTrack(
		kind: "audio" | "video",
		track: MediaStreamTrack | null,
	): void {
		const localStream = this.mediaHandler.localStream ?? new MediaStream();
		this.mediaHandler.localStream = localStream;
		const existingTracks =
			kind === "video"
				? localStream.getVideoTracks()
				: localStream.getAudioTracks();
		for (const existingTrack of existingTracks) {
			localStream.removeTrack(existingTrack);
		}
		if (track?.readyState === "live") {
			localStream.addTrack(track);
		}
	}

	serializeSendMediaMutation<T>(operation: () => Promise<T>): Promise<T> {
		const generation = this.sendMediaMutationGeneration;
		const lifecycleAbort = new DOMException(
			"Send media lifecycle has ended",
			"AbortError",
		);
		if (this.cleanupPromise) {
			return this.cleanupPromise.then(() => Promise.reject(lifecycleAbort));
		}

		const queuedResult = this.sendMediaMutationQueue.then(() => {
			if (
				generation !== this.sendMediaMutationGeneration ||
				this.cleanupPromise
			) {
				throw lifecycleAbort;
			}
			return operation();
		});
		this.sendMediaMutationQueue = queuedResult.catch(() => undefined);
		return queuedResult.catch(async (error) => {
			if (error === lifecycleAbort && this.cleanupPromise) {
				await this.cleanupPromise;
			}
			throw error;
		});
	}

	async publishMedia(
		localStream: MediaStream,
		options: { publishVideo?: boolean; publishAudio?: boolean } = {},
	): Promise<PublishedMedia> {
		return this.serializeSendMediaMutation(() =>
			this.publishMediaNow(localStream, options),
		);
	}

	async publishInitialMedia(
		localStream: MediaStream,
		options: { publishVideo: boolean; publishAudio: boolean },
		signal?: AbortSignal,
		finalize?: (publication: PublishedMedia) => void | Promise<void>,
	): Promise<PublishedMedia> {
		return this.serializeSendMediaMutation(async () => {
			const publication = await publishInitialMediaWithRetry(
				(stream, retryOptions) =>
					this.publishMediaNow(stream, retryOptions),
				localStream,
				options,
				signal,
			);
			await finalize?.(publication);
			return publication;
		});
	}

	private async publishMediaNow(
		localStream: MediaStream,
		options: { publishVideo?: boolean; publishAudio?: boolean } = {},
	): Promise<PublishedMedia> {
		const { publishVideo = true, publishAudio = true } = options;
		const results: PublishedMedia = {};
		const videoTrack = publishVideo
			? localStream.getVideoTracks().find((track) => track.readyState === "live") ??
				null
			: null;
		const audioTrack = publishAudio
			? localStream.getAudioTracks().find((track) => track.readyState === "live") ??
				null
			: null;
		const videoTrackToPublish = this.mediaHandler.videoProducer
			? null
			: videoTrack;
		const audioTrackToPublish = this.mediaHandler.audioProducer
			? null
			: audioTrack;
		const previousVideoTrack =
			this.mediaHandler.localStream
				?.getVideoTracks()
				.find((track) => track.readyState === "live") ?? null;
		const previousAudioTrack =
			this.mediaHandler.localStream
				?.getAudioTracks()
				.find((track) => track.readyState === "live") ?? null;

		try {
			if (!videoTrackToPublish && !audioTrackToPublish) return results;

			await this.transportManager.createSendTransport();

			if (videoTrackToPublish?.readyState === "live") {
				this.setLocalTrack("video", videoTrackToPublish);
				try {
					const videoProducer = await this.transportManager.createProducer(
						videoTrackToPublish,
						{ type: "camera" },
					);
					if (
						videoTrackToPublish.readyState !== "live" ||
						videoProducer.track?.readyState === "ended"
					) {
						videoProducer.close();
						this.setLocalTrack("video", previousVideoTrack);
					} else {
						results.videoProducer = videoProducer;
						this.mediaHandler.setProducers({ videoProducer });
						console.log("Video published successfully");
					}
				} catch (error: unknown) {
					results.videoError = error;
					console.warn(
						"Failed to publish video, continuing without video:",
						(error as Error).message,
					);
				}
			}

			if (audioTrackToPublish?.readyState === "live") {
				this.setLocalTrack("audio", audioTrackToPublish);
				try {
					const audioProducer = await this.transportManager.createProducer(
						audioTrackToPublish,
						{ type: "microphone" },
					);
					if (
						audioTrackToPublish.readyState !== "live" ||
						audioProducer.track?.readyState === "ended"
					) {
						audioProducer.close();
						this.setLocalTrack("audio", previousAudioTrack);
					} else {
						results.audioProducer = audioProducer;
						this.mediaHandler.setProducers({ audioProducer });
						console.log("Audio published successfully");
					}
				} catch (error: unknown) {
					results.audioError = error;
					console.warn(
						"Failed to publish audio, continuing without audio:",
						(error as Error).message,
					);
				}
			}
			console.log("Media published successfully");
			return results;
		} catch (error) {
			console.error("Failed to publish media:", error);
			throw error;
		}
	}

	async rebuildSendSide(): Promise<PublishedMedia> {
		return this.serializeSendMediaMutation(() => this.rebuildSendSideNow());
	}

	private async rebuildSendSideNow(): Promise<PublishedMedia> {
		const localStream = this.mediaHandler.localStream;
		const screenTrack = this.mediaHandler.screenProducer?.track;
		const hasLiveScreen = screenTrack?.readyState === "live";
		this.transportManager.closeSendTransport();
		this.mediaHandler.setProducers({
			audioProducer: null,
			videoProducer: null,
			screenProducer: null,
		});

		if (!localStream && !hasLiveScreen) return {};

		const hasLiveVideo =
			localStream?.getVideoTracks().some((track) => track.readyState === "live") ??
			false;
		const hasLiveAudio =
			localStream?.getAudioTracks().some((track) => track.readyState === "live") ??
			false;
		if (!hasLiveVideo && !hasLiveAudio && !hasLiveScreen) return {};

		const results = localStream
			? await this.publishMediaNow(localStream, {
					publishAudio: hasLiveAudio,
					publishVideo: hasLiveVideo,
				})
			: (await this.transportManager.createSendTransport(), {});

		if (hasLiveScreen && screenTrack) {
			const screenProducer = await this.transportManager.createProducer(screenTrack, {
				type: "screen",
			});
			this.mediaHandler.setProducers({ screenProducer });
			results.screenProducer = screenProducer;
		}

		return results;
	}

	async subscribeToProducer(
		producerId: string,
		participantId: string,
		metadata: ConsumerMetadata = {},
	): Promise<ConsumerEntry | false> {
		const generation = this.subscriptionGeneration;
		try {
			const consumer = await this.transportManager.createConsumer(
				producerId,
				metadata,
			);
			if (generation !== this.subscriptionGeneration) {
				consumer.close();
				throw new Error("Consumer subscription was cancelled");
			}

			const enhancedConsumer = this.consumerManager.addConsumer(
				consumer,
				participantId,
			);

			// for adaptive streaming
			if (enhancedConsumer && enhancedConsumer.kind === "video") {
				this.eventTarget.dispatchEvent(
					new CustomEvent("consumerReady", {
						detail: {
							consumerId: enhancedConsumer.id,
							participantId,
							kind: enhancedConsumer.kind,
						},
					}),
				);
			}

			return enhancedConsumer;
		} catch (error) {
			console.error(`Failed to subscribe to producer ${producerId}:`, error);
			throw error;
		}
	}

	async subscribeToRemoteProducer({
		producerId,
		participantId,
		isScreen,
	}: {
		producerId: string;
		participantId: string;
		isScreen: boolean;
	}): Promise<unknown | null> {
		if (this.receiveSubscriptionsClosed) {
			throw new DOMException("Receive media lifecycle has ended", "AbortError");
		}
		if (!producerId || !participantId) {
			return null;
		}

		if (participantId === this.getCurrentUserId()) {
			return null;
		}

		const key = this.resubscribeKey(participantId, producerId);
		const existing = this.consumerManager
			.getConsumersByParticipant(participantId)
			.find((entry) => entry.producerId === producerId);
		if (existing) return existing;

		const pending = this.pendingSubscriptions.get(key);
		if (pending) return pending;

		let subscription: Promise<unknown | null>;
		subscription = this.subscribeToProducer(producerId, participantId, {
			isScreen: !!isScreen,
		})
			.then((result) => {
				this.resubscribeAttempts.delete(key);
				return result;
			})
			.finally(() => {
				if (this.pendingSubscriptions.get(key) === subscription) {
					this.pendingSubscriptions.delete(key);
				}
			});
		this.pendingSubscriptions.set(key, subscription);
		return subscription;
	}

	async handleConsumerLost(info: {
		consumerId: string;
		participantId: string;
		producerId: string;
		kind: string;
		isScreen: boolean;
	}): Promise<void> {
		if (!info.participantId || !info.producerId) {
			return;
		}

		if (info.participantId === this.getCurrentUserId()) {
			return;
		}

		if (!this.participantManager.hasParticipant(info.participantId)) {
			return;
		}

		const key = this.resubscribeKey(info.participantId, info.producerId);
		const attempts = this.resubscribeAttempts.get(key) ?? 0;
		if (attempts >= SFUMediaManager.MAX_RESUBSCRIBE_ATTEMPTS) {
			console.warn("Giving up on re-subscribing to lost consumer", {
				participantId: info.participantId,
				producerId: info.producerId,
				kind: info.kind,
				attempts,
			});
			this.resubscribeAttempts.delete(key);
			this.eventHandlers.onRecoveryExhausted?.();
			return;
		}
		this.resubscribeAttempts.set(key, attempts + 1);

		const timer = setTimeout(() => {
			this.resubscribeTimers.delete(timer);
			void this.subscribeToRemoteProducer({
				producerId: info.producerId,
				participantId: info.participantId,
				isScreen: info.isScreen,
			}).catch((error: unknown) => {
				console.warn("Failed to re-subscribe to lost consumer", {
					participantId: info.participantId,
					producerId: info.producerId,
					error: (error as Error).message,
				});
			});
		}, SFUMediaManager.RESUBSCRIBE_DELAY_MS);
		this.resubscribeTimers.add(timer);
	}

	private resubscribeKey(participantId: string, producerId: string): string {
		return `${participantId}:${producerId}`;
	}

	cancelPendingSubscriptions(): Promise<void> {
		this.subscriptionGeneration++;
		for (const timer of this.resubscribeTimers) clearTimeout(timer);
		this.resubscribeTimers.clear();
		this.resubscribeAttempts.clear();
		const pending = Array.from(this.pendingSubscriptions.values());
		this.pendingSubscriptions.clear();
		void Promise.allSettled(pending);
		return Promise.resolve();
	}

	async handleNewConsumer(consumer: ConsumerEntry): Promise<void> {
		const { participantId, kind, isScreen } = consumer;

		if (this.processedConsumers.has(consumer?.id as string)) {
			return;
		}

		this.processedConsumers.add(consumer?.id as string);

		if (!participantId) {
			return;
		}

		const currentUserId = this.getCurrentUserId();
		if (participantId === currentUserId) {
			return;
		}

		if (!this.participantManager.hasParticipant(participantId as string)) {
			this.participantManager.addParticipant({
				user_id: participantId,
				user_name: participantId,
			});
		}

		if (isScreen) {
			await this.handleScreenShareConsumer(consumer);
			return;
		}

		if (kind === "video") {
			await this.attachVideoConsumer(participantId as string, consumer);
		} else if (kind === "audio") {
			await this.attachAudioConsumer(participantId as string, consumer);
		}
	}

	async attachVideoConsumer(
		participantId: string,
		consumer: ConsumerEntry,
	): Promise<void> {
		try {
			const track = consumer.track as MediaStreamTrack;
			const stream = new MediaStream([track]);

			await this.videoManager.attachStream(participantId, stream, false);

			const participant = this.participantManager.getParticipant(participantId);
			if (participant && !participant.video_enabled) {
				this.participantManager.updateParticipant(participantId, {
					video_enabled: true,
				});
			}
		} catch (error) {
			console.error(
				`Failed to attach video consumer for ${participantId}:`,
				error,
			);
			throw error;
		}
	}

	async attachAudioConsumer(
		participantId: string,
		consumer: ConsumerEntry,
	): Promise<void> {
		try {
			const track = consumer.track as MediaStreamTrack;
			const stream = new MediaStream([track]);

			await this.videoManager.attachStream(participantId, stream, false);
		} catch (error) {
			console.error(
				`Failed to attach audio consumer for ${participantId}:`,
				error,
			);
			throw error;
		}
	}

	async handleScreenShareConsumer(consumer: ConsumerEntry): Promise<void> {
		const participantId = consumer.participantId;
		const track = consumer.track as MediaStreamTrack;

		const allConsumers = this.consumerManager.getAllConsumers();
		const allCameraConsumers = allConsumers.filter(
			(c) => c.kind === "video" && !c.isScreen,
		);

		try {
			if (allCameraConsumers.length > 0 && !this.isScreenShareActive) {
				this.isScreenShareActive = true;

				for (const cameraConsumer of allCameraConsumers) {
					await this.attachVideoConsumer(
						cameraConsumer.participantId,
						cameraConsumer,
					);
				}
			}

			const screenStream = new MediaStream([track]);
			if (consumer.appData && !consumer.appData.type) {
				consumer.appData.type = "screen";
			} else if (consumer && !consumer.appData) {
				consumer.appData = { type: "screen" };
			}

			if (this.eventHandlers.onScreenShareStarted) {
				this.eventHandlers.onScreenShareStarted({
					participantId,
					stream: screenStream,
					consumer,
				});
			}
		} catch (error) {
			console.error("Failed to handle screen share consumer:", error);
			throw error;
		}
	}

	cleanup(): Promise<void> {
		if (this.cleanupPromise) return this.cleanupPromise;

		this.sendMediaMutationGeneration++;
		this.receiveSubscriptionsClosed = true;
		const receiveCancellation = this.cancelPendingSubscriptions();
		void receiveCancellation.catch((error: unknown) => {
			console.warn("Failed to cancel pending media subscriptions:", error);
		});
		const terminalCleanup = this.sendMediaMutationQueue.then(() => {
			this.mediaHandler.cleanup();
			this.processedConsumers.clear();
			this.isScreenShareActive = false;
		});
		this.cleanupPromise = terminalCleanup;
		this.sendMediaMutationQueue = terminalCleanup.catch(() => undefined);
		return terminalCleanup;
	}
}
