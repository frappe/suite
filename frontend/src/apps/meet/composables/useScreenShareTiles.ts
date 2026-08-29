import { computed, type Ref, watch } from "vue";
import { getInitials } from "../utils/text";
import type { GridLayout, PinnedTile } from "./useGridLayout";

interface ScreenShare {
	consumerId: string;
	participantId: string;
	source: "local" | "remote";
}

interface CurrentUser {
	user_id?: string;
	full_name?: string;
	name?: string;
}

export interface ScreenShareTileParticipant {
	user_id: string;
	user_name: string;
	avatar: string;
	initials: string;
	isLocalScreenShare: boolean;
}

export interface ScreenShareTile {
	pinId: string;
	consumerId: string;
	participant: ScreenShareTileParticipant;
}

interface UseScreenShareTilesOptions {
	displayScreenShares: Ref<ScreenShare[]>;
	pinnedTiles: Ref<PinnedTile[]>;
	currentUser: Ref<CurrentUser | null | undefined>;
	gridLayout: GridLayout;
	getParticipantName: (participantId: string) => string;
}

export function useScreenShareTiles({
	displayScreenShares,
	pinnedTiles,
	currentUser,
	gridLayout,
	getParticipantName,
}: UseScreenShareTilesOptions) {
	const screenShareSignature = computed(() =>
		displayScreenShares.value.map((share) => share.participantId).join(","),
	);

	watch(
		screenShareSignature,
		(signature, previousSignature) => {
			const shares = displayScreenShares.value;
			const primaryShareId = shares[0]?.participantId;

			const activePinnedShares = pinnedTiles.value.filter(
				(t) => t.type === "screenshare",
			);
			activePinnedShares.forEach((share) => {
				if (!shares.some((s) => s.participantId === share.id)) {
					gridLayout.unpinTile("screenshare", share.id);
				}
			});

			if (!signature) return;

			const hasNewShare = signature !== previousSignature;

			const isPrimaryPinned = pinnedTiles.value.some(
				(t) => t.type === "screenshare" && t.id === primaryShareId,
			);

			const shouldAutoPin = primaryShareId && (hasNewShare || !isPrimaryPinned);

			if (shouldAutoPin) {
				gridLayout.pinTile("screenshare", primaryShareId);
			}
		},
		{ immediate: true },
	);

	const screenShareTiles = computed<ScreenShareTile[]>(() => {
		return displayScreenShares.value.map((share) => {
			const participantName = getParticipantName(share.participantId);
			const isLocalSharer = share.source === "local";
			const localName = currentUser.value?.full_name || currentUser.value?.name;
			const displayName = `${
				isLocalSharer ? localName : participantName
			}'s screen`;

			return {
				pinId: share.participantId,
				consumerId: share.consumerId,
				participant: {
					user_id: share.participantId,
					user_name: displayName,
					avatar: "",
					initials: getInitials(displayName),
					isLocalScreenShare: isLocalSharer,
				},
			};
		});
	});

	return {
		screenShareTiles,
	};
}
