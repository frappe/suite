import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParticipantManager } from "../ParticipantManager";

beforeEach(() => {
	vi.clearAllMocks();
});

function createManager() {
	return new ParticipantManager();
}

function makeParticipantData(overrides: Record<string, unknown> = {}) {
	return {
		participantId: "p1",
		user_id: "p1",
		user_name: "Alice",
		userData: {
			name: "Alice",
			avatar: null,
			audio_enabled: true,
			video_enabled: true,
		},
		...overrides,
	};
}

describe("addParticipant", () => {
	it("creates a participant with resolved fields", () => {
		const pm = createManager();
		const p = pm.addParticipant(makeParticipantData());
		expect(p.user_id).toBe("p1");
		expect(p.user_name).toBe("Alice");
		expect(p.initials).toBe("A");
		expect(p.audio_enabled).toBe(true);
		expect(p.video_enabled).toBe(true);
	});

	it("falls back via name chain (userData.name -> user_name -> participantId)", () => {
		const pm = createManager();
		const p = pm.addParticipant({
			participantId: "p1",
			user_name: "",
		});
		expect(p.initials).toBe("P");
		expect(p.user_name).toBe("");
	});

	it("fires onParticipantAdded event", () => {
		const pm = createManager();
		const handler = vi.fn();
		pm.setEventHandlers({ onParticipantAdded: handler });
		const p = pm.addParticipant(makeParticipantData());
		expect(handler).toHaveBeenCalledWith(p);
	});
});

describe("removeParticipant", () => {
	it("removes participant and returns it", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		const removed = pm.removeParticipant("p1");
		expect(removed?.user_id).toBe("p1");
		expect(pm.hasParticipant("p1")).toBe(false);
	});

	it("returns undefined for unknown participant", () => {
		const pm = createManager();
		expect(pm.removeParticipant("nobody")).toBeUndefined();
	});

	it("fires onParticipantRemoved event", () => {
		const pm = createManager();
		const handler = vi.fn();
		pm.setEventHandlers({ onParticipantRemoved: handler });
		pm.addParticipant(makeParticipantData());
		pm.removeParticipant("p1");
		expect(handler).toHaveBeenCalledWith("p1", expect.any(Object));
	});
});

describe("updateParticipant", () => {
	it("merges updates into participant", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		const updated = pm.updateParticipant("p1", { user_name: "Alice B" });
		expect(updated?.user_name).toBe("Alice B");
		expect(updated?.audio_enabled).toBe(true);
	});

	it("returns null for unknown participant", () => {
		const pm = createManager();
		expect(pm.updateParticipant("nobody", {})).toBeNull();
	});

	it("fires onParticipantUpdated event", () => {
		const pm = createManager();
		const handler = vi.fn();
		pm.setEventHandlers({ onParticipantUpdated: handler });
		pm.addParticipant(makeParticipantData());
		pm.updateParticipant("p1", { user_name: "Bob" });
		expect(handler).toHaveBeenCalledWith(
			"p1",
			expect.objectContaining({ user_name: "Bob" }),
			{ user_name: "Bob" },
		);
	});
});

describe("getParticipant / getAllParticipants / getParticipantsMap", () => {
	it("returns participant by id", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		expect(pm.getParticipant("p1")?.user_name).toBe("Alice");
	});

	it("returns all participants as array", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		pm.addParticipant(
			makeParticipantData({
				participantId: "p2",
				user_id: "p2",
				user_name: "Bob",
			}),
		);
		expect(pm.getAllParticipants()).toHaveLength(2);
	});

	it("returns a copy of the participants map", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		const map = pm.getParticipantsMap();
		expect(map.size).toBe(1);
		map.set("p2", {} as never);
		expect(pm.getParticipantCount()).toBe(1);
	});
});

describe("updateMediaState", () => {
	it("updates audio_enabled", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		pm.updateMediaState("p1", { audioEnabled: false });
		expect(pm.getParticipant("p1")?.audio_enabled).toBe(false);
	});

	it("updates video_enabled", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		pm.updateMediaState("p1", { videoEnabled: false });
		expect(pm.getParticipant("p1")?.video_enabled).toBe(false);
	});

	it("returns null when no updates provided", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		const result = pm.updateMediaState("p1", {});
		expect(result).toBeNull();
	});

	it("returns null for unknown participant", () => {
		const pm = createManager();
		expect(pm.updateMediaState("nobody", { audioEnabled: true })).toBeNull();
	});
});

describe("hasParticipant / getParticipantCount", () => {
	it("checks existence", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData());
		expect(pm.hasParticipant("p1")).toBe(true);
		expect(pm.hasParticipant("p2")).toBe(false);
	});

	it("counts participants", () => {
		const pm = createManager();
		expect(pm.getParticipantCount()).toBe(0);
		pm.addParticipant(makeParticipantData());
		expect(pm.getParticipantCount()).toBe(1);
	});
});

describe("filter methods", () => {
	it("getVideoEnabledParticipants", () => {
		const pm = createManager();
		pm.addParticipant(
			makeParticipantData({ user_id: "p1", userData: { video_enabled: true } }),
		);
		pm.addParticipant(
			makeParticipantData({
				participantId: "p2",
				user_id: "p2",
				userData: { video_enabled: false },
			}),
		);
		expect(pm.getVideoEnabledParticipants()).toHaveLength(1);
	});

	it("getAudioEnabledParticipants", () => {
		const pm = createManager();
		pm.addParticipant(
			makeParticipantData({ user_id: "p1", userData: { audio_enabled: true } }),
		);
		pm.addParticipant(
			makeParticipantData({
				participantId: "p2",
				user_id: "p2",
				userData: { audio_enabled: false },
			}),
		);
		expect(pm.getAudioEnabledParticipants()).toHaveLength(1);
	});
});

describe("generateInitials", () => {
	it("returns UN for empty name", () => {
		const pm = createManager();
		expect(pm.generateInitials("")).toBe("UN");
	});

	it("returns first two initials for multi-word name", () => {
		const pm = createManager();
		expect(pm.generateInitials("Alice Bob")).toBe("AB");
	});

	it("returns single initial for one-word name", () => {
		const pm = createManager();
		expect(pm.generateInitials("Alice")).toBe("A");
	});

	it("handles triple name", () => {
		const pm = createManager();
		expect(pm.generateInitials("John Michael Doe")).toBe("JM");
	});

	it("uppercases initials", () => {
		const pm = createManager();
		expect(pm.generateInitials("alice bob")).toBe("AB");
	});
});

describe("clear", () => {
	it("removes all participants", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData({ participantId: "p1" }));
		pm.addParticipant(makeParticipantData({ participantId: "p2" }));
		pm.clear();
		expect(pm.getParticipantCount()).toBe(0);
	});

	it("fires onAllParticipantsCleared with ids", () => {
		const pm = createManager();
		const handler = vi.fn();
		pm.setEventHandlers({ onAllParticipantsCleared: handler });
		pm.addParticipant(makeParticipantData({ participantId: "p1" }));
		pm.clear();
		expect(handler).toHaveBeenCalledWith(["p1"]);
	});
});

describe("syncParticipants", () => {
	it("adds new participants from server", () => {
		const pm = createManager();
		pm.syncParticipants([
			{ participantId: "p1", user_name: "Alice" },
			{ participantId: "p2", user_name: "Bob" },
		]);
		expect(pm.getParticipantCount()).toBe(2);
	});

	it("updates existing participants", () => {
		const pm = createManager();
		pm.addParticipant(
			makeParticipantData({ participantId: "p1", user_name: "Alice" }),
		);
		pm.syncParticipants([{ participantId: "p1", user_name: "Alice B" }]);
		expect(pm.getParticipant("p1")?.user_name).toBe("Alice B");
	});

	it("removes participants not in server list", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData({ participantId: "p1" }));
		pm.addParticipant(makeParticipantData({ participantId: "p2" }));
		pm.syncParticipants([{ participantId: "p1" }]);
		expect(pm.getParticipantCount()).toBe(1);
		expect(pm.hasParticipant("p2")).toBe(false);
	});

	it("handles empty server list", () => {
		const pm = createManager();
		pm.addParticipant(makeParticipantData({ participantId: "p1" }));
		pm.syncParticipants([]);
		expect(pm.getParticipantCount()).toBe(0);
	});

	it("handles missing participantId by falling back to user_id", () => {
		const pm = createManager();
		pm.syncParticipants([{ user_id: "p1", user_name: "Alice" }]);
		expect(pm.hasParticipant("p1")).toBe(true);
	});
});

describe("setEventHandlers", () => {
	it("merges new handlers with existing", () => {
		const pm = createManager();
		const h1 = vi.fn();
		const h2 = vi.fn();
		pm.setEventHandlers({ onParticipantAdded: h1 });
		pm.setEventHandlers({ onParticipantRemoved: h2 });
		pm.addParticipant(makeParticipantData());
		pm.removeParticipant("p1");
		expect(h1).toHaveBeenCalled();
		expect(h2).toHaveBeenCalled();
	});
});
