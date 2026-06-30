/**
 * SFU Meeting Manager
 * Orchestrates SFU connection, media, and participant management
 *
 * This is a thin facade that coordinates the focused managers:
 * - SFUConnectionManager: Connection lifecycle and event handling
 * - SFUMediaManager: Producer/consumer operations
 * - SFURecoveryManager: ICE restart and recovery logic
 */

import { ConsumerManager } from "./media/ConsumerManager";
import { ParticipantManager } from "./media/ParticipantManager";
import { TransportManager } from "./media/TransportManager";
import { VideoElementManager } from "./media/VideoElementManager";
import type { SFUClient } from "./SFUClient";
import {
	SFUConnectionManager,
	type SFUEventHandlers,
} from "./sfu/SFUConnectionManager";
import { SFUMediaManager } from "./sfu/SFUMediaManager";
import { SFURecoveryManager } from "./sfu/SFURecoveryManager";

interface SFUMeetingManagerOptions {
	meetingId: string;
	currentUser: unknown;
	eventHandlers?: SFUEventHandlers;
}

export class SFUMeetingManager {
	sfuClient: SFUClient;

	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	consumerManager: ConsumerManager;
	transportManager: TransportManager;

	connectionManager: SFUConnectionManager;
	mediaManager: SFUMediaManager;
	recoveryManager: SFURecoveryManager;

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
			onRecovered: () => this.connectionManager?.resetReceiveSide(),
			onFailed: () => this.connectionManager?.resetReceiveSide(),
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

		this.connectionManager = new SFUConnectionManager({
			sfuClient,
			videoManager: this.videoManager,
			participantManager: this.participantManager,
			transportManager: this.transportManager,
			mediaManager: this.mediaManager,
			recoveryManager: this.recoveryManager,
		});
	}

	initialize(options: SFUMeetingManagerOptions): void {
		this.connectionManager.initialize(
			options.meetingId,
			options.currentUser,
			options.eventHandlers,
		);
	}

	async connect(authToken: string | null = null): Promise<boolean> {
		return this.connectionManager.connect(authToken);
	}

	async joinRoom(userData: unknown, mediaState: unknown): Promise<boolean> {
		return this.connectionManager.joinRoom(userData, mediaState);
	}

	async initializeDevice(): Promise<boolean> {
		return this.connectionManager.initializeDevice();
	}

	async createReceiveTransport(): Promise<boolean> {
		return this.connectionManager.createReceiveTransport();
	}

	async publishMedia(
		localStream: MediaStream,
		options: { publishVideo?: boolean; publishAudio?: boolean } = {},
	): Promise<Record<string, unknown>> {
		return this.mediaManager.publishMedia(localStream, options);
	}

	async setupExistingParticipants(): Promise<void> {
		return this.connectionManager.setupExistingParticipants();
	}

	async resyncAfterRecovery(reason: string): Promise<void> {
		return this.connectionManager.resyncAfterRecovery(reason);
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
		if (!this.sfuClient?.isConnected()) {
			return null;
		}

		try {
			return await this.sfuClient.updateConsumerPreferences({
				consumerId,
				visible: preferences.visible,
				width: preferences.width,
				height: preferences.height,
			});
		} catch (error) {
			console.warn(
				"Failed to update consumer preferences",
				consumerId,
				(error as Error)?.message || error,
			);
			return null;
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

	get initialSyncInProgress(): boolean {
		return this.connectionManager.initialSyncInProgress;
	}
}
