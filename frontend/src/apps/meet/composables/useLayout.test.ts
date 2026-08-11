import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useLayout } from "./useLayout";

vi.mock("./useResponsiveGrid", () => ({
	useResponsiveGrid: () => ({ isMobile: ref(false), maxColumns: ref(1), sidebarMaxColumns: ref(1) }),
}));

describe("useLayout", () => {
	it("uses the tile normally reserved for local media when configured with zero local tiles", () => {
		const participants = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`p${index}`, { user_id: `p${index}`, user_name: `P${index}` }]));
		const deps = { raisedHands: ref({}), activeSpeakerIds: ref<string[]>([]), stableSpeakerIds: ref<string[]>([]) };
		const normal = useLayout(ref(participants) as never, ref([]), deps, ref(0));
		const recorder = useLayout(ref(participants) as never, ref([]), deps, ref(0), { localTileCount: 0 });

		expect(normal.displayParticipants.value.list).toHaveLength(2);
		expect(recorder.displayParticipants.value.list).toHaveLength(4);
		expect(recorder.visibleTileCount.value).toBe(4);
	});
});
