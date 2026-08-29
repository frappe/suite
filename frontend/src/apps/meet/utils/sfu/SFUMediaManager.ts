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
	isScreenPublicationCurrent?: (track: MediaStreamTrack) => boolean;
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
	producerId?: string;
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
	private isScreenPublicationCurrent: (track: MediaStreamTrack) => boolean;
	private selectedProducerIds = new Map<string, string>();
	private attachmentTails = new Map<string, Promise<void>>();
	private closedProducerIds = new Set<string>();
	private pendingSubscriptions: Map<string, Promise<unknown | null>> = new Map();
	private resubscribeTimers = new Map<
		ReturnType<typeof setTimeout>,
		() => void
	>();
	private subscriptionGeneration = 0;
	private producerSubscriptionGenerations = new Map<string, number>();
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
		this.isScreenPublicationCurrent =
			options.isScreenPublicationCurrent ?? (() => true);
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

	repairLocalPublication(
		kind: "audio" | "video",
		localStream: MediaStream,
	): Promise<void> {
		return this.serializeSendMediaMutation(async () => {
			const producer =
				kind === "audio"
					? this.mediaHandler.audioProducer
					: this.mediaHandler.videoProducer;
			if (producer && !producer.closed) return;
			this.mediaHandler.setProducers(
				kind === "audio" ? { audioProducer: null } : { videoProducer: null },
			);
			await this.publishMediaNow(localStream, {
				publishAudio: kind === "audio",
				publishVideo: kind === "video",
			});
		});
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
						await this.transportManager.discardProducer(videoProducer);
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
						await this.transportManager.discardProducer(audioProducer);
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

		if (
			hasLiveScreen &&
			screenTrack &&
			this.isScreenPublicationCurrent(screenTrack)
		) {
			const screenProducer = await this.transportManager.createProducer(screenTrack, {
				type: "screen",
			});
			if (
				!this.isScreenPublicationCurrent(screenTrack) ||
				screenTrack.readyState !== "live" ||
				screenProducer.track?.readyState === "ended"
			) {
				await this.transportManager.discardProducer(screenProducer);
			} else {
				this.mediaHandler.setProducers({ screenProducer });
				results.screenProducer = screenProducer;
			}
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
		subscription = this.subscribeWithRetry(
			{ producerId, participantId, isScreen },
			this.subscriptionGeneration,
			this.producerSubscriptionGenerations.get(key) ?? 0,
		).finally(() => {
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

		void this.startSubscription(
			{
				producerId: info.producerId,
				participantId: info.participantId,
				isScreen: info.isScreen,
			},
			true,
		).catch((error: unknown) => {
				console.warn("Failed to re-subscribe to lost consumer", {
					participantId: info.participantId,
					producerId: info.producerId,
					error: (error as Error).message,
				});
			});
	}

	async recoverConsumer(entry: ConsumerEntry): Promise<void> {
		this.consumerManager.removeConsumer(entry.id);
		await this.handleConsumerLost({
			consumerId: entry.id,
			participantId: entry.participantId,
			producerId: entry.producerId,
			kind: entry.kind,
			isScreen: entry.isScreen,
		});
	}

	private startSubscription(
		request: { producerId: string; participantId: string; isScreen: boolean },
		delayFirstAttempt = false,
	): Promise<unknown | null> {
		const key = this.resubscribeKey(request.participantId, request.producerId);
		const pending = this.pendingSubscriptions.get(key);
		if (pending) return pending;

		let subscription: Promise<unknown | null>;
		subscription = this.subscribeWithRetry(
			request,
			this.subscriptionGeneration,
			this.producerSubscriptionGenerations.get(key) ?? 0,
			delayFirstAttempt,
		).finally(() => {
			if (this.pendingSubscriptions.get(key) === subscription) {
				this.pendingSubscriptions.delete(key);
			}
		});
		this.pendingSubscriptions.set(key, subscription);
		return subscription;
	}

	private async subscribeWithRetry(
		request: { producerId: string; participantId: string; isScreen: boolean },
		generation: number,
		producerGeneration: number,
		delayFirstAttempt = false,
	): Promise<unknown | null> {
		const key = this.resubscribeKey(request.participantId, request.producerId);
		let lastError: unknown;
		for (
			let attempt = 1;
			attempt <= SFUMediaManager.MAX_RESUBSCRIBE_ATTEMPTS;
			attempt++
		) {
			if (delayFirstAttempt || attempt > 1) {
				await this.waitForResubscribeDelay(
					generation,
					key,
					producerGeneration,
				);
			}
			delayFirstAttempt = false;
			if (
				this.receiveSubscriptionsClosed ||
				generation !== this.subscriptionGeneration ||
				producerGeneration !==
					(this.producerSubscriptionGenerations.get(key) ?? 0)
			) {
				throw new DOMException("Receive media lifecycle has ended", "AbortError");
			}

			try {
				const consumer = await this.subscribeToProducer(
					request.producerId,
					request.participantId,
					{ isScreen: request.isScreen },
				);
				if (
					producerGeneration !==
					(this.producerSubscriptionGenerations.get(key) ?? 0)
				) {
					if (consumer) this.consumerManager.removeConsumer(consumer.id);
					throw new DOMException("Producer subscription was cancelled", "AbortError");
				}
				return consumer;
			} catch (error) {
				lastError = error;
				if (
					generation !== this.subscriptionGeneration ||
					producerGeneration !==
						(this.producerSubscriptionGenerations.get(key) ?? 0)
				)
					throw error;
			}
		}

		console.warn("Giving up on remote consumer subscription", {
			participantId: request.participantId,
			producerId: request.producerId,
			attempts: SFUMediaManager.MAX_RESUBSCRIBE_ATTEMPTS,
		});
		this.eventHandlers.onRecoveryExhausted?.();
		throw lastError;
	}

	private waitForResubscribeDelay(
		generation: number,
		key: string,
		producerGeneration: number,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const finish = () => {
				this.resubscribeTimers.delete(timer);
				if (
					this.receiveSubscriptionsClosed ||
					generation !== this.subscriptionGeneration ||
					producerGeneration !==
						(this.producerSubscriptionGenerations.get(key) ?? 0)
				) {
					reject(
						new DOMException("Receive media lifecycle has ended", "AbortError"),
					);
					return;
				}
				resolve();
			};
			const timer = setTimeout(finish, SFUMediaManager.RESUBSCRIBE_DELAY_MS);
			this.resubscribeTimers.set(timer, finish);
		});
	}

	cancelProducerSubscription(participantId: string, producerId: string): void {
		const key = this.resubscribeKey(participantId, producerId);
		this.producerSubscriptionGenerations.set(
			key,
			(this.producerSubscriptionGenerations.get(key) ?? 0) + 1,
		);
		this.pendingSubscriptions.delete(key);
	}

	private resubscribeKey(participantId: string, producerId: string): string {
		return `${participantId}:${producerId}`;
	}

	cancelPendingSubscriptions(): Promise<void> {
		this.subscriptionGeneration++;
		for (const [timer, finish] of this.resubscribeTimers) {
			clearTimeout(timer);
			finish();
		}
		this.resubscribeTimers.clear();
		this.producerSubscriptionGenerations.clear();
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
		const key = `video:${participantId}`;
		const previousProducerId = this.selectedProducerIds.get(key);
		this.selectedProducerIds.set(key, consumer.producerId);
		return this.serializeAttachment(key, async () => {
			if (this.selectedProducerIds.get(key) !== consumer.producerId) return;
			const track = consumer.track as MediaStreamTrack;
			const stream = new MediaStream([track]);

			try {
				await this.videoManager.attachStream(participantId, stream, false);

				const participant = this.participantManager.getParticipant(participantId);
				if (participant && !participant.video_enabled) {
					this.participantManager.updateParticipant(participantId, {
						video_enabled: true,
					});
				}
			} catch (error) {
				this.restoreSelectionAfterAttachmentFailure(
					key,
					participantId,
					consumer.producerId,
					previousProducerId,
				);
				console.error(
					`Failed to attach video consumer for ${participantId}:`,
					error,
				);
				throw error;
			}
		});
	}

	async attachAudioConsumer(
		participantId: string,
		consumer: ConsumerEntry,
	): Promise<void> {
		const key = `audio:${participantId}`;
		const previousProducerId = this.selectedProducerIds.get(key);
		this.selectedProducerIds.set(key, consumer.producerId);
		return this.serializeAttachment(key, async () => {
			if (this.selectedProducerIds.get(key) !== consumer.producerId) return;
			const track = consumer.track as MediaStreamTrack;
			const stream = new MediaStream([track]);

			try {
				await this.videoManager.attachStream(participantId, stream, false);
			} catch (error) {
				this.restoreSelectionAfterAttachmentFailure(
					key,
					participantId,
					consumer.producerId,
					previousProducerId,
				);
				console.error(
					`Failed to attach audio consumer for ${participantId}:`,
					error,
				);
				throw error;
			}
		});
	}

	private serializeAttachment(
		key: string,
		operation: () => Promise<void>,
	): Promise<void> {
		const attachment = (this.attachmentTails.get(key) ?? Promise.resolve())
			.catch(() => undefined)
			.then(operation)
			.finally(() => {
				if (this.attachmentTails.get(key) === attachment) {
					this.attachmentTails.delete(key);
				}
			});
		this.attachmentTails.set(key, attachment);
		return attachment;
	}

	private restoreSelectionAfterAttachmentFailure(
		key: string,
		participantId: string,
		failedProducerId: string,
		previousProducerId: string | undefined,
	): void {
		if (this.selectedProducerIds.get(key) !== failedProducerId) return;
		if (previousProducerId && !this.closedProducerIds.has(previousProducerId)) {
			this.selectedProducerIds.set(key, previousProducerId);
			return;
		}
		this.selectedProducerIds.delete(key);
		if (!previousProducerId) return;
		this.selectedProducerIds.set(key, previousProducerId);
		queueMicrotask(() => {
			void this.reattachAfterProducerClosed(participantId, previousProducerId).catch(
				(error) =>
					console.warn("Failed to recover endpoint media after attachment error:", error),
			);
		});
	}

	async reattachAfterProducerClosed(
		participantId: string,
		producerId: string,
	): Promise<void> {
		this.closedProducerIds.add(producerId);
		const consumers = this.consumerManager.getConsumersByParticipant(participantId);
		for (const kind of ["audio", "video"] as const) {
			const key = `${kind}:${participantId}`;
			if (this.selectedProducerIds.get(key) !== producerId) continue;
			const replacement = consumers.find(
				(consumer) =>
					consumer.producerId !== producerId &&
					consumer.kind === kind &&
					!consumer.isScreen &&
					!consumer.consumer.closed,
			);
			if (!replacement) {
				this.selectedProducerIds.delete(key);
				continue;
			}
			if (kind === "video") {
				await this.attachVideoConsumer(participantId, replacement);
			} else {
				await this.attachAudioConsumer(participantId, replacement);
			}
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
					producerId: consumer.producerId,
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
			this.selectedProducerIds.clear();
			this.attachmentTails.clear();
			this.closedProducerIds.clear();
			this.isScreenShareActive = false;
		});
		this.cleanupPromise = terminalCleanup;
		this.sendMediaMutationQueue = terminalCleanup.catch(() => undefined);
		return terminalCleanup;
	}
}
