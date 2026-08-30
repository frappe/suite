import { afterEach, describe, expect, it, vi } from "vitest";
import { E2EEMeeting } from "../../media/E2EEMeeting";
import { ParticipantManager } from "../../media/ParticipantManager";
import { ParticipantConnection } from "../ParticipantConnection";

function createManager({ e2eeRequired = false } = {}) {
	const participantManager = new ParticipantManager();
	const handlers = new Map<string, (data: unknown) => unknown>();
	const sfuClient = {
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		getExistingProducers: vi.fn().mockResolvedValue([]),
		getRoomParticipants: vi.fn().mockResolvedValue([]),
		isE2EERequired: vi.fn(() => e2eeRequired),
		joinRoom: vi.fn().mockResolvedValue(undefined),
		on: vi.fn((event: string, handler: (data: unknown) => unknown) => {
			handlers.set(event, handler);
		}),
	};
	const mediaManager = {
		cancelPendingSubscriptions: vi.fn(),
		cleanup: vi.fn(),
		rebuildSendSide: vi.fn().mockResolvedValue({}),
		repairLocalPublication: vi.fn().mockResolvedValue(undefined),
		subscribeToRemoteProducer: vi.fn().mockResolvedValue(undefined),
		processedConsumers: new Set<string>(),
		isScreenShareActive: false,
		mediaHandler: { localStream: null },
		consumerManager: {
			clear: vi.fn(),
			setEventHandlers: vi.fn(),
			getConsumersByParticipant: vi.fn(() => []),
			getScreenShareConsumers: vi.fn(() => []),
			removeConsumer: vi.fn(),
		},
		reattachAfterProducerClosed: vi.fn().mockResolvedValue(undefined),
		setEventHandlers: vi.fn(),
	};
	const transportManager = {
		cleanup: vi.fn(),
		closeReceiveTransport: vi.fn(),
		createReceiveTransport: vi.fn().mockResolvedValue(undefined),
		initializeDevice: vi.fn().mockResolvedValue(undefined),
		initialize: vi.fn(),
		isDeviceLoaded: vi.fn(() => true),
	};
	const recoveryManager = {
		setupTransportEventHandlers: vi.fn(),
		reset: vi.fn(),
	};
	const manager = new ParticipantConnection({
		sfuClient: sfuClient as never,
		videoManager: {} as never,
		participantManager,
		transportManager: transportManager as never,
		mediaManager: mediaManager as never,
		recoveryManager: recoveryManager as never,
	});
	vi.spyOn(manager.expectedMedia, "waitForHealthy").mockResolvedValue();
	manager.currentUser = { value: { user_id: "me" } };
	return {
		handlers,
		manager,
		mediaManager,
		participantManager,
		sfuClient,
		transportManager,
		recoveryManager,
	};
}

describe("ParticipantConnection", () => {
	afterEach(() => {
		E2EEMeeting.instance.wipeMeetingContext();
	});

	it("subscribes to remote audio producers", async () => {
		const { handlers, manager, mediaManager, participantManager } = createManager();
		participantManager.addParticipant({
			participantId: "remote-1",
			userData: { name: "Remote", audio_enabled: false },
		});

		await manager.connect("token");
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "audio",
		});

		expect(mediaManager.subscribeToRemoteProducer).toHaveBeenCalledWith({
			participantId: "remote-1",
			producerId: "producer-1",
			isScreen: false,
		});
	});

	it("preserves remote progress while the subscription remains present", async () => {
		const { handlers, manager, mediaManager } = createManager();
		await manager.connect("token");
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "video",
		});
		mediaManager.consumerManager.getConsumersByParticipant.mockReturnValue([
			{
				producerId: "producer-1",
				kind: "video",
				consumer: { closed: false, producerId: "producer-1" },
			},
		]);
		manager.observeRemoteMediaProgress("producer-1", "video", true, true);

		await manager.reconcileExpectedMedia();

		expect(manager.expectedMedia.get("remote:producer-1")).toMatchObject({
			healthySamples: 1,
			flowing: true,
			decoding: true,
		});
	});

	it("repairs a closed local producer when its track remains live", async () => {
		const { manager, mediaManager } = createManager();
		const localStream = {
			getAudioTracks: () => [{ readyState: "live" }],
			getVideoTracks: () => [],
		};
		mediaManager.mediaHandler = {
			localStream,
			audioProducer: {
				closed: true,
				getStats: vi.fn().mockResolvedValue(new Map()),
			},
			videoProducer: null,
			screenProducer: null,
		} as never;

		await manager.reconcileExpectedMedia();

		await vi.waitFor(() =>
			expect(mediaManager.repairLocalPublication).toHaveBeenCalledWith(
				"audio",
				localStream,
			),
		);
	});

	it("verifies local health only when outbound RTP advances", async () => {
		const { manager, mediaManager } = createManager();
		let bytesSent = 100;
		mediaManager.mediaHandler = {
			localStream: {
				getAudioTracks: () => [{ readyState: "live" }],
				getVideoTracks: () => [],
			},
			audioProducer: {
				id: "audio-producer",
				closed: false,
				getStats: vi.fn(async () =>
					new Map([["outbound", { type: "outbound-rtp", bytesSent }]]),
				),
			},
			videoProducer: null,
			screenProducer: null,
		} as never;

		await manager.reconcileExpectedMedia();
		expect(manager.expectedMedia.get("local:microphone")?.healthySamples).toBe(1);
		await manager.reconcileExpectedMedia();
		expect(manager.expectedMedia.get("local:microphone")?.healthySamples).toBe(0);
		bytesSent = 200;
		await manager.reconcileExpectedMedia();
		bytesSent = 300;
		await manager.reconcileExpectedMedia();
		expect(manager.expectedMedia.get("local:microphone")?.healthySamples).toBe(2);
	});

	it("does not require progress from intentionally paused media", async () => {
		const { handlers, manager, mediaManager, participantManager } = createManager();
		participantManager.addParticipant({
			participantId: "remote-1",
			userData: { name: "Remote", video_enabled: true },
		});
		mediaManager.mediaHandler = {
			localStream: {
				getAudioTracks: () => [{ readyState: "live", enabled: false }],
				getVideoTracks: () => [],
			},
			audioProducer: {
				id: "audio-producer",
				closed: false,
				paused: true,
				getStats: vi.fn().mockResolvedValue(new Map()),
			},
			videoProducer: null,
			screenProducer: null,
		} as never;
		mediaManager.consumerManager.getConsumersByParticipant.mockReturnValue([
			{
				producerId: "producer-1",
				kind: "video",
				adaptivelyPaused: false,
				consumer: {
					closed: false,
					paused: false,
					producerPaused: true,
					producerId: "producer-1",
				},
			},
		]);
		await manager.connect("token");
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "video",
		});

		await manager.reconcileExpectedMedia();

		expect(manager.expectedMedia.get("local:microphone")?.desired).toBe(false);
		expect(manager.expectedMedia.get("remote:producer-1")?.desired).toBe(false);
	});

	it("passes the screen-share flag for screen video producers", async () => {
		const { handlers, manager, mediaManager, participantManager } = createManager();
		participantManager.addParticipant({
			participantId: "remote-1",
			userData: { name: "Remote", video_enabled: false },
		});

		await manager.connect("token");
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "screen-producer",
			kind: "video",
			isScreen: true,
		});

		expect(mediaManager.subscribeToRemoteProducer).toHaveBeenCalledWith({
			participantId: "remote-1",
			producerId: "screen-producer",
			isScreen: true,
		});
	});

	it("removes only the screen consumer matching a stopped producer", async () => {
		const { handlers, manager, mediaManager } = createManager();
		const stopped = vi.fn();
		manager.eventHandlers.onScreenShareStopped = stopped;
		const oldScreen = {
			id: "consumer-old",
			participantId: "remote-1",
			producerId: "screen-old",
			isScreen: true,
		};
		const currentScreen = {
			id: "consumer-current",
			participantId: "remote-1",
			producerId: "screen-current",
			isScreen: true,
		};
		mediaManager.consumerManager.getScreenShareConsumers.mockReturnValue([
			oldScreen,
			currentScreen,
		]);
		await manager.connect("token");

		handlers.get("screen_share_stopped")?.({
			participantId: "remote-1",
			producerId: "screen-old",
		});

		expect(mediaManager.consumerManager.removeConsumer).toHaveBeenCalledOnce();
		expect(mediaManager.consumerManager.removeConsumer).toHaveBeenCalledWith(
			"consumer-old",
		);
		expect(stopped).toHaveBeenCalledWith(
			expect.objectContaining({
				participantId: "remote-1",
				producerId: "screen-old",
				consumerId: "consumer-old",
			}),
		);
		expect(mediaManager.isScreenShareActive).toBe(true);
	});

	it("does not remove a screen consumer for another producer", async () => {
		const { handlers, manager, mediaManager } = createManager();
		mediaManager.consumerManager.getScreenShareConsumers.mockReturnValue([
			{
				id: "consumer-current",
				participantId: "remote-1",
				producerId: "screen-current",
				isScreen: true,
			},
		]);
		await manager.connect("token");

		handlers.get("screen_share_stopped")?.({
			participantId: "remote-1",
			producerId: "screen-old",
		});

		expect(mediaManager.consumerManager.removeConsumer).not.toHaveBeenCalled();
		expect(mediaManager.isScreenShareActive).toBe(true);
	});

	it("preserves a replacement screen when the old producer closes late", async () => {
		const { handlers, manager, mediaManager } = createManager();
		const oldScreen = {
			id: "consumer-old",
			participantId: "remote-1",
			producerId: "screen-old",
			isScreen: true,
			consumer: { closed: false, producerId: "screen-old" },
		};
		const replacement = {
			id: "consumer-current",
			participantId: "remote-1",
			producerId: "screen-current",
			isScreen: true,
			consumer: { closed: false, producerId: "screen-current" },
		};
		mediaManager.consumerManager.getConsumersByParticipant.mockReturnValue([
			oldScreen,
			replacement,
		]);
		await manager.connect("token");
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "screen-old",
			kind: "video",
			isScreen: true,
		});
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "screen-current",
			kind: "video",
			isScreen: true,
		});

		handlers.get("producer_closed")?.({
			participantId: "remote-1",
			producerId: "screen-old",
			isScreen: true,
		});

		expect(mediaManager.consumerManager.removeConsumer).toHaveBeenCalledOnce();
		expect(mediaManager.consumerManager.removeConsumer).toHaveBeenCalledWith(
			"consumer-old",
		);
	});

	it("ignores producer events for the current user", async () => {
		const { handlers, manager, mediaManager } = createManager();

		await manager.connect("token");
		await handlers.get("producer_created")?.({
			participantId: "me",
			producerId: "producer-1",
			kind: "audio",
		});

		expect(mediaManager.subscribeToRemoteProducer).not.toHaveBeenCalled();
	});

	it("waits for E2EE context before subscribing to remote producers", async () => {
		const { handlers, manager, mediaManager } = createManager({
			e2eeRequired: true,
		});

		await manager.connect("token");
		const producerPromise = handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "video",
		});

		await Promise.resolve();
		expect(mediaManager.subscribeToRemoteProducer).not.toHaveBeenCalled();

		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);
		await producerPromise;

		expect(mediaManager.subscribeToRemoteProducer).toHaveBeenCalledWith({
			participantId: "remote-1",
			producerId: "producer-1",
			isScreen: false,
		});
	});

	it("claims duplicate producer events before awaiting E2EE", async () => {
		const { handlers, manager, mediaManager } = createManager({
			e2eeRequired: true,
		});
		await manager.connect("token");
		const event = {
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "audio",
		};

		const first = handlers.get("producer_created")?.(event);
		const duplicate = handlers.get("producer_created")?.(event);
		E2EEMeeting.instance.setMeetingContext(
			new Uint8Array(32) as Uint8Array<ArrayBuffer>,
			1,
		);
		await Promise.all([first, duplicate]);

		expect(mediaManager.subscribeToRemoteProducer).toHaveBeenCalledOnce();
	});

	it("replays participant leaves and producer closes over stale snapshots", async () => {
		const { handlers, manager, mediaManager, participantManager, sfuClient } =
			createManager();
		await manager.connect("token");
		sfuClient.getRoomParticipants.mockImplementationOnce(async () => {
			handlers.get("participant_left")?.({ participantId: "remote-1" });
			return [{ participantId: "remote-1", user_id: "remote-1" }];
		});
		sfuClient.getExistingProducers.mockImplementationOnce(async () => {
			handlers.get("producer_closed")?.({
				participantId: "remote-1",
				producerId: "producer-1",
			});
			return [{ id: "producer-1", participantId: "remote-1" }];
		});

		await manager.setupExistingParticipants();

		expect(participantManager.hasParticipant("remote-1")).toBe(false);
		expect(mediaManager.subscribeToRemoteProducer).not.toHaveBeenCalled();
	});

	it("replays live camera state over the initial participant snapshot", async () => {
		const { handlers, manager, participantManager, sfuClient } = createManager();
		await manager.connect("token");
		sfuClient.getRoomParticipants.mockImplementationOnce(async () => {
			handlers.get("media_control_update")?.({
				participantId: "remote-1",
				action: "video_on",
			});
			return [
				{
					participantId: "remote-1",
					user_id: "remote-1",
					userData: { video_enabled: false },
				},
			];
		});

		await manager.setupExistingParticipants();

		expect(participantManager.getParticipant("remote-1")?.video_enabled).toBe(true);
	});

	it("applies camera state received before a participant joins", async () => {
		const { handlers, manager, participantManager } = createManager();
		await manager.connect("token");

		handlers.get("media_control_update")?.({
			participantId: "remote-1",
			action: "video_on",
		});
		handlers.get("participant_joined")?.({
			participantId: "remote-1",
			user_id: "remote-1",
			userData: { video_enabled: false },
		});

		expect(participantManager.getParticipant("remote-1")?.video_enabled).toBe(true);
	});

	it("reattaches a surviving endpoint consumer when one producer closes", async () => {
		const { handlers, manager, mediaManager } = createManager();
		await manager.connect("token");
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "video",
		});
		await handlers.get("producer_created")?.({
			participantId: "remote-1",
			producerId: "producer-2",
			kind: "video",
		});
		const closed = {
			id: "consumer-1",
			participantId: "remote-1",
			producerId: "producer-1",
			kind: "video",
			isScreen: false,
			consumer: { closed: false, producerId: "producer-1" },
		};
		const survivor = {
			id: "consumer-2",
			participantId: "remote-1",
			producerId: "producer-2",
			kind: "video",
			isScreen: false,
			consumer: { closed: false, producerId: "producer-2" },
		};
		let consumers = [closed, survivor];
		mediaManager.consumerManager.getConsumersByParticipant.mockImplementation(
			() => consumers,
		);
		mediaManager.consumerManager.removeConsumer.mockImplementation((id: string) => {
			consumers = consumers.filter((entry) => entry.id !== id);
		});

		handlers.get("producer_closed")?.({
			participantId: "remote-1",
			producerId: "producer-1",
		});

		await vi.waitFor(() =>
			expect(mediaManager.reattachAfterProducerClosed).toHaveBeenCalledWith(
				"remote-1",
				"producer-1",
			),
		);
	});

	it("preserves participant state during producer-only reconciliation", async () => {
		const { manager, participantManager } = createManager();
		participantManager.addParticipant({
			participantId: "remote-1",
			userData: { name: "Remote" },
		});

		await manager.requestExistingProducers();

		expect(participantManager.hasParticipant("remote-1")).toBe(true);
	});

	it("rejoins the room and rebuilds media after signaling reconnect", async () => {
		const { manager, mediaManager, sfuClient, transportManager, recoveryManager } =
			createManager();
		manager.initialize("meeting-1", { user_id: "me" });
		await manager.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);

		await manager.rejoinAfterSignalingReconnect();

		expect(sfuClient.disconnect).toHaveBeenCalledOnce();
		expect(sfuClient.connect).toHaveBeenCalledOnce();
		expect(sfuClient.joinRoom).toHaveBeenNthCalledWith(
			2,
			"meeting-1",
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);
		expect(transportManager.closeReceiveTransport).toHaveBeenCalledTimes(1);
		expect(recoveryManager.reset).toHaveBeenCalledTimes(1);
		expect(transportManager.initializeDevice).toHaveBeenCalledTimes(1);
		expect(transportManager.createReceiveTransport).toHaveBeenCalledTimes(1);
		expect(mediaManager.rebuildSendSide).toHaveBeenCalledTimes(1);
		expect(recoveryManager.setupTransportEventHandlers).toHaveBeenCalledTimes(1);
	});

	it("resubscribes expected remote media on a fresh Participant Connection", async () => {
		const { manager, mediaManager, sfuClient } = createManager();
		manager.initialize("meeting-1", { user_id: "me" });
		await manager.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);
		sfuClient.getExistingProducers.mockResolvedValue([
			{
				id: "producer-1",
				participantId: "remote-1",
				kind: "audio",
				isScreen: false,
			},
		]);

		await manager.rejoinAfterSignalingReconnect();

		expect(mediaManager.subscribeToRemoteProducer).toHaveBeenCalledWith({
			producerId: "producer-1",
			participantId: "remote-1",
			isScreen: false,
		});
	});

	it("uses current live tracks for rejoin media state", async () => {
		const { manager, mediaManager, sfuClient } = createManager();
		mediaManager.mediaHandler.localStream = {
			getAudioTracks: () => [{ readyState: "live" }],
			getVideoTracks: () => [{ readyState: "ended" }],
		};
		manager.initialize("meeting-1", { user_id: "me" });
		await manager.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);

		await manager.rejoinAfterSignalingReconnect();

		expect(sfuClient.joinRoom).toHaveBeenLastCalledWith(
			"meeting-1",
			expect.anything(),
			{ audio_enabled: true, video_enabled: false },
		);
	});

	it("starts a session rebuild when signaling reconnects", async () => {
		const { handlers, manager } = createManager();
		const rejoin = vi
			.spyOn(manager, "rejoinAfterSignalingReconnect")
			.mockResolvedValue(undefined);

		await manager.connect("token");
		handlers.get("reconnect")?.({});

		expect(rejoin).toHaveBeenCalledTimes(1);
	});

	it("cleans up when the meeting moves to another device", async () => {
		const { handlers, manager, sfuClient } = createManager();
		const replaced = vi.fn().mockResolvedValue(undefined);
		manager.eventHandlers.onParticipantConnectionReplaced = replaced;
		await manager.connect("token");

		handlers.get("participant_connection_replaced")?.({ reason: "takeover" });

		await vi.waitFor(() => expect(sfuClient.disconnect).toHaveBeenCalledOnce());
		expect(replaced).toHaveBeenCalledWith({ reason: "takeover" });
		expect(manager.state).toBe("stopped");
	});

	it("ignores replacement events from its own signaling reconnect", async () => {
		const { handlers, manager, sfuClient } = createManager();
		const replaced = vi.fn();
		manager.eventHandlers.onParticipantConnectionReplaced = replaced;
		await manager.connect("token");

		handlers.get("participant_connection_replaced")?.({ reason: "reconnect" });

		expect(replaced).not.toHaveBeenCalled();
		expect(sfuClient.disconnect).not.toHaveBeenCalled();
	});

	it("escalates signaling reconnect exhaustion through the same coordinator", async () => {
		const { handlers, manager } = createManager();
		const escalate = vi.spyOn(manager, "escalateRecovery").mockResolvedValue(true);
		await manager.connect("token");

		handlers.get("reconnect_failed")?.({});

		expect(escalate).toHaveBeenCalledWith({
			scope: "signaling",
			direction: "both",
			reason: "reconnect_failed",
		});
	});

	it("escalates subscription exhaustion through the same coordinator", async () => {
		const { manager, mediaManager } = createManager();
		const escalate = vi.spyOn(manager, "escalateRecovery").mockResolvedValue(true);
		await manager.connect("token");
		const handlers = mediaManager.setEventHandlers.mock.calls.at(-1)?.[0];

		handlers?.onRecoveryExhausted?.();

		expect(escalate).toHaveBeenCalledWith({
			scope: "subscription",
			direction: "recv",
			reason: "retry_limit",
		});
	});

	it("cancels transport recovery before signaling reconnect attempts", async () => {
		const { handlers, manager, recoveryManager } = createManager();

		await manager.connect("token");
		handlers.get("reconnect_attempt")?.({});

		expect(recoveryManager.reset).toHaveBeenCalledTimes(1);
	});

	it("shares one receive reset across concurrent callers", async () => {
		const { manager, mediaManager, sfuClient, transportManager } = createManager();

		await Promise.all([manager.resetReceiveSide(), manager.resetReceiveSide()]);

		expect(transportManager.closeReceiveTransport).toHaveBeenCalledTimes(1);
		expect(mediaManager.cancelPendingSubscriptions).toHaveBeenCalledTimes(1);
		expect(mediaManager.consumerManager.clear).toHaveBeenCalledTimes(1);
		expect(transportManager.createReceiveTransport).toHaveBeenCalledTimes(1);
		expect(sfuClient.getExistingProducers).toHaveBeenCalledTimes(1);
	});

	it("dispatches screen removal before clearing receive consumers", async () => {
		const { manager, mediaManager } = createManager();
		const stopped = vi.fn();
		const screen = {
			id: "screen-consumer",
			participantId: "remote-1",
			producerId: "screen-producer",
			isScreen: true,
			appData: { type: "screen" },
		};
		manager.eventHandlers.onScreenShareStopped = stopped;
		mediaManager.consumerManager.getScreenShareConsumers.mockReturnValue([screen]);
		mediaManager.consumerManager.removeConsumer.mockImplementation((id: string) => {
			const events = mediaManager.consumerManager.setEventHandlers.mock.calls.at(-1)?.[0];
			events?.onConsumerRemoved?.(id, screen);
		});
		await manager.connect("token");

		await manager.resetReceiveSide();

		expect(stopped).toHaveBeenCalledWith(
			expect.objectContaining({
				participantId: "remote-1",
				producerId: "screen-producer",
				consumerId: "screen-consumer",
			}),
		);
		expect(
			mediaManager.consumerManager.removeConsumer.mock.invocationCallOrder[0],
		).toBeLessThan(mediaManager.consumerManager.clear.mock.invocationCallOrder[0]);
	});

	it("fails receive recovery when the producer snapshot fails", async () => {
		const { manager, sfuClient } = createManager();
		sfuClient.getExistingProducers.mockRejectedValue(new Error("snapshot failed"));

		await expect(manager.resetReceiveSide()).rejects.toThrow("snapshot failed");
	});

	it("does not resume receive recovery after disconnect", async () => {
		const { manager, mediaManager, transportManager } = createManager();
		let finishCancellation: () => void = () => {};
		mediaManager.cancelPendingSubscriptions.mockReturnValue(
			new Promise<void>((resolve) => {
				finishCancellation = resolve;
			}),
		);

		const reset = manager.resetReceiveSide();
		await manager.disconnect();
		finishCancellation();
		await reset;

		expect(transportManager.createReceiveTransport).not.toHaveBeenCalled();
	});
});
