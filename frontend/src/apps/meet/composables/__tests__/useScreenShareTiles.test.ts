import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { useScreenShareTiles } from "../useScreenShareTiles";

describe("useScreenShareTiles", () => {
	it("keeps tile and pin identity when a screen consumer is replaced", async () => {
		const displayScreenShares = ref([
			{ consumerId: "consumer-1", participantId: "user-1", source: "remote" as const },
		]);
		const pinnedTiles = ref<{ type: "screenshare" | "participant"; id: string }[]>([]);
		const pinTile = vi.fn((type, id) => pinnedTiles.value.push({ type, id }));
		const unpinTile = vi.fn();
		const { screenShareTiles } = useScreenShareTiles({
			displayScreenShares,
			pinnedTiles,
			currentUser: ref(null),
			gridLayout: {
				pinnedTiles,
				displayScreenShares: displayScreenShares as never,
				pinTile,
				unpinTile,
				resetGridLayout: vi.fn(),
			},
			getParticipantName: () => "Alice",
		});

		expect(screenShareTiles.value[0]?.pinId).toBe("user-1");
		displayScreenShares.value = [
			{ consumerId: "consumer-2", participantId: "user-1", source: "remote" },
		];
		await nextTick();

		expect(screenShareTiles.value[0]?.pinId).toBe("user-1");
		expect(pinnedTiles.value).toEqual([{ type: "screenshare", id: "user-1" }]);
		expect(unpinTile).not.toHaveBeenCalled();
	});
});
