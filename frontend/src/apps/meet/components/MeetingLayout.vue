<template>
	<div
		ref="container"
		class="flex-1 min-h-0"
		data-testid="meeting-layout"
		:class="
			mode === 'sidebar'
				? 'relative flex flex-col sm:flex-row overflow-hidden mb-2'
				: 'relative h-full'
		"
	>
		<!-- ── Pinned area (empty placeholder; the pinned tile will be rendered here) ─────────────────── -->
		<div
            v-if="mode === 'sidebar' && pinnedTiles.length > 0"
            class="relative flex-1 sm:flex-1 flex gap-3 min-h-0 pointer-events-none"
        >
            <div
                v-for="tile in pinnedTiles"
                :key="`${tile.type}-${tile.id}`"
                :ref="(el) => setPinnedPanelRef(el, tile)"
                class="relative rounded-lg overflow-hidden flex-1 h-full"
            ></div>
        </div>

		<!-- ── Tile strip / full grid ─────────────────────────────────────── -->
		<TransitionGroup
			:name="isFlipAnimating ? '' : 'tile'"
			tag="div"
			class="h-full"
			:class="[
				mode === 'sidebar'
					? `grid gap-2 mt-3 sm:mt-0 sm:ml-3 ${containerClass}`
					: 'relative call-grid',
			]"
			:style="containerStyle"
		>
			<!-- Local camera tile -->
			<ParticipantTile
				:key="`local-${localParticipant.user_id}`"
				:participant="localParticipant"
				:isLocal="true"
				:isVideoEnabled="isCameraOn"
				:isAudioEnabled="isMicOn"
				:isActiveSpeaker="activeSpeakerIds.includes(localParticipant.user_id)"
				:videoRef="setLocalVideoRef"
				:tileCount="visibleTileCount"
				:showReaction="pinnedTiles.length===0"
				:style="tileStyle"
			/>

			<ParticipantTile
				v-for="shareTile in allScreenShareTiles"
				:key="shareTile.pinId"
				v-bind="getScreenShareTileBindings(shareTile)"
			/>

			<!-- Remote participants -->
			<template
				v-for="participant in allParticipants"
				:key="`group-${participant.user_id}`"
			>
				<ParticipantTile
					v-bind="getParticipantTileBindings(participant)"
				/>
			</template>

			<!-- Overflow tile -->
			<GroupTile
				v-if="displayParticipants.extra > 0"
				key="layout-group"
				:count="displayParticipants.extra"
				:tooltip="hiddenParticipantsTooltip"
				:participants="displayParticipants.hidden"
				:size="mode === 'sidebar' ? 'small' : 'medium'"
				:style="tileStyle"
				@click="emit('open-people-panel')"
			/>
		</TransitionGroup>

		<!-- Floating reactions -->
		<FloatingReactions
			class="!z-[60]"
			:reactions="floatingReactions"
			:container-ref="container"
		/>
	</div>
</template>

<script setup lang="ts">
import { type ComputedRef, computed, inject, ref, watch } from "vue";
import { useLayout } from "../composables/useLayout";
import { useMeetingContext } from "../composables/useMeetingContext";
import { usePinnedTileAnimation } from "../composables/usePinnedTileAnimation";
import { useScreenShareTiles } from "../composables/useScreenShareTiles";
import { useTileAdaptiveStreaming } from "../composables/useTileAdaptiveStreaming";
import type { Participant } from "../utils/media/ParticipantManager";
import { getInitials } from "../utils/text";
import FloatingReactions from "./FloatingReactions.vue";
import GroupTile from "./GroupTile.vue";
import ParticipantTile from "./ParticipantTile.vue";

const emit = defineEmits<{
	"open-people-panel": [];
}>();

const meetingCtx = useMeetingContext();
const setLocalVideoRef = inject<(el: unknown) => void>("setLocalVideoRef");
const setRemoteVideoRef =
	inject<(participantId: string, el: HTMLVideoElement | null) => void>(
		"setRemoteVideoRef",
	);
const setScreenShareVideoRef = inject<(el: HTMLVideoElement | null) => void>(
	"setScreenShareVideoRef",
);
const getParticipantName =
	inject<(participantId: string) => string>("getParticipantName") ||
	(() => "Unknown");

const { registerTile } = useTileAdaptiveStreaming();

const container = ref<HTMLElement | null>(null);
const pinnedPanelsMap = ref<Record<string, HTMLElement>>({});

const setPinnedPanelRef = (el: unknown, tile: { type: string; id: string }) => {
	const key = `${tile.type}-${tile.id}`;
	if (el) {
		pinnedPanelsMap.value[key] = el as HTMLElement;
	} else {
		delete pinnedPanelsMap.value[key];
	}
};

// Cache ref handlers to avoid UI flicker
const videoRefHandlers = new Map<string, (el: unknown) => void>();
const getRemoteVideoRef = (participantId: string): ((el: unknown) => void) => {
	if (!videoRefHandlers.has(participantId)) {
		videoRefHandlers.set(participantId, (el: unknown) => {
			setRemoteVideoRef(participantId, el as HTMLVideoElement | null);
			registerTile(participantId, el as HTMLVideoElement | null);
		});
	}
	return videoRefHandlers.get(participantId);
};

// ── Reactive state from meeting context ───────────────────────────────────────

const participants = computed(
	() => meetingCtx.participantStore.participants,
) as ComputedRef<Record<string, Participant>>;
const currentUser = computed(() => meetingCtx.currentUser.currentUser.value);
const isCameraOn = computed(() => meetingCtx.mediaState.isCameraOn);
const isMicOn = computed(() => meetingCtx.mediaState.isMicOn);
const activeSpeakerIds = computed(
	() => meetingCtx.participantStore.activeSpeakerIds,
);
const pinnedTiles = computed(() => meetingCtx.gridLayout.pinnedTiles.value);
const displayScreenShares = computed(
	() => meetingCtx.gridLayout.displayScreenShares.value,
);

// ── Pinned area data ──────────────────────────────────────────────────────────

// Unpin when the pinned participant leaves
watch(
	() => pinnedTiles.value.filter((t) => t.type === "participant"),
	(pinnedParticipantTiles) => {
		pinnedParticipantTiles.forEach((pTile) => {
			if (!participants.value[pTile.id]) {
				meetingCtx.gridLayout.unpinTile(pTile.type, pTile.id);
			}
		});
	},
	{ deep: true },
);

// ── Pin helpers ───────────────────────────────────────────────────────────────

const isPinnedParticipant = (userId) =>
	pinnedTiles.value.some((t) => t.type === "participant" && t.id === userId);

const isPinnedScreenShare = (pinId) =>
	pinnedTiles.value.some((t) => t.type === "screenshare" && t.id === pinId);

const { screenShareTiles: allScreenShareTiles } = useScreenShareTiles({
	displayScreenShares,
	pinnedTiles,
	currentUser,
	gridLayout: meetingCtx.gridLayout,
	getParticipantName,
});

const getScreenShareTileBindings = (shareTile: {
	pinId: string;
	participant:
		| Record<string, unknown>
		| { user_id: string; user_name: string; avatar: string };
}) => {
	const isPinned = isPinnedScreenShare(shareTile.pinId);
	const wrappedVideoRef = setScreenShareVideoRef
		? (el: unknown) => setScreenShareVideoRef(el as HTMLVideoElement | null)
		: undefined;

	return {
		participant: shareTile.participant as unknown as Participant,
		isLocal: false,
		isVideoEnabled: true,
		isAudioEnabled: false,
		videoRef: wrappedVideoRef,
		tileCount: isPinned ? 1 : visibleTileCount.value,
		class: isPinned ? "pinned-tile" : undefined,
		style: isPinned
			? pinnedTileStyles.value[`screenshare-${shareTile.pinId}`]
			: tileStyle.value,
		pinType: "screenshare" as const,
		pinId: shareTile.pinId,
		labelSize: isPinned ? ("sm" as const) : undefined,
		labelPosition: isPinned ? ("top-left" as const) : undefined,
		videoObjectFitClass: isPinned ? "object-contain" : undefined,
		videoBackgroundClass: isPinned ? "bg-gray-900" : undefined,
		tileBackgroundClass: isPinned ? "bg-black" : undefined,
		showAvatar: !isPinned,
		showReaction: !isPinned,
		showRaisedHand: !isPinned,
		showAudioState: !isPinned,
		showNetworkState: !isPinned,
	};
};

const getParticipantTileBindings = (
	participant: Participant & { isVisible: boolean },
) => {
	const isPinned = isPinnedParticipant(participant.user_id);

	return {
		class: {
			"hidden-tile": !participant.isVisible && !isPinned,
			"pinned-tile": isPinned,
		},
		participant,
		isLocal: false,
		isVideoEnabled: participant.video_enabled,
		isAudioEnabled: participant.audio_enabled,
		isActiveSpeaker: activeSpeakerIds.value.includes(participant.user_id),
		videoRef: getRemoteVideoRef(participant.user_id),
		tileCount: isPinned ? 1 : visibleTileCount.value,
		showReaction: pinnedTiles.value.length === 0,
		style: isPinned
			? pinnedTileStyles.value[`participant-${participant.user_id}`]
			: participant.isVisible
				? tileStyle.value
				: undefined,
	};
};

// ── Local participant object ───────────────────────────────────────────────────

const localParticipant = computed(() => {
	const userIdRaw = currentUser.value?.user_id;
	const fullNameRaw = currentUser.value?.full_name;
	const nameRaw = currentUser.value?.name;
	const avatarRaw = currentUser.value?.avatar;

	const user_id =
		typeof userIdRaw === "string"
			? userIdRaw
			: userIdRaw == null
				? "local"
				: String(userIdRaw);
	const displayNameRaw = fullNameRaw ?? nameRaw ?? "You";
	const user_name =
		typeof displayNameRaw === "string"
			? displayNameRaw
			: String(displayNameRaw);
	const avatar =
		typeof avatarRaw === "string"
			? avatarRaw
			: avatarRaw == null
				? ""
				: String(avatarRaw);

	return { user_id, user_name, avatar, initials: getInitials(user_name) };
});

// Number of extra strip tiles (pinned screenshares overlay the main panel instead)
const extraTileCount = computed(() => {
	const hasPinnedScreenShare = pinnedTiles.value.some(
		(t) => t.type === "screenshare",
	);
	if (!hasPinnedScreenShare) return allScreenShareTiles.value.length;
	return Math.max(0, allScreenShareTiles.value.length - 1);
});

// ── Layout composable ─────────────────────────────────────────────────────────

const {
	mode,
	containerStyle,
	containerClass,
	tileStyle,
	displayParticipants,
	allParticipants,
	visibleTileCount,
	hiddenParticipantsTooltip,
} = useLayout(
	participants,
	pinnedTiles,
	{
		raisedHands: computed(() => meetingCtx.raiseHandStore.raisedHands),
		activeSpeakerIds: computed(
			() => meetingCtx.participantStore.activeSpeakerIds,
		),
		stableSpeakerIds: computed(
			() => meetingCtx.participantStore.stableSpeakerIds,
		),
	},
	extraTileCount,
);

const { isFlipAnimating, pinnedTileStyles } = usePinnedTileAnimation({
	container,
	pinnedPanelsMap,
	pinnedTiles,
	visibleTileCount,
});

// ── Floating reactions ────────────────────────────────────────────────────────
// Grid mode: only reactions from hidden participants (visible tiles show their own)
// Sidebar mode: reactions from all participants (sidebar tiles use ParticipantTile
//   which shows reactions, main screen area doesn't)

const floatingReactions = computed(() => {
	const reactions = meetingCtx.reactionStore.reactions;
	const currentUserId = (currentUser.value as Record<string, unknown> | null)
		?.user_id as string | undefined;

	let sourceIds: Set<string>;
	if (mode.value === "grid") {
		sourceIds = new Set(displayParticipants.value.hidden.map((p) => p.user_id));
	} else {
		sourceIds = new Set([
			...Object.keys(participants.value),
			...(currentUserId ? [currentUserId] : []),
		]);
	}

	const result: Array<{
		userId: string;
		userName: string;
		emoji: string;
		timestamp: number;
		expiresAt: number;
		uniqueId: string;
	}> = [];
	for (const [userId, reaction] of Object.entries(reactions)) {
		if (!sourceIds.has(userId) || !reaction) continue;
		const participant =
			userId === currentUserId ? currentUser.value : participants.value[userId];
		const p = participant as Record<string, unknown> | null;
		const userName =
			(p?.user_name as string) ||
			(p?.full_name as string) ||
			(p?.name as string) ||
			(p?.user_id as string) ||
			"Unknown";
		result.push({
			userId,
			userName,
			emoji: (reaction as { emoji: string }).emoji,
			timestamp: (reaction as { expiresAt: number }).expiresAt - 5000,
			expiresAt: (reaction as { expiresAt: number }).expiresAt,
			uniqueId: `${userId}-${(reaction as { emoji: string }).emoji}-${(reaction as { expiresAt: number }).expiresAt}`,
		});
	}

	return result
		.sort((a, b) => {
			const diff = b.timestamp - a.timestamp;
			return diff !== 0 ? diff : a.userId.localeCompare(b.userId);
		})
		.slice(0, 6);
});
</script>

<style scoped>
/* Pinned tile overlays the pinned panel placeholder */
.pinned-tile {
	border-radius: 0.5rem;
	overflow: hidden;
	pointer-events: auto;
	will-change: transform, top, left, width, height;
	backface-visibility: hidden;
}

/* Hidden tiles stay mounted to preserve grid animation continuity */
.hidden-tile {
	position: absolute;
	opacity: 0;
	pointer-events: none;
	transform: scale(0);
	bottom: 0;
	right: 0;
	z-index: 0;
}

.tile-enter-from,
.tile-leave-to {
	opacity: 0;
	transform: scale(0.85);
}

.tile-enter-active,
.tile-leave-active {
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.tile-move {
	transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
}

.tile-leave-active {
	position: absolute;
	z-index: 0;
}

</style>
