/**
 * SFU Connection Manager
 * Handles SFU connection lifecycle, room joining, and participant sync
 */

import type { ConsumerEntry } from "../media/ConsumerManager";
import type {
	ParticipantData,
	ParticipantManager,
} from "../media/ParticipantManager";
import type { TransportManager } from "../media/TransportManager";
import type { VideoElementManager } from "../media/VideoElementManager";
import { waitForE2EEContextReady } from "../media/E2EEContextReady";
import type { ConnectionDetails, SFUClient } from "../SFUClient";
import type { SFUMediaManager } from "./SFUMediaManager";
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

export interface SFUEventHandlers {
	onParticipantJoined?: (participant: unknown) => void;
	onParticipantLeft?: (data: {
		participantId: string;
		participant?: unknown;
	}) => void;
	onParticipantUpdated?: (
		participantId: string,
		participant: unknown,
		updates: unknown,
	) => void;
	onScreenShareStarted?: (data: unknown) => void;
	onScreenShareStopped?: (data: unknown) => void;
	onActiveSpeakerChanged?: (participantIds: string[]) => void;
	onHostMutedYou?: () => void;
	onHostKickedYou?: (data: unknown) => void;
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
	currentUser: { value: unknown } = { value: null };
	isConnected = false;
	initialSyncInProgress = false;
	bufferedProducerEvents: SFUProducerEvent[] = [];
	eventHandlers: SFUEventHandlers = {};

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
		currentUser: unknown,
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

	async joinRoom(userData: unknown, mediaState: unknown): Promise<boolean> {
		try {
			await this.sfuClient.joinRoom(this.meetingId ?? "", userData, mediaState);
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

			const normalized = (participants || [])
				.map((p: Record<string, unknown>) => {
					const info = (p.info || {}) as Record<string, unknown>;
					return {
						participantId: (p.user_id ?? p.id) as string,
						user_id: (p.user_id ?? p.id) as string,
						user_name: (info.name ??
							info.user_name ??
							p.user_id ??
							"") as string,
						avatar: (info.avatar ?? null) as string | null,
						audio_enabled:
							typeof info.audio_enabled === "boolean"
								? info.audio_enabled
								: false,
						video_enabled:
							typeof info.video_enabled === "boolean"
								? info.video_enabled
								: false,
						is_guest: (info.is_guest as boolean) || false,
					};
				})
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

	async requestExistingProducers(): Promise<unknown[] | null> {
		try {
			const existingProducers = await this.sfuClient.getExistingProducers();

			if (existingProducers?.length) {
				console.log(
					`Found ${existingProducers.length} existing producers:`,
					existingProducers.map((p: unknown) => {
						const producer = p as Record<string, unknown>;
						return {
							id: producer.id,
							participantId:
								producer.participantId || producer.user_id || producer.userId,
							kind: producer.kind,
							isScreen: !!producer.isScreen,
						};
					}),
				);

				if (!(await this.waitForE2EEContextIfRequired())) {
					this.bufferedProducerEvents.push(
						...existingProducers.map((producerInfo: unknown) => {
							const info = producerInfo as Record<string, unknown>;
							return {
								producerId: info.id as string,
								participantId: (info.participantId ??
									info.user_id ??
									info.userId) as string,
								isScreen: !!info.isScreen,
							};
						}),
					);
					return existingProducers;
				}

				for (const producerInfo of existingProducers) {
					const info = producerInfo as Record<string, unknown>;
					const participantId = (info.participantId ??
						info.user_id ??
						info.userId) as string;
					const producerId = info.id as string;

					if (this.hasConsumerForProducer(participantId, producerId)) {
						continue;
					}

					console.log("Subscribing to existing producer:", {
						producerId,
						participantId,
						kind: info.kind,
						isScreen: !!info.isScreen,
					});
					await this.mediaManager.subscribeToRemoteProducer({
						producerId,
						participantId,
						isScreen: !!info.isScreen,
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
		this.transportManager.closeReceiveTransport();
		this.mediaManager.consumerManager.clear();
		this.mediaManager.processedConsumers.clear();
		this.mediaManager.isScreenShareActive = false;
		if (!(await this.waitForE2EEContextIfRequired())) {
			return;
		}
		await this.createReceiveTransport();
		await this.requestExistingProducers();
		await this.flushBufferedProducers();
	}

	async resyncProducers(): Promise<void> {
		await this.createReceiveTransport();
		await this.requestExistingProducers();
		await this.flushBufferedProducers();
	}

	async resyncAfterRecovery(reason: string): Promise<void> {
		const result = await this.recoveryManager.recoverTransportIce(reason);
		if (result === "failed" || result === "skipped") {
			await this.resetReceiveSide();
		}
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
			onParticipantAdded: (participant: Record<string, unknown>) => {
				if (this.eventHandlers.onParticipantJoined) {
					this.eventHandlers.onParticipantJoined(participant);
				}
			},
			onParticipantRemoved: (
				participantId: string,
				participant: Record<string, unknown>,
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
				participant: Record<string, unknown>,
				updates: Record<string, unknown>,
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
			onScreenShareStarted: (data: unknown) => {
				if (this.eventHandlers.onScreenShareStarted) {
					this.eventHandlers.onScreenShareStarted(data);
				}
			},
			onScreenShareStopped: (data: unknown) => {
				if (this.eventHandlers.onScreenShareStopped) {
					this.eventHandlers.onScreenShareStopped(data);
				}
			},
		});
	}

	private setupSFUEventHandlers(): void {
		this.sfuClient.on("reconnect", () => {
			void this.resyncAfterRecovery("socket_reconnect");
		});

		this.sfuClient.on("participant_joined", (data: ParticipantData) => {
			const currentUserId = this.getCurrentUserId();
			const joinedUserId = data.participantId || data.user_id || "";

			if (joinedUserId && joinedUserId !== currentUserId) {
				this.participantManager.addParticipant(data);
			}
		});

		this.sfuClient.on("participant_left", (data: ParticipantData) => {
			const d = data as ParticipantData;
			this.participantManager.removeParticipant(d.participantId || "");
		});

		this.sfuClient.on("producer_created", async (data: unknown) => {
			const d = data as SFUProducerEvent;
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

		this.sfuClient.on("producer_closed", (data: unknown) => {
			const d = data as SFUProducerClosedEvent;
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

		this.sfuClient.on("consumer_closed", (data: unknown) => {
			try {
				const d = data as { consumerId?: string; participantId?: string };
				const consumerId = d.consumerId;
				if (!consumerId) return;
				const removed =
					this.mediaManager.consumerManager.removeConsumer(consumerId);
				if (!removed) {
					const pid = d.participantId;
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

		this.sfuClient.on("media_control_update", (data: unknown) => {
			const d = data as SFUMediaControlEvent;
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

		this.sfuClient.on("network_quality_update", (data: unknown) => {
			const d = data as { participantId?: string; quality?: string };
			if (d.participantId && d.quality) {
				this.participantManager.updateParticipant(d.participantId, {
					networkQuality: d.quality,
				});
			}
		});

		this.sfuClient.on("host_control_update", (data: unknown) => {
			const d = data as SFUHostControlEvent;
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

		this.sfuClient.on("screen_share_started", (data: unknown) => {
			const d = data as { participantId?: string; stream?: MediaStream };
			console.log("SFU event: screen_share_started (from signaling)", {
				participantId: d.participantId,
				hasDirectStream: !!d.stream,
			});
		});

		this.sfuClient.on("screen_share_stopped", (data: unknown) => {
			const d = data as { participantId?: string };
			console.log("Screen share stopped - resetting sidebar mode flag");
			this.mediaManager.isScreenShareActive = false;

			if (this.eventHandlers.onScreenShareStopped) {
				this.eventHandlers.onScreenShareStopped(data);
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

		this.sfuClient.on("active_speaker", (data: unknown) => {
			const d = data as { participantIds: string[] };
			if (this.eventHandlers.onActiveSpeakerChanged) {
				this.eventHandlers.onActiveSpeakerChanged(d.participantIds);
			}
		});
	}

	private ensureRef(obj: unknown): { value: unknown } {
		if (obj && typeof obj === "object" && "value" in (obj as object)) {
			return obj as { value: unknown };
		}
		return { value: obj };
	}

	getCurrentUserId(): string | null {
		const cu = this.currentUser?.value || this.currentUser;
		return (
			((cu as Record<string, unknown>)?.user_id as string) ||
			((cu as Record<string, unknown>)?.userId as string) ||
			null
		);
	}

	async disconnect(): Promise<void> {
		try {
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
		this.meetingId = null;
		this.currentUser = { value: null };
		this.eventHandlers = {};
		this.isConnected = false;
		this.initialSyncInProgress = false;
	}
}
