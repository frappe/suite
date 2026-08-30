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
import { ExpectedMediaReconciler } from "./ExpectedMediaReconciler";
import {
	ParticipantConnectionRecovery,
	type ParticipantRecoveryTransition,
	type ParticipantRecoveryTrigger,
} from "./ParticipantConnectionRecovery";
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
	kind?: "audio" | "video";
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
		kind:
			value.kind === "audio" || value.kind === "video" ? value.kind : undefined,
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
	const shareData = isUnknownRecord(value.shareData) ? value.shareData : null;
	return {
		participantId:
			typeof value.participantId === "string" ? value.participantId : undefined,
		consumerId:
			typeof value.consumerId === "string" ? value.consumerId : undefined,
		producerId:
			typeof value.producerId === "string"
				? value.producerId
				: typeof shareData?.producerId === "string"
					? shareData.producerId
					: undefined,
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
	onHostKickedYou?: (data: { hostId?: string; banned?: boolean }) => void;
	onParticipantConnectionReplaced?: (data: { reason: "takeover" }) => void | Promise<void>;
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
	onRecoveryExhausted?: (trigger?: ParticipantRecoveryTrigger) => void;
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
	conflictId?: string;
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
	producerId?: string;
	stream?: MediaStream;
	consumer?: { id: string; producerId?: string };
}

interface ParticipantConnectionOptions {
	sfuClient: SFUClient;
	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	transportManager: TransportManager;
	mediaManager: SFUMediaManager;
	recoveryManager: SFURecoveryManager;
	expectedMedia?: ExpectedMediaReconciler;
}

export class ParticipantConnection {
	sfuClient: SFUClient;
	videoManager: VideoElementManager;
	participantManager: ParticipantManager;
	transportManager: TransportManager;
	mediaManager: SFUMediaManager;
	recoveryManager: SFURecoveryManager;
	readonly expectedMedia: ExpectedMediaReconciler;
	readonly participantRecovery: ParticipantConnectionRecovery;

	meetingId: string | null = null;
	currentUser: { value: User | null } = { value: null };
	isConnected = false;
	initialSyncInProgress = false;
	private bufferedReconciliationEvents: ReconciliationEvent[] = [];
	private bufferedMediaStateUpdates = new Map<
		string,
		{ audioEnabled?: boolean; videoEnabled?: boolean }
	>();
	private reconciliation: MeetingReconciliationState<ReconciledParticipant> =
		createMeetingReconciliationState();
	private producerClaims = new Set<string>();
	eventHandlers: SFUEventHandlers = {};
	private lastJoinUserData: JoinUserData | null = null;
	private lastJoinMediaState: JoinRoomMediaState = {
		audio_enabled: false,
		video_enabled: false,
	};
	private activeReceiveReset: Promise<void> | null = null;
	private lifecycleGeneration = 0;
	private lifecycleTail: Promise<void> = Promise.resolve();
	private lifecycleAbortController = new AbortController();
	private snapshotRetry: Promise<void> | null = null;
	private e2eeReadyForLifecycle = false;
	private lastAuthToken: string | null = null;
	private activeEscalation: Promise<boolean> | null = null;
	private readonly connectionId = crypto.randomUUID();
	private localProducerBytes = new Map<string, number>();
	private _state: ParticipantConnectionState = "stopped";
	private static readonly INITIAL_RETRY_DELAY_MS = 1000;
	private static readonly MAX_RETRY_DELAY_MS = 30000;
	private static readonly MAX_SNAPSHOT_RETRY_ATTEMPTS = 3;

	constructor(options: ParticipantConnectionOptions) {
		this.sfuClient = options.sfuClient;
		this.videoManager = options.videoManager;
		this.participantManager = options.participantManager;
		this.transportManager = options.transportManager;
		this.mediaManager = options.mediaManager;
		this.recoveryManager = options.recoveryManager;
		this.expectedMedia = options.expectedMedia ?? new ExpectedMediaReconciler();
		this.participantRecovery = new ParticipantConnectionRecovery({
			rebuild: (trigger, attempt, signal) =>
				this.serializeLifecycle(() =>
					this.performFreshParticipantConnectionRebuild(
						trigger,
						attempt,
						signal,
					),
				),
			verify: (_trigger, signal) => this.verifyFreshParticipantConnection(signal),
			onTransition: (transition) => this.handleRecoveryTransition(transition),
		});
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
				await this.joinRoom(userData, mediaState, options.conflictId);
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
				} else if (publication.status === "fulfilled") {
					this.setState("ready");
				}
				if (publication.status === "rejected") {
					this.setState("degraded");
					queueMicrotask(() => {
						void this.escalateRecovery({
							scope: "publication",
							direction: "send",
							reason: "retry_limit",
						}).catch((error) =>
							console.warn("Publication recovery escalation failed:", error),
						);
					});
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

	private async waitUntilVisible(signal: AbortSignal): Promise<void> {
		if (typeof document === "undefined" || !document.hidden) return;
		this.throwIfAborted(signal);
		await new Promise<void>((resolve, reject) => {
			const visibilityChange = () => {
				if (!document.hidden) finish(resolve);
			};
			const abort = () => finish(() => reject(signal.reason));
			const finish = (complete: () => void) => {
				document.removeEventListener("visibilitychange", visibilityChange);
				signal.removeEventListener("abort", abort);
				complete();
			};
			document.addEventListener("visibilitychange", visibilityChange);
			signal.addEventListener("abort", abort, { once: true });
		});
	}

	private startSnapshotRetry(signal: AbortSignal): void {
		if (this.snapshotRetry) return;
		this.snapshotRetry = (async () => {
			let delay = ParticipantConnection.INITIAL_RETRY_DELAY_MS;
			let attempts = 0;
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
					attempts += 1;
					if (
						attempts >= ParticipantConnection.MAX_SNAPSHOT_RETRY_ATTEMPTS
					) {
						void this.escalateRecovery({
							scope: "subscription",
							direction: "recv",
							reason: "snapshot_retry_limit",
						}).catch((recoveryError) =>
							console.warn("Snapshot recovery escalation failed:", recoveryError),
						);
						return;
					}
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
		this.lastAuthToken = authToken;
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
		conflictId?: string,
	): Promise<boolean> {
		const generation = this.lifecycleGeneration;
		try {
			await this.sfuClient.joinRoom(this.meetingId ?? "", userData, mediaState, {
				connectionId: this.connectionId,
				...(conflictId ? { conflictId } : {}),
			});
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
		signal: AbortSignal = this.lifecycleAbortController.signal,
		keepBufferingOnFailure = false,
	): Promise<void> {
		const generation = this.lifecycleGeneration;
		try {
			this.initialSyncInProgress = true;

			const participantSnapshot = this.sfuClient.getRoomParticipants();
			const participants = await this.awaitAbortable(participantSnapshot, signal);
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
			const existingProducers = await this.awaitAbortable(
				producerSnapshot,
				signal,
			);
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
						kind:
							producer.kind === "audio" || producer.kind === "video"
								? producer.kind
								: undefined,
					})),
				},
				this.bufferedReconciliationEvents.splice(0),
			);
			this.participantManager.syncParticipants([
				...this.reconciliation.participants.values(),
			]);

			this.initialSyncInProgress = false;
			this.flushBufferedMediaStateUpdates();
			await this.flushBufferedProducers(signal);
		} catch (error) {
			if (!signal.aborted) {
				console.error("Error in setupExistingParticipants:", error);
			}
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
			this.flushBufferedMediaStateUpdates();

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
			throw error;
		}
	}

	async flushBufferedProducers(
		signal: AbortSignal = this.lifecycleAbortController.signal,
	): Promise<void> {
		this.throwIfAborted(signal);
		if (!this.reconciliation.producers.size) {
			console.log("No buffered producer events to flush");
			return;
		}

		console.log(
			`Flushing ${this.reconciliation.producers.size} buffered producer events`,
		);
		for (const event of this.reconciliation.producers.values()) {
			this.throwIfAborted(signal);
			try {
				await this.subscribeToReconciledProducer(event, signal);
			} catch (error) {
				if (signal.aborted) throw error;
				console.warn("Failed to process buffered producer:", error);
			}
		}
	}

	private flushBufferedMediaStateUpdates(): void {
		for (const [participantId, updates] of this.bufferedMediaStateUpdates) {
			if (this.participantManager.updateMediaState(participantId, updates)) {
				this.bufferedMediaStateUpdates.delete(participantId);
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
		this.clearReceiveConsumers();
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
		const generation = this.lifecycleGeneration;
		return this.serializeLifecycle(async () => {
			this.setState("recovering");
			const result = await operation();
			if (
				generation === this.lifecycleGeneration &&
				!this.lifecycleAbortController.signal.aborted
			) {
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

	escalateRecovery(trigger: ParticipantRecoveryTrigger): Promise<boolean> {
		if (this.activeEscalation) return this.activeEscalation;
		if (!this.meetingId || !this.lastJoinUserData) {
			return Promise.reject(new Error("Cannot recover before joining a meeting"));
		}
		this.lifecycleAbortController.abort(
			new DOMException("Participant Connection generation replaced", "AbortError"),
		);
		this.lifecycleAbortController = new AbortController();
		this.lifecycleGeneration += 1;
		this.expectedMedia.reset();
		this.localProducerBytes.clear();
		const recovery = this.participantRecovery
			.recover(trigger, this.lifecycleAbortController.signal)
			.then(async (healthy) => {
				if (!healthy) await this.cleanupFailedParticipantConnection();
				return healthy;
			})
			.finally(() => {
				if (this.activeEscalation === recovery) this.activeEscalation = null;
			});
		this.activeEscalation = recovery;
		return recovery;
	}

	async rejoinAfterSignalingReconnect(): Promise<void> {
		await this.escalateRecovery({
			scope: "signaling",
			direction: "both",
			reason: "signaling_reconnected",
		});
	}

	private async performFreshParticipantConnectionRebuild(
		_trigger: ParticipantRecoveryTrigger,
		_attempt: number,
		signal: AbortSignal,
	): Promise<void> {
		if (!this.meetingId || !this.lastJoinUserData) {
			throw new Error("Cannot rebuild before joining a meeting");
		}
		this.recoveryManager.reset();
		this.expectedMedia.reset();
		this.localProducerBytes.clear();
		const pendingSubscriptions = this.mediaManager.cancelPendingSubscriptions();
		this.transportManager.closeReceiveTransport();
		this.clearReceiveConsumers();
		await pendingSubscriptions;
		this.throwIfAborted(signal);
		await this.sfuClient.disconnect();
		this.isConnected = false;
		await this.waitUntilOnline(signal);
		this.throwIfAborted(signal);
		const generation = this.lifecycleGeneration;
		await this.sfuClient.connect(this.meetingId, this.lastAuthToken, null);
		if (signal.aborted || generation !== this.lifecycleGeneration) {
			await this.sfuClient.disconnect();
			this.throwIfAborted(signal);
			throw new DOMException("Participant connection rebuild replaced", "AbortError");
		}
		this.isConnected = true;
		this.transportManager.initialize(this.sfuClient);
		this.throwIfAborted(signal);
		await this.sfuClient.joinRoom(
			this.meetingId,
			this.lastJoinUserData,
			this.getCurrentRejoinMediaState(),
		);
		this.throwIfAborted(signal);
		if (!(await this.waitForE2EEContextIfRequired(signal))) {
			throw new Error("E2EE context is not ready after fresh reconnect");
		}
		await this.transportManager.initializeDevice();
		this.throwIfAborted(signal);
		if (!(await this.createReceiveTransport())) {
			throw new Error("Failed to recreate receive transport");
		}
		const publication = await this.mediaManager.rebuildSendSide();
		if (publication.audioError || publication.videoError) {
			throw publication.audioError ?? publication.videoError;
		}
		this.throwIfAborted(signal);
		await this.setupExistingParticipants(signal, true);
		this.recoveryManager.setupTransportEventHandlers();
	}

	private async verifyFreshParticipantConnection(signal: AbortSignal): Promise<void> {
		await this.waitUntilVisible(signal);
		await this.reconcileExpectedMedia();
		this.throwIfAborted(signal);
		for (const producer of this.reconciliation.producers.values()) {
			if (
				(producer.kind === "audio" || producer.kind === "video") &&
				this.isRemoteProducerDesired(producer) &&
				!this.hasConsumerForProducer(producer.participantId, producer.producerId)
			) {
				throw new Error(`Expected subscription missing for ${producer.producerId}`);
			}
		}
		await this.expectedMedia.waitForHealthy(signal);
	}

	private handleRecoveryTransition(
		transition: ParticipantRecoveryTransition,
	): void {
		const detail = `${transition.trigger.scope}:${transition.trigger.reason} attempt ${transition.attempt}/${transition.maxAttempts}`;
		if (transition.phase === "rebuilding_participant_connection") {
			this.setState("recovering");
			this.reportRecoveryState("rejoining", detail);
		} else if (transition.phase === "healthy") {
			this.reportRecoveryState("healthy", detail);
			this.setState("ready");
		} else if (transition.phase === "terminal_failed") {
			this.reportRecoveryState("failed", detail);
			this.setState("failed");
			this.eventHandlers.onRecoveryExhausted?.(transition.trigger);
		}
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

	async reconcileExpectedMedia(): Promise<void> {
		await this.reconcileExpectedLocalMedia();
		for (const producer of this.reconciliation.producers.values()) {
			const consumer = this.mediaManager.consumerManager
				.getConsumersByParticipant(producer.participantId)
				.find(
					(entry) =>
						!entry.consumer.closed &&
						(entry.producerId === producer.producerId ||
							entry.consumer.producerId === producer.producerId),
				);
			const media = consumer?.kind ?? producer.kind ?? (producer.isScreen ? "video" : null);
			if (media !== "audio" && media !== "video") continue;
			const desired = this.isRemoteProducerDesired(producer);
			const key = `remote:${producer.producerId}`;
			const existing = this.expectedMedia.get(key);
			if (
				!existing ||
				existing.desired !== desired ||
				existing.subscribed !== Boolean(consumer)
			) {
				this.expectedMedia.observe({
					key,
					direction: "remote",
					media,
					source: "remote",
					desired,
					subscribed: Boolean(consumer),
				});
			}
			if (desired && !consumer) {
				void this.expectedMedia
					.repair(key, "subscription", "subscribe", () =>
						this.subscribeToReconciledProducer(producer),
					)
					.catch((error) =>
						console.warn("Expected media subscription repair failed:", error),
					);
			}
		}
	}

	private async reconcileExpectedLocalMedia(): Promise<void> {
		const stream = this.mediaManager.mediaHandler.localStream;
		const local = [
			{
				key: "local:microphone",
				media: "audio" as const,
				source: "microphone" as const,
				track: stream?.getAudioTracks().find((track) => track.readyState === "live"),
				producer: this.mediaManager.mediaHandler.audioProducer,
			},
			{
				key: "local:camera",
				media: "video" as const,
				source: "camera" as const,
				track: stream?.getVideoTracks().find((track) => track.readyState === "live"),
				producer: this.mediaManager.mediaHandler.videoProducer,
			},
			{
				key: "local:screen",
				media: "video" as const,
				source: "screen" as const,
				track: this.mediaManager.mediaHandler.screenProducer?.track,
				producer: this.mediaManager.mediaHandler.screenProducer,
			},
		];

		for (const item of local) {
			let flowing = false;
			if (item.producer && !item.producer.closed) {
				try {
					const stats = await item.producer.getStats();
					let bytesSent: number | null = null;
					for (const report of stats.values()) {
						if (
							report.type === "outbound-rtp" &&
							typeof report.bytesSent === "number" &&
							report.bytesSent >= 0
						) {
							bytesSent = report.bytesSent;
							break;
						}
					}
					if (bytesSent !== null) {
						flowing =
							bytesSent > (this.localProducerBytes.get(item.producer.id) ?? 0);
						this.localProducerBytes.set(item.producer.id, bytesSent);
					}
				} catch {
					// A later safety-net pass will retry the observation.
				}
			}
			const desired = Boolean(
				item.track?.readyState === "live" &&
					item.track.enabled !== false &&
					!item.producer?.paused,
			);
			this.expectedMedia.observe({
				key: item.key,
				direction: "local",
				media: item.media,
				source: item.source,
				desired,
				captured: desired,
				published: Boolean(item.producer && !item.producer.closed),
				flowing,
			});
			if (
				desired &&
				(!item.producer || item.producer.closed) &&
				item.source !== "screen" &&
				stream
			) {
				void this.expectedMedia
					.repair(item.key, "publication", "recreate_producer", () =>
						this.mediaManager.repairLocalPublication(item.media, stream),
					)
					.catch((error) =>
						console.warn("Expected local publication repair failed:", error),
					);
			}
		}
	}

	observeRemoteMediaProgress(
		producerId: string,
		media: "audio" | "video",
		flowing: boolean,
		decoding: boolean,
	): void {
		const producer = this.reconciliation.producers.get(producerId);
		if (!producer) return;
		this.expectedMedia.observe({
			key: `remote:${producerId}`,
			direction: "remote",
			media,
			source: "remote",
			desired: this.isRemoteProducerDesired(producer),
			subscribed: this.hasConsumerForProducer(producer.participantId, producerId),
			flowing,
			decoding,
		});
	}

	private isRemoteProducerDesired(producer: SFUProducerEvent): boolean {
		const consumer = this.mediaManager.consumerManager
			.getConsumersByParticipant(producer.participantId)
			.find(
				(entry) =>
					!entry.consumer.closed &&
					(entry.producerId === producer.producerId ||
						entry.consumer.producerId === producer.producerId),
			);
		if (
			consumer?.consumer.paused ||
			consumer?.consumer.producerPaused ||
			consumer?.adaptivelyPaused
		) {
			return false;
		}
		if (producer.isScreen) return true;
		const participant = this.participantManager.getParticipant(
			producer.participantId,
		);
		return producer.kind === "audio"
			? participant?.audio_enabled !== false
			: participant?.video_enabled !== false;
	}

	private async subscribeToReconciledProducer(
		event: SFUProducerEvent,
		signal: AbortSignal = this.lifecycleAbortController.signal,
	): Promise<void> {
		this.throwIfAborted(signal);
		if (
			this.reconciliation.producers.get(event.producerId) !== event ||
			this.producerClaims.has(event.producerId) ||
			this.hasConsumerForProducer(event.participantId, event.producerId) ||
			!this.transportManager?.isDeviceLoaded?.()
		)
			return;

		this.producerClaims.add(event.producerId);
		try {
			if (!(await this.waitForE2EEContextIfRequired(signal))) return;
			this.throwIfAborted(signal);
			if (this.reconciliation.producers.get(event.producerId) !== event) return;
			await this.awaitAbortable(
				this.mediaManager.subscribeToRemoteProducer({
					producerId: event.producerId,
					participantId: event.participantId,
					isScreen: event.isScreen,
				}),
				signal,
			);
			this.throwIfAborted(signal);
			if (this.reconciliation.producers.get(event.producerId) !== event) {
				this.removeProducerConsumers(event);
			}
		} finally {
			this.producerClaims.delete(event.producerId);
		}
	}

	private removeProducerConsumers(event: SFUProducerEvent): void {
		const existing = this.expectedMedia.get(`remote:${event.producerId}`);
		if (existing) this.expectedMedia.observe({ ...existing, desired: false });
		this.mediaManager.cancelProducerSubscription?.(
			event.participantId,
			event.producerId,
		);
		const consumers =
			this.mediaManager.consumerManager.getConsumersByParticipant(
				event.participantId,
			);
		for (const consumer of consumers) {
			if (consumer.producerId === event.producerId) {
				this.mediaManager.consumerManager.removeConsumer(consumer.id);
				this.mediaManager.processedConsumers.delete(consumer.id);
			}
		}
		void this.mediaManager
			.reattachAfterProducerClosed(event.participantId, event.producerId)
			.catch((error) =>
				console.warn("Failed to attach surviving endpoint media:", error),
			);
	}

	clearReceiveConsumers(): void {
		for (const screen of [
			...this.mediaManager.consumerManager.getScreenShareConsumers(),
		]) {
			this.mediaManager.consumerManager.removeConsumer(screen.id);
		}
		this.mediaManager.consumerManager.clear();
		this.mediaManager.processedConsumers.clear();
		this.mediaManager.isScreenShareActive = false;
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
				.some((track) => track.readyState === "live" && track.enabled !== false),
			video_enabled: localStream
				.getVideoTracks()
				.some((track) => track.readyState === "live" && track.enabled !== false),
		};
	}

	private async cleanupFailedParticipantConnection(): Promise<void> {
		this.lifecycleAbortController.abort(
			new DOMException("Participant connection recovery exhausted", "AbortError"),
		);
		this.lifecycleGeneration += 1;
		this.expectedMedia.reset();
		this.localProducerBytes.clear();
		this.recoveryManager.reset();
		try {
			await this.mediaManager.cleanup();
		} catch (error) {
			console.error("Error cleaning up failed participant media:", error);
		}
		try {
			this.transportManager.cleanup?.();
		} catch (error) {
			console.error("Error cleaning up failed participant transports:", error);
		}
		try {
			await this.sfuClient.disconnect();
		} catch (error) {
			console.error("Error disconnecting failed participant connection:", error);
		} finally {
			this.isConnected = false;
		}
	}

	private async waitForE2EEContextIfRequired(
		signal: AbortSignal = this.lifecycleAbortController.signal,
	): Promise<boolean> {
		if (!this.sfuClient.isE2EERequired?.()) {
			return true;
		}
		if (this.e2eeReadyForLifecycle) return true;
		try {
			const readiness = waitForE2EEContextReady();
			await this.awaitAbortable(readiness, signal);
			return true;
		} catch (error) {
			if (signal.aborted) throw error;
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
					this.mediaManager.isScreenShareActive =
						this.mediaManager.consumerManager.getScreenShareConsumers().length > 0;
					if (this.eventHandlers.onScreenShareStopped) {
						this.eventHandlers.onScreenShareStopped({
							participantId: consumer.participantId,
							consumerId,
							producerId: consumer.producerId,
							consumer,
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
				void this.escalateRecovery({
					scope: "subscription",
					direction: "recv",
					reason: "retry_limit",
				}).catch((error) =>
					console.warn("Subscription recovery escalation failed:", error),
				);
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
		this.sfuClient.on("participant_connection_replaced", (value: unknown) => {
			if (!isUnknownRecord(value) || value.reason !== "takeover") return;
			void Promise.resolve(
				this.eventHandlers.onParticipantConnectionReplaced?.({ reason: "takeover" }),
			)
				.catch((error) =>
					console.warn("Participant Connection replacement cleanup failed:", error),
				)
				.finally(() => void this.disconnect());
		});

		this.sfuClient.on("reconnect_attempt", () => {
			this.recoveryManager.reset();
			this.reportRecoveryState("reconnecting", "signaling reconnect attempt");
		});

		this.sfuClient.on("reconnect_failed", () => {
			void this.escalateRecovery({
				scope: "signaling",
				direction: "both",
				reason: "reconnect_failed",
			}).catch((error) =>
				console.warn("Signaling recovery escalation failed:", error),
			);
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
					this.flushBufferedMediaStateUpdates();
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
					producerId: d.producerId,
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
				if (this.initialSyncInProgress) {
					this.bufferedMediaStateUpdates.set(d.participantId, {
						...this.bufferedMediaStateUpdates.get(d.participantId),
						...updates,
					});
					return;
				}
				if (!this.participantManager.updateMediaState(d.participantId, updates)) {
					this.bufferedMediaStateUpdates.set(d.participantId, updates);
				}
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
				case "ban_participant":
					if (isForMe) {
						this.eventHandlers.onHostKickedYou?.({
							hostId: d.hostId,
							banned: d.action === "ban_participant",
						});
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
			if (!d?.participantId || !d.producerId) return;
			const screenConsumers =
				this.mediaManager.consumerManager.getScreenShareConsumers();
			const matchingConsumer = screenConsumers.find(
				(consumer) =>
					consumer.participantId === d.participantId &&
					consumer.producerId === d.producerId,
			);
			this.eventHandlers.onScreenShareStopped?.({
				...d,
				consumerId: matchingConsumer?.id,
				consumer: matchingConsumer,
			});
			if (matchingConsumer) {
				this.mediaManager.consumerManager.removeConsumer(matchingConsumer.id);
				this.mediaManager.processedConsumers.delete(matchingConsumer.id);
			}
			this.mediaManager.isScreenShareActive = screenConsumers.some(
				(consumer) => consumer.producerId !== d.producerId,
			);
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
		this.bufferedMediaStateUpdates.clear();
		this.lifecycleAbortController.abort(
			new DOMException("Participant connection stopped", "AbortError"),
		);
		this.e2eeReadyForLifecycle = false;
		try {
			this.lifecycleGeneration++;
			this.expectedMedia.reset();
			this.localProducerBytes.clear();
			this.recoveryManager.reset();
			let disconnectError: unknown = null;
			try {
				await this.mediaManager.cleanup();
			} catch (error) {
				disconnectError = error;
			}
			try {
				this.transportManager?.cleanup?.();
			} catch (error) {
				disconnectError ??= error;
			}
			try {
				if (this.sfuClient) await this.sfuClient.disconnect();
			} catch (error) {
				disconnectError ??= error;
			}
			if (disconnectError) throw disconnectError;
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
		this.expectedMedia.reset();
		this.localProducerBytes.clear();
		this.meetingId = null;
		this.currentUser = { value: null };
		this.eventHandlers = {};
		this.isConnected = false;
		this.initialSyncInProgress = false;
		this.bufferedReconciliationEvents = [];
		this.bufferedMediaStateUpdates.clear();
		this.reconciliation = createMeetingReconciliationState();
		this.producerClaims.clear();
		this.lastJoinUserData = null;
		this.lastJoinMediaState = {
			audio_enabled: false,
			video_enabled: false,
		};
		this.activeEscalation = null;
		this.activeReceiveReset = null;
		this.snapshotRetry = null;
		this.e2eeReadyForLifecycle = false;
		this.setState("stopped");
	}

	clearBufferedReconciliationEvents(): void {
		this.bufferedReconciliationEvents = [];
	}
}
