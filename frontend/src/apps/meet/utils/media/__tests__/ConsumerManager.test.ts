import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsumerManager } from "../ConsumerManager";

beforeEach(() => {
	vi.clearAllMocks();
});

function createManager() {
	return new ConsumerManager();
}

function mockConsumer(overrides: Record<string, unknown> = {}) {
	const consumer = {
		id: "c1",
		producerId: "producer-1",
		kind: "video",
		track: { kind: "video" } as MediaStreamTrack,
		appData: { userId: "p1", type: "camera" },
		close: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		once: vi.fn(),
		...overrides,
	};
	return consumer as never;
}

function assertEntry(
	entry: ReturnType<ConsumerManager["addConsumer"]>,
): asserts entry is NonNullable<ReturnType<ConsumerManager["addConsumer"]>> {
	expect(entry).not.toBe(false);
}

describe("addConsumer", () => {
	it("creates a consumer entry", () => {
		const cm = createManager();
		const entry = cm.addConsumer(mockConsumer());
		assertEntry(entry);
		expect((entry as unknown as { id: string }).id).toBe("c1");
		expect((entry as unknown as { participantId: string }).participantId).toBe(
			"p1",
		);
		expect((entry as unknown as { kind: string }).kind).toBe("video");
	});

	it("returns false for invalid consumer", () => {
		const cm = createManager();
		expect(cm.addConsumer(null as never)).toBe(false);
	});

	it("uses participantIdOverride when provided", () => {
		const cm = createManager();
		const entry = cm.addConsumer(mockConsumer(), "override-id");
		assertEntry(entry);
		expect((entry as unknown as { participantId: string }).participantId).toBe(
			"override-id",
		);
	});

	it("fires onConsumerAdded event", () => {
		const cm = createManager();
		const handler = vi.fn();
		cm.setEventHandlers({ onConsumerAdded: handler });
		cm.addConsumer(mockConsumer());
		expect(handler).toHaveBeenCalled();
	});
});

describe("removeConsumer", () => {
	it("removes consumer and calls close", () => {
		const cm = createManager();
		mockConsumer();
		cm.addConsumer(mockConsumer());
		const removed = cm.removeConsumer("c1");
		expect(removed?.id).toBe("c1");
		expect(cm.getConsumer("c1")).toBeUndefined();
	});

	it("returns undefined for unknown consumer", () => {
		const cm = createManager();
		expect(cm.removeConsumer("nobody")).toBeUndefined();
	});

	it("fires onConsumerRemoved event", () => {
		const cm = createManager();
		const handler = vi.fn();
		cm.setEventHandlers({ onConsumerRemoved: handler });
		cm.addConsumer(mockConsumer());
		cm.removeConsumer("c1");
		expect(handler).toHaveBeenCalledWith("c1", expect.any(Object));
	});
});

describe("query methods", () => {
	it("getConsumer returns by id", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		expect(cm.getConsumer("c1")?.id).toBe("c1");
	});

	it("getAllConsumers returns all entries", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		expect(cm.getAllConsumers()).toHaveLength(2);
	});

	it("getConsumersByParticipant filters correctly", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		cm.addConsumer(mockConsumer({ id: "c3", appData: { userId: "p2" } }));
		expect(cm.getConsumersByParticipant("p1")).toHaveLength(2);
	});

	it("getConsumersByKind filters by kind", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		expect(cm.getConsumersByKind("audio")).toHaveLength(1);
	});

	it("getVideoConsumer excludes screen shares", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(
			mockConsumer({ id: "c3", appData: { userId: "p1", type: "screen" } }),
		);
		const result = cm.getVideoConsumer("p1");
		expect(result?.kind).toBe("video");
		expect(result?.isScreen).toBe(false);
	});

	it("getAudioConsumer returns the audio consumer", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		expect(cm.getAudioConsumer("p1")?.kind).toBe("audio");
	});

	it("getScreenShareConsumers returns screen consumers only", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(
			mockConsumer({
				id: "c3",
				appData: { userId: "p2", type: "screen" },
			}),
		);
		expect(cm.getScreenShareConsumers()).toHaveLength(1);
	});
});

describe("pause / resume consumer", () => {
	it("pauseConsumer calls consumer.pause", async () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		expect(await cm.pauseConsumer("c1")).toBe(true);
	});

	it("resumeConsumer calls consumer.resume", async () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		expect(await cm.resumeConsumer("c1")).toBe(true);
	});

	it("pauseConsumer returns false for unknown consumer", async () => {
		const cm = createManager();
		expect(await cm.pauseConsumer("nobody")).toBe(false);
	});

	it("resumeConsumer returns false for unknown consumer", async () => {
		const cm = createManager();
		expect(await cm.resumeConsumer("nobody")).toBe(false);
	});
});

describe("pauseParticipantConsumers / resumeParticipantConsumers", () => {
	it("pauses all consumers for a participant", async () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		const results = await cm.pauseParticipantConsumers("p1");
		expect(results).toHaveLength(2);
		expect(results.every(Boolean)).toBe(true);
	});

	it("pauses only consumers of the given kind", async () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		const results = await cm.pauseParticipantConsumers("p1", "audio");
		expect(results).toHaveLength(1);
	});

	it("returns empty array for participant with no consumers", async () => {
		const cm = createManager();
		expect(await cm.pauseParticipantConsumers("nobody")).toEqual([]);
	});
});

describe("updateConsumer", () => {
	it("merges updates into consumer entry", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		const updated = cm.updateConsumer("c1", { isScreen: true });
		expect(updated?.isScreen).toBe(true);
		expect(updated?.kind).toBe("video");
	});

	it("returns null for unknown consumer", () => {
		const cm = createManager();
		expect(cm.updateConsumer("nobody", {})).toBeNull();
	});

	it("fires onConsumerUpdated event", () => {
		const cm = createManager();
		const handler = vi.fn();
		cm.setEventHandlers({ onConsumerUpdated: handler });
		cm.addConsumer(mockConsumer());
		cm.updateConsumer("c1", { isScreen: true });
		expect(handler).toHaveBeenCalledWith(
			"c1",
			expect.objectContaining({ isScreen: true }),
			{ isScreen: true },
		);
	});
});

describe("cleanupParticipantConsumers", () => {
	it("removes all consumers for a participant", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		cm.addConsumer(mockConsumer({ id: "c3", appData: { userId: "p2" } }));
		const removed = cm.cleanupParticipantConsumers("p1");
		expect(removed).toHaveLength(2);
		expect(cm.getConsumersByParticipant("p1")).toHaveLength(0);
	});
});

describe("getConsumerStats", () => {
	it("aggregates consumer counts", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		cm.addConsumer(
			mockConsumer({
				id: "c3",
				appData: { userId: "p2", type: "screen" },
			}),
		);
		const stats = cm.getConsumerStats();
		expect(stats.total).toBe(3);
		expect(stats.video).toBe(2);
		expect(stats.audio).toBe(1);
		expect(stats.screenShare).toBe(1);
	});
});

describe("getConsumersByParticipantStats", () => {
	it("groups consumers by participant", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2", kind: "audio" }));
		cm.addConsumer(
			mockConsumer({
				id: "c3",
				appData: { userId: "p2", type: "screen" },
			}),
		);
		const stats = cm.getConsumersByParticipantStats();
		expect(stats.p1?.video).toBe(1);
		expect(stats.p1?.audio).toBe(1);
		expect(stats.p2?.screen).toBe(1);
	});
});

describe("clear", () => {
	it("closes all consumers and clears map", () => {
		const cm = createManager();
		cm.addConsumer(mockConsumer());
		cm.addConsumer(mockConsumer({ id: "c2" }));
		cm.clear();
		expect(cm.getAllConsumers()).toHaveLength(0);
	});

	it("fires onAllConsumersCleared with ids", () => {
		const cm = createManager();
		const handler = vi.fn();
		cm.setEventHandlers({ onAllConsumersCleared: handler });
		cm.addConsumer(mockConsumer());
		cm.clear();
		expect(handler).toHaveBeenCalledWith(["c1"]);
	});
});

describe("consumer @close handling", () => {
	function setupMockConsumerWithClose(
		overrides: Record<string, unknown> = {},
	): {
		consumer: ReturnType<typeof mockConsumer> & {
			once: ReturnType<typeof vi.fn>;
		};
		fire: (event: string) => void;
	} {
		const handlers = new Map<string, () => void>();
		const once = vi.fn((event: string, handler: () => void) => {
			handlers.set(event, handler);
		});
		const consumer = mockConsumer({ once, ...overrides });
		return { consumer, fire: (event: string) => handlers.get(event)?.() };
	}

	it("fires onConsumerLost when consumer emits @close unexpectedly", () => {
		const cm = createManager();
		const { consumer, fire } = setupMockConsumerWithClose();
		const lost = vi.fn();
		cm.setEventHandlers({ onConsumerLost: lost });

		cm.addConsumer(consumer);
		fire("@close");

		expect(lost).toHaveBeenCalledWith({
			consumerId: "c1",
			participantId: "p1",
			producerId: "producer-1",
			kind: "video",
			isScreen: false,
		});
	});

	it("fires onConsumerLost when consumer emits trackended", () => {
		const cm = createManager();
		const { consumer, fire } = setupMockConsumerWithClose();
		const lost = vi.fn();
		cm.setEventHandlers({ onConsumerLost: lost });

		cm.addConsumer(consumer);
		fire("trackended");

		expect(lost).toHaveBeenCalledWith({
			consumerId: "c1",
			participantId: "p1",
			producerId: "producer-1",
			kind: "video",
			isScreen: false,
		});
	});

	it("does not fire onConsumerLost when removeConsumer is the trigger", () => {
		const cm = createManager();
		const { consumer } = setupMockConsumerWithClose();
		const lost = vi.fn();
		cm.setEventHandlers({ onConsumerLost: lost });

		cm.addConsumer(consumer);
		cm.removeConsumer("c1");

		expect(lost).not.toHaveBeenCalled();
	});

	it("does not fire onConsumerLost when clear() is the trigger", () => {
		const cm = createManager();
		const { consumer } = setupMockConsumerWithClose();
		const lost = vi.fn();
		cm.setEventHandlers({ onConsumerLost: lost });

		cm.addConsumer(consumer);
		cm.clear();

		expect(lost).not.toHaveBeenCalled();
	});

	it("captures producerId on the entry", () => {
		const cm = createManager();
		const entry = cm.addConsumer(
			mockConsumer({ id: "c2", producerId: "producer-2" }),
		);
		assertEntry(entry);
		expect((entry as unknown as { producerId: string }).producerId).toBe(
			"producer-2",
		);
	});
});
