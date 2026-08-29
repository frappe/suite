import { type ComputedRef, computed, type Ref, ref } from "vue";
import { useCurrentUser } from "./useCurrentUser";
import type { DisplayScreenShare, MediaState } from "./useMediaState";

export interface PinnedTile {
	type: "screenshare" | "participant";
	id: string;
}

export interface GridLayout {
	pinnedTiles: Ref<PinnedTile[]>;
	displayScreenShares: ComputedRef<DisplayScreenShare[]>;
	pinTile: (type: PinnedTile["type"], id: string) => void;
	unpinTile: (type: PinnedTile["type"], id: string) => void;
	resetGridLayout: () => void;
}

let instance: GridLayout | null = null;

export function useGridLayout(mediaState?: MediaState): GridLayout {
	if (instance) return instance;

	const pinnedTiles = ref<PinnedTile[]>([]);

	const displayScreenShares = computed<DisplayScreenShare[]>(() => {
		if (!mediaState) return [];

		const shares: DisplayScreenShare[] = [];

		for (const share of mediaState.activeScreenShareConsumers) {
			shares.push(share);
		}

		const currentUserStore = useCurrentUser();
		if (
			mediaState.isScreenSharing &&
			currentUserStore.currentUser.value?.user_id
		) {
			shares.push({
				source: "local",
				participantId: currentUserStore.currentUser.value?.user_id as string,
				consumerId: "local-screen",
				startedAt: mediaState.localScreenShareStartedAt || 0,
			});
		}

		return shares.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
	});

	const pinTile = (type: PinnedTile["type"], id: string) => {
		const exists = pinnedTiles.value.some(
			(t) => t.id === id && t.type === type,
		);
		if (!exists) {
			pinnedTiles.value.push({ type, id });
		}
	};

	const unpinTile = (type: PinnedTile["type"], id: string) => {
		pinnedTiles.value = pinnedTiles.value.filter(
			(t) => !(t.id === id && t.type === type),
		);
	};

	const resetGridLayout = () => {
		pinnedTiles.value = [];
	};

	instance = {
		pinnedTiles,
		displayScreenShares,
		pinTile,
		unpinTile,
		resetGridLayout,
	};

	return instance;
}
