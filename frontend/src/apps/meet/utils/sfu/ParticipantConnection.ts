/** Owns one browser endpoint's SFU lifecycle from setup through cleanup. */

import type { ConsumerEntry } from "../media/ConsumerManager";
import type {
	Participant,
	ParticipantData,
	ParticipantManager,
	ParticipantUpdate,
} from "../media/ParticipantManager";
import { normalizeParticipantData } from "../media/ParticipantManager";
import type { TransportManager } from "../media/TransportManager";
import type { TransportIceRestartResult } from "../media/TransportManager";
import type { VideoElementManager } from "../media/VideoElementManager";
import { waitForE2EEContextReady } from "../media/E2EEContextReady";
import type {
	ConnectionDetails,
	SFUClient,
	SFUExistingProducer,
} from "../SFUClient";
import type { JoinRoomMediaState, JoinUserData } from "../../types";
import { isUnknownRecord } from "../../types";
import type { User } from "../../composables/useCurrentUser";
import type { SFUMediaManager } from "./SFUMediaManager";
import type { MediaScreenShareEvent } from "./SFUMediaManager";
import type { RecoveryResult, SFURecoveryManager } from "./SFURecoveryManager";
import {
	applyMeetingReconciliationEvent,
	createMeetingReconciliationState,
	reconcileMeetingSnapshot,
	type MeetingReconciliationEvent,
	type MeetingReconciliationState,
} from "./MeetingSnapshotReconciler";

interface SFUProducerEvent {
	producerId: string;
	participantId: string;
	isScreen?: boolean;
}

type ReconciledParticipant = ParticipantData & { participantId: string };
type ReconciliationEvent = MeetingReconciliationEvent<ReconciledParticipant>;

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
	onLifecycleStateChange?: (state: ParticipantConnectionState) => void;
	onInitialPublicationError?: (error: unknown) => void;
}

export type ParticipantConnectionState =
	| "starting"
	| "syncing"
	| "ready"
	| "degraded"
	| "recovering"
	| "stopping"
	| "stopped"
	| "failed";

export interface ParticipantConnectionStartOptions {
	authToken?: string | null;
	prefetchedDetails?: ConnectionDetails | null;
	prepareJoin: (signal: AbortSignal) => Promise<{
		userData: JoinUserData;
		mediaState: JoinRoomMediaState;
	}>;
	waitForE2EEReady: (signal: AbortSignal) => Promise<void>;
	publishLocalMedia: (signal: AbortSignal) => Promise<unknown>;
}

interface ScreenShareEvent {
	participantId?: string;
	consumerId?: string;
	stream?: MediaStream;
	consumer?: { id: string };
}

interface ParticipantConnectionOptions {
	sfuClient: SFUClient;
	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	transportManager: TransportManager;
	mediaManager: SFUMediaManager;
	recoveryManager: SFURecoveryManager;
}

export class ParticipantConnection {
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
	private bufferedReconciliationEvents: ReconciliationEvent[] = [];
	private reconciliation: MeetingReconciliationState<ReconciledParticipant> =
		createMeetingReconciliationState();
	private producerClaims = new Set<string>();
	eventHandlers: SFUEventHandlers = {};
	private lastJoinUserData: JoinUserData | null = null;
	private lastJoinMediaState: JoinRoomMediaState = {
		audio_enabled: false,
		video_enabled: false,
	};
	private activeRejoin: Promise<void> | null = null;
	private activeReceiveReset: Promise<void> | null = null;
	private lifecycleGeneration = 0;
	private lifecycleTail: Promise<void> = Promise.resolve();
	private lifecycleAbortController = new AbortController();
	private snapshotRetry: Promise<void> | null = null;
	private e2eeReadyForLifecycle = false;
	private _state: ParticipantConnectionState = "stopped";
	private static readonly INITIAL_RETRY_DELAY_MS = 1000;
	private static readonly MAX_RETRY_DELAY_MS = 30000;

	constructor(options: ParticipantConnectionOptions) {
		this.sfuClient = options.sfuClient;
		this.videoManager = options.videoManager;
		this.participantManager = options.participantManager;
		this.transportManager = options.transportManager;
		this.mediaManager = options.mediaManager;
		this.recoveryManager = options.recoveryManager;
	}

	get state(): ParticipantConnectionState {
		return this._state;
	}

	start(
		options: ParticipantConnectionStartOptions,
	): Promise<ParticipantConnectionState> {
		const requestedGeneration = this.lifecycleGeneration;
		return this.serializeLifecycle(async () => {
			if (requestedGeneration !== this.lifecycleGeneration) {
				throw new DOMException(
					"Participant connection start cancelled",
					"AbortError",
				);
			}
			if (this._state !== "stopped" && this._state !== "failed") {
				throw new Error(
					`Cannot start participant connection from ${this._state}`,
				);
			}

			this.lifecycleAbortController.abort();
			this.lifecycleAbortController = new AbortController();
			const signal = this.lifecycleAbortController.signal;
			this.setState("starting");
			this.initialSyncInProgress = true;

			try {
				await this.connect(options.authToken, options.prefetchedDetails);
				this.throwIfAborted(signal);
				const { userData, mediaState } = await this.awaitAbortable(
					options.prepareJoin(signal),
					signal,
				);
				await this.joinRoom(userData, mediaState);
				this.throwIfAborted(signal);
				if (this.sfuClient.isE2EERequired?.()) {
					await this.awaitAbortable(options.waitForE2EEReady(signal), signal);
					this.e2eeReadyForLifecycle = true;
				}
				await this.initializeDevice();
				this.throwIfAborted(signal);
				if (!(await this.createReceiveTransport())) {
					throw new Error("Failed to create receive transport");
				}
				this.throwIfAborted(signal);
				this.setState("syncing");

				const [publication, snapshot] = await Promise.allSettled([
					this.awaitAbortable(options.publishLocalMedia(signal), signal),
					this.setupExistingParticipants(signal, true),
				]);
				this.throwIfAborted(signal);
				if (publication.status === "rejected") {
					console.warn("Initial media publication failed:", publication.reason);
					this.eventHandlers.onInitialPublicationError?.(publication.reason);
				}
				if (snapshot.status === "rejected") {
					this.initialSyncInProgress = true;
					this.setState("degraded");
					this.startSnapshotRetry(signal);
				} else {
					this.setState("ready");
				}
				return this._state;
			} catch (error) {
				this.initialSyncInProgress = false;
				if (signal.aborted) throw error;
				this.setState("failed");
				throw error;
			}
		});
	}

	private serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.lifecycleTail.then(operation, operation);
		this.lifecycleTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private setState(state: ParticipantConnectionState): void {
		if (this._state === state) return;
		this._state = state;
		this.eventHandlers.onLifecycleStateChange?.(state);
	}

	private throwIfAborted(signal: AbortSignal): void {
		if (signal.aborted)
			throw signal.reason ?? new DOMException("Aborted", "AbortError");
	}

	private awaitAbortable<T>(
		promise: Promise<T>,
		signal: AbortSignal,
	): Promise<T> {
		if (signal.aborted) return Promise.reject(signal.reason);
		return new Promise<T>((resolve, reject) => {
			const abort = () =>
				reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			signal.addEventListener("abort", abort, { once: true });
			promise.then(
				(value) => {
					signal.removeEventListener("abort", abort);
					resolve(value);
				},
				(error) => {
					signal.removeEventListener("abort", abort);
					reject(error);
				},
			);
		});
	}

	private delay(ms: number, signal: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(done, ms);
			function done() {
				signal.removeEventListener("abort", abort);
				resolve();
			}
			function abort() {
				clearTimeout(timeout);
				reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			}
			signal.addEventListener("abort", abort, { once: true });
		});
	}

	private async waitUntilOnline(signal: AbortSignal): Promise<void> {
		if (typeof navigator === "undefined" || navigator.onLine !== false) return;
		if (typeof window === "undefined") return;
		await new Promise<void>((resolve, reject) => {
			const online = () => finish(resolve);
			const abort = () => finish(() => reject(signal.reason));
			const finish = (complete: () => void) => {
				window.removeEventListener("online", online);
				signal.removeEventListener("abort", abort);
				complete();
			};
			window.addEventListener("online", online, { once: true });
			signal.addEventListener("abort", abort, { once: true });
		});
	}

	private startSnapshotRetry(signal: AbortSignal): void {
		if (this.snapshotRetry) return;
		this.snapshotRetry = (async () => {
			let delay = ParticipantConnection.INITIAL_RETRY_DELAY_MS;
			while (!signal.aborted && this.isSignalingConnected()) {
				try {
					await this.waitUntilOnline(signal);
					await this.delay(delay, signal);
					await this.serializeLifecycle(async () => {
						this.throwIfAborted(signal);
						await this.setupExistingParticipants(signal, true);
						this.throwIfAborted(signal);
						this.setState("ready");
					});
					return;
				} catch (error) {
					if (signal.aborted || !this.isSignalingConnected()) return;
					this.initialSyncInProgress = true;
					console.warn("Participant snapshot retry failed:", error);
					delay = Math.min(delay * 2, ParticipantConnection.MAX_RETRY_DELAY_MS);
				}
			}
		})().finally(() => {
			this.snapshotRetry = null;
		});
	}

	private isSignalingConnected(): boolean {
		return this.sfuClient.isConnected?.() ?? this.isConnected;
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

		const generation = this.lifecycleGeneration;
		try {
			await this.sfuClient.connect(
				this.meetingId ?? "",
				authToken,
				prefetchedDetails,
			);
			if (generation !== this.lifecycleGeneration) {
				await this.sfuClient.disconnect();
				return false;
			}
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
		const generation = this.lifecycleGeneration;
		try {
			await this.sfuClient.joinRoom(this.meetingId ?? "", userData, mediaState);
			if (generation !== this.lifecycleGeneration) {
				await this.sfuClient.disconnect();
				return false;
			}
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
		const generation = this.lifecycleGeneration;
		try {
			await this.transportManager.initializeDevice();
			if (generation !== this.lifecycleGeneration) {
				this.transportManager.cleanup?.();
				return false;
			}
			return true;
		} catch (error) {
			console.error("Failed to initialize MediaSoup device:", error);
			throw error;
		}
	}

	async createReceiveTransport(): Promise<boolean> {
		const generation = this.lifecycleGeneration;
		try {
			if (!(await this.waitForE2EEContextIfRequired())) {
				return false;
			}
			await this.transportManager.createReceiveTransport();
			if (generation !== this.lifecycleGeneration) {
				this.transportManager.closeReceiveTransport();
				return false;
			}
			return true;
		} catch (error) {
			console.warn("Failed to create receive transport:", error);
			return false;
		}
	}

	async setupExistingParticipants(
		signal?: AbortSignal,
		keepBufferingOnFailure = false,
	): Promise<void> {
		const generation = this.lifecycleGeneration;
		try {
			this.initialSyncInProgress = true;

			const participantSnapshot = this.sfuClient.getRoomParticipants();
			const participants = signal
				? await this.awaitAbortable(participantSnapshot, signal)
				: await participantSnapshot;
			const currentUserId = this.getCurrentUserId();

			const normalized: ReconciledParticipant[] = participants
				.map((participant) => ({
					...participant,
					participantId: participant.participantId || participant.user_id || "",
					audio_enabled: participant.userData?.audio_enabled ?? false,
					video_enabled: participant.userData?.video_enabled ?? false,
					is_guest: participant.userData?.is_guest ?? false,
				}))
				.filter((p) => p.participantId && p.user_id !== currentUserId);
			const producerSnapshot = this.sfuClient.getExistingProducers();
			const existingProducers = signal
				? await this.awaitAbortable(producerSnapshot, signal)
				: await producerSnapshot;
			if (generation !== this.lifecycleGeneration) {
				throw new DOMException("Participant sync cancelled", "AbortError");
			}
			this.reconciliation = reconcileMeetingSnapshot(
				this.reconciliation,
				{
					participants: normalized,
					producers: existingProducers.map((producer) => ({
						producerId: producer.id,
						participantId: producer.participantId,
						isScreen: producer.isScreen === true,
					})),
				},
				this.bufferedReconciliationEvents.splice(0),
			);
			this.participantManager.syncParticipants([
				...this.reconciliation.participants.values(),
			]);

			this.initialSyncInProgress = false;
			await this.flushBufferedProducers();
		} catch (error) {
			console.error("Error in setupExistingParticipants:", error);
			if (!keepBufferingOnFailure) this.initialSyncInProgress = false;
			throw error;
		}
	}

	async requestExistingProducers(): Promise<SFUExistingProducer[] | null> {
		const generation = this.lifecycleGeneration;
		try {
			this.initialSyncInProgress = true;
			const existingProducers = await this.sfuClient.getExistingProducers();
			if (generation !== this.lifecycleGeneration) return null;
			const previous = this.reconciliation;
			const bufferedEvents = this.bufferedReconciliationEvents.splice(0);
			this.reconciliation = reconcileMeetingSnapshot(
				this.reconciliation,
				{
					producers: existingProducers.map((producer) => ({
						producerId: producer.id,
						participantId: producer.participantId,
						isScreen: producer.isScreen === true,
					})),
				},
				[],
			);
			for (const event of bufferedEvents) this.applyReconciliationEvent(event);
			for (const producer of previous.producers.values()) {
				if (!this.reconciliation.producers.has(producer.producerId)) {
					this.removeProducerConsumers(producer);
				}
			}
			this.initialSyncInProgress = false;

			if (existingProducers.length) {
				console.log(
					`Found ${existingProducers.length} existing producers:`,
					existingProducers,
				);
				await this.flushBufferedProducers();
			} else {
				console.log("No existing producers found");
			}

			return existingProducers;
		} catch (error) {
			this.initialSyncInProgress = false;
			console.warn("Failed to request existing producers:", error);
			return null;
		}
	}

	async flushBufferedProducers(): Promise<void> {
		if (!this.reconciliation.producers.size) {
			console.log("No buffered producer events to flush");
			return;
		}

		console.log(
			`Flushing ${this.reconciliation.producers.size} buffered producer events`,
		);
		for (const event of this.reconciliation.producers.values()) {
			try {
				await this.subscribeToReconciledProducer(event);
			} catch (error) {
				console.warn("Failed to process buffered producer:", error);
			}
		}
	}

	async resetReceiveSide(): Promise<void> {
		if (this.activeReceiveReset) return this.activeReceiveReset;

		const generation = this.lifecycleGeneration;
		this.activeReceiveReset = this.serializeLifecycle(() =>
			this.performReceiveReset(generation),
		).finally(() => {
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
		if (
			!(await this.waitForE2EEContextIfRequired(
				this.lifecycleAbortController.signal,
			))
		) {
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
		if (result === "skipped") await this.resetReceiveSide();
	}

	serializeTransportRecovery(
		operation: () => Promise<RecoveryResult>,
	): Promise<RecoveryResult> {
		return this.serializeLifecycle(async () => {
			this.setState("recovering");
			const result = await operation();
			if (!this.lifecycleAbortController.signal.aborted) {
				this.setState(result === "failed" ? "degraded" : "ready");
			}
			return result;
		});
	}

	async recoverFailedTransports(
		reason: string,
		result: TransportIceRestartResult,
	): Promise<void> {
		const recoveries: Promise<unknown>[] = [];
		if (result.send === "failed") {
			this.reportRecoveryState("recovering_send", reason);
			recoveries.push(this.mediaManager.rebuildSendSide());
		}
		if (result.recv === "failed") {
			this.reportRecoveryState("recovering_receive", reason);
			recoveries.push(this.performReceiveReset(this.lifecycleGeneration));
		}
		const failed = (await Promise.allSettled(recoveries)).find(
			(recovery) => recovery.status === "rejected",
		);
		if (failed?.status === "rejected") {
			throw failed.reason;
		}
	}

	reportRecoveryState(
		state: Parameters<
			NonNullable<SFUEventHandlers["onRecoveryStateChange"]>
		>[0],
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

		const rejoin = this.serializeLifecycle(async () => {
			const signal = this.lifecycleAbortController.signal;
			let retryDelay = ParticipantConnection.INITIAL_RETRY_DELAY_MS;
			while (!signal.aborted) {
				this.setState("recovering");
				this.reportRecoveryState("rejoining", "signaling reconnected");
				try {
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
					if (!(await this.waitForE2EEContextIfRequired(signal))) {
						throw new Error(
							"E2EE context is not ready after signaling reconnect",
						);
					}
					if (generation !== this.lifecycleGeneration) return;

					await this.transportManager.initializeDevice();
					if (generation !== this.lifecycleGeneration) return;
					if (!(await this.createReceiveTransport())) {
						throw new Error(
							"Failed to recreate receive transport after reconnect",
						);
					}
					if (generation !== this.lifecycleGeneration) return;
					await this.mediaManager.rebuildSendSide();
					if (generation !== this.lifecycleGeneration) return;
					await this.setupExistingParticipants(signal, true);
					if (generation !== this.lifecycleGeneration) return;
					this.recoveryManager.setupTransportEventHandlers();
					this.reportRecoveryState("healthy", "session rebuilt");
					this.setState("ready");
					return;
				} catch (error) {
					if (signal.aborted || generation !== this.lifecycleGeneration) return;
					this.reportRecoveryState("failed", "session rebuild failed");
					this.setState("degraded");
					console.warn("Session rebuild failed; retrying:", error);
					await this.waitUntilOnline(signal);
					await this.delay(retryDelay, signal);
					retryDelay = Math.min(
						retryDelay * 2,
						ParticipantConnection.MAX_RETRY_DELAY_MS,
					);
				}
			}
		}).finally(() => {
			this.activeRejoin = null;
		});
		this.activeRejoin = rejoin;

		return rejoin;
	}

	private hasConsumerForProducer(
		participantId: string,
		producerId: string,
	): boolean {
		const existingConsumers =
			this.mediaManager.consumerManager.getConsumersByParticipant(
				participantId,
			);
		return existingConsumers.some(
			(c) =>
				!c.consumer.closed &&
				(c.producerId === producerId || c.consumer.producerId === producerId),
		);
	}

	private async subscribeToReconciledProducer(
		event: SFUProducerEvent,
	): Promise<void> {
		if (
			this.reconciliation.producers.get(event.producerId) !== event ||
			this.producerClaims.has(event.producerId) ||
			this.hasConsumerForProducer(event.participantId, event.producerId) ||
			!this.transportManager?.isDeviceLoaded?.()
		)
			return;

		this.producerClaims.add(event.producerId);
		try {
			if (!(await this.waitForE2EEContextIfRequired())) return;
			if (this.reconciliation.producers.get(event.producerId) !== event) return;
			await this.mediaManager.subscribeToRemoteProducer(event);
			if (this.reconciliation.producers.get(event.producerId) !== event) {
				this.removeProducerConsumers(event);
			}
		} finally {
			this.producerClaims.delete(event.producerId);
		}
	}

	private removeProducerConsumers(event: SFUProducerEvent): void {
		const consumers =
			this.mediaManager.consumerManager.getConsumersByParticipant(
				event.participantId,
			);
		for (const consumer of consumers) {
			const producerMatches =
				consumer.consumer.producerId === event.producerId ||
				consumer.appData?.producerId === event.producerId;
			const isScreen =
				consumer.isScreen ||
				consumer.appData?.type === "screen" ||
				consumer.consumer.appData?.type === "screen";
			if (producerMatches || (event.isScreen && isScreen)) {
				this.mediaManager.consumerManager.removeConsumer(consumer.id);
				this.mediaManager.processedConsumers.delete(consumer.id);
			}
		}
	}

	private applyReconciliationEvent(event: ReconciliationEvent): void {
		const previous = this.reconciliation;
		this.reconciliation = applyMeetingReconciliationEvent(previous, event);
		if (event.type === "participant-joined") {
			if (!previous.participants.has(event.value.participantId)) {
				this.participantManager.addParticipant(event.value);
			}
		} else if (event.type === "participant-left") {
			if (!previous.departedParticipantIds.has(event.value.participantId)) {
				this.participantManager.removeParticipant(event.value.participantId);
			}
		} else if (
			event.type === "producer-closed" &&
			!previous.closedProducerIds.has(event.value.producerId)
		) {
			this.removeProducerConsumers(event.value);
		}
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

	private async waitForE2EEContextIfRequired(
		signal?: AbortSignal,
	): Promise<boolean> {
		if (!this.sfuClient.isE2EERequired?.()) {
			return true;
		}
		if (this.e2eeReadyForLifecycle) return true;
		try {
			const readiness = waitForE2EEContextReady();
			await (signal ? this.awaitAbortable(readiness, signal) : readiness);
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
			if (!data?.participantId) return;
			const currentUserId = this.getCurrentUserId();
			const joinedUserId = data.participantId || data.user_id || "";

			if (joinedUserId && joinedUserId !== currentUserId) {
				const event: ReconciliationEvent = {
					type: "participant-joined",
					value: { ...data, participantId: data.participantId },
				};
				if (this.initialSyncInProgress) {
					this.bufferedReconciliationEvents.push(event);
					return;
				}
				const previous = this.reconciliation;
				this.reconciliation = applyMeetingReconciliationEvent(previous, event);
				if (!previous.participants.has(data.participantId)) {
					this.participantManager.addParticipant(data);
				}
			}
		});

		this.sfuClient.on("participant_left", (value: unknown) => {
			const participant = normalizeParticipantData(value);
			if (participant?.participantId) {
				const event: ReconciliationEvent = {
					type: "participant-left",
					value: { participantId: participant.participantId },
				};
				if (this.initialSyncInProgress) {
					this.bufferedReconciliationEvents.push(event);
					return;
				}
				const previous = this.reconciliation;
				this.reconciliation = applyMeetingReconciliationEvent(previous, event);
				if (!previous.departedParticipantIds.has(participant.participantId)) {
					this.participantManager.removeParticipant(participant.participantId);
				}
			}
		});

		this.sfuClient.on("producer_created", async (value: unknown) => {
			const d = normalizeProducerEvent(value);
			if (!d) return;
			if (d.participantId === this.getCurrentUserId()) return;
			const event: ReconciliationEvent = {
				type: "producer-created",
				value: { ...d, isScreen: d.isScreen === true },
			};
			if (this.initialSyncInProgress) {
				this.bufferedReconciliationEvents.push(event);
				return;
			}
			const previous = this.reconciliation;
			this.reconciliation = applyMeetingReconciliationEvent(previous, event);
			if (
				previous.producers.has(d.producerId) ||
				!this.reconciliation.producers.has(d.producerId)
			)
				return;
			await this.subscribeToReconciledProducer(event.value).catch((error) => {
				console.warn("Failed to subscribe to producer_created event:", error);
			});
		});

		this.sfuClient.on("producer_closed", (value: unknown) => {
			const d = normalizeProducerClosedEvent(value);
			if (!d?.participantId || !d.producerId) return;
			const event: ReconciliationEvent = {
				type: "producer-closed",
				value: {
					participantId: d.participantId,
					producerId: d.producerId,
					isScreen: d.isScreen === true,
				},
			};
			if (this.initialSyncInProgress) {
				this.bufferedReconciliationEvents.push(event);
				return;
			}
			const previous = this.reconciliation;
			this.reconciliation = applyMeetingReconciliationEvent(previous, event);
			if (previous.closedProducerIds.has(d.producerId)) return;
			this.removeProducerConsumers(event.value);

			if (d.isScreen) {
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
			)
				return;
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
			)
				return;
			const d = { participantIds: value.participantIds };
			if (this.eventHandlers.onActiveSpeakerChanged) {
				this.eventHandlers.onActiveSpeakerChanged(d.participantIds);
			}
		});
	}

	private ensureRef(obj: User | { value: User | null } | null): {
		value: User | null;
	} {
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
		this.setState("stopping");
		this.initialSyncInProgress = false;
		this.lifecycleAbortController.abort(
			new DOMException("Participant connection stopped", "AbortError"),
		);
		this.e2eeReadyForLifecycle = false;
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
		} finally {
			this.isConnected = false;
			this.setState("stopped");
		}
	}

	reset(): void {
		this.lifecycleAbortController.abort();
		this.lifecycleGeneration++;
		this.meetingId = null;
		this.currentUser = { value: null };
		this.eventHandlers = {};
		this.isConnected = false;
		this.initialSyncInProgress = false;
		this.bufferedReconciliationEvents = [];
		this.reconciliation = createMeetingReconciliationState();
		this.producerClaims.clear();
		this.lastJoinUserData = null;
		this.lastJoinMediaState = {
			audio_enabled: false,
			video_enabled: false,
		};
		this.activeRejoin = null;
		this.activeReceiveReset = null;
		this.snapshotRetry = null;
		this.e2eeReadyForLifecycle = false;
		this.setState("stopped");
	}

	clearBufferedReconciliationEvents(): void {
		this.bufferedReconciliationEvents = [];
	}
}
