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
import type { ConsumerEntry } from "./media/ConsumerManager";
import { ParticipantManager } from "./media/ParticipantManager";
import { TransportManager } from "./media/TransportManager";
import {
	type AttachmentTrackOwnership,
	type MediaAttachmentFacade,
	VideoElementManager,
} from "./media/VideoElementManager";
import type { ProducerCloseMetadata, SFUClient } from "./SFUClient";
import type { User } from "../composables/useCurrentUser";
import type { JoinRoomMediaState, JoinUserData } from "../types";
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
import {
	MediaHealthMonitor,
	type MediaHealthState,
} from "./media/MediaHealthMonitor";
import type { Producer } from "mediasoup-client/types";

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

export type LocalProducerKind = "audio" | "video" | "screen";

export interface LocalProducerState {
	id: string;
	track: MediaStreamTrack | null;
	paused: boolean;
}

export interface ConnectionDiagnostics {
	connectionStatus: ReturnType<SFUClient["getConnectionStatus"]>;
	transportStats: ReturnType<TransportManager["getTransportStats"]>;
	networkStats: Awaited<ReturnType<TransportManager["getNetworkStats"]>> | null;
}

export type RTCStatsReport = Readonly<{
	id?: string;
	type?: string;
	timestamp?: number;
	isRemote?: boolean;
	codecId?: string;
	mimeType?: string;
	remoteId?: string;
	localId?: string;
	bytesSent?: number;
	bytesReceived?: number;
	packetsLost?: number;
	packetsReceived?: number;
	packetsSent?: number;
	jitter?: number;
	roundTripTime?: number;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	framesDropped?: number;
	framesEncoded?: number;
	framesDecoded?: number;
	qualityLimitationReason?: string;
	scalabilityMode?: string;
	nackCount?: number;
	pliCount?: number;
	firCount?: number;
	jitterBufferEmittedCount?: number;
	jitterBufferDelay?: number;
	concealedSamples?: number;
	totalSamplesReceived?: number;
	selected?: boolean;
	nominated?: boolean;
	state?: string;
	localCandidateId?: string;
	remoteCandidateId?: string;
	currentRoundTripTime?: number;
	availableOutgoingBitrate?: number;
	protocol?: string;
	candidateType?: string;
}>;

const RTC_STATS_REPORT_KEYS = [
	"id",
	"type",
	"timestamp",
	"isRemote",
	"codecId",
	"mimeType",
	"remoteId",
	"localId",
	"bytesSent",
	"bytesReceived",
	"packetsLost",
	"packetsReceived",
	"packetsSent",
	"jitter",
	"roundTripTime",
	"frameWidth",
	"frameHeight",
	"framesPerSecond",
	"framesDropped",
	"framesEncoded",
	"framesDecoded",
	"qualityLimitationReason",
	"scalabilityMode",
	"nackCount",
	"pliCount",
	"firCount",
	"jitterBufferEmittedCount",
	"jitterBufferDelay",
	"concealedSamples",
	"totalSamplesReceived",
	"selected",
	"nominated",
	"state",
	"localCandidateId",
	"remoteCandidateId",
	"currentRoundTripTime",
	"availableOutgoingBitrate",
	"protocol",
	"candidateType",
] as const satisfies readonly (keyof RTCStatsReport)[];

export type RTCStatsStreamSample = Readonly<{
	id: string;
	direction: "send" | "receive";
	kind: "audio" | "video";
	source:
		| "microphone"
		| "camera"
		| "screen"
		| "remote audio"
		| "remote video"
		| "remote screen";
	participantId?: string;
	paused: boolean;
	muted: boolean;
	trackSettings: Readonly<MediaTrackSettings>;
	reports: readonly RTCStatsReport[];
}>;

export type RTCStatsSample = Readonly<{
	transportReports: readonly (readonly RTCStatsReport[])[];
	streams: readonly RTCStatsStreamSample[];
	signalingConnected: boolean;
	sendTransportState: string;
	receiveTransportState: string;
}>;

function snapshotRTCStatsReports(stats: unknown): readonly RTCStatsReport[] {
	if (!stats || typeof stats !== "object") return Object.freeze([]);
	const values = (stats as { values?: () => IterableIterator<unknown> }).values?.();
	if (!values) return Object.freeze([]);
	return Object.freeze(
		Array.from(values).flatMap((report) => {
			if (!report || typeof report !== "object") return [];
			const entries = RTC_STATS_REPORT_KEYS.flatMap((key) => {
				const value = Reflect.get(report, key) as unknown;
				return typeof value === "string" ||
					typeof value === "number" ||
					typeof value === "boolean"
					? [[key, value] as const]
					: [];
			});
			return [
				Object.freeze(Object.fromEntries(entries) as RTCStatsReport),
			];
		}),
	);
}

export class SFUMeetingManager implements MediaAttachmentFacade {
	private readonly sfuClient: SFUClient;
	private readonly videoManager: VideoElementManager;
	private readonly ownsVideoManager: boolean;
	private readonly participantManager: ParticipantManager;
	private readonly consumerManager: ConsumerManager;
	private readonly transportManager: TransportManager;
	private connectionManager: ParticipantConnection;
	private readonly mediaManager: SFUMediaManager;
	private recoveryManager: SFURecoveryManager;
	private readonly mediaHealthMonitor: MediaHealthMonitor;
	private mediaHealthSubscriberCount = 0;
	private consumerPreferenceGenerations = new Map<string, number>();
	private screenPublicationGeneration = 0;
	private screenPublicationTrack: MediaStreamTrack | null = null;

	constructor(
		sfuClient: SFUClient,
		videoManager?: VideoElementManager,
	) {
		this.sfuClient = sfuClient;

		this.videoManager = videoManager ?? new VideoElementManager();
		this.ownsVideoManager = !videoManager;
		this.participantManager = new ParticipantManager();
		this.consumerManager = new ConsumerManager();
		this.transportManager = new TransportManager();
		this.transportManager.initialize(sfuClient);

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
					void this.connectionManager
						.escalateRecovery({
							scope: "transport",
							direction:
								result.send === "failed" && result.recv === "failed"
									? "both"
									: result.send === "failed"
										? "send"
										: "recv",
							reason: "rebuild_failed",
						})
						.catch((recoveryError) =>
							console.warn("Transport recovery escalation failed:", recoveryError),
						);
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
				isScreenPublicationCurrent: (track) =>
					this.screenPublicationTrack === track && track.readyState === "live",
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
			expectedMedia: new ExpectedMediaReconciler((event) => {
				getClientTelemetry(sfuClient).reportMediaRepair(event);
				if (event.outcome !== "exhausted") return;
				void this.connectionManager
					?.escalateRecovery({
						scope: event.source === "remote" ? "subscription" : "publication",
						direction: event.source === "remote" ? "recv" : "send",
						reason: "retry_limit",
					})
					.catch((error) =>
						console.warn("Expected media recovery escalation failed:", error),
					);
			}),
		});

		this.mediaHealthMonitor = new MediaHealthMonitor({
			getTransportStats: () => this.transportManager.getTransportStats(),
			getNetworkStats: () => this.transportManager.getNetworkStats(),
			getConsumers: () => this.consumerManager.getAllConsumers(),
			getConsumer: (consumerId) => this.consumerManager.getConsumer(consumerId),
			isConsumerPaused: (entry) => this.isConsumerPaused(entry),
			recoverConsumer: (entry) => this.mediaManager.recoverConsumer(entry),
			requestConsumerKeyFrame: (consumerId) =>
				this.sfuClient.requestConsumerKeyFrame(consumerId),
			reconcileExpectedMedia: () => this.reconcileExpectedMedia(),
			recoverBrowserLifecycle: () => this.recoverBrowserLifecycle(),
			observeRemoteMediaProgress: (producerId, media, flowing, decoding) =>
				this.observeRemoteMediaProgress(producerId, media, flowing, decoding),
			resetReceiveMedia: () => this.resetReceiveMedia(),
			reportNetworkQuality: (stats) =>
				getClientTelemetry(this.sfuClient).reportNetworkQuality(stats),
			markFirstRemoteMedia: (media) =>
				getClientTelemetry(this.sfuClient).markFirstRemoteMedia(media),
			reportMediaStalls: (media) =>
				getClientTelemetry(this.sfuClient).reportMediaStalls(media),
		});
	}

	private isConsumerPaused(entry: ConsumerEntry): boolean {
		const participant = this.participantManager.getParticipant(entry.participantId);
		return (
			entry.consumer.paused ||
			(entry.consumer as typeof entry.consumer & { producerPaused?: boolean })
				.producerPaused ||
			entry.adaptivelyPaused ||
			(entry.kind === "audio" && participant?.audio_enabled === false) ||
			(entry.kind === "video" &&
				!entry.isScreen &&
				participant?.video_enabled === false)
		);
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

	rejoinParticipantConnection(
		userData: JoinUserData,
		mediaState: JoinRoomMediaState,
	): Promise<boolean> {
		return this.connectionManager.joinRoom(userData, mediaState);
	}

	reconcileExpectedMedia(): Promise<void> {
		return this.connectionManager.reconcileExpectedMedia();
	}

	/** Restarts playback, then reconciles expected media after browser resume. */
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
			const hadVideo = !!mediaHandler.videoProducer;
			const hadAudio = !!mediaHandler.audioProducer;
			const hadScreen = !!mediaHandler.screenProducer;
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
			const existingScreenTrack = hadScreen
				? (mediaHandler.screenProducer?.track ?? null)
				: null;
			if (
				existingScreenTrack?.readyState === "live" &&
				(!this.screenPublicationTrack ||
					this.screenPublicationTrack === existingScreenTrack)
			) {
				this.screenPublicationTrack = existingScreenTrack;
			}
			const screenTrack =
				existingScreenTrack?.readyState === "live" &&
				this.screenPublicationTrack === existingScreenTrack
					? existingScreenTrack
					: null;
			const screenGeneration = this.screenPublicationGeneration;
			const isCurrentScreenTrack = () =>
				this.screenPublicationGeneration === screenGeneration &&
				this.screenPublicationTrack === screenTrack &&
				screenTrack?.readyState === "live";

			await this.mediaManager.cancelPendingSubscriptions();
			throwIfAborted(signal);
			mediaHandler.cleanup();
			this.mediaManager.setLocalTrack("video", videoTrack);
			this.mediaManager.setLocalTrack("audio", audioTrack);
			this.connectionManager.clearReceiveConsumers();
			this.connectionManager.clearBufferedReconciliationEvents();
			this.transportManager.cleanup();

			await this.transportManager.initializeDevice();
			throwIfAborted(signal);
			await this.transportManager.createReceiveTransport();
			throwIfAborted(signal);

			if (videoTrack || audioTrack || screenTrack) {
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
								this.closeProducerInstance(videoProducer);
								throwIfAborted(signal);
							}
							if (
								videoTrack.readyState !== "live" ||
								videoProducer.track?.readyState === "ended"
							) {
								this.closeProducerInstance(videoProducer);
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
								this.closeProducerInstance(audioProducer);
								throwIfAborted(signal);
							}
							if (
								audioTrack.readyState !== "live" ||
								audioProducer.track?.readyState === "ended"
							) {
								this.closeProducerInstance(audioProducer);
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

				if (screenTrack && isCurrentScreenTrack()) {
					try {
						const screenProducer = await this.transportManager.createProducer(
							screenTrack,
							{ type: "screen" },
						);
						if (signal?.aborted) {
							this.closeProducerInstance(screenProducer);
							throwIfAborted(signal);
						}
						if (
							!isCurrentScreenTrack() ||
							screenProducer.track?.readyState === "ended"
						) {
							this.closeProducerInstance(screenProducer);
						} else {
							mediaHandler.setProducers({ screenProducer });
						}
					} catch (error) {
						if (isAbortError(error)) throw error;
						console.warn(
							"Failed to re-publish screen after E2EE conversion:",
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
					this.closeProducerInstance(mediaHandler.videoProducer);
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
					this.closeProducerInstance(mediaHandler.audioProducer);
				}
				mediaHandler.setProducers({ audioProducer: null });
				this.mediaManager.setLocalTrack("audio", null);
				publicationResult.audioPublished = false;
			}
			if (
				mediaHandler.screenProducer &&
				(!isCurrentScreenTrack() ||
					mediaHandler.screenProducer.track?.readyState === "ended")
			) {
				this.closeProducerInstance(mediaHandler.screenProducer);
				mediaHandler.setProducers({ screenProducer: null });
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

	startMediaHealthMonitoring(
		listener: (state: MediaHealthState) => void,
	): () => void {
		this.mediaHealthSubscriberCount += 1;
		const unsubscribe = this.mediaHealthMonitor.subscribe(listener);
		this.mediaHealthMonitor.start();
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			unsubscribe();
			this.mediaHealthSubscriberCount = Math.max(
				0,
				this.mediaHealthSubscriberCount - 1,
			);
			if (this.mediaHealthSubscriberCount === 0) this.mediaHealthMonitor.stop();
		};
	}

	sendHostControl(
		action:
			| "mute_participant"
			| "kick_participant"
			| "ban_participant"
			| "lower_hand",
		targetParticipantId: string,
	): Promise<unknown> {
		return this.sfuClient.sendRequest("host_control", {
			action,
			targetParticipantId,
		});
	}

	getRemoteAudioTrack(participantId: string): MediaStreamTrack | null {
		return this.consumerManager.getAudioConsumer(participantId)?.track ?? null;
	}

	getLocalProducerState(kind: LocalProducerKind): LocalProducerState | null {
		const producer = this.getLocalProducer(kind);
		return producer
			? {
					id: producer.id,
					track: producer.track ?? null,
					paused: producer.paused,
				}
			: null;
	}

	async replaceLocalProducerTrack(
		kind: LocalProducerKind,
		track: MediaStreamTrack,
	): Promise<boolean> {
		const producer = this.getLocalProducer(kind);
		if (!producer) return false;
		if (typeof producer.replaceTrack !== "function") {
			throw new Error(`${kind} producer cannot replace its track`);
		}
		await producer.replaceTrack({ track });
		return true;
	}

	async createLocalProducer(
		kind: Exclude<LocalProducerKind, "screen">,
		track: MediaStreamTrack,
	): Promise<LocalProducerState> {
		const producer = await this.transportManager.createProducer(track, {
			type: kind === "audio" ? "microphone" : "camera",
		});
		this.setLocalProducer(kind, producer);
		return {
			id: producer.id,
			track: producer.track ?? null,
			paused: producer.paused,
		};
	}

	async reconcileLocalProducerTrack(
		kind: LocalProducerKind,
		track: MediaStreamTrack,
		options: { resume?: boolean } = {},
	): Promise<LocalProducerState> {
		const state = await this.mediaManager.serializeSendMediaMutation(() =>
			this.reconcileLocalProducerTrackNow(kind, track, options),
		);
		if (!state) throw new Error(`${kind} producer reconciliation was cancelled`);
		return state;
	}

	publishScreenTrack(
		track: MediaStreamTrack,
	): Promise<LocalProducerState | null> {
		const generation = ++this.screenPublicationGeneration;
		this.screenPublicationTrack = track;
		return this.mediaManager.serializeSendMediaMutation(() =>
			this.reconcileLocalProducerTrackNow("screen", track, {}, () =>
				Boolean(
					this.screenPublicationGeneration === generation &&
						this.screenPublicationTrack === track &&
						track.readyState === "live",
				),
			),
		);
	}

	private async reconcileLocalProducerTrackNow(
		kind: LocalProducerKind,
		track: MediaStreamTrack,
		options: { resume?: boolean } = {},
		isCurrent: () => boolean = () => true,
	): Promise<LocalProducerState | null> {
		if (!isCurrent()) return null;
		if (track.readyState !== "live") {
			if (kind === "screen") return null;
			throw new Error(`Cannot publish ended ${kind} track`);
		}

		for (let attempt = 0; attempt < 3; attempt += 1) {
			if (!isCurrent()) return null;
			let producer = this.getLocalProducer(kind);
			if (producer?.closed) {
				this.setLocalProducer(kind, null);
				producer = null;
			}

			if (!producer) {
				const created = await this.transportManager.createProducer(track, {
					type:
						kind === "audio"
							? "microphone"
							: kind === "video"
								? "camera"
								: "screen",
				});
				if (
					!isCurrent() ||
					track.readyState !== "live" ||
					created.track?.readyState === "ended"
				) {
					this.closeProducerInstance(created);
					if (kind === "screen") return null;
					throw new Error(`${kind} track ended during producer creation`);
				}

				const current = this.getLocalProducer(kind);
				if (current && !current.closed) {
					this.closeProducerInstance(created);
					if (kind === "screen" && current.track !== track) return null;
					continue;
				}
				this.setLocalProducer(kind, created);
				producer = created;
			} else if (producer.track !== track) {
				if (typeof producer.replaceTrack !== "function") {
					throw new Error(`${kind} producer cannot replace its track`);
				}
				await producer.replaceTrack({ track });
				if (!isCurrent()) {
					if (this.getLocalProducer(kind) === producer) {
						this.setLocalProducer(kind, null);
						this.closeProducerInstance(producer);
					}
					return null;
				}
			}

			if (track.readyState !== "live") {
				if (this.getLocalProducer(kind) === producer) {
					this.setLocalProducer(kind, null);
				}
				this.closeProducerInstance(producer);
				if (kind === "screen") return null;
				throw new Error(`${kind} track ended during producer reconciliation`);
			}
			if (!isCurrent()) {
				if (this.getLocalProducer(kind) === producer) {
					this.setLocalProducer(kind, null);
					this.closeProducerInstance(producer);
				}
				return null;
			}
			if (this.getLocalProducer(kind) !== producer || producer.closed) {
				this.closeProducerInstance(producer);
				continue;
			}

			if (options.resume) {
				producer.resume();
				if (producer.id && this.sfuClient.isConnected()) {
					void this.sfuClient.resumeProducer(producer.id).catch(() => {});
				}
			}
			if (kind !== "screen") this.mediaManager.setLocalTrack(kind, track);
			return {
				id: producer.id,
				track: producer.track ?? null,
				paused: producer.paused,
			};
		}

		throw new Error(`${kind} producer changed repeatedly during reconciliation`);
	}

	private closeProducerInstance(
		producer: Producer,
		metadata: ProducerCloseMetadata = {},
	): void {
		void this.transportManager.discardProducer(producer, metadata);
	}

	closeLocalProducer(
		kind: LocalProducerKind,
		metadata: ProducerCloseMetadata = {},
	): void {
		if (kind === "screen") {
			this.screenPublicationGeneration += 1;
			this.screenPublicationTrack = null;
		}
		const producer = this.getLocalProducer(kind);
		this.setLocalProducer(kind, null);
		if (producer) void this.transportManager.discardProducer(producer, metadata);
	}

	async stopScreenShare(metadata: ProducerCloseMetadata = {}): Promise<void> {
		this.screenPublicationGeneration += 1;
		this.screenPublicationTrack = null;
		const producer = await this.mediaManager.serializeSendMediaMutation(async () => {
			const producer = this.getLocalProducer("screen");
			if (!producer) return null;
			this.setLocalProducer("screen", null);
			return producer;
		});
		if (!producer) return;

		try {
			if (producer.id && this.sfuClient.isConnected()) {
				await this.sfuClient.sendScreenShare("stop_share", {
					...metadata,
					producerId: producer.id,
					stoppedAt: Date.now(),
				});
			}
		} catch {
			// Local producer cleanup remains authoritative if signaling fails.
		} finally {
			await this.transportManager.discardProducer(producer, metadata);
		}
	}

	pauseLocalProducer(kind: LocalProducerKind): void {
		const producer = this.getLocalProducer(kind);
		producer?.pause();
		if (producer?.id && this.sfuClient.isConnected()) {
			void this.sfuClient.pauseProducer(producer.id);
		}
	}

	resumeLocalProducer(kind: LocalProducerKind): void {
		const producer = this.getLocalProducer(kind);
		producer?.resume();
		if (producer?.id && this.sfuClient.isConnected()) {
			void this.sfuClient.resumeProducer(producer.id).catch(() => {});
		}
	}

	hasLocalMediaPublications(): boolean {
		return Boolean(
			this.mediaManager.mediaHandler.videoProducer ||
				this.mediaManager.mediaHandler.audioProducer ||
				this.mediaManager.mediaHandler.screenProducer ||
				this.screenPublicationTrack?.readyState === "live",
		);
	}

	private getLocalProducer(kind: LocalProducerKind): Producer | null {
		const mediaHandler = this.mediaManager.mediaHandler;
		if (kind === "audio") return mediaHandler.audioProducer;
		if (kind === "video") return mediaHandler.videoProducer;
		return mediaHandler.screenProducer;
	}

	private setLocalProducer(
		kind: LocalProducerKind,
		producer: Producer | null,
	): void {
		if (kind === "audio") {
			this.mediaManager.mediaHandler.setProducers({ audioProducer: producer });
		} else if (kind === "video") {
			this.mediaManager.mediaHandler.setProducers({ videoProducer: producer });
		} else {
			this.mediaManager.mediaHandler.setProducers({ screenProducer: producer });
		}
	}

	private get mediaHandler() {
		return this.mediaManager.mediaHandler;
	}

	registerRemoteVideoElement(
		participantId: string,
		element: HTMLVideoElement | null,
	): void {
		this.videoManager.registerRemoteVideoElement(participantId, element);
	}

	registerLocalPreview(element: HTMLVideoElement | null): void {
		this.videoManager.registerLocalPreview(element);
	}

	attachLocalPreview(stream: MediaStream | null): Promise<void> {
		return this.videoManager.attachLocalPreview(stream);
	}

	registerScreenSharePreview(
		attachmentId: string,
		element: HTMLVideoElement | null,
	): void {
		this.videoManager.registerScreenSharePreview(attachmentId, element);
	}

	attachScreenSharePreview(
		attachmentId: string,
		stream: MediaStream,
		trackOwnership: AttachmentTrackOwnership = "borrowed",
	): Promise<void> {
		return this.videoManager.attachScreenSharePreview(
			attachmentId,
			stream,
			trackOwnership,
		);
	}

	removeScreenSharePreview(attachmentId: string): void {
		this.videoManager.removeScreenSharePreview(attachmentId);
	}

	attachBackgroundEffectsSource(
		attachmentId: string,
		element: HTMLVideoElement,
		stream: MediaStream,
	): Promise<void> {
		return this.videoManager.attachBackgroundEffectsSource(
			attachmentId,
			element,
			stream,
		);
	}

	removeBackgroundEffectsSource(attachmentId: string): void {
		this.videoManager.removeBackgroundEffectsSource(attachmentId);
	}

	async setAudioOutputDevice(deviceId: string): Promise<void> {
		await this.videoManager.setAudioOutputDevice(deviceId);
	}

	onRemoteConsumerReady(listener: (event: Event) => void): () => void {
		this.mediaManager.eventTarget.addEventListener("consumerReady", listener);
		return () =>
			this.mediaManager.eventTarget.removeEventListener("consumerReady", listener);
	}

	getVideoConsumerId(participantId: string): string | null {
		return this.consumerManager.getVideoConsumer(participantId)?.id ?? null;
	}

	async sampleRTCStats(): Promise<RTCStatsSample> {
		const transports = [
			{ direction: "send" as const, transport: this.transportManager.sendTransport },
			{ direction: "receive" as const, transport: this.transportManager.recvTransport },
		].filter((entry) => !!entry.transport);
		const producers = (["audio", "video", "screen"] as const).flatMap(
			(kind) => {
				const producer = this.getLocalProducer(kind);
				return producer && !producer.closed ? [{ kind, producer }] : [];
			},
		);
		const consumers = this.consumerManager.getAllConsumers();

		const [transportReports, streams] = await Promise.all([
			Promise.all(
				transports.map(async ({ direction, transport }) => {
					try {
						const reports = snapshotRTCStatsReports(await transport?.getStats());
						const current =
							direction === "send"
								? this.transportManager.sendTransport
								: this.transportManager.recvTransport;
						return current === transport ? reports : null;
					} catch {
						return null;
					}
				}),
			),
			Promise.all([
				...producers.map(async ({ kind, producer }) => {
					try {
						const reports = snapshotRTCStatsReports(await producer.getStats());
						if (this.getLocalProducer(kind) !== producer || producer.closed) return null;
						const source =
							producer.kind === "audio"
								? "microphone"
								: producer.appData?.type === "screen"
									? "screen"
									: "camera";
						return Object.freeze({
							id: producer.id,
							direction: "send" as const,
							kind: producer.kind,
							source,
							paused: producer.paused,
							muted: producer.track?.muted ?? false,
							trackSettings: Object.freeze({
								...(producer.track?.getSettings?.() ?? {}),
							}),
							reports,
						}) satisfies RTCStatsStreamSample;
					} catch {
						return null;
					}
				}),
				...consumers.map(async (entry) => {
					try {
						const reports = snapshotRTCStatsReports(await entry.consumer.getStats());
						if (this.consumerManager.getConsumer(entry.id)?.consumer !== entry.consumer) {
							return null;
						}
						const source =
							entry.kind === "audio"
								? "remote audio"
								: entry.isScreen || entry.appData?.type === "screen"
									? "remote screen"
									: "remote video";
						return Object.freeze({
							id: entry.id,
							direction: "receive" as const,
							kind: entry.kind,
							source,
							participantId: entry.participantId,
							paused: entry.consumer.paused,
							muted: entry.track?.muted ?? false,
							trackSettings: Object.freeze({
								...(entry.track?.getSettings?.() ?? {}),
							}),
							reports,
						}) satisfies RTCStatsStreamSample;
					} catch {
						return null;
					}
				}),
			]),
		]);

		return Object.freeze({
			transportReports: Object.freeze(
				transportReports.filter(
					(reports): reports is readonly RTCStatsReport[] => reports !== null,
				),
			),
			streams: Object.freeze(
				streams.filter(
					(stream): stream is RTCStatsStreamSample => stream !== null,
				),
			),
			signalingConnected: this.sfuClient.getConnectionStatus().connected,
			sendTransportState:
				this.transportManager.sendTransport?.connectionState ?? "closed",
			receiveTransportState:
				this.transportManager.recvTransport?.connectionState ?? "closed",
		});
	}

	async getConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
		let networkStats: ConnectionDiagnostics["networkStats"] = null;
		try {
			networkStats = await this.transportManager.getNetworkStats();
		} catch {
			// Diagnostics should still open when a recovering transport disappears.
		}
		return {
			connectionStatus: this.sfuClient.getConnectionStatus(),
			transportStats: this.transportManager.getTransportStats(),
			networkStats,
		};
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
		this.screenPublicationGeneration += 1;
		this.screenPublicationTrack = null;
		return this.connectionManager.disconnect();
	}

	async cleanup(): Promise<void> {
		this.mediaHealthSubscriberCount = 0;
		this.mediaHealthMonitor.stop();
		await this.disconnect();

		if (this.ownsVideoManager) this.videoManager.cleanup();
		else this.videoManager.cleanupRemoteMedia();
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

}
