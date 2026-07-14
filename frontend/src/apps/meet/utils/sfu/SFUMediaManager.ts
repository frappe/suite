/**
 * SFU Media Manager
 * Handles producer/consumer operations and media track management
 */

import type { Producer } from "mediasoup-client/types";
import type { ConsumerEntry, ConsumerManager } from "../media/ConsumerManager";
import type { ParticipantManager } from "../media/ParticipantManager";
import type { TransportManager } from "../media/TransportManager";
import type { VideoElementManager } from "../media/VideoElementManager";

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

interface MediaEventHandlers {
	onScreenShareStarted?: (data: unknown) => void;
	onScreenShareStopped?: (data: unknown) => void;
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

	async publishMedia(
		localStream: MediaStream,
		options: { publishVideo?: boolean; publishAudio?: boolean } = {},
	): Promise<Record<string, unknown>> {
		const { publishVideo = true, publishAudio = true } = options;
		const results: Record<string, unknown> = {};

		try {
			this.mediaHandler.localStream = localStream;

			await this.transportManager.createSendTransport();

			if (publishVideo && localStream) {
				const videoTrack = localStream.getVideoTracks()[0];
				if (videoTrack) {
					try {
						const videoProducer = await this.transportManager.createProducer(
							videoTrack,
							{ type: "camera" },
						);
						results.videoProducer = videoProducer;
						this.mediaHandler.setProducers({ videoProducer });
						console.log("Video published successfully");
					} catch (error: unknown) {
						console.warn(
							"Failed to publish video, continuing without video:",
							(error as Error).message,
						);
					}
				}
			}

			if (publishAudio && localStream) {
				const audioTrack = localStream.getAudioTracks()[0];
				if (audioTrack) {
					try {
						const audioProducer = await this.transportManager.createProducer(
							audioTrack,
							{ type: "microphone" },
						);
						results.audioProducer = audioProducer;
						this.mediaHandler.setProducers({ audioProducer });
						console.log("Audio published successfully");
					} catch (error: unknown) {
						console.warn(
							"Failed to publish audio, continuing without audio:",
							(error as Error).message,
						);
					}
				}
			}
			console.log("Media published successfully");
			return results;
		} catch (error) {
			console.error("Failed to publish media:", error);
			throw error;
		}
	}

	async rebuildSendSide(): Promise<Record<string, unknown>> {
		const localStream = this.mediaHandler.localStream;
		this.transportManager.closeSendTransport();
		this.mediaHandler.setProducers({
			audioProducer: null,
			videoProducer: null,
		});

		if (!localStream) return {};

		const hasLiveVideo = localStream
			.getVideoTracks()
			.some((track) => track.readyState === "live");
		const hasLiveAudio = localStream
			.getAudioTracks()
			.some((track) => track.readyState === "live");
		if (!hasLiveVideo && !hasLiveAudio) return {};

		return this.publishMedia(localStream, {
			publishAudio: hasLiveAudio,
			publishVideo: hasLiveVideo,
		});
	}

	async subscribeToProducer(
		producerId: string,
		participantId: string,
		metadata: Record<string, unknown> = {},
	): Promise<unknown> {
		try {
			const consumer = await this.transportManager.createConsumer(
				producerId,
				metadata,
			);

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
		if (!producerId || !participantId) {
			return null;
		}

		if (participantId === this.getCurrentUserId()) {
			return null;
		}

		const result = await this.subscribeToProducer(producerId, participantId, {
			isScreen: !!isScreen,
		});
		this.resubscribeAttempts.delete(
			this.resubscribeKey(participantId, producerId),
		);
		return result;
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
			return;
		}
		this.resubscribeAttempts.set(key, attempts + 1);

		setTimeout(() => {
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
	}

	private resubscribeKey(participantId: string, producerId: string): string {
		return `${participantId}:${producerId}`;
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
		}
	}

	cleanup(): void {
		this.mediaHandler.cleanup();
		this.processedConsumers.clear();
		this.isScreenShareActive = false;
	}
}
