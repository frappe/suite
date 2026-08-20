/**
 * SFU Meeting Manager
 * Orchestrates SFU connection, media, and participant management
 *
 * This is a thin facade that coordinates the focused managers:
 * - ParticipantConnection: Participant connection lifecycle and event handling
 * - SFUMediaManager: Producer/consumer operations
 * - SFURecoveryManager: ICE restart and recovery logic
 */

import { ConsumerManager } from "./media/ConsumerManager";
import { ParticipantManager } from "./media/ParticipantManager";
import { TransportManager } from "./media/TransportManager";
import { VideoElementManager } from "./media/VideoElementManager";
import type { SFUClient } from "./SFUClient";
import type { User } from "../composables/useCurrentUser";
import {
	ParticipantConnection,
	type ParticipantConnectionStartOptions,
	type ParticipantConnectionState,
	type SFUEventHandlers,
} from "./sfu/ParticipantConnection";
import { SFUMediaManager, type PublishedMedia } from "./sfu/SFUMediaManager";
import {
	SFURecoveryManager,
	type RecoveryResult,
} from "./sfu/SFURecoveryManager";
import { ExpectedMediaReconciler } from "./sfu/ExpectedMediaReconciler";
import { getClientTelemetry } from "./telemetry/ClientTelemetry";

const isAbortError = (error: unknown) =>
	(error as { name?: unknown } | null)?.name === "AbortError";

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw (
			signal.reason ?? new DOMException("E2EE lifecycle ended", "AbortError")
		);
	}
}

interface SFUMeetingManagerOptions {
	meetingId: string;
	currentUser: User | null;
	eventHandlers?: SFUEventHandlers;
}

export interface E2EEPublicationResult {
	videoPublished: boolean;
	audioPublished: boolean;
}

export class SFUMeetingManager {
	sfuClient: SFUClient;

	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	consumerManager: ConsumerManager;
	transportManager: TransportManager;

	private connectionManager: ParticipantConnection;
	mediaManager: SFUMediaManager;
	private recoveryManager: SFURecoveryManager;
	private consumerPreferenceGenerations = new Map<string, number>();

	constructor(sfuClient: SFUClient) {
		this.sfuClient = sfuClient;

		this.videoManager = new VideoElementManager();
		this.participantManager = new ParticipantManager();
		this.consumerManager = new ConsumerManager();
		this.transportManager = new TransportManager();

		this.recoveryManager = new SFURecoveryManager({
			sfuClient,
			transportManager: this.transportManager,
			meetingId: () => this.connectionManager?.meetingId ?? null,
			schedule: (operation) =>
				this.connectionManager.serializeTransportRecovery(operation),
			onStarted: (reason) =>
				this.connectionManager?.reportRecoveryState(
					reason.includes("send") ? "recovering_send" : "recovering_receive",
					reason,
				),
			onRecovered: async (reason) => {
				this.connectionManager?.reportRecoveryState("healthy", reason);
			},
			onFailed: async (_reason, result) => {
				try {
					await this.connectionManager.recoverFailedTransports(_reason, result);
					this.connectionManager?.reportRecoveryState("healthy", _reason);
				} catch (error) {
					this.connectionManager?.reportRecoveryState("failed", _reason);
					throw error;
				}
			},
		});

		this.mediaManager = new SFUMediaManager(
			{
				transportManager: this.transportManager,
				videoManager: this.videoManager,
				consumerManager: this.consumerManager,
				participantManager: this.participantManager,
			},
			() => this.connectionManager?.getCurrentUserId() ?? null,
		);

		this.connectionManager = new ParticipantConnection({
			sfuClient,
			videoManager: this.videoManager,
			participantManager: this.participantManager,
			transportManager: this.transportManager,
			mediaManager: this.mediaManager,
			recoveryManager: this.recoveryManager,
			expectedMedia: new ExpectedMediaReconciler((event) =>
				getClientTelemetry(sfuClient).reportMediaRepair(event),
			),
		});
	}

	initialize(options: SFUMeetingManagerOptions): void {
		this.connectionManager.initialize(
			options.meetingId,
			options.currentUser,
			options.eventHandlers,
		);
	}

	startParticipantConnection(
		options: ParticipantConnectionStartOptions,
	): Promise<ParticipantConnectionState> {
		return this.connectionManager.start(options);
	}

	reconcileExpectedMedia(): Promise<void> {
		return this.connectionManager.reconcileExpectedMedia();
	}

	async recoverBrowserLifecycle(): Promise<void> {
		await this.videoManager.retryPlayback();
		await this.reconcileExpectedMedia();
	}

	observeRemoteMediaProgress(
		producerId: string,
		media: "audio" | "video",
		flowing: boolean,
		decoding: boolean,
	): void {
		this.connectionManager.observeRemoteMediaProgress(
			producerId,
			media,
			flowing,
			decoding,
		);
	}

	async publishMedia(
		localStream: MediaStream,
		options: { publishVideo?: boolean; publishAudio?: boolean } = {},
	): Promise<PublishedMedia> {
		return this.mediaManager.publishMedia(localStream, options);
	}

	async publishInitialMedia(
		localStream: MediaStream,
		options: { publishVideo: boolean; publishAudio: boolean },
		signal?: AbortSignal,
		finalize?: (publication: PublishedMedia) => void | Promise<void>,
	): Promise<PublishedMedia> {
		return this.mediaManager.publishInitialMedia(
			localStream,
			options,
			signal,
			finalize,
		);
	}

	setLocalMediaTrack(
		kind: "audio" | "video",
		track: MediaStreamTrack | null,
	): void {
		this.mediaManager.setLocalTrack(kind, track);
	}

	serializeSendMediaMutation<T>(operation: () => Promise<T>): Promise<T> {
		return this.mediaManager.serializeSendMediaMutation(operation);
	}

	async reconfigureForE2EE(
		videoStream: MediaStream | null = null,
		audioStream: MediaStream | null = null,
		signal?: AbortSignal,
	): Promise<E2EEPublicationResult> {
		return this.mediaManager.serializeSendMediaMutation(() => {
			throwIfAborted(signal);
			return this.reconfigureForE2EENow(videoStream, audioStream, signal);
		});
	}

	private async reconfigureForE2EENow(
		videoStream: MediaStream | null,
		audioStream: MediaStream | null,
		signal?: AbortSignal,
	): Promise<E2EEPublicationResult> {
		throwIfAborted(signal);
		console.log("Reconfiguring media for E2EE");
		this.connectionManager.initialSyncInProgress = true;
		const publicationResult: E2EEPublicationResult = {
			videoPublished: false,
			audioPublished: false,
		};

		try {
			const mediaHandler = this.mediaManager.mediaHandler;
			const closeUnusableProducer = (
				producer: NonNullable<typeof mediaHandler.videoProducer>,
			) => {
				producer.close();
				if (producer.id && this.sfuClient.isConnected()) {
					void this.sfuClient.closeProducer?.(producer.id).catch(() => {});
				}
			};
			const hadVideo = !!mediaHandler.videoProducer;
			const hadAudio = !!mediaHandler.audioProducer;
			const videoTrack = hadVideo
				? (videoStream
						?.getVideoTracks()
						.find((track) => track.readyState === "live") ?? null)
				: null;
			const audioTrack = hadAudio
				? (audioStream
						?.getAudioTracks()
						.find((track) => track.readyState === "live") ?? null)
				: null;

			await this.mediaManager.cancelPendingSubscriptions();
			throwIfAborted(signal);
			mediaHandler.cleanup();
			this.mediaManager.setLocalTrack("video", videoTrack);
			this.mediaManager.setLocalTrack("audio", audioTrack);
			this.consumerManager.clear();
			this.mediaManager.processedConsumers.clear();
			this.connectionManager.clearBufferedReconciliationEvents();
			this.transportManager.cleanup();

			await this.transportManager.initializeDevice();
			throwIfAborted(signal);
			await this.transportManager.createReceiveTransport();
			throwIfAborted(signal);

			if (hadVideo || hadAudio) {
				await this.transportManager.createSendTransport();
				throwIfAborted(signal);

				if (videoTrack) {
					try {
						if (videoTrack.readyState !== "live") {
							this.mediaManager.setLocalTrack("video", null);
						} else {
							const videoProducer = await this.transportManager.createProducer(
								videoTrack,
								{
									type: "camera",
								},
							);
							if (signal?.aborted) {
								closeUnusableProducer(videoProducer);
								throwIfAborted(signal);
							}
							if (
								videoTrack.readyState !== "live" ||
								videoProducer.track?.readyState === "ended"
							) {
								closeUnusableProducer(videoProducer);
								this.mediaManager.setLocalTrack("video", null);
							} else {
								mediaHandler.setProducers({ videoProducer });
								publicationResult.videoPublished = true;
							}
						}
					} catch (error) {
						if (isAbortError(error)) throw error;
						console.warn(
							"Failed to re-publish video after E2EE conversion:",
							error,
						);
					}
				}

				if (audioTrack) {
					try {
						if (audioTrack.readyState !== "live") {
							this.mediaManager.setLocalTrack("audio", null);
						} else {
							const audioProducer = await this.transportManager.createProducer(
								audioTrack,
								{
									type: "microphone",
								},
							);
							if (signal?.aborted) {
								closeUnusableProducer(audioProducer);
								throwIfAborted(signal);
							}
							if (
								audioTrack.readyState !== "live" ||
								audioProducer.track?.readyState === "ended"
							) {
								closeUnusableProducer(audioProducer);
								this.mediaManager.setLocalTrack("audio", null);
							} else {
								mediaHandler.setProducers({ audioProducer });
								publicationResult.audioPublished = true;
							}
						}
					} catch (error) {
						if (isAbortError(error)) throw error;
						console.warn(
							"Failed to re-publish audio after E2EE conversion:",
							error,
						);
					}
				}
			}
			await this.connectionManager.setupExistingParticipants();
			throwIfAborted(signal);
			if (
				publicationResult.videoPublished &&
				(videoTrack?.readyState !== "live" ||
					mediaHandler.videoProducer?.track?.readyState === "ended")
			) {
				if (mediaHandler.videoProducer) {
					closeUnusableProducer(mediaHandler.videoProducer);
				}
				mediaHandler.setProducers({ videoProducer: null });
				this.mediaManager.setLocalTrack("video", null);
				publicationResult.videoPublished = false;
			}
			if (
				publicationResult.audioPublished &&
				(audioTrack?.readyState !== "live" ||
					mediaHandler.audioProducer?.track?.readyState === "ended")
			) {
				if (mediaHandler.audioProducer) {
					closeUnusableProducer(mediaHandler.audioProducer);
				}
				mediaHandler.setProducers({ audioProducer: null });
				this.mediaManager.setLocalTrack("audio", null);
				publicationResult.audioPublished = false;
			}
			console.log("E2EE reconfiguration completed");
			return publicationResult;
		} catch (error) {
			if (!(signal?.aborted && isAbortError(error))) {
				console.error("E2EE reconfiguration failed:", error);
			}
			throw error;
		} finally {
			this.connectionManager.initialSyncInProgress = false;
		}
	}

	async resyncAfterRecovery(reason: string): Promise<void> {
		return this.connectionManager.resyncAfterRecovery(reason);
	}

	async recoverTransport(reason: string): Promise<RecoveryResult> {
		return this.recoveryManager.recoverTransportIce(reason);
	}

	async resetReceiveMedia(): Promise<void> {
		return this.connectionManager.resetReceiveSide();
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
		return this.mediaManager.subscribeToRemoteProducer({
			producerId,
			participantId,
			isScreen,
		});
	}

	registerVideoElement(participantId: string, element: HTMLElement): void {
		this.videoManager.registerVideoElement(participantId, element);
	}

	getVideoConsumerEntry(participantId: string): unknown {
		return this.consumerManager.getVideoConsumer(participantId);
	}

	async updateConsumerStreamPreferences(
		consumerId: string,
		preferences: {
			visible: boolean;
			width: number;
			height: number;
		},
	): Promise<unknown | null> {
		const generation =
			(this.consumerPreferenceGenerations.get(consumerId) ?? 0) + 1;
		this.consumerPreferenceGenerations.set(consumerId, generation);
		if (!preferences.visible) {
			this.consumerManager.updateConsumer(consumerId, {
				adaptivelyPaused: true,
			});
		}
		if (!this.sfuClient?.isConnected()) {
			throw new Error("Cannot update consumer preferences while disconnected");
		}

		try {
			const result = await this.sfuClient.updateConsumerPreferences({
				consumerId,
				visible: preferences.visible,
				width: preferences.width,
				height: preferences.height,
			});
			if (
				preferences.visible &&
				this.consumerPreferenceGenerations.get(consumerId) === generation
			) {
				this.consumerManager.updateConsumer(consumerId, {
					adaptivelyPaused: false,
				});
			}
			return result;
		} catch (error) {
			console.warn(
				"Failed to update consumer preferences",
				consumerId,
				(error as Error)?.message || error,
			);
			throw error;
		} finally {
			if (this.consumerPreferenceGenerations.get(consumerId) === generation) {
				this.consumerPreferenceGenerations.delete(consumerId);
			}
		}
	}

	async disconnect(): Promise<void> {
		return this.connectionManager.disconnect();
	}

	async cleanup(): Promise<void> {
		await this.disconnect();

		this.videoManager.cleanup();
		this.participantManager.clear();

		this.connectionManager.reset();
	}

	get meetingId(): string | null {
		return this.connectionManager.meetingId;
	}

	get isConnected(): boolean {
		return this.connectionManager.isConnected;
	}

	get participantConnectionState(): ParticipantConnectionState {
		return this.connectionManager.state;
	}

	get eventTarget(): EventTarget {
		return this.mediaManager.eventTarget;
	}

	get mediaHandler() {
		return this.mediaManager.mediaHandler;
	}

	get processedConsumers(): Set<string> {
		return this.mediaManager.processedConsumers;
	}

	get isScreenShareActive(): boolean {
		return this.mediaManager.isScreenShareActive;
	}

	get currentUser(): { value: unknown } {
		return this.connectionManager.currentUser;
	}
}
