import { type ComputedRef, computed, type Ref } from "vue";
import type { Participant } from "../utils/media/ParticipantManager";
import type { PinnedTile } from "./useGridLayout";
import { useResponsiveGrid } from "./useResponsiveGrid";

interface LayoutDeps {
	raisedHands: Ref<Record<string, string>>;
	activeSpeakerIds: Ref<string[]>;
	stableSpeakerIds: Ref<string[]>;
}

interface DisplayParticipantsResult {
	list: Participant[];
	hidden: Participant[];
	extra: number;
}

interface LayoutParticipant extends Participant {
	isVisible: boolean;
	slotIndex: number;
}

interface UseLayoutReturn {
	mode: ComputedRef<"grid" | "sidebar">;
	gridColumns: ComputedRef<number>;
	displayParticipants: ComputedRef<DisplayParticipantsResult>;
	allParticipants: ComputedRef<LayoutParticipant[]>;
	visibleTileCount: ComputedRef<number>;
	hiddenParticipantsTooltip: ComputedRef<string>;
}

interface LayoutOptions {
	localTileCount?: 0 | 1;
}

export function useLayout(
	participants: Ref<Record<string, Participant>>,
	pinnedTiles: Ref<PinnedTile[]>,
	layoutDeps: LayoutDeps,
	extraTiles: Ref<number>,
	options: LayoutOptions = {},
): UseLayoutReturn {
	const localTileCount = options.localTileCount ?? 1;
	const { isMobile, maxColumns, sidebarMaxColumns } = useResponsiveGrid();

	const mode = computed<"grid" | "sidebar">(() =>
		pinnedTiles.value.length > 0 ? "sidebar" : "grid",
	);

	const stripParticipants = computed<Record<string, Participant>>(() => {
		return participants.value;
	});

	const maxVisibleTiles = computed<number>(() => {
		if (mode.value === "sidebar") {
			if (isMobile.value) return 3;
			return sidebarMaxColumns.value * 4;
		}
		return maxColumns.value * 4;
	});

	// ── Slot persistence ──────────────────────────────────────────────────────

	let slotAssignments: Map<string, number> = new Map();
	const lastPromotion = new Map<string, number>();
	let previousPriorities = new Map<string, number>();
	let promotionSequence = 0;

	// ── Priority ──────────────────────────────────────────────────────────────

	const getPriority = (
		p: Participant,
		activeSpeakerSet: Set<string>,
		stableSpeakerSet: Set<string>,
		raisedHands: Record<string, string>,
	): number => {
		const isActive = activeSpeakerSet.has(p.user_id);
		const isStable = stableSpeakerSet.has(p.user_id);
		const hasVideo = !!p.video_enabled;
		const hasHand = !!raisedHands[p.user_id];
		if (isActive && hasVideo) return 0;
		if (isActive) return 1;
		if (hasHand) return 2;
		if (isStable && hasVideo) return 3;
		if (isStable) return 4;
		if (hasVideo) return 5;
		return 6;
	};

	const getPinnedParticipantId = (): string[] =>
		pinnedTiles.value.filter((t) => t.type === "participant").map((t) => t.id);

	const getRemoteCapacity = (
		remoteCount: number,
		pinnedParticipantIds: string[],
	): number => {
		const overlayRemoteCount = pinnedParticipantIds.length;
		const stripRemoteCount = remoteCount - overlayRemoteCount;
		const reserved = localTileCount + extraTiles.value;
		const total = stripRemoteCount + reserved;
		const threshold = maxVisibleTiles.value;

		if (total <= threshold) return remoteCount;

		return Math.min(
			remoteCount,
			Math.max(
				overlayRemoteCount,
				threshold - reserved - 1 + overlayRemoteCount,
			),
		);
	};

	const buildPriorityMap = (
		remotes: Participant[],
		activeSpeakerSet: Set<string>,
		stableSpeakerSet: Set<string>,
		raisedHands: Record<string, string>,
	): Map<string, number> => {
		const priorityMap = new Map<string, number>();
		for (const participant of remotes) {
			priorityMap.set(
				participant.user_id,
				getPriority(
					participant,
					activeSpeakerSet,
					stableSpeakerSet,
					raisedHands,
				),
			);
		}
		return priorityMap;
	};

	const pruneSlotAssignments = (remotes: Participant[]) => {
		const currentIds = new Set(
			remotes.map((participant) => participant.user_id),
		);
		for (const id of slotAssignments.keys()) {
			if (!currentIds.has(id)) slotAssignments.delete(id);
		}
		for (const id of lastPromotion.keys()) {
			if (!currentIds.has(id)) lastPromotion.delete(id);
		}
	};

	const getCurrentlyVisibleIds = (remoteCapacity: number): Set<string> => {
		const currentlyVisible = new Set<string>();
		for (const [id, slot] of slotAssignments.entries()) {
			if (slot < remoteCapacity) currentlyVisible.add(id);
		}
		return currentlyVisible;
	};

	const sortRemotesByPriority = (
		remotes: Participant[],
		priorityMap: Map<string, number>,
		currentlyVisible: Set<string>,
		raisedHands: Record<string, string>,
	): Participant[] => {
		return [...remotes].sort((left, right) => {
			const leftPriority = priorityMap.get(left.user_id) ?? 4;
			const rightPriority = priorityMap.get(right.user_id) ?? 4;
			if (leftPriority !== rightPriority) return leftPriority - rightPriority;

			// Raised hands form the same earliest-first queue as the People panel.
			if (raisedHands[left.user_id] && raisedHands[right.user_id]) {
				const handOrder =
					new Date(raisedHands[left.user_id]).getTime() -
					new Date(raisedHands[right.user_id]).getTime();
				if (handOrder) return handOrder;
			}

			const leftVisible = currentlyVisible.has(left.user_id);
			const rightVisible = currentlyVisible.has(right.user_id);
			if (leftVisible !== rightVisible) return leftVisible ? -1 : 1;

			// Among equally ranked visible tiles, retain the most recently
			// promoted one instead of always evicting the same physical slot.
			if (leftVisible && rightVisible) {
				const promotionOrder =
					(lastPromotion.get(right.user_id) ?? 0) -
					(lastPromotion.get(left.user_id) ?? 0);
				if (promotionOrder) return promotionOrder;
			}

			const leftSlot = slotAssignments.get(left.user_id) ?? 9999;
			const rightSlot = slotAssignments.get(right.user_id) ?? 9999;
			if (leftSlot !== rightSlot) return leftSlot - rightSlot;

			return left.user_id.localeCompare(right.user_id);
		});
	};

	const ensurePinnedParticipantVisible = (
		visibleRemotes: Participant[],
		remotes: Participant[],
		pinnedParticipantIds: string[],
		remoteCapacity: number,
	): Participant[] => {
		if (pinnedParticipantIds.length === 0 || remoteCapacity <= 0)
			return visibleRemotes;

		const newVisible = [...visibleRemotes];

		for (const pinnedId of pinnedParticipantIds) {
			const isPinnedVisible = newVisible.some((p) => p.user_id === pinnedId);

			if (!isPinnedVisible) {
				const pinnedParticipant = remotes.find((p) => p.user_id === pinnedId);
				if (pinnedParticipant) {
					if (newVisible.length >= remoteCapacity) {
						newVisible.pop();
					}
					newVisible.unshift(pinnedParticipant);
				}
			}
		}
		return newVisible;
	};

	const partitionVisibleAndHidden = (
		sortedRemotes: Participant[],
		remoteCapacity: number,
		remotes: Participant[],
		pinnedParticipantId: string[],
	): DisplayParticipantsResult => {
		const visibleRemotes = ensurePinnedParticipantVisible(
			sortedRemotes.slice(0, remoteCapacity),
			remotes,
			pinnedParticipantId,
			remoteCapacity,
		);

		const visibleIds = new Set(
			visibleRemotes.map((participant) => participant.user_id),
		);
		const hidden = sortedRemotes.filter(
			(participant) => !visibleIds.has(participant.user_id),
		);

		return {
			list: visibleRemotes,
			hidden,
			extra: hidden.length,
		};
	};

	const assignStableSlots = (
		visibleRemotes: Participant[],
		slotLimit: number,
	) => {
		const usedSlots = new Set<number>();
		const newSlotAssignments = new Map<string, number>();

		for (const participant of visibleRemotes) {
			const existingSlot = slotAssignments.get(participant.user_id);
			if (
				existingSlot !== undefined &&
				existingSlot < slotLimit &&
				!usedSlots.has(existingSlot)
			) {
				newSlotAssignments.set(participant.user_id, existingSlot);
				usedSlots.add(existingSlot);
			}
		}

		let nextFreeSlot = 0;
		for (const participant of visibleRemotes) {
			if (newSlotAssignments.has(participant.user_id)) continue;
			while (usedSlots.has(nextFreeSlot)) nextFreeSlot++;
			newSlotAssignments.set(participant.user_id, nextFreeSlot);
			usedSlots.add(nextFreeSlot);
			nextFreeSlot++;
		}

		slotAssignments = newSlotAssignments;

		return [...visibleRemotes].sort((left, right) => {
			const leftSlot = newSlotAssignments.get(left.user_id) ?? 999;
			const rightSlot = newSlotAssignments.get(right.user_id) ?? 999;
			return leftSlot - rightSlot;
		});
	};

	// ── Display participants ──────────────────────────────────────────────────

	const displayParticipants = computed<DisplayParticipantsResult>(() => {
		const remotes = Object.values(stripParticipants.value || {});
		const pinnedParticipantIds = getPinnedParticipantId();
		const remoteCapacity = getRemoteCapacity(
			remotes.length,
			pinnedParticipantIds,
		);

		const stableSpeakers = layoutDeps.stableSpeakerIds.value || [];
		const activeSpeakers = layoutDeps.activeSpeakerIds.value || [];
		const activeSpeakerSet = new Set<string>(activeSpeakers);
		const stableSpeakerSet = new Set<string>(stableSpeakers);
		const raisedHands = layoutDeps.raisedHands.value || {};

		const priorityMap = buildPriorityMap(
			remotes,
			activeSpeakerSet,
			stableSpeakerSet,
			raisedHands,
		);
		pruneSlotAssignments(remotes);
		const currentlyVisible = getCurrentlyVisibleIds(remoteCapacity);
		promotionSequence++;
		for (const id of currentlyVisible) {
			const previousPriority = previousPriorities.get(id);
			const currentPriority = priorityMap.get(id);
			if (
				previousPriority !== undefined &&
				currentPriority !== undefined &&
				currentPriority < previousPriority
			) {
				lastPromotion.set(id, promotionSequence);
			}
		}
		const sortedRemotes = sortRemotesByPriority(
			remotes,
			priorityMap,
			currentlyVisible,
			raisedHands,
		);
		const partitioned = partitionVisibleAndHidden(
			sortedRemotes,
			remoteCapacity,
			remotes,
			pinnedParticipantIds,
		);

		for (const participant of partitioned.list) {
			if (!currentlyVisible.has(participant.user_id)) {
				lastPromotion.set(participant.user_id, promotionSequence);
			}
		}
		previousPriorities = priorityMap;

		return {
			...partitioned,
			list: assignStableSlots(partitioned.list, remoteCapacity),
		};
	});

	const visibleTileCount = computed<number>(
		() =>
			localTileCount +
			extraTiles.value +
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0),
	);

	const gridColumns = computed<number>(() => {
		if (mode.value === "sidebar") {
			if (isMobile.value) return 1;
			const pinnedParticipantIds = new Set(getPinnedParticipantId());
			const stripTileCount =
				visibleTileCount.value -
				displayParticipants.value.list.filter((participant) =>
					pinnedParticipantIds.has(participant.user_id),
				).length;
			return Math.min(stripTileCount > 4 ? 2 : 1, sidebarMaxColumns.value);
		}
		const count = visibleTileCount.value;
		if (count <= 0) return 1;
		if (isMobile.value && count === 2) return 1;
		return Math.min(maxColumns.value, Math.ceil(Math.sqrt(count)));
	});

	const allParticipants = computed<LayoutParticipant[]>(() => {
		const { list, hidden } = displayParticipants.value;

		const visible: LayoutParticipant[] = list.map((p, idx) => ({
			...p,
			isVisible: true,
			slotIndex: idx,
		}));

		const invisible: LayoutParticipant[] = hidden.map((p, idx) => ({
			...p,
			isVisible: false,
			slotIndex: list.length + idx,
		}));

		return [...visible, ...invisible];
	});

	const hiddenParticipantsTooltip = computed<string>(() => {
		const hidden = displayParticipants.value.hidden || [];
		if (!hidden.length) return "";
		const names = hidden.map((p) => p.user_name || p.user_id);
		const shown = names.slice(0, 8);
		const remaining = names.length - shown.length;
		if (remaining > 0) return `${shown.join(", ")} and ${remaining} more`;
		if (shown.length === 1) return shown[0];
		if (shown.length === 2) return `${shown[0]} and ${shown[1]}`;
		return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
	});

	return {
		mode,
		gridColumns,
		displayParticipants,
		allParticipants,
		visibleTileCount,
		hiddenParticipantsTooltip,
	};
}
