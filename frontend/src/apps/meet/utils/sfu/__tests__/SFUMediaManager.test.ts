import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFUMediaManager } from "../SFUMediaManager";

type MockTransportManager = {
	createConsumer: ReturnType<typeof vi.fn>;
};
type MockParticipantManager = {
	hasParticipant: ReturnType<typeof vi.fn>;
};

function createManager(
	opts: { currentUserId?: string | null; hasParticipant?: boolean } = {},
): {
	mediaManager: SFUMediaManager;
	transportManager: MockTransportManager;
	videoManager: { attachStream: ReturnType<typeof vi.fn> };
	consumerManager: { addConsumer: ReturnType<typeof vi.fn> };
	participantManager: MockParticipantManager;
} {
	const transportManager: MockTransportManager = {
		createConsumer: vi.fn().mockResolvedValue({
			id: "new-c1",
			producerId: "producer-1",
			kind: "video",
			track: { kind: "video" },
			appData: { type: "camera" },
		}),
	};

	const videoManager = {
		attachStream: vi.fn(),
	};

	const consumerManager = {
		addConsumer: vi.fn((c) => ({
			id: c.id,
			producerId: c.producerId,
			kind: c.kind,
			track: c.track,
		})),
	};

	const participantManager: MockParticipantManager = {
		hasParticipant: vi.fn().mockReturnValue(opts.hasParticipant ?? true),
	};

	const getCurrentUserId = vi.fn().mockReturnValue(opts.currentUserId ?? "me");

	const mediaManager = new SFUMediaManager(
		{
			transportManager: transportManager as never,
			videoManager: videoManager as never,
			consumerManager: consumerManager as never,
			participantManager: participantManager as never,
		},
		getCurrentUserId,
	);

	return {
		mediaManager,
		transportManager,
		videoManager,
		consumerManager,
		participantManager,
	};
}

describe("SFUMediaManager.handleConsumerLost", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const baseInfo = {
		consumerId: "lost-c1",
		participantId: "remote-1",
		producerId: "producer-1",
		kind: "video",
		isScreen: false,
	};

	it("re-subscribes to the same producer after the debounce delay", async () => {
		const { mediaManager, transportManager } = createManager();
		await mediaManager.handleConsumerLost(baseInfo);

		expect(transportManager.createConsumer).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(250);

		expect(transportManager.createConsumer).toHaveBeenCalledTimes(1);
		expect(transportManager.createConsumer).toHaveBeenCalledWith(
			"producer-1",
			expect.objectContaining({ isScreen: false }),
		);
	});

	it("does not re-subscribe if the participant has left", async () => {
		const { mediaManager, transportManager } = createManager({
			hasParticipant: false,
		});
		await mediaManager.handleConsumerLost(baseInfo);

		await vi.advanceTimersByTimeAsync(1000);
		expect(transportManager.createConsumer).not.toHaveBeenCalled();
	});

	it("does not re-subscribe to its own consumer", async () => {
		const { mediaManager, transportManager } = createManager({
			currentUserId: "remote-1",
		});
		await mediaManager.handleConsumerLost(baseInfo);

		await vi.advanceTimersByTimeAsync(1000);
		expect(transportManager.createConsumer).not.toHaveBeenCalled();
	});

	it("does not re-subscribe without a producerId", async () => {
		const { mediaManager, transportManager } = createManager();
		await mediaManager.handleConsumerLost({
			...baseInfo,
			producerId: "",
		});

		await vi.advanceTimersByTimeAsync(1000);
		expect(transportManager.createConsumer).not.toHaveBeenCalled();
	});

	it("caps retries at 3, then resets and tries again on the next lost event", async () => {
		const { mediaManager, transportManager } = createManager();
		transportManager.createConsumer.mockRejectedValue(new Error("server down"));

		for (let i = 0; i < 3; i++) {
			await mediaManager.handleConsumerLost(baseInfo);
			await vi.advanceTimersByTimeAsync(250);
		}
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(3);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(3);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(4);

		for (let i = 0; i < 2; i++) {
			await mediaManager.handleConsumerLost(baseInfo);
			await vi.advanceTimersByTimeAsync(250);
		}
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(6);
	});

	it("treats a successful re-subscribe as a fresh retry budget", async () => {
		const { mediaManager, transportManager } = createManager();

		transportManager.createConsumer.mockResolvedValue({
			id: "new-c1",
			producerId: "producer-1",
			kind: "video",
			track: { kind: "video" },
			appData: { type: "camera" },
		});

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(1);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(2);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(3);

		await mediaManager.handleConsumerLost(baseInfo);
		await vi.advanceTimersByTimeAsync(250);
		expect(transportManager.createConsumer).toHaveBeenCalledTimes(4);
	});
});
