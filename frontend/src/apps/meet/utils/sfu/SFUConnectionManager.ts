/**
 * SFU Connection Manager
 * Handles SFU connection lifecycle, room joining, and participant sync
 */

import type { ConsumerEntry } from "../media/ConsumerManager";
import type {
	Participant,
	ParticipantData,
	ParticipantManager,
	ParticipantUpdate,
} from "../media/ParticipantManager";
import { normalizeParticipantData } from "../media/ParticipantManager";
import type { TransportManager } from "../media/TransportManager";
import type { VideoElementManager } from "../media/VideoElementManager";
import { waitForE2EEContextReady } from "../media/E2EEContextReady";
import type {
	ConnectionDetails,
	SFUClient,
	SFUExistingProducer,
} from "../SFUClient";
import type {
	JoinRoomMediaState,
	JoinUserData,
} from "../../types";
import { isUnknownRecord } from "../../types";
import type { User } from "../../composables/useCurrentUser";
import type { SFUMediaManager } from "./SFUMediaManager";
import type { MediaScreenShareEvent } from "./SFUMediaManager";
import type { SFURecoveryManager } from "./SFURecoveryManager";

interface SFUProducerEvent {
	producerId: string;
	participantId: string;
	isScreen?: boolean;
}

interface SFUProducerClosedEvent {
	participantId?: string;
	producerId?: string;
	isScreen?: boolean;
}

interface SFUMediaControlEvent {
	participantId: string;
	action?: string | { type: string; enabled: boolean };
}

interface SFUHostControlEvent {
	action: string;
	targetParticipantId: string;
	hostId?: string;
}

function normalizeProducerEvent(value: unknown): SFUProducerEvent | null {
	if (
		!isUnknownRecord(value) ||
		typeof value.producerId !== "string" ||
		typeof value.participantId !== "string"
	) {
		return null;
	}
	return {
		producerId: value.producerId,
		participantId: value.participantId,
		isScreen: value.isScreen === true,
	};
}

function normalizeProducerClosedEvent(
	value: unknown,
): SFUProducerClosedEvent | null {
	if (!isUnknownRecord(value)) return null;
	return {
		participantId:
			typeof value.participantId === "string" ? value.participantId : undefined,
		producerId:
			typeof value.producerId === "string" ? value.producerId : undefined,
		isScreen: value.isScreen === true,
	};
}

function normalizeScreenShareEvent(value: unknown): ScreenShareEvent | null {
	if (!isUnknownRecord(value)) return null;
	return {
		participantId:
			typeof value.participantId === "string" ? value.participantId : undefined,
		consumerId:
			typeof value.consumerId === "string" ? value.consumerId : undefined,
		stream:
			typeof MediaStream !== "undefined" && value.stream instanceof MediaStream
				? value.stream
				: undefined,
	};
}

export interface SFUEventHandlers {
	onParticipantJoined?: (participant: Participant) => void;
	onParticipantLeft?: (data: {
		participantId: string;
		participant?: Participant;
	}) => void;
	onParticipantUpdated?: (
		participantId: string,
		participant: Participant,
		updates: ParticipantUpdate,
	) => void;
	onScreenShareStarted?: (data: ScreenShareEvent) => void;
	onScreenShareStopped?: (data: ScreenShareEvent) => void;
	onActiveSpeakerChanged?: (participantIds: string[]) => void;
	onNetworkQualityUpdated?: (participantId: string, quality: string) => void;
	onHostMutedYou?: () => void;
	onHostKickedYou?: (data: { hostId?: string }) => void;
	onRecoveryStateChange?: (
		state:
			| "reconnecting"
			| "rejoining"
			| "recovering_send"
			| "recovering_receive"
			| "healthy"
			| "failed",
		detail?: string,
	) => void;
	onRecoveryExhausted?: () => void;
}

interface ScreenShareEvent {
	participantId?: string;
	consumerId?: string;
	stream?: MediaStream;
	consumer?: { id: string };
}

interface ConnectionManagerOptions {
	sfuClient: SFUClient;
	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	transportManager: TransportManager;
	mediaManager: SFUMediaManager;
	recoveryManager: SFURecoveryManager;
}

export class SFUConnectionManager {
	sfuClient: SFUClient;
	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	transportManager: TransportManager;
	mediaManager: SFUMediaManager;
	recoveryManager: SFURecoveryManager;

	meetingId: string | null = null;
	currentUser: { value: User | null } = { value: null };
	isConnected = false;
	initialSyncInProgress = false;
	bufferedProducerEvents: SFUProducerEvent[] = [];
	eventHandlers: SFUEventHandlers = {};
	private lastJoinUserData: JoinUserData | null = null;
	private lastJoinMediaState: JoinRoomMediaState = {
		audio_enabled: false,
		video_enabled: false,
	};
	private activeRejoin: Promise<void> | null = null;
	private activeReceiveReset: Promise<void> | null = null;
	private lifecycleGeneration = 0;

	constructor(options: ConnectionManagerOptions) {
		this.sfuClient = options.sfuClient;
		this.videoManager = options.videoManager;
		this.participantManager = options.participantManager;
		this.transportManager = options.transportManager;
		this.mediaManager = options.mediaManager;
		this.recoveryManager = options.recoveryManager;
	}

	initialize(
		meetingId: string,
		currentUser: User | { value: User | null } | null,
		eventHandlers?: SFUEventHandlers,
	): void {
		this.meetingId = meetingId;
		this.currentUser = this.ensureRef(currentUser);
		this.eventHandlers = eventHandlers || {};
	}

	async connect(
		authToken: string | null = null,
		prefetchedDetails: ConnectionDetails | null = null,
	): Promise<boolean> {
		if (this.isConnected) {
			return true;
		}

		try {
			await this.sfuClient.connect(
				this.meetingId ?? "",
				authToken,
				prefetchedDetails,
			);
			this.isConnected = true;

			this.transportManager.initialize(this.sfuClient);
			this.recoveryManager.setupTransportEventHandlers();
			this.setupManagerEventHandlers();
			this.setupSFUEventHandlers();

			return true;
		} catch (error) {
			console.error("Failed to connect to SFU:", error);
			throw error;
		}
	}

	async joinRoom(
		userData: JoinUserData,
		mediaState: JoinRoomMediaState,
	): Promise<boolean> {
		try {
			await this.sfuClient.joinRoom(this.meetingId ?? "", userData, mediaState);
			this.lastJoinUserData = userData;
			this.lastJoinMediaState = { ...mediaState };
			console.log("Successfully joined room:", this.meetingId);
			return true;
		} catch (error) {
			console.error("Failed to join room:", error);
			throw error;
		}
	}

	async initializeDevice(): Promise<boolean> {
		try {
			await this.transportManager.initializeDevice();
			return true;
		} catch (error) {
			console.error("Failed to initialize MediaSoup device:", error);
			throw error;
		}
	}

	async createReceiveTransport(): Promise<boolean> {
		try {
			if (!(await this.waitForE2EEContextIfRequired())) {
				return false;
			}
			await this.transportManager.createReceiveTransport();
			return true;
		} catch (error) {
			console.warn("Failed to create receive transport:", error);
			return false;
		}
	}

	async setupExistingParticipants(): Promise<void> {
		try {
			this.initialSyncInProgress = true;

			const participants = await this.sfuClient.getRoomParticipants();
			const currentUserId = this.getCurrentUserId();

			const normalized = participants
				.map((participant) => ({
					...participant,
					audio_enabled: participant.userData?.audio_enabled ?? false,
					video_enabled: participant.userData?.video_enabled ?? false,
					is_guest: participant.userData?.is_guest ?? false,
				}))
				.filter((p) => p.user_id !== currentUserId);

			this.participantManager.syncParticipants(normalized);

			await this.requestExistingProducers();
			await this.flushBufferedProducers();

			this.initialSyncInProgress = false;
		} catch (error) {
			console.error("Error in setupExistingParticipants:", error);
			this.initialSyncInProgress = false;
			throw error;
		}
	}

	async requestExistingProducers(): Promise<SFUExistingProducer[] | null> {
		try {
			const existingProducers = await this.sfuClient.getExistingProducers();

			if (existingProducers?.length) {
				console.log(
					`Found ${existingProducers.length} existing producers:`,
					existingProducers,
				);

				if (!(await this.waitForE2EEContextIfRequired())) {
					this.bufferedProducerEvents.push(
						...existingProducers.map((producer) => ({
							producerId: producer.id,
							participantId: producer.participantId,
							isScreen: producer.isScreen,
						})),
					);
					return existingProducers;
				}

				for (const producerInfo of existingProducers) {
					const participantId = producerInfo.participantId;
					const producerId = producerInfo.id;

					if (this.hasConsumerForProducer(participantId, producerId)) {
						continue;
					}

					console.log("Subscribing to existing producer:", {
						producerId,
						participantId,
						kind: producerInfo.kind,
						isScreen: producerInfo.isScreen,
					});
					await this.mediaManager.subscribeToRemoteProducer({
						producerId,
						participantId,
						isScreen: producerInfo.isScreen,
					});
				}
			} else {
				console.log("No existing producers found");
			}

			return existingProducers;
		} catch (error) {
			console.warn("Failed to request existing producers:", error);
			return null;
		}
	}

	async flushBufferedProducers(): Promise<void> {
		if (!this.bufferedProducerEvents.length) {
			console.log("No buffered producer events to flush");
			return;
		}
		if (!(await this.waitForE2EEContextIfRequired())) {
			return;
		}

		console.log(
			`Flushing ${this.bufferedProducerEvents.length} buffered producer events`,
		);
		const pending = this.bufferedProducerEvents.splice(0);
		for (const event of pending) {
			try {
				if (!event?.producerId || !event.participantId) {
					console.warn("Skipping malformed buffered producer event:", event);
					continue;
				}

				if (this.hasConsumerForProducer(event.participantId, event.producerId)) {
					continue;
				}

				await this.mediaManager.subscribeToRemoteProducer({
					producerId: event.producerId as string,
					participantId: event.participantId as string,
					isScreen: !!event.isScreen,
				});
			} catch (error) {
				console.warn("Failed to process buffered producer:", error);
			}
		}
	}

	async resetReceiveSide(): Promise<void> {
		if (this.activeReceiveReset) return this.activeReceiveReset;

		const generation = this.lifecycleGeneration;
		this.activeReceiveReset = this.performReceiveReset(generation).finally(() => {
			this.activeReceiveReset = null;
		});
		return this.activeReceiveReset;
	}

	private async performReceiveReset(generation: number): Promise<void> {
		const pendingSubscriptions = this.mediaManager.cancelPendingSubscriptions();
		this.transportManager.closeReceiveTransport();
		this.mediaManager.consumerManager.clear();
		this.mediaManager.processedConsumers.clear();
		this.mediaManager.isScreenShareActive = false;
		await pendingSubscriptions;
		if (generation !== this.lifecycleGeneration) return;
		if (!(await this.waitForE2EEContextIfRequired())) {
			return;
		}
		if (generation !== this.lifecycleGeneration) return;
		if (!(await this.createReceiveTransport())) return;
		if (generation !== this.lifecycleGeneration) return;
		await this.requestExistingProducers();
		if (generation !== this.lifecycleGeneration) return;
		await this.flushBufferedProducers();
	}

	async resyncProducers(): Promise<void> {
		await this.createReceiveTransport();
		await this.requestExistingProducers();
		await this.flushBufferedProducers();
	}

	async resyncAfterRecovery(reason: string): Promise<void> {
		const result = await this.recoveryManager.recoverTransportIce(reason);
		if (result === "skipped") {
			await this.resetReceiveSide();
		}
	}

	reportRecoveryState(
		state: Parameters<NonNullable<SFUEventHandlers["onRecoveryStateChange"]>>[0],
		detail?: string,
	): void {
		this.eventHandlers.onRecoveryStateChange?.(state, detail);
	}

	async rejoinAfterSignalingReconnect(): Promise<void> {
		if (this.activeRejoin) return this.activeRejoin;
		if (!this.meetingId || !this.lastJoinUserData) {
			throw new Error("Cannot rejoin before joining a meeting");
		}
		this.recoveryManager.reset();
		const generation = this.lifecycleGeneration;
		const lastJoinUserData = this.lastJoinUserData;
		const meetingId = this.meetingId;

		const rejoin = (async () => {
			this.reportRecoveryState("rejoining", "signaling reconnected");
			const pendingSubscriptions =
				this.mediaManager.cancelPendingSubscriptions();
			this.transportManager.closeReceiveTransport();
			this.mediaManager.consumerManager.clear();
			this.mediaManager.processedConsumers.clear();
			this.mediaManager.isScreenShareActive = false;
			await pendingSubscriptions;
			if (generation !== this.lifecycleGeneration) return;

			await this.sfuClient.joinRoom(
				meetingId,
				lastJoinUserData,
				this.getCurrentRejoinMediaState(),
			);
			if (generation !== this.lifecycleGeneration) return;
			if (!(await this.waitForE2EEContextIfRequired())) {
				throw new Error("E2EE context is not ready after signaling reconnect");
			}
			if (generation !== this.lifecycleGeneration) return;

			await this.transportManager.initializeDevice();
			if (generation !== this.lifecycleGeneration) return;
			if (!(await this.createReceiveTransport())) {
				throw new Error("Failed to recreate receive transport after reconnect");
			}
			if (generation !== this.lifecycleGeneration) return;
			await this.mediaManager.rebuildSendSide();
			if (generation !== this.lifecycleGeneration) return;
			await this.setupExistingParticipants();
			if (generation !== this.lifecycleGeneration) return;
			this.recoveryManager.setupTransportEventHandlers();
			this.reportRecoveryState("healthy", "session rebuilt");
		})()
			.catch((error) => {
				this.reportRecoveryState("failed", "session rebuild failed");
				throw error;
			})
			.finally(() => {
				this.activeRejoin = null;
			});
		this.activeRejoin = rejoin;

		return rejoin;
	}

	private hasConsumerForProducer(participantId: string, producerId: string): boolean {
		const existingConsumers =
			this.mediaManager.consumerManager.getConsumersByParticipant(participantId);
		return existingConsumers.some(
			(c) =>
				!c.consumer.closed &&
				(c.producerId === producerId || c.consumer.producerId === producerId),
		);
	}

	private getCurrentRejoinMediaState(): JoinRoomMediaState {
		const localStream = this.mediaManager.mediaHandler.localStream;
		if (!localStream) return this.lastJoinMediaState;

		return {
			...this.lastJoinMediaState,
			audio_enabled: localStream
				.getAudioTracks()
				.some((track) => track.readyState === "live"),
			video_enabled: localStream
				.getVideoTracks()
				.some((track) => track.readyState === "live"),
		};
	}

	private async waitForE2EEContextIfRequired(): Promise<boolean> {
		if (!this.sfuClient.isE2EERequired?.()) {
			return true;
		}
		try {
			await waitForE2EEContextReady();
			return true;
		} catch (error) {
			console.warn("E2EE context not ready for media subscription:", error);
			return false;
		}
	}

	private setupManagerEventHandlers(): void {
		this.participantManager.setEventHandlers({
			onParticipantAdded: (participant: Participant) => {
				if (this.eventHandlers.onParticipantJoined) {
					this.eventHandlers.onParticipantJoined(participant);
				}
			},
			onParticipantRemoved: (
				participantId: string,
				participant: Participant,
			) => {
				this.videoManager.removeVideoElement(participantId);
				this.mediaManager.consumerManager.cleanupParticipantConsumers(
					participantId,
				);
				if (this.eventHandlers.onParticipantLeft) {
					this.eventHandlers.onParticipantLeft({ participantId, participant });
				}
			},
			onParticipantUpdated: (
				participantId: string,
				participant: Participant,
				updates: ParticipantUpdate,
			) => {
				if (this.eventHandlers.onParticipantUpdated) {
					this.eventHandlers.onParticipantUpdated(
						participantId,
						participant,
						updates,
					);
				}
			},
		});

		this.mediaManager.consumerManager.setEventHandlers({
			onConsumerAdded: (consumer: ConsumerEntry) => {
				this.mediaManager.handleNewConsumer(consumer);
			},
			onConsumerRemoved: (consumerId: string, consumer: ConsumerEntry) => {
				if (consumer?.isScreen || consumer?.appData?.type === "screen") {
					this.mediaManager.isScreenShareActive = false;
					if (this.eventHandlers.onScreenShareStopped) {
						this.eventHandlers.onScreenShareStopped({
							participantId: consumer.participantId,
							consumerId,
						});
					}
				}
			},
			onConsumerLost: (info) => {
				void this.mediaManager.handleConsumerLost(info);
			},
		});

		this.mediaManager.setEventHandlers({
			onRecoveryExhausted: () => {
				this.eventHandlers.onRecoveryExhausted?.();
			},
			onScreenShareStarted: (data: MediaScreenShareEvent) => {
				if (this.eventHandlers.onScreenShareStarted) {
					this.eventHandlers.onScreenShareStarted(data);
				}
			},
			onScreenShareStopped: (data: MediaScreenShareEvent) => {
				if (this.eventHandlers.onScreenShareStopped) {
					this.eventHandlers.onScreenShareStopped(data);
				}
			},
		});
	}

	private setupSFUEventHandlers(): void {
		this.sfuClient.on("reconnect_attempt", () => {
			this.recoveryManager.reset();
			this.reportRecoveryState("reconnecting", "signaling reconnect attempt");
		});

		this.sfuClient.on("reconnect_failed", () => {
			this.reportRecoveryState("failed", "signaling reconnect failed");
		});

		this.sfuClient.on("reconnect", () => {
			this.reportRecoveryState("reconnecting", "signaling reconnected");
			void this.rejoinAfterSignalingReconnect().catch((error) => {
				console.warn("Failed to rejoin after signaling reconnect:", error);
			});
		});

		this.sfuClient.on("participant_joined", (value: unknown) => {
			const data = normalizeParticipantData(value);
			if (!data) return;
			const currentUserId = this.getCurrentUserId();
			const joinedUserId = data.participantId || data.user_id || "";

			if (joinedUserId && joinedUserId !== currentUserId) {
				this.participantManager.addParticipant(data);
			}
		});

		this.sfuClient.on("participant_left", (value: unknown) => {
			const participant = normalizeParticipantData(value);
			if (participant?.participantId) {
				this.participantManager.removeParticipant(participant.participantId);
			}
		});

		this.sfuClient.on("producer_created", async (value: unknown) => {
			const d = normalizeProducerEvent(value);
			if (!d) return;
			if (d.participantId === this.getCurrentUserId()) return;

			if (
				this.initialSyncInProgress ||
				!this.transportManager?.isDeviceLoaded?.()
			) {
				this.bufferedProducerEvents.push(d);
				return;
			}
			if (!(await this.waitForE2EEContextIfRequired())) {
				this.bufferedProducerEvents.push(d);
				return;
			}

			try {
				await this.mediaManager.subscribeToRemoteProducer({
					producerId: d.producerId,
					participantId: d.participantId,
					isScreen: !!d.isScreen,
				});
			} catch (error) {
				console.warn("Failed to subscribe to producer_created event:", error);
			}
		});

		this.sfuClient.on("producer_closed", (value: unknown) => {
			const d = normalizeProducerClosedEvent(value);
			if (!d) return;
			const pid = d.participantId;
			const closedProducerId = d.producerId;
			const closedIsScreen = d.isScreen;
			if (pid) {
				const allForPid =
					this.mediaManager.consumerManager.getConsumersByParticipant(pid);
				for (const c of allForPid) {
					const producedMatch =
						(closedProducerId && c.consumer.producerId === closedProducerId) ||
						c.appData?.producerId === closedProducerId;
					const isScreenLike =
						c.isScreen ||
						c.appData?.type === "screen" ||
						c.consumer.appData?.type === "screen";
					const shouldRemove =
						producedMatch || (isScreenLike && closedIsScreen);
					if (shouldRemove) {
						this.mediaManager.consumerManager.removeConsumer(c.id);
						this.mediaManager.processedConsumers.delete(c.id);
					}
				}
			}

			if (this.eventHandlers && d?.isScreen) {
				this.eventHandlers.onScreenShareStopped?.({
					participantId: d.participantId,
				});
			}
		});

		this.sfuClient.on("consumer_closed", (value: unknown) => {
			try {
				if (!isUnknownRecord(value)) return;
				const consumerId =
					typeof value.consumerId === "string" ? value.consumerId : undefined;
				if (!consumerId) return;
				const removed =
					this.mediaManager.consumerManager.removeConsumer(consumerId);
				if (!removed) {
					const pid =
						typeof value.participantId === "string"
							? value.participantId
							: undefined;
					if (pid) {
						const allForPid =
							this.mediaManager.consumerManager.getConsumersByParticipant(pid);
						for (const c of allForPid) {
							const maybeScreen =
								c.isScreen ||
								c.appData?.type === "screen" ||
								(c.consumer as { appData?: { type?: string } })?.appData
									?.type === "screen";
							if (maybeScreen) {
								this.mediaManager.consumerManager.removeConsumer(c.id);
							}
						}
					}
				}
			} catch (e: unknown) {
				console.warn("Error handling consumer_closed", (e as Error).message);
			}
		});

		this.sfuClient.on("media_control_update", (value: unknown) => {
			if (!isUnknownRecord(value) || typeof value.participantId !== "string") {
				return;
			}
			const action = value.action;
			const d: SFUMediaControlEvent = {
				participantId: value.participantId,
				action:
					typeof action === "string"
						? action
						: isUnknownRecord(action) &&
								typeof action.type === "string" &&
								typeof action.enabled === "boolean"
							? { type: action.type, enabled: action.enabled }
							: undefined,
			};
			const updates: Record<string, boolean> = {};
			if (d.action && typeof d.action === "object") {
				const a = d.action;
				if (a.type === "audio" && typeof a.enabled === "boolean") {
					updates.audioEnabled = !!a.enabled;
				}
				if (a.type === "video" && typeof a.enabled === "boolean") {
					updates.videoEnabled = !!a.enabled;
				}
			} else if (typeof d.action === "string") {
				switch (d.action) {
					case "mute":
						updates.audioEnabled = false;
						break;
					case "unmute":
						updates.audioEnabled = true;
						break;
					case "video_off":
						updates.videoEnabled = false;
						break;
					case "video_on":
						updates.videoEnabled = true;
						break;
					default:
						break;
				}
			}

			if (Object.keys(updates).length) {
				this.participantManager.updateMediaState(d.participantId, updates);
			}
		});

		this.sfuClient.on("network_quality_update", (value: unknown) => {
			if (
				isUnknownRecord(value) &&
				typeof value.participantId === "string" &&
				typeof value.quality === "string"
			) {
				this.eventHandlers.onNetworkQualityUpdated?.(
					value.participantId,
					value.quality,
				);
				this.participantManager.updateParticipant(value.participantId, {
					networkQuality: value.quality,
				});
			}
		});

		this.sfuClient.on("host_control_update", (value: unknown) => {
			if (
				!isUnknownRecord(value) ||
				typeof value.action !== "string" ||
				typeof value.targetParticipantId !== "string"
			) return;
			const d: SFUHostControlEvent = {
				action: value.action,
				targetParticipantId: value.targetParticipantId,
				hostId: typeof value.hostId === "string" ? value.hostId : undefined,
			};
			const myParticipantId = this.getCurrentUserId();
			const isForMe = d.targetParticipantId === myParticipantId;

			switch (d.action) {
				case "mute_participant":
					if (isForMe) {
						this.eventHandlers.onHostMutedYou?.();
					} else {
						this.participantManager.updateMediaState(d.targetParticipantId, {
							audioEnabled: false,
						});
					}
					break;
				case "kick_participant":
					if (isForMe) {
						this.eventHandlers.onHostKickedYou?.({ hostId: d.hostId });
					}
					break;
				default:
					console.warn("Unknown host control action:", d.action);
			}
		});

		this.sfuClient.on("screen_share_started", (value: unknown) => {
			const d = normalizeScreenShareEvent(value);
			if (!d) return;
			console.log("SFU event: screen_share_started (from signaling)", {
				participantId: d.participantId,
				hasDirectStream: !!d.stream,
			});
		});

		this.sfuClient.on("screen_share_stopped", (value: unknown) => {
			const d = normalizeScreenShareEvent(value);
			if (!d) return;
			console.log("Screen share stopped - resetting sidebar mode flag");
			this.mediaManager.isScreenShareActive = false;

			if (this.eventHandlers.onScreenShareStopped) {
				this.eventHandlers.onScreenShareStopped(d);
			}

			const pid = d.participantId;
			if (pid) {
				const screenConsumers = this.mediaManager.consumerManager
					.getScreenShareConsumers()
					.filter((c) => c.participantId === pid);
				for (const sc of screenConsumers) {
					console.log("Removing screen-share consumer on stop:", {
						consumerId: sc.id,
						participantId: pid,
					});
					this.mediaManager.consumerManager.removeConsumer(sc.id);
					this.mediaManager.processedConsumers.delete(sc.id);
				}
				const allForPid =
					this.mediaManager.consumerManager.getConsumersByParticipant(pid);
				for (const c of allForPid) {
					const maybeScreen =
						c.isScreen ||
						c.appData?.type === "screen" ||
						(c.consumer as { appData?: { type?: string } })?.appData?.type ===
							"screen";
					if (maybeScreen) {
						console.log("(safety) Removing screen-like consumer on stop:", {
							consumerId: c.id,
							participantId: pid,
						});
						this.mediaManager.consumerManager.removeConsumer(c.id);
						this.mediaManager.processedConsumers.delete(c.id);
					}
				}
			}
		});

		this.sfuClient.on("active_speaker", (value: unknown) => {
			if (
				!isUnknownRecord(value) ||
				!Array.isArray(value.participantIds) ||
				!value.participantIds.every((id) => typeof id === "string")
			) return;
			const d = { participantIds: value.participantIds };
			if (this.eventHandlers.onActiveSpeakerChanged) {
				this.eventHandlers.onActiveSpeakerChanged(d.participantIds);
			}
		});
	}

	private ensureRef(
		obj: User | { value: User | null } | null,
	): { value: User | null } {
		if (obj && "value" in obj) {
			return obj;
		}
		return { value: obj };
	}

	getCurrentUserId(): string | null {
		const user = this.currentUser.value;
		return user?.user_id || user?.userId || null;
	}

	async disconnect(): Promise<void> {
		try {
			this.lifecycleGeneration++;
			this.recoveryManager.reset();
			this.mediaManager.cleanup();
			this.transportManager?.cleanup?.();
			if (this.sfuClient) {
				await this.sfuClient.disconnect();
			}
			this.isConnected = false;
		} catch (error) {
			console.error("Error disconnecting from SFU:", error);
		}
	}

	reset(): void {
		this.lifecycleGeneration++;
		this.meetingId = null;
		this.currentUser = { value: null };
		this.eventHandlers = {};
		this.isConnected = false;
		this.initialSyncInProgress = false;
		this.lastJoinUserData = null;
		this.lastJoinMediaState = {
			audio_enabled: false,
			video_enabled: false,
		};
		this.activeRejoin = null;
	}
}
