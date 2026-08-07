import { describe, expect, it, vi } from "vitest";
import { RecorderSocketController, trustedAvatar } from "./RecorderSocketController";

const config = { job: "j", grant: "g", meetingId: "r", sfuOrigin: "https://sfu.test", frappeOrigin: "https://frappe.test", socketPath: "/socket.io", startedAt: 0 };

function harness(existing: Record<string, unknown>[] = [], subscription: unknown = undefined, state: Record<string, unknown> = {}) {
	const calls: string[] = [];
	const socketHandlers = new Map<string, (...args: unknown[]) => void>();
	const sfuHandlers = new Map<string, (...args: unknown[]) => void>();
	let consumerAdded: ((consumer: Record<string, unknown>) => void) | undefined;
	let participantHandlers: Record<string, (...args: never[]) => void> = {};
	let mediaHandlers: Record<string, (value: unknown) => void> = {};
	const channel = {
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => socketHandlers.set(event, handler)),
		connect: vi.fn(async () => { calls.push("connect"); socketHandlers.get("recording:challenge")?.({ version: 1 }); }),
		emit: vi.fn((event: string, _data: unknown, callback?: (value: unknown) => void) => { calls.push(event); callback?.({ success: true }); }),
		disconnect: vi.fn(), off: vi.fn(), isConnected: vi.fn(), id: vi.fn(), updateAuth: vi.fn(),
	};
	const bridge = { sign: vi.fn(async () => "signature"), reportCaptureReady: vi.fn(), reportInterruption: vi.fn(), reportProofComplete: vi.fn(), reportJoinComplete: vi.fn(), reportFailure: vi.fn() };
	const participants = new Map<string, Record<string, unknown>>();
	const dependencies = {
		sfuClient: { connected: false, connectionDetails: {}, on: vi.fn((event, handler) => sfuHandlers.set(event, handler)), registerEventHandlers: vi.fn(), getRoomParticipants: vi.fn(async () => { calls.push("participants"); return []; }), getExistingProducers: vi.fn(async () => { calls.push("producers"); return existing; }), disconnect: vi.fn() },
		transportManager: { initializeDevice: vi.fn(async () => calls.push("device")), createReceiveTransport: vi.fn(async () => calls.push("recv")), setEventHandlers: vi.fn(), cleanup: vi.fn() },
		consumerManager: { setEventHandlers: vi.fn((handlers) => { consumerAdded = handlers.onConsumerAdded; }), getConsumersByParticipant: vi.fn(() => []), getScreenShareConsumers: vi.fn(() => []), cleanupParticipantConsumers: vi.fn(), clear: vi.fn(), removeConsumer: vi.fn() },
		participantManager: { setEventHandlers: vi.fn((handlers) => { participantHandlers = handlers; }), syncParticipants: vi.fn((values) => values.forEach((p) => participants.set(p.participantId, p))), addParticipant: vi.fn((p) => participants.set(p.participantId || p.user_id, p)), removeParticipant: vi.fn((id) => participants.delete(id)), updateMediaState: vi.fn(), getAllParticipants: vi.fn(() => [...participants.values()]), hasParticipant: vi.fn((id) => participants.has(id)) },
		videoManager: { removeVideoElement: vi.fn(), cleanup: vi.fn() },
		mediaManager: { setEventHandlers: vi.fn((handlers) => { mediaHandlers = handlers; }), handleNewConsumer: vi.fn(async (consumer) => { if (consumer.isScreen) mediaHandlers.onScreenShareStarted?.({ participantId: consumer.participantId, stream: {}, consumer }); }), handleConsumerLost: vi.fn(), subscribeToRemoteProducer: vi.fn(async (event) => { if (subscription === null) return null; const consumer = subscription || { id: `c-${event.producerId}`, producerId: event.producerId, participantId: event.participantId, kind: "audio", isScreen: false }; consumerAdded?.(consumer as Record<string, unknown>); return consumer; }), cancelPendingSubscriptions: vi.fn(async () => undefined), cleanup: vi.fn() },
	};
	const controller = new RecorderSocketController(bridge as never, channel, state, dependencies as never);
	return { calls, channel, bridge, dependencies, sfuHandlers, getParticipantHandlers: () => participantHandlers, participants, controller };
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

	it("tombstones producer closes and participant leaves during snapshots", async () => {
		const h = harness([{ id: "p1", participantId: "alice" }]);
		h.dependencies.sfuClient.getRoomParticipants.mockImplementationOnce(async () => { h.sfuHandlers.get("participant_left")?.({ participantId: "alice" }); h.sfuHandlers.get("producer_closed")?.({ producerId: "p1", participantId: "alice" }); return [{ id: "alice", info: { name: "Alice" } }]; });
		await h.controller.connect(config);
		expect(h.participants.has("alice")).toBe(false);
		expect(h.dependencies.mediaManager.subscribeToRemoteProducer).not.toHaveBeenCalled();
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

	it("defaults missing snapshot media state to off", async () => {
		const h = harness([]);
		h.dependencies.sfuClient.getRoomParticipants.mockResolvedValueOnce([
			{ id: "alice", info: { name: "Alice" } },
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

		h.getParticipantHandlers().onParticipantRemoved?.("alice" as never);
		vi.advanceTimersByTime(5_000);
		h.getParticipantHandlers().onParticipantAdded?.({ user_id: "alice" } as never);
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

	it("reports only failure when initial screen playback is rejected", async () => {
		const consumer = { id: "screen-c1", producerId: "p1", participantId: "alice", kind: "video", isScreen: true };
		const h = harness([{ id: "p1", participantId: "alice", isScreen: true }], consumer, { screenStarted: () => Promise.reject(new Error("screen decoder failed")) });
		await expect(h.controller.connect(config)).rejects.toThrow("screen decoder failed");
		expect(h.bridge.reportFailure).toHaveBeenCalledWith("screen decoder failed");
		expect(h.bridge.reportInterruption).not.toHaveBeenCalled();
	});

	it("rewrites only public avatars on the trusted Frappe origin", () => {
		expect(trustedAvatar("/files/avatar.png", "https://frappe.test")).toBe("https://frappe.test/files/avatar.png");
		expect(trustedAvatar("/files/avatar.png", "http://frappe.test")).toBe("http://frappe.test/files/avatar.png");
		for (const value of ["https://evil.test/a.png", "//evil.test/a.png", "/private/files/a.png", "data:image/png,x"]) expect(trustedAvatar(value, "https://frappe.test")).toBeNull();
	});
});
