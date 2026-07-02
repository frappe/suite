import { describe, expect, it, vi } from "vitest";
import { ParticipantManager } from "../../media/ParticipantManager";
import { SFUConnectionManager } from "../SFUConnectionManager";

function createManager() {
	const participantManager = new ParticipantManager();
	const handlers = new Map<string, (data: unknown) => unknown>();
	const sfuClient = {
		connect: vi.fn().mockResolvedValue(undefined),
		on: vi.fn((event: string, handler: (data: unknown) => unknown) => {
			handlers.set(event, handler);
		}),
	};
	const mediaManager = {
		subscribeToRemoteProducer: vi.fn().mockResolvedValue(undefined),
		consumerManager: {
			setEventHandlers: vi.fn(),
			getConsumersByParticipant: vi.fn(() => []),
		},
		setEventHandlers: vi.fn(),
	};
	const transportManager = {
		initialize: vi.fn(),
		isDeviceLoaded: vi.fn(() => true),
	};
	const manager = new SFUConnectionManager({
		sfuClient: sfuClient as never,
		videoManager: {} as never,
		participantManager,
		transportManager: transportManager as never,
		mediaManager: mediaManager as never,
		recoveryManager: { setupTransportEventHandlers: vi.fn() } as never,
	});
	manager.currentUser = { value: { user_id: "me" } };
	return { handlers, manager, mediaManager, participantManager };
}

describe("SFUConnectionManager", () => {
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
});
