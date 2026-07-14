import { afterEach, describe, expect, it, vi } from "vitest";
import { E2EEMeeting } from "../../media/E2EEMeeting";
import { ParticipantManager } from "../../media/ParticipantManager";
import { SFUConnectionManager } from "../SFUConnectionManager";

function createManager({ e2eeRequired = false } = {}) {
	const participantManager = new ParticipantManager();
	const handlers = new Map<string, (data: unknown) => unknown>();
	const sfuClient = {
		connect: vi.fn().mockResolvedValue(undefined),
		getExistingProducers: vi.fn().mockResolvedValue([]),
		getRoomParticipants: vi.fn().mockResolvedValue([]),
		isE2EERequired: vi.fn(() => e2eeRequired),
		joinRoom: vi.fn().mockResolvedValue(undefined),
		on: vi.fn((event: string, handler: (data: unknown) => unknown) => {
			handlers.set(event, handler);
		}),
	};
	const mediaManager = {
		rebuildSendSide: vi.fn().mockResolvedValue({}),
		subscribeToRemoteProducer: vi.fn().mockResolvedValue(undefined),
		processedConsumers: new Set<string>(),
		isScreenShareActive: false,
		mediaHandler: { localStream: null },
		consumerManager: {
			clear: vi.fn(),
			setEventHandlers: vi.fn(),
			getConsumersByParticipant: vi.fn(() => []),
		},
		setEventHandlers: vi.fn(),
	};
	const transportManager = {
		closeReceiveTransport: vi.fn(),
		createReceiveTransport: vi.fn().mockResolvedValue(undefined),
		initializeDevice: vi.fn().mockResolvedValue(undefined),
		initialize: vi.fn(),
		isDeviceLoaded: vi.fn(() => true),
	};
	const manager = new SFUConnectionManager({
		sfuClient: sfuClient as never,
		videoManager: {} as never,
		participantManager,
		transportManager: transportManager as never,
		mediaManager: mediaManager as never,
		recoveryManager: {
			setupTransportEventHandlers: vi.fn(),
			reset: vi.fn(),
		} as never,
	});
	manager.currentUser = { value: { user_id: "me" } };
	return {
		handlers,
		manager,
		mediaManager,
		participantManager,
		sfuClient,
		transportManager,
		recoveryManager: manager.recoveryManager,
	};
}

describe("SFUConnectionManager", () => {
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

	it("rejoins the room and rebuilds media after signaling reconnect", async () => {
		const { manager, mediaManager, sfuClient, transportManager, recoveryManager } =
			createManager();
		manager.initialize("meeting-1", { user_id: "me" });
		await manager.joinRoom(
			{ name: "Me", userId: "me" },
			{ audio_enabled: true, video_enabled: true },
		);

		await manager.rejoinAfterSignalingReconnect();

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
});
