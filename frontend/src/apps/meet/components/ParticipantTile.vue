<template>
	<div
		class="group relative rounded-md overflow-hidden min-h-0"
		:class="tileBackgroundClass"
		:data-testid="`participant-tile-${participant.user_id}`"
		:data-audio-enabled="String(isAudioEnabled)"
		:data-video-enabled="String(isVideoEnabled)"
		:data-tile-id="`${pinType}-${tileId}`"
	>
		<video
			:ref="videoRef"
			:data-participant-id="participant.user_id"
			class="block w-full h-full remote-video"
			:class="[videoObjectFitClass, videoBackgroundClass]"
			:style="{ transform: isLocal ? 'scaleX(-1) translateZ(0)' : 'translateZ(0)' }"
			autoplay
			muted
			playsinline
		/>

		<!-- Infinity mirror cover for local screen share presenter -->
		<div
			v-if="participant.isLocalScreenShare && showBlur"
			class="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-md"
		>
			<lucide-monitor-up class="w-8 h-8 text-white mb-6" />
			<div
				v-if="showScreenShareCopy"
				class="text-white text-xl-medium mb-1"
			>
				You are sharing your screen
			</div>
			<div
				v-if="showScreenShareCopy"
				class="text-white text-sm-medium"
			>
				Everyone else can see what you are presenting
			</div>
		</div>

		<div
			v-if="showAvatar && !isVideoEnabled && !participant.isLocalScreenShare"
			class="absolute inset-0 flex items-center justify-center pointer-events-none"
			:class="avatarBackgroundClass"
		>
			<MeetAvatar
				size="3xl"
				:image="participant.avatar"
				:label="participant.user_name || participant.initials"
			/>
		</div>

		<NamePill
			:name="resolvedDisplayName"
			:size="labelSize"
			:position="labelPosition"
		>
			<template v-if="showAudioState">
				<AudioIndicator
					v-if="isAudioEnabled && stream"
					:mediaStream="stream"
					:isActive="true"
					:maxHeight="12"
					:sensitivity="3.0"
					activeColorClass="bg-white"
				/>
				<lucide-mic-off v-else-if="!isAudioEnabled" class="w-3 h-3 shrink-0 text-white" />
			</template>
		</NamePill>

		<!-- Reaction -->
		<div
			v-if="showReaction && currentReaction"
			class="absolute top-1 px-2 py-1 rounded-md text-3xl pointer-events-none animate-pop"
			:class="{ 'left-2': !isHandRaised, 'left-10': isHandRaised }"
			:aria-label="`Reaction ${currentReaction.emoji} from ${resolvedDisplayName}`"
			role="img"
		>
			<span class="text-4xl">{{ currentReaction.emoji }}</span>
		</div>

		<!-- Raised Hand -->
		<div
			v-if="showRaisedHand && isHandRaised"
			class="absolute top-2 left-2 px-2 py-1 rounded-full !bg-[#e54e17] text-white pointer-events-none flex items-center justify-center"
			:aria-label="`${resolvedDisplayName} has raised their hand`"
		>
			<lucide-hand class="w-4 h-4" :class="{ wave: isAnimating }" />
		</div>

		<div
			v-if="showNetworkState && showNetworkIndicator"
			class="absolute top-2 right-2 bg-gray-700 rounded-full p-1.5 ring-1 ring-gray-800"
			:title="networkQualityMessage"
		>
			<WifiAlertIcon class="w-4 h-4 text-white" />
		</div>

		<!-- Participant action toolbar -->
		<div
			v-if="showActionToolbar"
			class="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-full bg-gray-700 p-0.5 text-white opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity ring-1 ring-gray-800"
			@click.stop
		>
			<Button
				v-if="canShowPinButton"
				variant="ghost"
				size="xs"
				class="!rounded-full !text-white hover:!bg-gray-600"
				:class="{ '!bg-gray-600': isPinned }"
				:tooltip="isPinned ? 'Unpin participant' : 'Pin participant'"
				@click="togglePin"
			>
				<template #icon>
					<lucide-pin-off v-if="isPinned" class="w-3.5 h-3.5" />
					<lucide-pin v-else class="w-3.5 h-3.5" />
				</template>
			</Button>
			<Button
				v-if="canShowHostControls && isAudioEnabled"
				variant="ghost"
				size="xs"
				class="!rounded-full !text-white hover:!bg-gray-600"
				tooltip="Mute participant"
				@click="handleMute"
			>
				<template #icon>
					<lucide-mic-off class="w-3.5 h-3.5" />
				</template>
			</Button>
			<Button
				v-if="canShowHostControls"
				variant="ghost"
				size="xs"
				class="!rounded-full !text-white hover:!bg-gray-600"
				tooltip="Remove participant"
				@click="showKickDialog = true"
			>
				<template #icon>
					<lucide-user-x class="w-3.5 h-3.5" />
				</template>
			</Button>
		</div>

		<!-- Kick Confirmation Dialog -->
		<KickParticipantDialog
			v-if="canShowHostControls"
			v-model="showKickDialog"
			:participant-name="resolvedDisplayName || 'this participant'"
			@confirm="handleKick"
		/>
	</div>
</template>

<script setup lang="ts">
import { Button } from "frappe-ui";
import { type ComputedRef, computed, inject, type Ref, ref, watch } from "vue";
import { useAudioStream } from "../composables/useAudioLevels";
import { useMeetingContext } from "../composables/useMeetingContext";
import { useNetworkQuality } from "../composables/useNetworkQuality";
import WifiAlertIcon from "../icons/WifiAlertIcon.vue";
import type { Participant } from "../utils/media/ParticipantManager";
import AudioIndicator from "./AudioIndicator.vue";
import KickParticipantDialog from "./KickParticipantDialog.vue";
import MeetAvatar from "./MeetAvatar.vue";
import NamePill from "./NamePill.vue";

type TileSize = "xs" | "sm" | "md";
type TilePosition = "bottom-left" | "top-left" | "top-right" | "bottom-right";

interface Props {
	participant: Participant;
	isLocal?: boolean;
	isVideoEnabled?: boolean;
	isAudioEnabled?: boolean;
	isActiveSpeaker?: boolean;
	videoRef: (el: unknown) => void;
	labelSize?: TileSize;
	labelPosition?: TilePosition;
	pinType?: "screenshare" | "participant";
	pinId?: string | null;
	showPinButton?: boolean;
	showAvatar?: boolean;
	showReaction?: boolean;
	showRaisedHand?: boolean;
	showAudioState?: boolean;
	showNetworkState?: boolean;
	tileBackgroundClass?: string;
	avatarBackgroundClass?: string;
	videoObjectFitClass?: string;
	videoBackgroundClass?: string;
	displayName?: string;
}

const props = withDefaults(defineProps<Props>(), {
	isLocal: false,
	isVideoEnabled: true,
	isAudioEnabled: true,
	isActiveSpeaker: false,
	labelSize: "md",
	labelPosition: "bottom-left",
	pinType: "participant",
	pinId: null,
	showPinButton: true,
	showAvatar: true,
	showReaction: true,
	showRaisedHand: true,
	showAudioState: true,
	showNetworkState: true,
	tileBackgroundClass: "bg-surface-gray-3",
	avatarBackgroundClass: "bg-surface-gray-3",
	videoObjectFitClass: "object-cover",
	videoBackgroundClass: "",
	displayName: "",
});

const meetingCtx = useMeetingContext();
const isCurrentUserHost = inject<Ref<boolean> | ComputedRef<boolean>>(
	"isCurrentUserHost",
	ref(false),
);
const hostControls = inject<{
	muteParticipant: (participantId: string) => void;
	kickParticipant: (participantId: string, ban: boolean) => void;
}>("hostControls", null);

const tileId = computed(() => props.pinId || props.participant.user_id);

const showBlur = ref(props.participant.isLocalScreenShare);

const showScreenShareCopy = computed(() => {
	return !meetingCtx?.gridLayout.pinnedTiles.value.length || isPinned.value;
});

const { stream } = useAudioStream(props.participant.user_id, {
	mediaState: meetingCtx?.mediaState,
	currentUser: meetingCtx?.currentUser,
});

const { networkQuality } = useNetworkQuality();

const resolvedDisplayName = computed(() => {
	return (
		props.displayName ||
		props.participant.user_name ||
		(props.participant.is_guest ? "Guest" : "")
	);
});

const computedNetworkQuality = computed(() => {
	if (props.isLocal) {
		return networkQuality.value;
	}
	return props.participant.networkQuality || "good";
});

const showNetworkIndicator = computed(() => {
	return computedNetworkQuality.value !== "good";
});

const networkQualityMessage = computed(() => {
	const quality = computedNetworkQuality.value;
	const isLocal = props.isLocal;
	const name = resolvedDisplayName.value || "This participant";

	if (quality === "critical") {
		return isLocal
			? "Your internet connection is unstable. Video and audio might lag or drop."
			: `${name}'s internet connection is unstable.`;
	}
	if (quality === "poor") {
		return isLocal
			? "Your internet connection is weak. You might notice some lag."
			: `${name}'s internet connection is weak.`;
	}
	return "";
});

const currentReaction = computed(() => {
	if (!meetingCtx?.reactionStore.reactions) return null;
	return meetingCtx.reactionStore.reactions[props.participant.user_id] || null;
});

const isHandRaised = computed(() => {
	if (!meetingCtx?.raiseHandStore.raisedHands) return false;
	return !!meetingCtx.raiseHandStore.raisedHands[props.participant.user_id];
});

const isAnimating = ref(false);

watch(isHandRaised, (newValue, oldValue) => {
	if (newValue && !oldValue) {
		isAnimating.value = true;
		setTimeout(() => {
			isAnimating.value = false;
		}, 1500);
	}
});

const isPinned = computed(() => {
	const pinnedList = meetingCtx?.gridLayout.pinnedTiles.value || [];
	return pinnedList.some(
		(p) => p.type === props.pinType && p.id === tileId.value,
	);
});

const canShowPinButton = computed(() => {
	return (
		!props.isLocal &&
		props.showPinButton &&
		!!meetingCtx?.gridLayout.pinTile &&
		!!tileId.value
	);
});

const togglePin = () => {
	if (!tileId.value || !meetingCtx) return;
	if (isPinned.value) {
		meetingCtx.gridLayout.unpinTile(props.pinType, tileId.value);
	} else {
		meetingCtx.gridLayout.pinTile(props.pinType, tileId.value);
	}
};

const canShowHostControls = computed(() => {
	return !props.isLocal && isCurrentUserHost.value && !!hostControls;
});

const showActionToolbar = computed(() => {
	return canShowPinButton.value || canShowHostControls.value;
});

const showKickDialog = ref(false);

const handleMute = () => {
	hostControls?.muteParticipant(props.participant.user_id);
};

const handleKick = (ban) => {
	hostControls?.kickParticipant(props.participant.user_id, ban);
	showKickDialog.value = false;
};
</script>

<style scoped>
/* Firefox blank video mitigation */
.remote-video {
	background-color: #000;
	will-change: transform;
	transform: translateZ(0);
}

@-moz-document url-prefix() {
	.remote-video {
		background-color: #111;
		opacity: 0.99;
	}
}

video.remote-video::-moz-focus-inner {
	border: 0;
}

/* Reaction animation */
.animate-pop {
	animation: pop 360ms cubic-bezier(.2,.9,.3,1);
}
@keyframes pop {
	0% { transform: scale(0.75); opacity: 0 }
	60% { transform: scale(1.08); opacity: 1 }
	100% { transform: scale(1); opacity: 1 }
}

/* Raised-hand wave (was a global rule in the standalone app's index.css) */
.wave {
	display: inline-block;
	transform-origin: 70% 70%;
	animation: hand-wave 900ms ease-in-out infinite;
}
@keyframes hand-wave {
	0% { transform: rotate(0deg); }
	15% { transform: rotate(20deg); }
	40% { transform: rotate(-12deg); }
	65% { transform: rotate(8deg); }
	100% { transform: rotate(0deg); }
}
</style>
