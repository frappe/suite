import { describe, expect, it, vi } from "vitest";
import type { Participant, ParticipantData } from "../src/apps/meet/utils/media/ParticipantManager";
import type { RecorderParticipantData, RecorderParticipantUpdate } from "./protocol";
import { RecorderSocketController, trustedAvatar, type RecorderState } from "./RecorderSocketController";
import type { RecorderConfig, RecordingChallenge } from "./rendererBridge";

vi.stubGlobal("MediaStream", class MediaStream {});

const config: RecorderConfig = { job: "j", grant: "g", meetingId: "r", sfuOrigin: "https://sfu.test", frappeOrigin: "https://frappe.test", socketPath: "/socket.io", startedAt: 0 };
const challenge: RecordingChallenge = { version: 1, jti: "jti", socket_id: "socket", nonce: "nonce", issued_at: 1, expires_at: 2 };
type ChallengeFixture = RecordingChallenge | { version: 2 };

interface ProducerFixture {
	id: string;
	participantId: string;
	isScreen?: boolean;
}

interface ConsumerFixture {
	id: string;
	producerId: string;
	participantId: string;
	kind: "audio" | "video";
	isScreen: boolean;
}

interface ParticipantHandlers {
	onParticipantAdded?: (participant: Participant) => void;
	onParticipantRemoved?: (participantId: string) => void;
	onParticipantUpdated?: (participantId: string, participant: Participant, updates: RecorderParticipantUpdate) => void;
}

interface ConsumerHandlers {
	onConsumerAdded?: (consumer: ConsumerFixture) => void;
	onConsumerRemoved?: (consumerId: string, consumer: ConsumerFixture) => void;
}

interface MediaHandlers {
	onScreenShareStarted?: (value: { participantId: string; stream: MediaStream; consumer: ConsumerFixture }) => void;
}

const participantFixture = (data: RecorderParticipantData): Participant => ({
	user_id: data.participantId || data.user_id || "",
	user_name: data.userData?.name || data.user_name || "",
	avatar: data.userData?.avatar || data.avatar || null,
	initials: "",
	audio_enabled: data.userData?.audio_enabled ?? data.audio_enabled,
	video_enabled: data.userData?.video_enabled ?? data.video_enabled,
	is_guest: data.userData?.is_guest ?? data.is_guest,
	participantId: data.participantId,
	userData: data.userData,
});

function harness(existing: ProducerFixture[] = [], subscription?: ConsumerFixture | null, state: RecorderState = {}, challengeFixture: ChallengeFixture = challenge) {
	const calls: string[] = [];
	const socketHandlers = new Map<string, (...args: unknown[]) => void>();
	const sfuHandlers = new Map<string, (...args: unknown[]) => void>();
	let consumerHandlers: ConsumerHandlers = {};
	let participantHandlers: ParticipantHandlers = {};
	let mediaHandlers: MediaHandlers = {};
	const channel = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => socketHandlers.set(event, handler)),
		connect: vi.fn(async () => { calls.push("connect"); socketHandlers.get("recording:challenge")?.(challengeFixture); }),
		emit: vi.fn((event: string, _data: { signature: string } | { roomId: string }, callback?: (value: unknown) => void) => { calls.push(event); callback?.({ success: true }); }),
		disconnect: vi.fn(), off: vi.fn(), isConnected: vi.fn(), id: vi.fn(), updateAuth: vi.fn(),
	};
	const bridge = { sign: vi.fn(async () => "signature"), reportCaptureReady: vi.fn(), reportInterruption: vi.fn(), reportProofComplete: vi.fn(), reportJoinComplete: vi.fn(), reportFailure: vi.fn() };
	const participants = new Map<string, Participant>();
	const consumers = new Map<string, ConsumerFixture>();
	const removeConsumer = vi.fn((id: string) => {
		const consumer = consumers.get(id);
		if (!consumer) return undefined;
		consumers.delete(id);
		consumerHandlers.onConsumerRemoved?.(id, consumer);
		return consumer;
	});
	const dependencies = {
		sfuClient: { connected: false, connectionDetails: {}, on: vi.fn((event: string, handler: (...args: unknown[]) => void) => sfuHandlers.set(event, handler)), registerEventHandlers: vi.fn(), getRoomParticipants: vi.fn(async (): Promise<ParticipantData[]> => { calls.push("participants"); return []; }), getExistingProducers: vi.fn(async () => { calls.push("producers"); return existing; }), disconnect: vi.fn() },
		transportManager: { initializeDevice: vi.fn(async () => calls.push("device")), createReceiveTransport: vi.fn(async () => calls.push("recv")), setEventHandlers: vi.fn(), cleanup: vi.fn() },
		consumerManager: { setEventHandlers: vi.fn((handlers: ConsumerHandlers) => { consumerHandlers = { ...consumerHandlers, ...handlers }; }), getConsumersByParticipant: vi.fn((id: string) => [...consumers.values()].filter((consumer) => consumer.participantId === id)), getScreenShareConsumers: vi.fn(() => [...consumers.values()].filter((consumer) => consumer.isScreen)), cleanupParticipantConsumers: vi.fn((id: string) => { for (const consumer of [...consumers.values()]) if (consumer.participantId === id) removeConsumer(consumer.id); }), clear: vi.fn(() => { for (const consumer of [...consumers.values()]) removeConsumer(consumer.id); }), removeConsumer },
		participantManager: { setEventHandlers: vi.fn((handlers: ParticipantHandlers) => { participantHandlers = handlers; }), syncParticipants: vi.fn((values: RecorderParticipantData[]) => values.forEach((value) => { const participant = participantFixture(value); participants.set(participant.user_id, participant); })), addParticipant: vi.fn((value: RecorderParticipantData) => { const participant = participantFixture(value); participants.set(participant.user_id, participant); participantHandlers.onParticipantAdded?.(participant); return participant; }), removeParticipant: vi.fn((id: string) => { const removed = participants.delete(id); if (removed) participantHandlers.onParticipantRemoved?.(id); return removed; }), updateMediaState: vi.fn(), getAllParticipants: vi.fn(() => [...participants.values()]), hasParticipant: vi.fn((id: string) => participants.has(id)) },
		videoManager: { removeVideoElement: vi.fn(), cancelDeferredAttachment: vi.fn(), cleanup: vi.fn() },
		mediaManager: { setEventHandlers: vi.fn((handlers: MediaHandlers) => { mediaHandlers = handlers; }), handleNewConsumer: vi.fn(async (consumer: ConsumerFixture) => { if (consumer.isScreen) mediaHandlers.onScreenShareStarted?.({ participantId: consumer.participantId, stream: new MediaStream(), consumer }); }), handleConsumerLost: vi.fn(), subscribeToRemoteProducer: vi.fn(async (event: { producerId: string; participantId: string; isScreen: boolean }) => { if (subscription === null) return null; const consumer: ConsumerFixture = subscription || { id: `c-${event.producerId}`, producerId: event.producerId, participantId: event.participantId, kind: event.isScreen ? "video" : "audio", isScreen: event.isScreen }; consumers.set(consumer.id, consumer); consumerHandlers.onConsumerAdded?.(consumer); return consumer; }), cancelPendingSubscriptions: vi.fn(async () => undefined), cleanup: vi.fn() },
	};
	const controller = new RecorderSocketController(bridge as never, channel, state, dependencies as never);
	return { calls, channel, bridge, consumers, dependencies, sfuHandlers, getConsumerHandlers: () => consumerHandlers, getParticipantHandlers: () => participantHandlers, participants, controller };
}

describe("RecorderSocketController", () => {
	it("waits for proof, receive transport, and initial sync before reporting ready", async () => {
		const h = harness();
		await h.controller.connect(config);
		expect(h.calls).toEqual(["connect", "recording:proof", "recording:join", "device", "recv", "participants", "producers"]);
		expect(h.controller.ready.value).toBe(true);
		expect(h.bridge.reportCaptureReady).toHaveBeenCalledOnce();
	});

	it("deduplicates snapshot and live producers during sync", async () => {
		const h = harness([{ id: "p1", participantId: "alice" }]);
		h.dependencies.sfuClient.getExistingProducers.mockImplementationOnce(async () => { h.sfuHandlers.get("producer_created")?.({ producerId: "p1", participantId: "alice" }); return [{ id: "p1", participantId: "alice" }]; });
		await h.controller.connect(config);
		expect(h.dependencies.mediaManager.subscribeToRemoteProducer).toHaveBeenCalledOnce();
	});

	it("claims duplicate live producers synchronously", async () => {
		const h = harness();
		await h.controller.connect(config);

		h.sfuHandlers.get("producer_created")?.({ producerId: "p1", participantId: "alice" });
		h.sfuHandlers.get("producer_created")?.({ producerId: "p1", participantId: "alice" });
		await vi.waitFor(() =>
			expect(h.dependencies.mediaManager.subscribeToRemoteProducer).toHaveBeenCalledOnce(),
		);
	});

	it("tombstones producer closes and participant leaves during snapshots", async () => {
		const h = harness([{ id: "p1", participantId: "alice" }]);
		h.dependencies.sfuClient.getRoomParticipants.mockImplementationOnce(async () => { h.sfuHandlers.get("participant_left")?.({ participantId: "alice" }); h.sfuHandlers.get("producer_closed")?.({ producerId: "p1", participantId: "alice" }); return [{ participantId: "alice", user_id: "alice", userData: { name: "Alice" } }]; });
		await h.controller.connect(config);
		expect(h.participants.has("alice")).toBe(false);
		expect(h.dependencies.mediaManager.subscribeToRemoteProducer).not.toHaveBeenCalled();
	});

	it("does not resurrect old producers when a participant leaves and rejoins", async () => {
		const h = harness([{ id: "old", participantId: "alice" }]);
		h.dependencies.sfuClient.getRoomParticipants.mockResolvedValueOnce([
			{ participantId: "alice", user_id: "alice", userData: { name: "Alice" } },
		]);
		h.dependencies.sfuClient.getExistingProducers.mockImplementationOnce(async () => {
			h.sfuHandlers.get("participant_left")?.({ participantId: "alice" });
			h.sfuHandlers.get("participant_joined")?.({ participantId: "alice" });
			h.sfuHandlers.get("producer_created")?.({ producerId: "new", participantId: "alice" });
			return [{ id: "old", participantId: "alice" }];
		});

		await h.controller.connect(config);

		expect(h.dependencies.mediaManager.subscribeToRemoteProducer).toHaveBeenCalledOnce();
		expect(h.dependencies.mediaManager.subscribeToRemoteProducer).toHaveBeenCalledWith({
			producerId: "new",
			participantId: "alice",
			isScreen: false,
		});
	});

	it("fails readiness when an initial producer returns no consumer", async () => {
		const h = harness([{ id: "p1", participantId: "alice" }], null);
		await expect(h.controller.connect(config)).rejects.toThrow("did not create a consumer");
		expect(h.controller.ready.value).toBe(false);
		expect(h.bridge.reportCaptureReady).not.toHaveBeenCalled();
		expect(h.bridge.reportFailure).toHaveBeenCalled();
		expect(h.bridge.reportInterruption).not.toHaveBeenCalled();
	});

	it("accepts an initial snapshot with no media", async () => {
		const h = harness([]);
		await h.controller.connect(config);
		expect(h.controller.ready.value).toBe(true);
		expect(h.dependencies.mediaManager.subscribeToRemoteProducer).not.toHaveBeenCalled();
	});

	it("rejects a malformed recording challenge", async () => {
		const h = harness([], undefined, {}, { version: 2 });

		await expect(h.controller.connect(config)).rejects.toThrow("Invalid recording challenge");
		expect(h.bridge.sign).not.toHaveBeenCalled();
		expect(h.bridge.reportFailure).toHaveBeenCalledWith("Invalid recording challenge");
	});

	it("defaults missing snapshot media state to off", async () => {
		const h = harness([]);
		h.dependencies.sfuClient.getRoomParticipants.mockResolvedValueOnce([
			{ participantId: "alice", user_id: "alice", userData: { name: "Alice" } },
		]);

		await h.controller.connect(config);

		expect(h.participants.get("alice")).toMatchObject({
			audio_enabled: false,
			video_enabled: false,
		});
	});

	it("reports a room that remains empty when leave races the participant snapshot", async () => {
		vi.useFakeTimers();
		const roomEmpty = vi.fn();
		const h = harness([], undefined, { roomEmpty });
		await h.controller.connect(config);

		h.sfuHandlers.get("participant_left")?.({ participantId: "alice" });
		vi.advanceTimersByTime(9_999);
		expect(roomEmpty).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(roomEmpty).toHaveBeenCalledOnce();
		vi.useRealTimers();
	});

	it("cancels room-empty termination when a participant rejoins during grace", () => {
		vi.useFakeTimers();
		const roomEmpty = vi.fn();
		const h = harness([], undefined, { roomEmpty });

		h.getParticipantHandlers().onParticipantRemoved?.("alice");
		vi.advanceTimersByTime(5_000);
		h.getParticipantHandlers().onParticipantAdded?.({ user_id: "alice", user_name: "Alice", avatar: null, initials: "A" });
		vi.advanceTimersByTime(5_000);

		expect(roomEmpty).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("waits for the renderer to acknowledge an initial screen attachment", async () => {
		let acknowledge!: () => void;
		const screenStarted = vi.fn(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
		const consumer = { id: "screen-c1", producerId: "p1", participantId: "alice", kind: "video", isScreen: true };
		const h = harness([{ id: "p1", participantId: "alice", isScreen: true }], consumer, { screenStarted });
		const connected = h.controller.connect(config);
		await vi.waitFor(() => expect(screenStarted).toHaveBeenCalledOnce());
		expect(h.controller.ready.value).toBe(false);
		acknowledge();
		await connected;
		expect(h.controller.ready.value).toBe(true);
	});

	it("cancels an initial screen attachment removed before mount", async () => {
		vi.useFakeTimers();
		let acknowledge!: () => void;
		const screenStarted = vi.fn(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
		const consumer = { id: "screen-c1", producerId: "p1", participantId: "alice", kind: "video", isScreen: true } as const;
		const h = harness([{ id: "p1", participantId: "alice", isScreen: true }], consumer, { screenStarted });
		const connected = h.controller.connect(config);
		await vi.waitFor(() => expect(screenStarted).toHaveBeenCalledOnce());

		h.sfuHandlers.get("producer_closed")?.({
			producerId: "p1",
			participantId: "alice",
			isScreen: true,
		});

		await connected;
		expect(h.controller.ready.value).toBe(true);
		expect(h.bridge.reportFailure).not.toHaveBeenCalled();
		expect(
			Reflect.get(h.controller, "attachmentPromises").size,
		).toBe(0);
		expect(
			Reflect.get(h.controller, "screenAttachmentPromises").size,
		).toBe(0);
		await vi.advanceTimersByTimeAsync(
			RecorderSocketController.ATTACHMENT_TIMEOUT_MS,
		);
		acknowledge();
		await Promise.resolve();
		expect(h.bridge.reportFailure).not.toHaveBeenCalled();
		expect(h.bridge.reportInterruption).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("cancels a participant attachment removed before its tile mounts", async () => {
		let rejectAttachment!: (error: Error) => void;
		const h = harness();
		await h.controller.connect(config);
		h.dependencies.mediaManager.handleNewConsumer.mockReturnValueOnce(
			new Promise<void>((_resolve, reject) => {
				rejectAttachment = reject;
			}),
		);
		h.sfuHandlers.get("participant_joined")?.({
			participantId: "alice",
			userData: { name: "Alice" },
		});
		h.sfuHandlers.get("producer_created")?.({
			producerId: "camera-1",
			participantId: "alice",
			isScreen: false,
		});
		await vi.waitFor(() =>
			expect(h.dependencies.mediaManager.handleNewConsumer).toHaveBeenCalled(),
		);

		h.sfuHandlers.get("participant_left")?.({ participantId: "alice" });
		await vi.waitFor(() =>
			expect(Reflect.get(h.controller, "attachmentPromises").size).toBe(0),
		);
		expect(
			h.dependencies.videoManager.cancelDeferredAttachment,
		).toHaveBeenCalledWith("alice");
		rejectAttachment(new Error("obsolete attachment failed"));
		await Promise.resolve();
		expect(h.bridge.reportInterruption).not.toHaveBeenCalled();
	});

	it("replaces a participant screen and ignores the old producer's late close", async () => {
		const screenStarted = vi.fn();
		const screenStopped = vi.fn();
		const h = harness([], undefined, { screenStarted, screenStopped });
		await h.controller.connect(config);

		h.sfuHandlers.get("producer_created")?.({
			producerId: "screen-old",
			participantId: "alice",
			isScreen: true,
		});
		await vi.waitFor(() => expect(screenStarted).toHaveBeenCalledTimes(1));
		h.sfuHandlers.get("producer_created")?.({
			producerId: "screen-current",
			participantId: "alice",
			isScreen: true,
		});
		await vi.waitFor(() => expect(screenStarted).toHaveBeenCalledTimes(2));

		expect(screenStopped).toHaveBeenCalledWith("alice", "screen-old");
		screenStopped.mockClear();
		h.sfuHandlers.get("producer_closed")?.({
			producerId: "screen-old",
			participantId: "alice",
			isScreen: true,
		});

		expect(screenStopped).not.toHaveBeenCalled();
		expect(Reflect.get(h.controller, "activeScreens").get("alice")).toEqual({
			consumerId: "c-screen-current",
			producerId: "screen-current",
		});
	});

	it("matches recorder screen stops by participant and producer", async () => {
		const screenStopped = vi.fn();
		const h = harness([], undefined, { screenStopped });
		await h.controller.connect(config);
		h.sfuHandlers.get("producer_created")?.({
			producerId: "screen-1",
			participantId: "alice",
			isScreen: true,
		});
		await vi.waitFor(() =>
			expect(h.dependencies.mediaManager.subscribeToRemoteProducer).toHaveBeenCalled(),
		);
		h.dependencies.consumerManager.removeConsumer.mockClear();

		h.sfuHandlers.get("screen_share_stopped")?.({
			participantId: "bob",
			producerId: "screen-1",
		});

		expect(h.dependencies.consumerManager.removeConsumer).not.toHaveBeenCalled();
		expect(screenStopped).not.toHaveBeenCalled();
	});

	it("ignores an old consumer removal after same-producer resubscription", async () => {
		const screenStopped = vi.fn();
		const h = harness([], undefined, { screenStopped });
		await h.controller.connect(config);
		const oldConsumer = {
			id: "screen-old-consumer",
			producerId: "screen-1",
			participantId: "alice",
			kind: "video",
			isScreen: true,
		} as const;
		const replacement = {
			...oldConsumer,
			id: "screen-new-consumer",
		};
		h.consumers.set(oldConsumer.id, oldConsumer);
		h.getConsumerHandlers().onConsumerAdded?.(oldConsumer);
		await vi.waitFor(() =>
			expect(Reflect.get(h.controller, "activeScreens").get("alice")).toEqual({
				consumerId: oldConsumer.id,
				producerId: oldConsumer.producerId,
			}),
		);
		h.consumers.set(replacement.id, replacement);
		h.getConsumerHandlers().onConsumerAdded?.(replacement);
		await vi.waitFor(() =>
			expect(Reflect.get(h.controller, "activeScreens").get("alice")).toEqual({
				consumerId: replacement.id,
				producerId: replacement.producerId,
			}),
		);
		screenStopped.mockClear();

		h.getConsumerHandlers().onConsumerRemoved?.(oldConsumer.id, oldConsumer);

		expect(screenStopped).not.toHaveBeenCalled();
		expect(Reflect.get(h.controller, "activeScreens").get("alice")).toEqual({
			consumerId: replacement.id,
			producerId: replacement.producerId,
		});
	});

	it("settles active screen state during recorder cleanup", async () => {
		const screenStopped = vi.fn();
		const h = harness([], undefined, { screenStopped });
		await h.controller.connect(config);
		h.sfuHandlers.get("producer_created")?.({
			producerId: "screen-1",
			participantId: "alice",
			isScreen: true,
		});
		await vi.waitFor(() =>
			expect(Reflect.get(h.controller, "activeScreens").has("alice")).toBe(true),
		);

		h.controller.disconnect();

		expect(screenStopped).toHaveBeenCalledWith("alice", "screen-1");
		expect(Reflect.get(h.controller, "activeScreens").size).toBe(0);
		expect(Reflect.get(h.controller, "screenAttachmentPromises").size).toBe(0);
	});

	it("reports only failure when initial screen playback is rejected", async () => {
		const consumer = { id: "screen-c1", producerId: "p1", participantId: "alice", kind: "video", isScreen: true };
		const h = harness([{ id: "p1", participantId: "alice", isScreen: true }], consumer, { screenStarted: () => Promise.reject(new Error("screen decoder failed")) });
		await expect(h.controller.connect(config)).rejects.toThrow("screen decoder failed");
		expect(h.bridge.reportFailure).toHaveBeenCalledWith("screen decoder failed");
		expect(h.bridge.reportInterruption).not.toHaveBeenCalled();
	});

	it("rejects malformed external SFU values without mutating recorder state", async () => {
		const activeSpeakersChanged = vi.fn();
		const h = harness([], undefined, { activeSpeakersChanged });
		await h.controller.connect(config);

		h.sfuHandlers.get("participant_joined")?.({ participantId: 42 });
		h.sfuHandlers.get("producer_created")?.({ producerId: "p1", participantId: null });
		h.sfuHandlers.get("media_control_update")?.({ participantId: "alice", action: { type: "audio", enabled: "yes" } });
		h.sfuHandlers.get("active_speaker")?.({ participantIds: ["alice", 42] });

		expect(h.participants).toHaveLength(0);
		expect(h.dependencies.mediaManager.subscribeToRemoteProducer).not.toHaveBeenCalled();
		expect(h.dependencies.participantManager.updateMediaState).not.toHaveBeenCalled();
		expect(activeSpeakersChanged).not.toHaveBeenCalled();
	});

	it("normalizes valid media controls and preserves precise participant updates", async () => {
		const participantUpdated = vi.fn();
		const h = harness([], undefined, { participantUpdated });
		await h.controller.connect(config);

		h.sfuHandlers.get("media_control_update")?.({ participantId: "alice", action: "unmute" });
		h.sfuHandlers.get("media_control_update")?.({ participantId: "alice", action: { type: "video", enabled: true } });
		h.getParticipantHandlers().onParticipantUpdated?.(
			"alice",
			{ user_id: "alice", user_name: "Alice", avatar: null, initials: "A" },
			{ audio_enabled: true },
		);

		expect(h.dependencies.participantManager.updateMediaState).toHaveBeenNthCalledWith(1, "alice", { audioEnabled: true });
		expect(h.dependencies.participantManager.updateMediaState).toHaveBeenNthCalledWith(2, "alice", { videoEnabled: true });
		expect(participantUpdated).toHaveBeenCalledWith("alice", { audio_enabled: true });
	});

	it("rewrites only public avatars on the trusted Frappe origin", () => {
		expect(trustedAvatar("/files/avatar.png", "https://frappe.test")).toBe("https://frappe.test/files/avatar.png");
		expect(trustedAvatar("/files/avatar.png", "http://frappe.test")).toBe("http://frappe.test/files/avatar.png");
		for (const value of ["https://evil.test/a.png", "//evil.test/a.png", "/private/files/a.png", "data:image/png,x"]) expect(trustedAvatar(value, "https://frappe.test")).toBeNull();
	});
});
