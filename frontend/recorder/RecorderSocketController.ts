import { type Ref, readonly, ref } from "vue";
import { ConsumerManager } from "../src/apps/meet/utils/media/ConsumerManager";
import {
	type Participant,
	ParticipantManager,
} from "../src/apps/meet/utils/media/ParticipantManager";
import {
	type SignalChannel,
	SocketIOSignalChannel,
} from "../src/apps/meet/utils/media/SignalChannel";
import { TransportManager } from "../src/apps/meet/utils/media/TransportManager";
import { VideoElementManager } from "../src/apps/meet/utils/media/VideoElementManager";
import { SFUClient } from "../src/apps/meet/utils/SFUClient";
import { SFUMediaManager } from "../src/apps/meet/utils/sfu/SFUMediaManager";
import {
	type ProducerEvent,
	parseConsumerId,
	parseParticipantUpdate,
	parseRecorderStageProjectionEvent,
	parseRecordingProjectionSnapshotResponse,
	parseRecordingChallenge,
	parseRecordingProofResponse,
	parseRequestResponse,
	parseScreenShareStarted,
	type RecorderParticipantData,
	type RecorderParticipantUpdate,
} from "./protocol";
import { RecorderStageProjection } from "./RecorderStageProjection";
import type {
	RecorderConfig,
	RecorderRendererBridge,
	RendererReasonCode,
} from "./rendererBridge";
import { CaptureCommandSupersededError } from "./rendererBridge";
import type {
	RecorderStageParticipant,
	RecorderStageProducer,
	RecorderStageProjectionEvent,
	RecorderStageSnapshot,
} from "../../suite/meet/types";

export type RecorderState = {
	participantAdded?: (participant: Participant) => void;
	participantRemoved?: (participantId: string) => void;
	participantUpdated?: (
		participantId: string,
		updates: RecorderParticipantUpdate,
	) => void;
	activeSpeakersChanged?: (participantIds: string[]) => void;
	screenStarted?: (data: {
		participantId: string;
		consumerId: string;
		producerId: string;
		stream: MediaStream;
		startedAt: number;
	}) => Promise<void> | void;
	screenStopped?: (participantId: string, producerId: string) => void;
	reactionReceived?: (userId: string, reaction: string) => void;
	handChanged?: (userId: string, raised: boolean, timestamp: string) => void;
	handsSynced?: (hands: Record<string, string>) => void;
	chatReceived?: (message: {
		id: string;
		participantId?: string;
		author: string;
		text: string;
	}) => void;
	roomEmpty?: () => void;
	transientsCleared?: () => void;
	captureStarted?: (timestamp: string) => void;
	frameCommitted?: () => Promise<void>;
};

interface RecorderDependencies {
	sfuClient: SFUClient;
	transportManager: TransportManager;
	consumerManager: ConsumerManager;
	participantManager: ParticipantManager;
	videoManager: VideoElementManager;
	mediaManager: SFUMediaManager;
}

interface PendingAttachment {
	consumerId: string;
	participantId: string;
	promise: Promise<void>;
	cancel: () => void;
}

export class RecorderSocketController {
	static readonly ATTACHMENT_TIMEOUT_MS = 10_000;
	private channel: SignalChannel;
	private deps: RecorderDependencies;
	private projection?: RecorderStageProjection;
	private projectionFailure?: Error;
	private producerClaims = new Map<string, Promise<void>>();
	private attachmentPromises = new Map<string, PendingAttachment>();
	private screenAttachmentPromises = new Map<string, PendingAttachment>();
	private currentParticipantAttachments = new Map<
		string,
		{ consumerId: string; producerId: string }
	>();
	private activeScreens = new Map<
		string,
		{ consumerId: string; producerId: string }
	>();
	private captureEpoch?: {
		epoch: number;
		prepared: Promise<void>;
		settled: boolean;
		accepted: boolean;
		superseded: boolean;
		started?: {
			timestamp: string;
			promise: Promise<void>;
			settled: boolean;
			accepted: boolean;
		};
	};
	private bufferedTransients: RecorderStageProjectionEvent[] = [];
	private transientsLive = false;
	private cleaningUp = false;
	private roomEmptyTimer?: ReturnType<typeof setTimeout>;
	private listenerCleanup: Array<() => void> = [];
	private state: RecorderState;
	private _ready = ref(false);
	private _interruption = ref<string | null>(null);
	readonly ready: Readonly<Ref<boolean>> = readonly(this._ready);
	readonly interruption: Readonly<Ref<string | null>> = readonly(
		this._interruption,
	);

	constructor(
		private bridge: RecorderRendererBridge,
		channel: SignalChannel = new SocketIOSignalChannel(),
		state: RecorderState = {},
		dependencies?: RecorderDependencies,
	) {
		this.channel = channel;
		this.state = state;
		if (dependencies) {
			this.deps = dependencies;
		} else {
			const sfuClient = new SFUClient(channel);
			const transportManager = new TransportManager();
			const consumerManager = new ConsumerManager();
			const participantManager = new ParticipantManager();
			const videoManager = new VideoElementManager(
				RecorderSocketController.ATTACHMENT_TIMEOUT_MS,
			);
			transportManager.initialize(sfuClient);
			this.deps = {
				sfuClient,
				transportManager,
				consumerManager,
				participantManager,
				videoManager,
				mediaManager: new SFUMediaManager(
					{
						transportManager,
						consumerManager,
						participantManager,
						videoManager,
					},
					() => null,
				),
			};
		}
		this.setupManagerEvents();
		this.setupSFUEvents();
	}

	get videoManager(): VideoElementManager {
		return this.deps.videoManager;
	}

	async connect(config: RecorderConfig): Promise<void> {
		this.projection = new RecorderStageProjection(config.meetingId);
		this.frappeOrigin = new URL(config.frappeOrigin).origin;
		let resolveProof!: () => void;
		let rejectProof!: (error: Error) => void;
		const proved = new Promise<void>((resolve, reject) => {
			resolveProof = resolve;
			rejectProof = reject;
		});
		const onChallenge = (value: unknown) => {
			const challenge = parseRecordingChallenge(value);
			if (!challenge) {
				rejectProof(new Error("Invalid recording challenge"));
				return;
			}
			this.bridge
				.sign(challenge)
				.then((signature) => this.requestProof(signature))
				.then(resolveProof, rejectProof);
		};
		const onDisconnect = () => {
			if (this.cleaningUp) return;
			this.interrupt("sfu_disconnected", "SFU connection lost");
			this.cleanup();
		};
		this.listenChannel("recording:challenge", onChallenge);
		this.listenChannel("disconnect", onDisconnect);
		try {
			await this.channel.connect({
				origin: config.sfuOrigin,
				path: config.socketPath,
				auth: { token: config.grant },
				reconnection: false,
			});
			await proved;
			this.bridge.reportProofComplete();
			await this.request("recording:join", { roomId: config.meetingId });
			this.bridge.reportJoinComplete();
			this.deps.sfuClient.connected = true;
			this.deps.sfuClient.connectionDetails.meetingId = config.meetingId;
			this.deps.sfuClient.registerEventHandlers();
			await this.deps.transportManager.initializeDevice();
			await this.deps.transportManager.createReceiveTransport();
			await this.initialSynchronize();
			await this.commitStableFrame();
			this._ready.value = true;
			this.bridge.reportCaptureReady();
		} catch (error) {
			const reason =
				error instanceof Error
					? error.message
					: "Recorder connection interrupted";
			this._ready.value = false;
			this._interruption.value = reason;
			if (!this.projectionFailure)
				this.bridge.reportFailure("configuration_failed", reason);
			this.cleanup();
			throw error;
		}
	}

	async prepareCapture(epoch: number): Promise<void> {
		this.assertEpoch(epoch);
		this.assertOperational();
		if (this.captureEpoch) {
			if (epoch === this.captureEpoch.epoch) {
				if (!this.captureEpoch.settled || this.captureEpoch.accepted)
					return this.captureEpoch.prepared;
			} else {
				if (epoch < this.captureEpoch.epoch)
					throw new Error(`Stale capture epoch ${epoch}`);
				if (
					this.captureEpoch.started &&
					!this.captureEpoch.started.accepted
				)
					throw new Error(`Conflicting capture epoch ${epoch}`);
				this.captureEpoch.superseded = true;
			}
		}
		this.transientsLive = false;
		this.bufferedTransients = [];
		const capture = {
			epoch,
			prepared: Promise.resolve(),
			settled: false,
			accepted: false,
			superseded: false,
		};
		const prepared = Promise.resolve().then(async () => {
			try {
				this.assertCurrentCapture(capture);
				const projection = this.requireProjection();
				projection.beginReconciliation();
				const snapshot = await this.requestProjectionSnapshot(() =>
					this.assertCurrentCapture(capture),
				);
				this.assertCurrentCapture(capture);
				await this.reconcileProjection(snapshot, false, () =>
					this.assertCurrentCapture(capture),
				);
				this.assertCurrentCapture(capture);
				this.state.transientsCleared?.();
				await this.commitStableFrame(() => this.assertCurrentCapture(capture));
				this.assertCurrentCapture(capture);
				capture.accepted = true;
			} catch (error) {
				this.assertCurrentCapture(capture);
				throw error;
			}
		});
		capture.prepared = prepared.finally(() => {
			capture.settled = true;
		});
		this.captureEpoch = capture;
		return capture.prepared;
	}

	async captureStarted(epoch: number, timestamp: string): Promise<void> {
		this.assertEpoch(epoch);
		this.assertOperational();
		if (!isCanonicalTimestamp(timestamp))
			throw new Error("Invalid capture start timestamp");
		const capture = this.captureEpoch;
		if (!capture || epoch < capture.epoch)
			throw new Error(`Stale capture epoch ${epoch}`);
		if (epoch > capture.epoch)
			throw new Error(`Conflicting capture epoch ${epoch}`);
		if (capture.started) {
			if (capture.started.timestamp !== timestamp)
				throw new Error(`Conflicting capture timestamp for epoch ${epoch}`);
			if (capture.started.accepted || !capture.started.settled)
				return capture.started.promise;
		}
		const started = {
			timestamp,
			settled: false,
			accepted: false,
			promise: Promise.resolve(),
		};
		started.promise = capture.prepared
			.then(() => {
				this.assertCurrentCapture(capture);
				this.state.captureStarted?.(timestamp);
				const buffered = this.bufferedTransients.splice(0);
				for (const event of buffered)
					if (event.observed_at >= timestamp) this.applyTransient(event);
				this.transientsLive = true;
				started.accepted = true;
			})
			.catch((error) => {
				if (error instanceof CaptureCommandSupersededError) throw error;
				this.transientsLive = false;
				this.state.transientsCleared?.();
				throw error;
			})
			.finally(() => {
				started.settled = true;
			});
		capture.started = started;
		return started.promise;
	}

	disconnect(): void {
		this._ready.value = false;
		this.cleanup();
	}

	reportPlaybackFailure(reason: string): void {
		this.interrupt("media_attachment_failed", reason);
	}

	failCaptureCommand(reason: string): void {
		this.interrupt("projection_invalid", reason);
		this.cleanup();
	}

	private setupManagerEvents(): void {
		this.deps.participantManager.setEventHandlers({
			onParticipantAdded: (p) => {
				if (this.roomEmptyTimer) clearTimeout(this.roomEmptyTimer);
				this.roomEmptyTimer = undefined;
				this.state.participantAdded?.(p);
			},
			onParticipantRemoved: (id) => {
				this.deps.videoManager.removeVideoElement(id);
				this.deps.consumerManager.cleanupParticipantConsumers(id);
				this.state.participantRemoved?.(id);
				this.scheduleRoomEmpty();
			},
			onParticipantUpdated: (id, _p, updates) => {
				const parsed = parseParticipantUpdate(updates);
				if (parsed) this.state.participantUpdated?.(id, parsed);
			},
		});
		this.deps.consumerManager.setEventHandlers({
			onConsumerAdded: (consumer) => {
				const operation = this.deps.mediaManager
					.handleNewConsumer(consumer)
					.then(async () => {
						if (consumer.isScreen) {
							await this.screenAttachmentPromises.get(consumer.id)?.promise;
						}
					});
				const pending = this.cancellableAttachment(consumer, operation);
				this.attachmentPromises.set(consumer.producerId, pending);
				if (!consumer.isScreen) {
					this.currentParticipantAttachments.set(consumer.participantId, {
						consumerId: consumer.id,
						producerId: consumer.producerId,
					});
				}
				void pending.promise
					.catch((error) => {
						if (this._ready.value)
							this.interrupt(
								"media_attachment_failed",
								error instanceof Error ? error.message : "unknown error",
							);
					})
					.finally(() => {
						if (this.attachmentPromises.get(consumer.producerId) === pending) {
							this.attachmentPromises.delete(consumer.producerId);
						}
					});
			},
			onConsumerRemoved: (_id, consumer) => {
				this.cancelConsumerAttachment(consumer);
				if (consumer.isScreen)
					this.finishScreen(
						consumer.participantId,
						consumer.producerId,
						consumer.id,
					);
			},
			onConsumerLost: (info) =>
				void this.deps.mediaManager.handleConsumerLost(info),
		});
		this.deps.mediaManager.setEventHandlers({
			onScreenShareStarted: (value) => {
				const data = parseScreenShareStarted(value);
				if (!data) return;
				const previous = this.activeScreens.get(data.participantId);
				if (previous && previous.consumerId !== data.consumerId) {
					this.finishScreen(
						data.participantId,
						previous.producerId,
						previous.consumerId,
					);
					const previousConsumer = this.deps.consumerManager
						.getScreenShareConsumers()
						.find(
							(consumer) =>
								consumer.id === previous.consumerId &&
								consumer.participantId === data.participantId &&
								consumer.producerId === previous.producerId,
						);
					if (previousConsumer) {
						this.deps.consumerManager.removeConsumer(previousConsumer.id);
					}
				}
				this.activeScreens.set(data.participantId, {
					consumerId: data.consumerId,
					producerId: data.producerId,
				});
				const acknowledged = Promise.resolve().then(() =>
					this.state.screenStarted?.({
						participantId: data.participantId,
						consumerId: data.consumerId,
						producerId: data.producerId,
						stream: data.stream,
						startedAt: Date.parse(
							this.requireProjection().producers.get(data.producerId)
								?.observed_at || "",
						),
					}),
				);
				const pending = this.withTimeout(
					data,
					acknowledged,
					`Timed out waiting for screen element for ${data.participantId}`,
				);
				this.screenAttachmentPromises.set(data.consumerId, pending);
				const cleanupPending = () => {
					if (this.screenAttachmentPromises.get(data.consumerId) === pending) {
						this.screenAttachmentPromises.delete(data.consumerId);
					}
				};
				void pending.promise.then(cleanupPending, cleanupPending);
			},
			onRecoveryExhausted: () =>
				this.interrupt(
					"media_subscription_failed",
					"Media subscription recovery exhausted",
				),
		});
		this.deps.transportManager.setEventHandlers({
			onTransportConnectionStateChange: ({ direction, state }) => {
				if (
					direction === "recv" &&
					(state === "failed" ||
						state === "disconnected" ||
						state === "closed") &&
					this._ready.value
				)
					this.interrupt(
						"receive_transport_failed",
						`Receive transport ${state}`,
					);
			},
		});
	}

	private setupSFUEvents(): void {
		this.listenSFU("recording:projection", (value) => {
			const event = parseRecorderStageProjectionEvent(value);
			if (!event) {
				this.failProjection("Invalid recorder projection event");
				return;
			}
			try {
				const accepted = this.requireProjection().applyEvent(event);
				for (const item of accepted) this.applyProjectionEvent(item);
			} catch (error) {
				this.failProjection(
					error instanceof Error
						? error.message
						: "Invalid recorder projection",
				);
			}
		});
		this.listenSFU("consumer_closed", (value) => {
			const id = parseConsumerId(value);
			if (id) this.deps.consumerManager.removeConsumer(id);
		});
	}

	private async initialSynchronize(): Promise<void> {
		const snapshot = await this.requestProjectionSnapshot();
		if (this.projectionFailure) throw this.projectionFailure;
		await this.reconcileProjection(snapshot, true);
	}

	private async reconcileProjection(
		snapshot: RecorderStageSnapshot,
		initialize = false,
		assertCurrent: () => void = () => undefined,
	): Promise<void> {
		const projection = this.requireProjection();
		let replayed: RecorderStageProjectionEvent[];
		try {
			replayed = initialize
				? projection.initialize(snapshot)
				: projection.reconcile(snapshot);
		} catch (error) {
			throw this.failProjection(
				error instanceof Error ? error.message : "Invalid recorder projection",
			);
		}
		this.deps.participantManager.syncParticipants(
			[...projection.participants.values()].map((participant) =>
				this.sanitizeParticipant(this.participantData(participant)),
			),
		);
		this.state.handsSynced?.(Object.fromEntries(projection.raisedHands));
		this.state.activeSpeakersChanged?.([...projection.activeSpeakerIds]);
		for (const event of replayed)
			if (
				event.payload.type === "reaction" ||
				event.payload.type === "chat_message"
			)
				this.queueTransient(event);
		if (projection.participants.size === 0) this.scheduleRoomEmpty();
		this.removeStaleConsumers();
		await Promise.all(
			[...projection.producers.values()].map((producer) =>
				this.subscribeRequired(this.producerEvent(producer)),
			),
		);
		assertCurrent();
	}

	private applyProjectionEvent(
		event: RecorderStageProjectionEvent,
		subscribe = true,
	): void {
		const payload = event.payload;
		switch (payload.type) {
			case "participant_joined":
				this.deps.participantManager.addParticipant(
					this.sanitizeParticipant(this.participantData(payload.participant)),
				);
				break;
			case "participant_updated":
				this.deps.participantManager.updateParticipant(
					payload.participant.participant_id,
					this.sanitizeParticipant(this.participantData(payload.participant)),
				);
				break;
			case "participant_left": {
				const removed = this.deps.participantManager.removeParticipant(
					payload.participant_id,
				);
				if (!removed) this.scheduleRoomEmpty();
				break;
			}
			case "producer_created":
				if (subscribe)
					void this.subscribeLive(this.producerEvent(payload.producer));
				break;
			case "producer_updated":
				break;
			case "producer_closed":
				this.removeProducer({
					producerId: payload.producer_id,
					participantId: payload.participant_id,
					isScreen: payload.is_screen,
				});
				break;
			case "media_control":
				this.updateMedia(payload.participant_id, payload.action);
				break;
			case "active_speaker":
				this.state.activeSpeakersChanged?.([...payload.participant_ids]);
				break;
			case "hand_raised":
				this.state.handChanged?.(
					payload.participant_id,
					payload.raised,
					event.observed_at,
				);
				break;
			case "reaction":
			case "chat_message":
				this.queueTransient(event);
				break;
		}
	}
	private subscribeRequired(event: ProducerEvent): Promise<void> {
		if (!this.isCurrentProducer(event)) return Promise.resolve();
		const existing = this.producerClaims.get(event.producerId);
		if (existing) return existing;
		const operation = this.subscribeClaimed(event);
		this.producerClaims.set(event.producerId, operation);
		const release = () => {
			if (this.producerClaims.get(event.producerId) === operation)
				this.producerClaims.delete(event.producerId);
		};
		void operation.then(release, release);
		return operation;
	}
	private async commitStableFrame(
		assertCurrent: () => void = () => undefined,
	): Promise<void> {
		while (true) {
			assertCurrent();
			this.assertNotFailed();
			if (this.cleaningUp) throw new Error("Recorder is shutting down");
			const before = this.currentPersistentStageSignature();
			await Promise.all(
				[...this.requireProjection().producers.values()].map((producer) =>
					this.subscribeRequired(this.producerEvent(producer)),
				),
			);
			assertCurrent();
			await this.state.frameCommitted?.();
			assertCurrent();
			this.assertNotFailed();
			if (this.cleaningUp) throw new Error("Recorder is shutting down");
			if (before === this.currentPersistentStageSignature()) return;
		}
	}
	private currentPersistentStageSignature(): string {
		const projection = this.requireProjection();
		return JSON.stringify({
			participants: [...projection.participants.values()].sort((a, b) =>
				a.participant_id.localeCompare(b.participant_id),
			),
			producers: [...projection.producers.values()].sort((a, b) =>
				a.producer_id.localeCompare(b.producer_id),
			),
			raisedHands: [...projection.raisedHands].sort(([a], [b]) =>
				a.localeCompare(b),
			),
			activeSpeakerIds: projection.activeSpeakerIds,
		});
	}
	private async subscribeClaimed(event: ProducerEvent): Promise<void> {
		if (!this.isCurrentProducer(event)) return;
		const existing = this.deps.consumerManager
			.getConsumersByParticipant(event.participantId)
			.find((consumer) => consumer.producerId === event.producerId);
		if (existing) {
			await this.attachmentPromises.get(event.producerId)?.promise;
			if (existing.isScreen)
				await this.screenAttachmentPromises.get(existing.id)?.promise;
			return;
		}
		const result =
			await this.deps.mediaManager.subscribeToRemoteProducer(event);
		if (!this.isCurrentProducer(event)) {
			this.removeProducer(event);
			return;
		}
		if (!result)
			throw new Error(
				`Initial producer ${event.producerId} did not create a consumer`,
			);
		const attached = this.attachmentPromises.get(event.producerId)?.promise;
		if (!attached)
			throw new Error(`Initial producer ${event.producerId} was not attached`);
		await attached;
		if (!this.isCurrentProducer(event)) this.removeProducer(event);
	}
	private async subscribeLive(event: ProducerEvent): Promise<void> {
		try {
			await this.subscribeRequired(event);
		} catch (error) {
			this.interrupt(
				"media_subscription_failed",
				error instanceof Error ? error.message : "Media subscription failed",
			);
		}
	}
	private isCurrentProducer(event: ProducerEvent): boolean {
		const producer = this.requireProjection().producers.get(event.producerId);
		return (
			producer?.participant_id === event.participantId &&
			producer.is_screen === event.isScreen
		);
	}
	private sanitizeParticipant(
		p: RecorderParticipantData,
	): RecorderParticipantData {
		const avatar = trustedAvatar(
			p.userData?.avatar || p.avatar,
			this.frappeOrigin,
		);
		return { ...p, avatar, userData: { ...p.userData, avatar } };
	}
	private frappeOrigin = "";
	private removeProducer(event: ProducerEvent): void {
		const consumers = this.deps.consumerManager
			.getConsumersByParticipant(event.participantId)
			.filter((consumer) => consumer.producerId === event.producerId);
		for (const consumer of consumers) {
			this.deps.consumerManager.removeConsumer(consumer.id);
		}
		if (!consumers.length) this.cancelProducerAttachment(event);
		if (event.isScreen)
			this.finishScreen(event.participantId, event.producerId);
	}
	private removeStaleConsumers(): void {
		const projection = this.requireProjection();
		for (const participant of this.deps.participantManager.getAllParticipants()) {
			for (const consumer of this.deps.consumerManager.getConsumersByParticipant(
				participant.user_id,
			)) {
				const producer = projection.producers.get(consumer.producerId);
				if (
					!producer ||
					producer.participant_id !== consumer.participantId ||
					producer.is_screen !== consumer.isScreen
				)
					this.deps.consumerManager.removeConsumer(consumer.id);
			}
		}
	}
	private finishScreen(
		participantId: string,
		producerId: string,
		consumerId?: string,
	): void {
		const screen = this.activeScreens.get(participantId);
		if (
			screen?.producerId !== producerId ||
			(consumerId && screen.consumerId !== consumerId)
		)
			return;
		this.activeScreens.delete(participantId);
		this.screenAttachmentPromises.get(screen.consumerId)?.cancel();
		this.state.screenStopped?.(participantId, producerId);
	}
	private updateMedia(
		participantId: string,
		action: "mute" | "unmute" | "video_off" | "video_on",
	): void {
		const update: { audioEnabled?: boolean; videoEnabled?: boolean } = {};
		if (action === "mute" || action === "unmute")
			update.audioEnabled = action === "unmute";
		else update.videoEnabled = action === "video_on";
		this.deps.participantManager.updateMediaState(participantId, update);
	}
	private participantData(
		participant: RecorderStageParticipant,
	): RecorderParticipantData & { participantId: string } {
		return {
			participantId: participant.participant_id,
			user_id: participant.participant_id,
			user_name: participant.name,
			avatar: participant.avatar,
			audio_enabled: participant.audio_enabled,
			video_enabled: participant.video_enabled,
			userData: {
				name: participant.name,
				avatar: participant.avatar,
				audio_enabled: participant.audio_enabled,
				video_enabled: participant.video_enabled,
			},
		};
	}
	private producerEvent(producer: RecorderStageProducer): ProducerEvent {
		return {
			producerId: producer.producer_id,
			participantId: producer.participant_id,
			isScreen: producer.is_screen,
		};
	}
	private queueTransient(event: RecorderStageProjectionEvent): void {
		if (this.transientsLive) this.applyTransient(event);
		else this.bufferedTransients.push(event);
	}
	private applyTransient(event: RecorderStageProjectionEvent): void {
		const payload = event.payload;
		if (payload.type === "reaction") {
			this.state.reactionReceived?.(payload.from_user, payload.reaction);
		} else if (payload.type === "chat_message") {
			this.state.chatReceived?.({
				id: payload.message_id,
				participantId: payload.from_user,
				author: payload.from_name,
				text: payload.message,
			});
		}
	}
	private requireProjection(): RecorderStageProjection {
		if (!this.projection)
			throw new Error("Recorder projection is not initialized");
		return this.projection;
	}
	private failProjection(diagnostic: string): Error {
		const error = new Error(diagnostic);
		if (this.projectionFailure) return this.projectionFailure;
		this.projectionFailure = error;
		this.interrupt("projection_invalid", diagnostic);
		this.cleanup();
		return error;
	}
	private assertEpoch(epoch: number): void {
		if (!Number.isSafeInteger(epoch) || epoch < 0)
			throw new Error(`Invalid capture epoch ${epoch}`);
	}
	private assertOperational(): void {
		this.assertNotFailed();
		if (this.cleaningUp || !this._ready.value)
			throw new Error("Recorder is not ready for capture");
	}
	private assertCurrentCapture(capture: { superseded: boolean }): void {
		if (capture.superseded || this.captureEpoch !== capture)
			throw new CaptureCommandSupersededError();
		this.assertOperational();
	}
	private assertNotFailed(): void {
		if (this.projectionFailure) throw this.projectionFailure;
	}
	private interrupt(reasonCode: RendererReasonCode, diagnostic: string): void {
		if (!this._ready.value && this._interruption.value) return;
		this._ready.value = false;
		this._interruption.value = diagnostic;
		this.bridge.reportInterruption(reasonCode, diagnostic);
	}
	private cancellableAttachment(
		consumer: { id: string; participantId: string },
		operation: Promise<void>,
	): PendingAttachment {
		let settled = false;
		let cancel!: () => void;
		const promise = new Promise<void>((resolve, reject) => {
			cancel = () => {
				if (settled) return;
				settled = true;
				resolve();
			};
			operation.then(
				() => {
					if (settled) return;
					settled = true;
					resolve();
				},
				(error) => {
					if (settled) return;
					settled = true;
					reject(error);
				},
			);
		});
		return {
			consumerId: consumer.id,
			participantId: consumer.participantId,
			promise,
			cancel,
		};
	}
	private withTimeout(
		consumer: { consumerId: string; participantId: string },
		operation: Promise<void>,
		message: string,
	): PendingAttachment {
		let settled = false;
		let timer: ReturnType<typeof setTimeout>;
		let cancel!: () => void;
		const promise = new Promise<void>((resolve, reject) => {
			cancel = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve();
			};
			timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(new Error(message));
			}, RecorderSocketController.ATTACHMENT_TIMEOUT_MS);
			operation.then(
				() => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					resolve();
				},
				(error) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					reject(error);
				},
			);
		});
		return {
			consumerId: consumer.consumerId,
			participantId: consumer.participantId,
			promise,
			cancel,
		};
	}
	private cancelConsumerAttachment(consumer: {
		id: string;
		participantId: string;
		producerId: string;
		isScreen: boolean;
	}): void {
		const pending = this.attachmentPromises.get(consumer.producerId);
		if (pending?.consumerId === consumer.id) pending.cancel();
		if (consumer.isScreen) {
			this.screenAttachmentPromises.get(consumer.id)?.cancel();
			return;
		}
		const current = this.currentParticipantAttachments.get(
			consumer.participantId,
		);
		if (
			current?.producerId === consumer.producerId &&
			current.consumerId === consumer.id
		) {
			this.currentParticipantAttachments.delete(consumer.participantId);
			this.deps.videoManager.cancelDeferredAttachment(consumer.participantId);
		}
	}
	private cancelProducerAttachment(event: ProducerEvent): void {
		this.attachmentPromises.get(event.producerId)?.cancel();
		if (
			this.currentParticipantAttachments.get(event.participantId)
				?.producerId === event.producerId
		) {
			this.currentParticipantAttachments.delete(event.participantId);
			this.deps.videoManager.cancelDeferredAttachment(event.participantId);
		}
	}
	private cleanup(): void {
		if (this.cleaningUp) return;
		this.cleaningUp = true;
		if (this.roomEmptyTimer) clearTimeout(this.roomEmptyTimer);
		this.roomEmptyTimer = undefined;
		this.bufferedTransients = [];
		this.transientsLive = false;
		for (const pending of this.attachmentPromises.values()) pending.cancel();
		for (const [participantId, screen] of [...this.activeScreens]) {
			this.finishScreen(participantId, screen.producerId, screen.consumerId);
		}
		for (const pending of this.screenAttachmentPromises.values())
			pending.cancel();
		this.attachmentPromises.clear();
		this.producerClaims.clear();
		this.screenAttachmentPromises.clear();
		this.currentParticipantAttachments.clear();
		this.activeScreens.clear();
		void this.deps.mediaManager.cancelPendingSubscriptions();
		this.deps.mediaManager.cleanup();
		this.deps.consumerManager.clear();
		for (const participant of this.deps.participantManager.getAllParticipants())
			this.deps.participantManager.removeParticipant(participant.user_id);
		this.deps.videoManager.cleanup();
		this.deps.transportManager.cleanup();
		this.deps.sfuClient.disconnect();
		for (const remove of this.listenerCleanup.splice(0)) remove();
		this.deps.participantManager.setEventHandlers({
			onParticipantAdded: undefined,
			onParticipantRemoved: undefined,
			onParticipantUpdated: undefined,
		});
		this.deps.consumerManager.setEventHandlers({
			onConsumerAdded: undefined,
			onConsumerRemoved: undefined,
			onConsumerLost: undefined,
		});
		this.deps.mediaManager.setEventHandlers({
			onScreenShareStarted: undefined,
			onRecoveryExhausted: undefined,
		});
		this.deps.transportManager.setEventHandlers({
			onTransportConnectionStateChange: undefined,
		});
	}
	private listenChannel(
		event: string,
		handler: (...args: unknown[]) => void,
	): void {
		this.channel.on(event, handler);
		this.listenerCleanup.push(() => this.channel.off(event, handler));
	}
	private listenSFU(event: string, handler: (...args: unknown[]) => void): void {
		this.deps.sfuClient.on(event, handler);
		this.listenerCleanup.push(() => this.deps.sfuClient.off(event, handler));
	}
	private scheduleRoomEmpty(): void {
		if (this.deps.participantManager.getAllParticipants().length > 0) return;
		if (this.roomEmptyTimer) clearTimeout(this.roomEmptyTimer);
		this.roomEmptyTimer = setTimeout(() => {
			this.roomEmptyTimer = undefined;
			if (this.deps.participantManager.getAllParticipants().length === 0)
				this.state.roomEmpty?.();
		}, 10_000);
	}
	private request(event: string, data: { roomId: string }): Promise<void> {
		return new Promise((resolve, reject) =>
			this.channel.emit(event, data, (value) => {
				const response = parseRequestResponse(value);
				response?.success
					? resolve()
					: reject(new Error(response?.error || `${event} failed`));
			}),
		);
	}
	private requestProjectionSnapshot(
		assertCurrent: () => void = () => undefined,
	): Promise<RecorderStageSnapshot> {
		return new Promise((resolve, reject) =>
			this.channel.emit("recording:get_projection_snapshot", {}, (value) => {
				try {
					assertCurrent();
				} catch (error) {
					reject(error);
					return;
				}
				const response = parseRecordingProjectionSnapshotResponse(value);
				if (!response) {
					reject(this.failProjection("Invalid recorder projection snapshot"));
					return;
				}
				response.success
					? resolve(response.snapshot)
					: reject(new Error(response.error));
			}),
		);
	}
	private requestProof(signature: string): Promise<void> {
		return new Promise((resolve, reject) =>
			this.channel.emit(
				"recording:proof",
				{ protocol_version: 1, signature },
				(value) => {
					const response = parseRecordingProofResponse(value);
					response?.success
						? resolve()
						: reject(
								new Error(response?.diagnostic || "recording:proof failed"),
							);
				},
			),
		);
	}
}

export function trustedAvatar(
	value: unknown,
	frappeOrigin: string,
): string | null {
	if (
		typeof value !== "string" ||
		!value ||
		!frappeOrigin ||
		value.startsWith("//")
	)
		return null;
	try {
		const origin = new URL(frappeOrigin);
		const url = new URL(value, origin);
		if (
			!["http:", "https:"].includes(origin.protocol) ||
			url.origin !== origin.origin ||
			url.protocol !== origin.protocol ||
			url.pathname.startsWith("/private/")
		)
			return null;
		return url.href;
	} catch {
		return null;
	}
}

const isCanonicalTimestamp = (value: unknown): value is string => {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
	)
		return false;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};
