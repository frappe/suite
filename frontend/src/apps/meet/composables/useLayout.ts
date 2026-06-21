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

interface ContainerStyle {
	display: string;
	"flex-wrap"?: string;
	"justify-content"?: string;
	"align-content"?: string;
	gap?: string;
	overflow?: string;
	"grid-auto-rows"?: string;
	maxHeight?: string;
}

interface TileStyle {
	width?: string;
	height?: string;
	minWidth?: string;
	minHeight?: string;
	marginBottom?: string;
	[key: string]: string | undefined;
}

interface UseLayoutReturn {
	mode: ComputedRef<"grid" | "sidebar">;
	containerStyle: ComputedRef<ContainerStyle>;
	containerClass: ComputedRef<string>;
	tileStyle: ComputedRef<TileStyle>;
	displayParticipants: ComputedRef<DisplayParticipantsResult>;
	allParticipants: ComputedRef<LayoutParticipant[]>;
	visibleTileCount: ComputedRef<number>;
	hiddenParticipantsTooltip: ComputedRef<string>;
	maxVisibleTiles: ComputedRef<number>;
}

/**
 * Layout composable for the video grid.
 *
 * Modes:
 *   - "grid"    (no pinnedTile) — full-width flex grid, 2-4 adaptive columns
 *   - "sidebar" (pinnedTile set) — pinned area fills the main space, participants
 *                                  collapse into a compact tile strip
 *
 * When a participant is pinned they are removed from the tile strip so
 * their video stream can be shown exclusively in the pinned area.
 */
export function useLayout(
	participants: Ref<Record<string, Participant>>,
	pinnedTiles: Ref<PinnedTile[]>,
	layoutDeps: LayoutDeps,
	extraTiles: Ref<number>,
): UseLayoutReturn {
	const { maxColumns, sidebarMaxColumns, windowWidth, BREAKPOINTS } =
		useResponsiveGrid();

	const mode = computed<"grid" | "sidebar">(() =>
		pinnedTiles.value.length > 0 ? "sidebar" : "grid",
	);

	const isMobile = computed(() => windowWidth.value < BREAKPOINTS.md);

	// ── Participants visible in the tile strip ────────────────────────────────
	// All participants stay in the list — the pinned one is positioned absolutely
	// over the pinned panel by MeetingLayout, so no exclusion needed.
	const stripParticipants = computed<Record<string, Participant>>(() => {
		return participants.value;
	});

	// ── Column helpers (grid mode) ────────────────────────────────────────────

	/**
	 * Number of columns = ceil(sqrt(n)), capped at maxCols.
	 *
	 * This gives a naturally square grid that grows its column count only
	 * when it becomes more square to do so:
	 *   n=1→1  n=2-4→2  n=5-9→3  n=10-16→4
	 *
	 * All rows are full (cols tiles) except the last row which holds the
	 * remainder. Natural flex wrapping handles the layout — no break divs
	 * are needed because tile width = (100% - (cols-1)*gap) / cols causes
	 * the container to wrap at exactly cols tiles per row.
	 */
	const getGridColumns = (tileCount: number, maxCols: number): number => {
		if (tileCount <= 0) return 1;
		if (isMobile.value && tileCount === 2) return 1;
		return Math.min(maxCols, Math.ceil(Math.sqrt(tileCount)));
	};

	const getRowDistribution = (
		totalTiles: number,
		maxCols: number,
	): number[] => {
		if (totalTiles <= 0) return [];
		const cols = getGridColumns(totalTiles, maxCols);
		const rows = Math.ceil(totalTiles / cols);
		const remainder = totalTiles % cols;
		return Array.from({ length: rows }, (_, i) =>
			i < rows - 1 || remainder === 0 ? cols : remainder,
		);
	};

	// ── Max visible tiles ─────────────────────────────────────────────────────

	const maxVisibleTiles = computed<number>(() => {
		if (mode.value === "sidebar") {
			if (isMobile.value) return 3;
			return sidebarMaxColumns.value * 4;
		}
		return maxColumns.value * 4;
	});

	// ── Slot persistence ──────────────────────────────────────────────────────
	// Stable slot assignments keep tiles from jumping around when priority changes.

	let slotAssignments: Map<string, number> = new Map();

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
		if (isStable && hasVideo) return 0;
		if (isStable) return 2;
		if (hasVideo) return 3;
		if (hasHand) return 4;
		return 5;
	};

	const getPinnedParticipantId = (): string[] =>
		pinnedTiles.value.filter((t) => t.type === "participant").map((t) => t.id);

	const getRemoteCapacity = (
		remoteCount: number,
		pinnedParticipantIds: string[],
	): number => {
		const overlayRemoteCount = pinnedParticipantIds.length;
		const stripRemoteCount = remoteCount - overlayRemoteCount;
		const reserved = 1 + extraTiles.value;
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
	): Participant[] => {
		return [...remotes].sort((left, right) => {
			const leftPriority = priorityMap.get(left.user_id) ?? 4;
			const rightPriority = priorityMap.get(right.user_id) ?? 4;
			if (leftPriority !== rightPriority) return leftPriority - rightPriority;

			const leftVisible = currentlyVisible.has(left.user_id);
			const rightVisible = currentlyVisible.has(right.user_id);
			if (leftVisible !== rightVisible) return leftVisible ? -1 : 1;

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
		const sortedRemotes = sortRemotesByPriority(
			remotes,
			priorityMap,
			currentlyVisible,
		);
		const partitioned = partitionVisibleAndHidden(
			sortedRemotes,
			remoteCapacity,
			remotes,
			pinnedParticipantIds,
		);

		return {
			...partitioned,
			list: assignStableSlots(partitioned.list, remoteCapacity),
		};
	});

	const visibleTileCount = computed<number>(
		() =>
			1 +
			extraTiles.value +
			displayParticipants.value.list.length +
			(displayParticipants.value.extra > 0 ? 1 : 0),
	);

	// ── Grid mode layout ──────────────────────────────────────────────────────

	const gridTileStyle = computed<TileStyle>(() => {
		const total = visibleTileCount.value;
		const distribution = getRowDistribution(total, maxColumns.value);
		const firstRowCols = distribution[0] || 1;
		const rows = distribution.length || 1;
		// gap is set on the container via CSS gap (not marginBottom) so it only
		// applies between rows — not after the last row. Height formula is exact.
		const gap = "0.5rem";
		return {
			width: `calc((100% - ${firstRowCols - 1} * ${gap}) / ${firstRowCols})`,
			height: `calc((100% - ${rows - 1} * ${gap}) / ${rows})`,
			minWidth: "0",
			minHeight: "0",
		};
	});

	// ── Sidebar mode layout ───────────────────────────────────────────────────

	const sidebarColumns = computed<number>(() => {
		if (isMobile.value) return 1;
		const total = Object.keys(stripParticipants.value || {}).length + 1; // +1 local
		return Math.min(total > 4 ? 2 : 1, sidebarMaxColumns.value);
	});

	const sidebarContainerClass = computed<string>(() => {
		if (isMobile.value) {
			const visible = visibleTileCount.value;
			const cols = Math.min(visible, 3);
			return `w-full grid-cols-${cols} grid-rows-1`;
		}
		const widthClass = sidebarColumns.value === 2 ? "w-72" : "w-64";
		return `${widthClass} grid-cols-${sidebarColumns.value}`;
	});

	const sidebarContainerStyle = computed<ContainerStyle>(() => {
		if (isMobile.value) {
			return { display: "grid", "grid-auto-rows": "1fr", maxHeight: "120px" };
		}

		const visible = visibleTileCount.value;
		const cols = sidebarColumns.value;
		const rows = Math.min(4, Math.ceil(visible / cols));
		const gapTotal = (rows - 1) * 0.5;

		if (cols === 1 && visible <= 4) {
			const perRowBase = `calc((100% - ${visible - 1} * 0.5rem) / ${visible})`;
			return { display: "grid", "grid-auto-rows": `min(25%, ${perRowBase})` };
		}

		return {
			display: "grid",
			"grid-auto-rows":
				rows === 1
					? "min(25%, 1fr)"
					: `min(25%, calc((100% - ${gapTotal}rem) / ${rows}))`,
		};
	});

	// ── Unified outputs ───────────────────────────────────────────────────────

	const containerStyle = computed<ContainerStyle>(() => {
		if (mode.value === "sidebar") return sidebarContainerStyle.value;
		return {
			display: "flex",
			"flex-wrap": "wrap",
			"justify-content": "center",
			"align-content": "start",
			gap: "0.5rem",
			overflow: "hidden",
		};
	});

	const containerClass = computed<string>(() => {
		if (mode.value === "sidebar") return sidebarContainerClass.value;
		return "call-grid";
	});

	// In sidebar mode tiles fill their CSS grid cells so no explicit sizing needed.
	const tileStyle = computed<TileStyle>(() => {
		if (mode.value === "sidebar") return {};
		return gridTileStyle.value;
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
		containerStyle,
		containerClass,
		tileStyle,
		displayParticipants,
		allParticipants,
		visibleTileCount,
		hiddenParticipantsTooltip,
		maxVisibleTiles,
	};
}
