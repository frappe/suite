import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ConsumerEntry,
	ConsumerManager,
} from "../ConsumerManager";

interface MockConsumerOverrides {
	id?: string;
	producerId?: string;
	kind?: "audio" | "video";
	track?: MediaStreamTrack;
	appData?: { userId: string; type?: string };
	close?: ReturnType<typeof vi.fn>;
	pause?: ReturnType<typeof vi.fn>;
	resume?: ReturnType<typeof vi.fn>;
	once?: ReturnType<typeof vi.fn>;
}

beforeEach(() => {
	vi.clearAllMocks();
});

function createManager() {
	return new ConsumerManager();
}

function mockConsumer(overrides: MockConsumerOverrides = {}) {
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
): asserts entry is ConsumerEntry {
	expect(entry).not.toBe(false);
}

describe("addConsumer", () => {
	it("creates a consumer entry", () => {
		const cm = createManager();
		const entry = cm.addConsumer(mockConsumer());
		assertEntry(entry);
		expect(entry.id).toBe("c1");
		expect(entry.participantId).toBe("p1");
		expect(entry.kind).toBe("video");
	});

	it("returns false for invalid consumer", () => {
		const cm = createManager();
		expect(cm.addConsumer(null as never)).toBe(false);
	});

	it("uses participantIdOverride when provided", () => {
		const cm = createManager();
		const entry = cm.addConsumer(mockConsumer(), "override-id");
		assertEntry(entry);
		expect(entry.participantId).toBe("override-id");
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
		overrides: MockConsumerOverrides = {},
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

		expect(cm.getConsumer("c1")).toBeUndefined();
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

		expect(cm.getConsumer("c1")).toBeUndefined();
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
		expect(entry.producerId).toBe("producer-2");
	});
});
