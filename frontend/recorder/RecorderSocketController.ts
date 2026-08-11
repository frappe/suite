import { readonly, ref, type Ref } from "vue";
import { ConsumerManager } from "../src/apps/meet/utils/media/ConsumerManager";
import { ParticipantManager, type Participant } from "../src/apps/meet/utils/media/ParticipantManager";
import { SocketIOSignalChannel, type SignalChannel } from "../src/apps/meet/utils/media/SignalChannel";
import { TransportManager } from "../src/apps/meet/utils/media/TransportManager";
import { VideoElementManager } from "../src/apps/meet/utils/media/VideoElementManager";
import { SFUClient } from "../src/apps/meet/utils/SFUClient";
import { SFUMediaManager } from "../src/apps/meet/utils/sfu/SFUMediaManager";
import {
	applyMeetingReconciliationEvent,
	createMeetingReconciliationState,
	reconcileMeetingSnapshot,
	type MeetingReconciliationEvent,
	type MeetingReconciliationState,
} from "../src/apps/meet/utils/sfu/MeetingSnapshotReconciler";
import {
	parseActiveSpeakers,
	parseChatMessage,
	parseConsumerId,
	parseHandChange,
	parseMediaControlMessage,
	parseParticipantId,
	parseParticipantMessage,
	parseParticipantUpdate,
	parseProducerMessage,
	parseProducerSnapshot,
	parseRaisedHands,
	parseReaction,
	parseRecordingChallenge,
	parseRequestResponse,
	parseScreenShareStarted,
	type MediaControlMessage,
	type ProducerEvent,
	type RecorderParticipantData,
	type RecorderParticipantUpdate,
} from "./protocol";
import type { RecorderConfig, RecorderRendererBridge } from "./rendererBridge";

type ReconciledRecorderParticipant = RecorderParticipantData & { participantId: string };
type SyncEvent = MeetingReconciliationEvent<ReconciledRecorderParticipant>;
export type RecorderState = {
	participantAdded?: (participant: Participant) => void;
	participantRemoved?: (participantId: string) => void;
	participantUpdated?: (participantId: string, updates: RecorderParticipantUpdate) => void;
	activeSpeakersChanged?: (participantIds: string[]) => void;
	screenStarted?: (data: { participantId: string; consumerId: string; stream: MediaStream; startedAt: number }) => Promise<void> | void;
	screenStopped?: (participantId: string) => void;
	reactionReceived?: (userId: string, reaction: string) => void;
	handChanged?: (userId: string, raised: boolean, timestamp: string) => void;
	handsSynced?: (hands: Record<string, string>) => void;
	chatReceived?: (message: { id: string; participantId?: string; author: string; text: string }) => void;
	roomEmpty?: () => void;
};

interface RecorderDependencies {
	sfuClient: SFUClient;
	transportManager: TransportManager;
	consumerManager: ConsumerManager;
	participantManager: ParticipantManager;
	videoManager: VideoElementManager;
	mediaManager: SFUMediaManager;
}

export class RecorderSocketController {
	static readonly ATTACHMENT_TIMEOUT_MS = 10_000;
	private channel: SignalChannel;
	private deps: RecorderDependencies;
	private bufferedEvents: SyncEvent[] = [];
	private reconciliation: MeetingReconciliationState<ReconciledRecorderParticipant> =
		createMeetingReconciliationState();
	private producerClaims = new Set<string>();
	private attachmentPromises = new Map<string, Promise<void>>();
	private screenAttachmentPromises = new Map<string, Promise<void>>();
	private initialSync = true;
	private captureStartedAt = 0;
	private cleaningUp = false;
	private roomEmptyTimer?: ReturnType<typeof setTimeout>;
	private state: RecorderState;
	private _ready = ref(false);
	private _interruption = ref<string | null>(null);
	readonly ready: Readonly<Ref<boolean>> = readonly(this._ready);
	readonly interruption: Readonly<Ref<string | null>> = readonly(this._interruption);

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
			const videoManager = new VideoElementManager(RecorderSocketController.ATTACHMENT_TIMEOUT_MS);
			transportManager.initialize(sfuClient);
			this.deps = {
				sfuClient,
				transportManager,
				consumerManager,
				participantManager,
				videoManager,
				mediaManager: new SFUMediaManager({ transportManager, consumerManager, participantManager, videoManager }, () => null),
			};
		}
		this.setupManagerEvents();
		this.setupSFUEvents();
	}

	get videoManager(): VideoElementManager { return this.deps.videoManager; }

	async connect(config: RecorderConfig): Promise<void> {
		this.captureStartedAt = config.startedAt;
		this.frappeOrigin = new URL(config.frappeOrigin).origin;
		let resolveProof!: () => void;
		let rejectProof!: (error: Error) => void;
		const proved = new Promise<void>((resolve, reject) => { resolveProof = resolve; rejectProof = reject; });
		this.channel.on("recording:challenge", (value) => {
			const challenge = parseRecordingChallenge(value);
			if (!challenge) {
				rejectProof(new Error("Invalid recording challenge"));
				return;
			}
			this.bridge.sign(challenge)
				.then((signature) => this.request("recording:proof", { signature }))
				.then(resolveProof, rejectProof);
		});
		this.channel.on("disconnect", () => {
			if (this.cleaningUp) return;
			this.interrupt("SFU connection lost");
			this.cleanup();
		});
		try {
			await this.channel.connect({ origin: config.sfuOrigin, path: config.socketPath, auth: { token: config.grant }, reconnection: false });
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
			this._ready.value = true;
			this.bridge.reportCaptureReady();
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Recorder connection interrupted";
			this._ready.value = false;
			this._interruption.value = reason;
			this.bridge.reportFailure(reason);
			this.cleanup();
			throw error;
		}
	}

	disconnect(): void {
		this._ready.value = false;
		this.cleanup();
	}

	reportPlaybackFailure(reason: string): void { this.interrupt(reason); }

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
				const attached = this.deps.mediaManager.handleNewConsumer(consumer).then(async () => {
					if (consumer.isScreen) await this.screenAttachmentPromises.get(consumer.id);
				});
				this.attachmentPromises.set(consumer.producerId, attached);
				void attached.catch((error) => {
					if (this._ready.value) this.interrupt(`Media attachment failed: ${error instanceof Error ? error.message : "unknown error"}`);
				});
			},
			onConsumerRemoved: (_id, consumer) => { if (consumer.isScreen) this.stopScreen(consumer.participantId); },
			onConsumerLost: (info) => void this.deps.mediaManager.handleConsumerLost(info),
		});
		this.deps.mediaManager.setEventHandlers({
			onScreenShareStarted: (value) => {
				const data = parseScreenShareStarted(value);
				if (!data) return;
				const acknowledged = Promise.resolve(this.state.screenStarted?.({ participantId: data.participantId, consumerId: data.consumerId, stream: data.stream, startedAt: Date.now() }));
				this.screenAttachmentPromises.set(data.consumerId, this.withTimeout(acknowledged, `Timed out waiting for screen element for ${data.participantId}`));
			},
			onRecoveryExhausted: () => this.interrupt("Media subscription recovery exhausted"),
		});
		this.deps.transportManager.setEventHandlers({ onTransportConnectionStateChange: ({ direction, state }) => {
			if (direction === "recv" && (state === "failed" || state === "disconnected" || state === "closed") && this._ready.value) this.interrupt(`Receive transport ${state}`);
		} });
	}

	private setupSFUEvents(): void {
		const client = this.deps.sfuClient;
		client.on("participant_joined", (value) => { const event = parseParticipantMessage("participant-joined", value); if (event) this.queueOrApply(event); });
		client.on("participant_left", (value) => { const event = parseParticipantMessage("participant-left", value); if (event) this.queueOrApply(event); });
		client.on("producer_created", (value) => { const event = parseProducerMessage("producer-created", value); if (event) this.queueOrApply(event); });
		client.on("producer_closed", (value) => { const event = parseProducerMessage("producer-closed", value); if (event) this.queueOrApply(event); });
		client.on("consumer_closed", (value) => { const id = parseConsumerId(value); if (id) this.deps.consumerManager.removeConsumer(id); });
		client.on("media_control_update", (value) => { const message = parseMediaControlMessage(value); if (message) this.updateMedia(message); });
		client.on("active_speaker", (value) => { const ids = parseActiveSpeakers(value); if (ids) this.state.activeSpeakersChanged?.(ids); });
		client.on("screen_share_stopped", (value) => { const id = parseParticipantId(value); if (id) this.stopScreen(id); });
		client.on("reaction:message", (value) => { const reaction = parseReaction(value); if (reaction) this.state.reactionReceived?.(reaction.fromUser, reaction.reaction); });
		client.on("hand_raised", (value) => { const hand = parseHandChange(value); if (hand) this.state.handChanged?.(hand.participantId, hand.raised, hand.timestamp); });
		client.on("existing_raised_hands", (value) => { const hands = parseRaisedHands(value); if (hands) this.state.handsSynced?.(hands); });
		client.on("chat:message", (value) => { const message = parseChatMessage(value); if (!message) return; const time = Date.parse(message.timestamp || ""); if (!Number.isFinite(time) || time >= this.captureStartedAt) this.state.chatReceived?.({ id: `${message.fromUser || "unknown"}-${message.timestamp || Date.now()}`, participantId: message.fromUser, author: message.fromName || message.fromUser || "Unknown", text: message.message }); });
	}

	private async initialSynchronize(): Promise<void> {
		const participants = await this.deps.sfuClient.getRoomParticipants();
		const participantSnapshot = participants
			.map((participant) => {
				const participantId = participant.participantId || participant.user_id;
				if (!participantId) return null;
				return this.sanitizeParticipant({
					...participant,
					participantId,
					userData: {
						...participant.userData,
						audio_enabled:
							participant.userData?.audio_enabled ??
							participant.audio_enabled ??
							false,
						video_enabled:
							participant.userData?.video_enabled ??
							participant.video_enabled ??
							false,
					},
					audio_enabled:
						participant.userData?.audio_enabled ??
						participant.audio_enabled ??
						false,
					video_enabled:
						participant.userData?.video_enabled ??
						participant.video_enabled ??
						false,
				});
			})
			.filter((participant): participant is ReconciledRecorderParticipant => participant !== null);
		const existing = await this.deps.sfuClient.getExistingProducers();
		const producers: ProducerEvent[] = [];
		for (const value of existing) {
			const producer = parseProducerSnapshot(value);
			if (!producer) continue;
			producers.push({ producerId: producer.id, participantId: producer.participantId, isScreen: producer.isScreen });
		}
		this.reconciliation = reconcileMeetingSnapshot(
			this.reconciliation,
			{ participants: participantSnapshot, producers },
			this.bufferedEvents.splice(0),
		);
		this.deps.participantManager.syncParticipants([...this.reconciliation.participants.values()]);
		if (this.reconciliation.participants.size === 0) this.scheduleRoomEmpty();
		this.initialSync = false;
		for (const event of this.reconciliation.producers.values()) await this.subscribeRequired(event);
	}

	private queueOrApply(event: SyncEvent): void {
		if (this.initialSync) this.bufferedEvents.push(event);
		else this.applySyncEvent(event);
	}
	private applySyncEvent(event: SyncEvent): void {
		const previous = this.reconciliation;
		this.reconciliation = applyMeetingReconciliationEvent(previous, event);
		if (event.type === "participant-joined") {
			const id = event.value.participantId;
			if (!previous.participants.has(id) || previous.departedParticipantIds.has(id)) {
				this.deps.participantManager.addParticipant(this.sanitizeParticipant(event.value));
			}
		} else if (event.type === "participant-left") {
			const id = event.value.participantId;
			if (!previous.departedParticipantIds.has(id)) {
				const removed = this.deps.participantManager.removeParticipant(id);
				if (!removed) this.scheduleRoomEmpty();
			}
		} else if (event.type === "producer-created") {
			if (
				!previous.producers.has(event.value.producerId) &&
				this.reconciliation.producers.has(event.value.producerId)
			) void this.subscribeLive(event.value);
		} else {
			if (!previous.closedProducerIds.has(event.value.producerId)) this.removeProducer(event.value);
		}
	}
	private async subscribeRequired(event: ProducerEvent): Promise<void> {
		if (!this.isCurrentProducer(event) || this.producerClaims.has(event.producerId)) return;
		this.producerClaims.add(event.producerId);
		try {
			if (!this.isCurrentProducer(event)) return;
			const result = await this.deps.mediaManager.subscribeToRemoteProducer(event);
			if (!this.isCurrentProducer(event)) { this.removeProducer(event); return; }
			if (!result) throw new Error(`Initial producer ${event.producerId} did not create a consumer`);
			const attached = this.attachmentPromises.get(event.producerId);
			if (!attached) throw new Error(`Initial producer ${event.producerId} was not attached`);
			await attached;
			if (!this.isCurrentProducer(event)) this.removeProducer(event);
		} finally {
			this.producerClaims.delete(event.producerId);
		}
	}
	private async subscribeLive(event: ProducerEvent): Promise<void> {
		try { await this.subscribeRequired(event); } catch (error) { this.interrupt(error instanceof Error ? error.message : "Media subscription failed"); }
	}
	private isCurrentProducer(event: ProducerEvent): boolean { return this.reconciliation.producers.get(event.producerId) === event; }
	private sanitizeParticipant(p: RecorderParticipantData): RecorderParticipantData { const avatar = trustedAvatar(p.userData?.avatar || p.avatar, this.frappeOrigin); return { ...p, avatar, userData: { ...p.userData, avatar } }; }
	private frappeOrigin = "";
	private removeProducer(event: ProducerEvent): void { for (const c of this.deps.consumerManager.getConsumersByParticipant(event.participantId || "")) if (c.producerId === event.producerId || (event.isScreen && c.isScreen)) this.deps.consumerManager.removeConsumer(c.id); }
	private stopScreen(participantId: string): void { if (!participantId) return; for (const c of this.deps.consumerManager.getScreenShareConsumers().filter((c) => c.participantId === participantId)) this.deps.consumerManager.removeConsumer(c.id); this.state.screenStopped?.(participantId); }
	private updateMedia(data: MediaControlMessage): void { const action = data.action; const update: { audioEnabled?: boolean; videoEnabled?: boolean } = {}; if (typeof action === "object") action.type === "audio" ? update.audioEnabled = action.enabled : update.videoEnabled = action.enabled; else if (action === "mute" || action === "unmute") update.audioEnabled = action === "unmute"; else update.videoEnabled = action === "video_on"; this.deps.participantManager.updateMediaState(data.participantId, update); }
	private interrupt(reason: string): void { if (!this._ready.value && this._interruption.value) return; this._ready.value = false; this._interruption.value = reason; this.bridge.reportInterruption(reason); }
	private withTimeout(promise: Promise<void>, message: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(message)), RecorderSocketController.ATTACHMENT_TIMEOUT_MS);
			promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
		});
	}
	private cleanup(): void {
		if (this.cleaningUp) return;
		this.cleaningUp = true;
		if (this.roomEmptyTimer) clearTimeout(this.roomEmptyTimer);
		void this.deps.mediaManager.cancelPendingSubscriptions();
		this.deps.mediaManager.cleanup();
		this.deps.consumerManager.clear();
		for (const participant of this.deps.participantManager.getAllParticipants()) this.deps.participantManager.removeParticipant(participant.user_id);
		this.deps.videoManager.cleanup();
		this.deps.transportManager.cleanup();
		this.deps.sfuClient.disconnect();
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
	private request(event: string, data: { signature: string } | { roomId: string }): Promise<void> { return new Promise((resolve, reject) => this.channel.emit(event, data, (value) => { const response = parseRequestResponse(value); response?.success ? resolve() : reject(new Error(response?.error || `${event} failed`)); })); }
}

export function trustedAvatar(value: unknown, frappeOrigin: string): string | null {
	if (typeof value !== "string" || !value || !frappeOrigin || value.startsWith("//")) return null;
	try {
		const origin = new URL(frappeOrigin);
		const url = new URL(value, origin);
		if (!["http:", "https:"].includes(origin.protocol) || url.origin !== origin.origin || url.protocol !== origin.protocol || url.pathname.startsWith("/private/")) return null;
		return url.href;
	} catch {
		return null;
	}
}
