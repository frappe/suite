import { readonly, ref, type Ref } from "vue";
import { ConsumerManager, type ConsumerEntry } from "../src/apps/meet/utils/media/ConsumerManager";
import { ParticipantManager, type Participant, type ParticipantData } from "../src/apps/meet/utils/media/ParticipantManager";
import { SocketIOSignalChannel, type SignalChannel } from "../src/apps/meet/utils/media/SignalChannel";
import { TransportManager } from "../src/apps/meet/utils/media/TransportManager";
import { VideoElementManager } from "../src/apps/meet/utils/media/VideoElementManager";
import { SFUClient } from "../src/apps/meet/utils/SFUClient";
import { SFUMediaManager } from "../src/apps/meet/utils/sfu/SFUMediaManager";
import type { RecorderConfig, RecorderRendererBridge, RecordingChallenge } from "./rendererBridge";

type ProducerEvent = { producerId: string; participantId: string; isScreen?: boolean };
type SyncEvent =
	| { type: "participant-joined"; value: ParticipantData }
	| { type: "participant-left"; value: ParticipantData }
	| { type: "producer-created"; value: ProducerEvent }
	| { type: "producer-closed"; value: ProducerEvent };
type RecorderState = {
	participantAdded?: (participant: Participant) => void;
	participantRemoved?: (participantId: string) => void;
	participantUpdated?: (participantId: string, updates: Record<string, unknown>) => void;
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
	private closedProducers = new Set<string>();
	private departedParticipants = new Set<string>();
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
		this.channel.on("recording:challenge", (...args) => {
			this.bridge.sign(args[0] as RecordingChallenge)
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
			onParticipantUpdated: (id, _p, updates) => this.state.participantUpdated?.(id, updates),
		});
		this.deps.consumerManager.setEventHandlers({
			onConsumerAdded: (consumer) => {
				const attached = this.deps.mediaManager.handleNewConsumer(consumer).then(async () => {
					if (consumer.isScreen) await this.screenAttachmentPromises.get(consumer.id);
				});
				this.attachmentPromises.set(consumer.producerId, attached);
				void attached.catch((error: unknown) => {
					if (this._ready.value) this.interrupt(`Media attachment failed: ${error instanceof Error ? error.message : "unknown error"}`);
				});
			},
			onConsumerRemoved: (_id, consumer) => { if (consumer.isScreen) this.stopScreen(consumer.participantId); },
			onConsumerLost: (info) => void this.deps.mediaManager.handleConsumerLost(info),
		});
		this.deps.mediaManager.setEventHandlers({
			onScreenShareStarted: (value) => {
				const data = value as { participantId: string; stream: MediaStream; consumer: ConsumerEntry };
				const acknowledged = Promise.resolve(this.state.screenStarted?.({ participantId: data.participantId, consumerId: data.consumer.id, stream: data.stream, startedAt: Date.now() }));
				this.screenAttachmentPromises.set(data.consumer.id, this.withTimeout(acknowledged, `Timed out waiting for screen element for ${data.participantId}`));
			},
			onRecoveryExhausted: () => this.interrupt("Media subscription recovery exhausted"),
		});
		this.deps.transportManager.setEventHandlers({ onTransportConnectionStateChange: ({ direction, state }) => {
			if (direction === "recv" && (state === "failed" || state === "disconnected" || state === "closed") && this._ready.value) this.interrupt(`Receive transport ${state}`);
		} });
	}

	private setupSFUEvents(): void {
		const client = this.deps.sfuClient;
		client.on("participant_joined", (value) => this.queueOrApply({ type: "participant-joined", value: value as ParticipantData }));
		client.on("participant_left", (value) => this.queueOrApply({ type: "participant-left", value: value as ParticipantData }));
		client.on("producer_created", (value) => this.queueOrApply({ type: "producer-created", value: value as ProducerEvent }));
		client.on("producer_closed", (value) => this.queueOrApply({ type: "producer-closed", value: value as ProducerEvent }));
		client.on("consumer_closed", (value) => { const id = (value as { consumerId?: string }).consumerId; if (id) this.deps.consumerManager.removeConsumer(id); });
		client.on("media_control_update", (value) => this.updateMedia(value as Record<string, unknown>));
		client.on("active_speaker", (value) => this.state.activeSpeakersChanged?.((value as { participantIds?: string[] }).participantIds || []));
		client.on("screen_share_stopped", (value) => this.stopScreen((value as { participantId?: string }).participantId || ""));
		client.on("reaction:message", (value) => { const d = value as { fromUser?: string; reaction?: string }; if (d.fromUser && d.reaction) this.state.reactionReceived?.(d.fromUser, d.reaction); });
		client.on("hand_raised", (value) => { const d = value as { participantId?: string; raised?: boolean; timestamp?: string }; if (d.participantId) this.state.handChanged?.(d.participantId, !!d.raised, d.timestamp || new Date().toISOString()); });
		client.on("existing_raised_hands", (value) => this.state.handsSynced?.((value as { hands?: Record<string, string> }).hands || {}));
		client.on("chat:message", (value) => { const d = value as { fromUser?: string; fromName?: string; message?: string; timestamp?: string }; const time = Date.parse(d.timestamp || ""); if (d.message && (!Number.isFinite(time) || time >= this.captureStartedAt)) this.state.chatReceived?.({ id: `${d.fromUser || "unknown"}-${d.timestamp || Date.now()}`, participantId: d.fromUser, author: d.fromName || d.fromUser || "Unknown", text: d.message }); });
	}

	private async initialSynchronize(): Promise<void> {
		const participants = await this.deps.sfuClient.getRoomParticipants() as Record<string, unknown>[];
		this.deps.participantManager.syncParticipants(participants.map((p) => this.snapshotParticipant(p)).filter((p) => !this.departedParticipants.has(p.participantId || "")));
		const existing = await this.deps.sfuClient.getExistingProducers();
		const producers = new Map<string, ProducerEvent>();
		for (const value of existing as Record<string, unknown>[]) {
			const event = { producerId: value.id as string, participantId: (value.participantId || value.user_id || value.userId) as string, isScreen: !!value.isScreen };
			if (!this.closedProducers.has(event.producerId) && !this.departedParticipants.has(event.participantId)) producers.set(event.producerId, event);
		}
		while (this.bufferedEvents.length) for (const event of this.bufferedEvents.splice(0)) this.applySyncEvent(event, producers);
		this.initialSync = false;
		for (const event of producers.values()) await this.subscribeRequired(event);
	}

	private queueOrApply(event: SyncEvent): void {
		if (this.initialSync) this.bufferedEvents.push(event);
		else this.applySyncEvent(event);
	}
	private applySyncEvent(event: SyncEvent, producers?: Map<string, ProducerEvent>): void {
		if (event.type === "participant-joined") {
			const id = event.value.participantId || event.value.user_id || "";
			this.departedParticipants.delete(id);
			this.deps.participantManager.addParticipant(this.sanitizeParticipant(event.value));
		} else if (event.type === "participant-left") {
			const id = event.value.participantId || event.value.user_id || "";
			this.departedParticipants.add(id);
			const removed = this.deps.participantManager.removeParticipant(id);
			if (!removed) this.scheduleRoomEmpty();
			if (producers) for (const [producerId, producer] of producers) if (producer.participantId === id) { producers.delete(producerId); this.closedProducers.add(producerId); }
		} else if (event.type === "producer-created") {
			this.closedProducers.delete(event.value.producerId);
			if (!this.departedParticipants.has(event.value.participantId)) producers ? producers.set(event.value.producerId, event.value) : void this.subscribeLive(event.value);
		} else {
			this.closedProducers.add(event.value.producerId);
			producers?.delete(event.value.producerId);
			this.removeProducer(event.value);
		}
	}
	private async subscribeRequired(event: ProducerEvent): Promise<void> {
		if (this.closedProducers.has(event.producerId) || this.departedParticipants.has(event.participantId)) return;
		const result = await this.deps.mediaManager.subscribeToRemoteProducer(event);
		if (this.closedProducers.has(event.producerId) || this.departedParticipants.has(event.participantId)) { this.removeProducer(event); return; }
		if (!result) throw new Error(`Initial producer ${event.producerId} did not create a consumer`);
		const attached = this.attachmentPromises.get(event.producerId);
		if (!attached) throw new Error(`Initial producer ${event.producerId} was not attached`);
		await attached;
	}
	private async subscribeLive(event: ProducerEvent): Promise<void> {
		try { await this.subscribeRequired(event); } catch (error) { this.interrupt(error instanceof Error ? error.message : "Media subscription failed"); }
	}
	private snapshotParticipant(p: Record<string, unknown>): ParticipantData {
		const info = (p.info || {}) as Record<string, unknown>;
		return this.sanitizeParticipant({
			participantId: (p.user_id || p.id) as string,
			user_id: (p.user_id || p.id) as string,
			user_name: (info.name || info.user_name || p.user_id || "") as string,
			avatar: info.avatar as string | null,
			audio_enabled:
				typeof info.audio_enabled === "boolean" ? info.audio_enabled : false,
			video_enabled:
				typeof info.video_enabled === "boolean" ? info.video_enabled : false,
			is_guest: Boolean(info.is_guest),
			userData: info,
		});
	}
	private sanitizeParticipant(p: ParticipantData): ParticipantData { const avatar = trustedAvatar(p.userData?.avatar || p.avatar, this.frappeOrigin); return { ...p, avatar, userData: { ...p.userData, avatar } }; }
	private frappeOrigin = "";
	private removeProducer(event: ProducerEvent): void { for (const c of this.deps.consumerManager.getConsumersByParticipant(event.participantId || "")) if (c.producerId === event.producerId || (event.isScreen && c.isScreen)) this.deps.consumerManager.removeConsumer(c.id); }
	private stopScreen(participantId: string): void { if (!participantId) return; for (const c of this.deps.consumerManager.getScreenShareConsumers().filter((c) => c.participantId === participantId)) this.deps.consumerManager.removeConsumer(c.id); this.state.screenStopped?.(participantId); }
	private updateMedia(data: Record<string, unknown>): void { const action = data.action as { type?: string; enabled?: boolean } | string; const update: { audioEnabled?: boolean; videoEnabled?: boolean } = {}; if (typeof action === "object") action.type === "audio" ? update.audioEnabled = !!action.enabled : action.type === "video" ? update.videoEnabled = !!action.enabled : undefined; else if (action === "mute" || action === "unmute") update.audioEnabled = action === "unmute"; else if (action === "video_on" || action === "video_off") update.videoEnabled = action === "video_on"; this.deps.participantManager.updateMediaState(data.participantId as string, update); }
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
	private request(event: string, data: unknown): Promise<void> { return new Promise((resolve, reject) => this.channel.emit(event, data, (value) => { const response = value as { success?: boolean; error?: string }; response?.success ? resolve() : reject(new Error(response?.error || `${event} failed`)); })); }
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
